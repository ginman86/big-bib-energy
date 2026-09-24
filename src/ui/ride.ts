import { LevelFilter, powerLevel } from '../core/avatar';
import { bandHalfWidth } from '../core/compliance';
import { ErgGovernor, ErgState } from '../core/erg';
import { leadTarget, StepResponse } from '../core/latency';
import { clock, pct } from '../core/format';
import { Session, Snapshot } from '../core/session';
import type { Workout } from '../core/workout';
import { zoneFor } from '../core/zones';
import { SimulatedTrainer } from '../devices/simulated';
import type { HeartRateMonitor } from '../devices/heart-rate';
import type { ControlMode, Trainer } from '../devices/trainer';
import { Avatar, Rider } from './avatar';
import { $, esc, html, setText } from './dom';
import { drawProfile } from './profile';

export interface RideProps {
  workout: Workout;
  ftp: number;
  mode: ControlMode;
  trainer: Trainer;
  /** A standalone strap takes precedence over any HR the trainer reports. */
  heartRate?: HeartRateMonitor;
  avatar: Rider | 'off';
  onModeChange(mode: ControlMode): void;
  onFinish(session: Session): void;
  onQuit(): void;
}

/** Grade used in target mode: flat-ish road, the rider picks gears to hit the number. */
const TARGET_MODE_GRADE = 1;
// Main chart: a tight window so the road visibly moves at 1× (~12 px/s on a laptop).
// The overview strip above carries the whole-workout context.
const WINDOW_BEHIND = 40;
const WINDOW_SPAN = 150;
/** Send ERG step changes this early so the trainer's control loop lands them on the boundary. */
const ERG_LEAD_S = 1;
/** Time constant for gliding the big power number between readings. */
const GLIDE_S = 0.2;

export function renderRide(root: HTMLElement, props: RideProps): () => void {
  const { workout, ftp, trainer } = props;
  const session = new Session(workout, ftp);
  const sim = trainer instanceof SimulatedTrainer ? trainer : undefined;
  // A read-only power meter can't hold watts for you.
  let mode: ControlMode = trainer.controllable ? props.mode : 'target';
  // ERG soft start: free road until the rider is spinning, then ramp in.
  const erg = new ErgGovernor();
  let ergState: ErgState | undefined;
  let freeSent = false;
  let speed = 1;

  const page = html(`
    <main class="ride">
      <header class="ride-head">
        <span class="wordmark">BB<i>/</i>E</span>
        <span class="title">${esc(workout.name)}</span>
        <span class="spacer"></span>
        <div class="seg" data-role="mode">
          <button data-mode="erg">ERG</button>
          <button data-mode="target">Target</button>
        </div>
        <span class="clock num"><b data-f="elapsed">0:00</b> / ${clock(session.duration)}</span>
        <button class="btn" data-role="skip" title="Skip interval (→)">Skip</button>
        <button class="btn" data-role="pause" title="Pause (Space)">Pause</button>
      </header>

      <canvas class="overview"></canvas>
      <canvas class="window"></canvas>

      <aside class="hud" hidden></aside>

      <section class="hero${props.avatar !== 'off' ? ' with-avatar' : ''}">
        <div class="power num"><span data-f="power">0</span><small>W</small></div>
        <div class="verdict">
          <div class="gauge-target"><span class="label">Target</span><span class="num" data-f="target">—</span><span class="label">W</span></div>
          <div class="gauge">
            <div class="track"></div>
            <div class="band"></div>
            <div class="marker"></div>
          </div>
          <div class="state" data-f="state">Ready</div>
        </div>
        <div class="interval-clock">
          <span class="label" data-f="zone">—</span>
          <span class="num" data-f="remaining">0:00</span>
          <div class="seg-label" data-f="segment">—</div>
        </div>
      </section>

      <footer class="strip">
        <div><span class="label">Cadence</span><span class="num" data-f="cadence">—</span></div>
        <div><span class="label">Heart rate</span><span class="num" data-f="hr">—</span></div>
        <div><span class="label">Interval on target</span><span class="num" data-f="segpct">—</span></div>
        <div><span class="label">Ride on target</span><span class="num" data-f="ridepct">—</span></div>
        <div class="next"><span class="label">Next</span><span class="num" data-f="next">—</span></div>
      </footer>
    </main>
  `);

  const f = (name: string) => $(page, `[data-f=${name}]`);
  const fields = {
    elapsed: f('elapsed'),
    power: f('power'),
    target: f('target'),
    state: f('state'),
    zone: f('zone'),
    remaining: f('remaining'),
    segment: f('segment'),
    cadence: f('cadence'),
    hr: f('hr'),
    segpct: f('segpct'),
    ridepct: f('ridepct'),
    next: f('next'),
  };
  const band = $(page, '.gauge .band');
  const marker = $(page, '.gauge .marker');
  const nextBox = $(page, '.next');
  const overview = $<HTMLCanvasElement>(page, '.overview');
  const windowCanvas = $<HTMLCanvasElement>(page, '.window');
  const pauseBtn = $<HTMLButtonElement>(page, '[data-role=pause]');

  const avatar = props.avatar !== 'off' ? new Avatar(props.avatar) : undefined;
  const levels = new LevelFilter();
  if (avatar) $(page, '.hero').prepend(avatar.el);

  // Overlay for ready / paused.
  const veil = html(`
    <div class="paused-veil">
      <div>
        <div class="label" style="text-align:center" data-v="kicker">${esc(workout.name)}</div>
        <div class="big" data-v="title">Ready</div>
        <div class="actions">
          <button class="btn primary" data-v="go">Start</button>
          <button class="btn" data-v="end" hidden>End ride</button>
          <button class="btn" data-v="quit">Quit</button>
        </div>
        <p class="label" style="text-align:center;margin-top:28px;color:var(--text-3)">Space pause · → skip · L latency${sim ? ' · ↑↓ push the rider' : ''}</p>
      </div>
    </div>
  `);

  if (sim) {
    const panel = html(`
      <div class="sim-panel">
        <span class="label">Sim</span>
        <div class="seg" data-role="speed">
          ${[1, 4, 16].map((s) => `<button data-speed="${s}" aria-pressed="${s === 1}">${s}×</button>`).join('')}
        </div>
        <button class="btn" data-bias="-15" title="↓">−</button>
        <span class="label num" data-role="bias" style="min-width:48px;text-align:center">±0 W</span>
        <button class="btn" data-bias="15" title="↑">+</button>
      </div>
    `);
    panel.querySelectorAll<HTMLButtonElement>('[data-speed]').forEach((b) =>
      b.addEventListener('click', () => {
        speed = Number(b.dataset.speed);
        panel.querySelectorAll('[data-speed]').forEach((x) => x.setAttribute('aria-pressed', String(x === b)));
      }),
    );
    panel.querySelectorAll<HTMLButtonElement>('[data-bias]').forEach((b) => b.addEventListener('click', () => nudge(Number(b.dataset.bias))));
    $(page, '.ride-head .spacer').after(panel);
  }

  function nudge(watts: number) {
    if (!sim) return;
    sim.bias += watts;
    const el = page.querySelector<HTMLElement>('[data-role=bias]');
    if (el) setText(el, sim.bias === 0 ? '±0 W' : `${sim.bias > 0 ? '+' : '−'}${Math.abs(sim.bias)} W`);
  }

  function applyMode(m: ControlMode) {
    if (!trainer.controllable) m = 'target';
    mode = m;
    erg.reset();
    freeSent = false;
    page.querySelectorAll('[data-mode]').forEach((b) => b.setAttribute('aria-pressed', String((b as HTMLElement).dataset.mode === m)));
    if (m === 'target') void trainer.setGrade(TARGET_MODE_GRADE);
  }

  function showVeil(state: 'ready' | 'paused') {
    setText($(veil, '[data-v=title]'), state === 'ready' ? 'Ready' : 'Paused');
    setText($(veil, '[data-v=go]'), state === 'ready' ? 'Start' : 'Resume');
    $(veil, '[data-v=end]').hidden = state === 'ready';
    if (!veil.isConnected) root.append(veil);
  }

  function togglePause() {
    if (session.status === 'running') {
      session.pause();
      showVeil('paused');
      setText(pauseBtn, 'Resume');
    } else if (session.status === 'ready' || session.status === 'paused') {
      session.start();
      veil.remove();
      setText(pauseBtn, 'Pause');
    }
  }

  function end() {
    session.finish();
  }

  $(veil, '[data-v=go]').addEventListener('click', togglePause);
  $(veil, '[data-v=end]').addEventListener('click', end);
  $(veil, '[data-v=quit]').addEventListener('click', () => props.onQuit());
  pauseBtn.addEventListener('click', togglePause);
  $(page, '[data-role=skip]').addEventListener('click', () => session.skip());
  page.querySelectorAll<HTMLButtonElement>('[data-mode]').forEach((b) =>
    b.addEventListener('click', () => {
      applyMode(b.dataset.mode as ControlMode);
      props.onModeChange(mode);
    }),
  );

  const onKey = (e: KeyboardEvent) => {
    if (e.target instanceof HTMLInputElement) return;
    if (e.code === 'Space') {
      e.preventDefault();
      togglePause();
    } else if (e.key === 'ArrowRight') session.skip();
    else if (e.key === 'ArrowUp') {
      e.preventDefault();
      nudge(15);
    } else if (e.key === 'ArrowDown') {
      e.preventDefault();
      nudge(-15);
    } else if (e.key === 'Escape' && session.status === 'running') togglePause();
    else if (e.key === 'l' || e.key === 'L') hud.hidden = !hud.hidden;
  };
  window.addEventListener('keydown', onKey);

  root.append(page);
  if (!trainer.controllable) {
    const erg = $<HTMLButtonElement>(page, '[data-mode=erg]');
    erg.disabled = true;
    erg.title = `${trainer.name} is a power meter — ERG needs a controllable trainer`;
  }
  applyMode(mode);
  showVeil('ready');

  const docEl = document.documentElement;
  let raf = 0;
  let last = performance.now();
  let lastOverview = 0;
  let lastHud = 0;
  let shownPower = 0;
  const steps = new StepResponse();
  const hud = $(page, '.hud');
  let finished = false;

  const frame = (now: number) => {
    // rAF timestamps can precede the performance.now() taken at setup; never go backwards.
    const realDt = Math.min(0.25, Math.max(0, (now - last) / 1000));
    const dt = realDt * speed;
    last = now;

    const targetW = session.targetWatts();
    const running = session.status === 'running';
    if (sim) sim.goal = targetW;
    // The sim keeps pedalling while paused/ready so the numbers are live, but ride time doesn't move.
    trainer.tick?.(running ? dt : Math.min(dt, 0.25));
    const reading = trainer.latest();

    ergState = undefined;
    if (mode === 'erg') {
      const leadW = running ? Math.round((leadTarget(session.segments, session.elapsed, ERG_LEAD_S) ?? 0) * ftp) : targetW;
      const cmd = erg.update({ nowMs: now, active: running, targetW: leadW, powerW: reading.power, cadence: reading.cadence });
      if (cmd.kind === 'erg') {
        freeSent = false;
        void trainer.setTargetPower(cmd.watts);
        steps.command(cmd.watts, now);
        steps.reading(reading.power, now);
      } else if (!freeSent) {
        freeSent = true;
        void trainer.setGrade(0);
      }
      ergState = erg.state;
    }

    const snap = session.advance(
      running ? dt : 0,
      {
        ...reading,
        // With a strap connected, never fall back to the trainer's (or the simulator's) value.
        heartRate: props.heartRate ? props.heartRate.latest() : reading.heartRate,
      },
      // Don't score the rider while ERG is still engaging.
      { unscored: ergState !== undefined && ergState !== 'engaged' },
    );
    render(snap, now, realDt);

    if (session.status === 'finished') {
      if (!finished) {
        finished = true;
        props.onFinish(session);
      }
      return;
    }
    raf = requestAnimationFrame(frame);
  };

  function verdict(s: Snapshot, live: boolean, diff: number): string {
    if (!live) return session.status === 'ready' ? 'Ready' : 'Paused';
    if (ergState === 'released') return 'Pedal to engage';
    if (ergState === 'ramping') return 'ERG engaging';
    if (s.settling) return 'Settle in';
    if (s.band === 'on') return 'On target';
    return s.band === 'under' ? `Push +${diff} W` : `Ease off −${diff} W`;
  }

  function renderHud(now: number) {
    const st = trainer.stats?.(now);
    const ms = (v?: number) => (v === undefined ? '—' : v >= 1000 ? `${(v / 1000).toFixed(1)} s` : `${Math.round(v)} ms`);
    const rows: [string, string][] = [
      ['Trainer', `${trainer.name} · ${trainer.protocol}`],
      ['Data rate', st ? `${st.hz.toFixed(1)} Hz` : 'simulated'],
      ['Last reading', st ? ms(st.ageMs) : '—'],
      ['ERG step response', steps.last === undefined ? 'no steps yet' : `${ms(steps.last)} (avg ${ms(steps.average)}, n=${steps.samples.length})`],
      ['ERG lead', `${ERG_LEAD_S} s`],
      ['Display smoothing', '3 s average + glide'],
    ];
    hud.innerHTML = rows.map(([k, v]) => `<div><span class="label">${k}</span><span>${esc(v)}</span></div>`).join('');
  }

  function render(s: Snapshot, now: number, realDt: number) {
    const live = session.status === 'running';
    docEl.dataset.band = live && !s.settling ? s.band : '';
    docEl.dataset.settling = String(s.settling);
    // Stay calm until the ride is actually rolling.
    avatar?.set(levels.update(live ? powerLevel(zoneFor(s.powerW / ftp)) : 1, now));

    setText(fields.elapsed, clock(s.elapsed));
    // Glide toward the new value instead of snapping; ~0.2 s, far below the 3 s smoothing.
    shownPower += (s.powerW - shownPower) * (1 - Math.exp(-realDt / GLIDE_S));
    setText(fields.power, String(Math.round(shownPower)));
    if (!hud.hidden && now - lastHud > 250) {
      lastHud = now;
      renderHud(now);
    }
    setText(fields.target, String(s.targetW));
    const diff = Math.round(Math.abs(s.targetW - s.powerW));
    setText(fields.state, verdict(s, live, diff));

    // Gauge spans target ±25% (at least ±40 W); the band is the tolerance window.
    const range = Math.max(s.targetW * 0.25, 40);
    const half = bandHalfWidth(s.targetW, session.tolerance);
    const pos = Math.min(1, Math.max(0, (s.powerW - (s.targetW - range)) / (2 * range)));
    marker.style.left = `${pos * 100}%`;
    band.style.left = `${((range - half) / (2 * range)) * 100}%`;
    band.style.width = `${(half / range) * 100}%`;

    if (s.segment) {
      setText(fields.remaining, clock(s.segmentRemaining));
      setText(fields.segment, s.segment.label);
      const zone = zoneFor((s.segment.from + s.segment.to) / 2);
      setText(fields.zone, `Z${zone.id} · ${zone.name}`);
    }
    setText(fields.cadence, s.cadence ? String(s.cadence) : '—');
    setText(fields.hr, s.heartRate ? String(s.heartRate) : '—');
    setText(fields.segpct, s.settling ? '—' : pct(s.segmentCompliance));
    setText(fields.ridepct, pct(s.totalCompliance));
    if (s.next) {
      const nextW = Math.round(s.next.from * ftp);
      setText(fields.next, `${clock(s.next.end - s.next.start)} @ ${nextW} W · in ${clock(s.segmentRemaining)}`);
      nextBox.classList.toggle('soon', live && s.segmentRemaining <= 10);
    } else {
      setText(fields.next, 'Finish');
      nextBox.classList.remove('soon');
    }

    const t0 = Math.max(0, s.elapsed - WINDOW_BEHIND);
    drawProfile(windowCanvas, {
      segments: session.segments,
      ftp,
      samples: session.samples,
      elapsed: s.elapsed,
      range: [t0, t0 + WINDOW_SPAN],
      live: { t: s.elapsed, power: s.powerW, target: s.targetW },
      tolerance: session.tolerance,
      detailed: true,
    });
    if (now - lastOverview > 500) {
      lastOverview = now;
      drawProfile(overview, { segments: session.segments, ftp, samples: session.samples, elapsed: s.elapsed });
    }
  }

  raf = requestAnimationFrame(frame);

  return () => {
    cancelAnimationFrame(raf);
    window.removeEventListener('keydown', onKey);
    veil.remove();
    delete docEl.dataset.band;
    delete docEl.dataset.settling;
  };
}
