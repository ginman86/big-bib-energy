import { encodeFitActivity, fitFileName } from '../core/fit';
import { climbText, clock, distanceText, pct, speedText, Units } from '../core/format';
import { HR_ZONES, suggestLthr, sustainedMaxHr, timeInHrZones } from '../core/hr';
import { mean } from '../core/metrics';
import type { RideSummary, Session } from '../core/session';
import { asset } from './asset';
import { $, esc, html } from './dom';
import type { StravaStatus } from '../api/uploads';
import { drawHrStrip } from './hr-chart';
import { animateXp, Reveal, xpReveal } from './progress';
import { drawProfile } from './profile';

export interface SummaryProps {
  session: Session;
  /** Present when signed in with Strava: uploads the ride and resolves with the outcome. */
  upload?: () => Promise<StravaStatus>;
  /** XP, rank and patches earned by this ride. */
  reveal?: Reveal;
  /** Simulated rides don't auto-upload (no fake activities on Strava); offer a button instead. */
  manualUpload?: boolean;
  lthr?: number;
  /** Simulated rides show a ramp test result but don't offer it as your FTP. */
  simulated?: boolean;
  units: Units;
  onAcceptLthr(lthr: number): void;
  onAcceptFtp(ftp: number): void;
  onDone(): void;
}

function hrSection(session: Session, lthr: number | undefined, blocks: ReturnType<Session['summary']>['segments']): string {
  const hr = session.samples.flatMap((x) => (x.heartRate ? [x.heartRate] : []));
  if (!hr.length) return '';
  const zones = lthr ? timeInHrZones(session.samples, lthr) : [];
  const total = zones.reduce((a, b) => a + b, 0) || 1;
  const suggestion = suggestLthr(session.samples, blocks);
  const worthSuggesting = suggestion && (!lthr || Math.abs(suggestion.lthr - lthr) >= 3);
  return `
    <section class="hr-summary">
      <h2 class="section-title">Heart rate</h2>
      <div class="hr-summary-grid">
        <div class="hr-kpis">
          <div><span class="label">Avg</span><span class="num">${Math.round(mean(hr))}</span></div>
          <div><span class="label">Max</span><span class="num">${sustainedMaxHr(session.samples) ?? '—'}</span></div>
          ${lthr ? `<div><span class="label">LTHR</span><span class="num">${lthr}</span></div>` : ''}
        </div>
        ${
          lthr
            ? `<div class="hr-zones">${HR_ZONES.map(
                (z, i) => `
              <div class="hr-zone-row">
                <span class="label">Z${z.id} · ${z.name}</span>
                <div class="bar"><span style="width:${(zones[i] / total) * 100}%;background:var(--hr${z.id})"></span></div>
                <span class="num">${clock(zones[i])}</span>
              </div>`,
              ).join('')}</div>`
            : `<p class="trainer-status">Set your LTHR on the home screen to see time in zones.</p>`
        }
      </div>
      <canvas class="hr-chart-summary"></canvas>
      ${
        worthSuggesting
          ? `<div class="lthr-card">
              <div>
                <span class="label">Zone check</span>
                <p>Your heart rate settled across ${suggestion.blocks} sustained block${suggestion.blocks > 1 ? 's' : ''}.
                Estimated LTHR <b>${suggestion.lthr} bpm</b>${lthr ? ` (currently ${lthr})` : ''}.</p>
              </div>
              <button class="btn primary" data-role="accept-lthr" data-lthr="${suggestion.lthr}">Update zones</button>
            </div>`
          : ''
      }
    </section>`;
}

function rampSection(s: RideSummary, simulated?: boolean): string {
  const r = s.rampTest;
  if (!r) return '';
  const change = r.ftp - s.ftp;
  const delta = change === 0 ? 'same as now' : `${change > 0 ? '+' : '−'}${Math.abs(change)} W on ${s.ftp} W`;
  const note = r.topped
    ? 'You rode every step, so this is a floor: your FTP is at least this.'
    : `Step ${r.steps} of the ramp. Best minute ${r.bestMinuteW} W × 75%.` +
      (change < -0.1 * s.ftp ? ' Well below your current FTP: if you stopped for another reason, keep the old one.' : '');
  const action = simulated
    ? '<span class="label">Simulated · FTP unchanged</span>'
    : change === 0
      ? ''
      : `<button class="btn primary" data-role="accept-ftp" data-ftp="${r.ftp}">Set FTP to ${r.ftp} W</button>`;
  return `
    <section class="ramp-result">
      <div>
        <span class="label">Ramp test · FTP</span>
        <div class="ramp-ftp"><span class="num">${r.ftp}</span><small>W</small><span class="label">${delta}</span></div>
        <p>${note}</p>
      </div>
      ${action}
    </section>`;
}

/** Hold the line this well and you've earned the flaming bibs. */
const CREST_COMPLIANCE = 0.9;

function verdict(compliance: number): string {
  if (compliance >= 0.9) return 'Dialled <em>in.</em>';
  if (compliance >= 0.75) return 'Solid <em>work.</em>';
  if (compliance >= 0.5) return 'Got it <em>done.</em>';
  return 'Ride <em>logged.</em>';
}

function stravaLine(st: StravaStatus | 'uploading'): string {
  if (st === 'uploading') return `<span class="trainer-status">Uploading to Strava…</span>`;
  switch (st.status) {
    case 'uploaded':
      return `<a class="view-on-strava" href="${esc(st.url ?? '')}" target="_blank" rel="noopener">View on Strava</a>`;
    case 'processing':
      return `<span class="trainer-status">Strava is still processing. It'll appear shortly.</span>`;
    case 'not-connected':
      return `<span class="trainer-status">Reconnect Strava from home to allow uploads.</span>`;
    default:
      return `<span class="trainer-status">${esc(st.error ?? 'Strava upload failed')}</span>
        <button class="link" data-role="retry-upload">Retry</button>`;
  }
}

export function renderSummary(
  root: HTMLElement,
  { session, lthr, simulated, units, onAcceptLthr, onAcceptFtp, onDone, upload, manualUpload, reveal }: SummaryProps,
): () => void {
  const s = session.summary();
  const scored = s.segments.filter((x) => x.under + x.over + x.compliance > 0);

  const page = html(`
    <main class="summary">
      <header class="topbar">
        <span class="wordmark">Big Bib<i>/</i>Energy</span>
        <div style="display:flex;gap:12px">
          ${session.samples.length ? '<button class="btn" data-role="fit">Download .fit</button>' : ''}
          <button class="btn primary" data-role="done">Done</button>
        </div>
      </header>

      <section class="summary-head">
        <div>
          <h1>${s.rampTest ? 'Emptied the <em>tank.</em>' : verdict(s.compliance)}</h1>
          <div class="label">${esc(s.workoutName)} · FTP ${s.ftp} W${s.intensity ? ` · ridden at ${Math.round(s.intensity * 100)}%` : ''}</div>
          ${
            s.course
              ? `<div class="label course-line">${esc(s.course.name)} · ${distanceText(s.course.meters, units)} · ${climbText(s.course.climbMeters, units)} climbed · ${speedText(s.course.avgSpeed, units)} avg</div>`
              : ''
          }
          ${upload ? '<div class="strava-status" data-role="strava-status"></div>' : ''}
        </div>
        ${s.compliance >= CREST_COMPLIANCE ? `<img class="crest" src="${asset('brand/crest.jpg')}" alt="Big Bib Energy — earned" />` : ''}
      </section>

      ${rampSection(s, simulated)}

      ${reveal ? xpReveal(reveal) : ''}

      <section class="kpis">
        <div class="hero-kpi"><span class="label">On target</span><span class="num">${pct(s.compliance)}</span></div>
        <div><span class="label">Time</span><span class="num">${clock(s.seconds)}</span></div>
        <div><span class="label">Avg power</span><span class="num">${Math.round(s.avgPower)}</span></div>
        <div><span class="label">Norm. power</span><span class="num">${Math.round(s.normalizedPower)}</span></div>
        <div><span class="label">TSS</span><span class="num">${Math.round(s.tss)}</span></div>
        <div><span class="label">IF</span><span class="num">${s.intensityFactor.toFixed(2)}</span></div>
      </section>

      <canvas class="power-chart-summary"></canvas>

      ${hrSection(session, lthr, s.segments)}

      <table class="intervals">
        <thead>
          <tr>
            <th class="label">Block</th>
            <th class="label">Target</th>
            <th class="label">Avg</th>
            <th class="label">On target</th>
            <th class="label" style="width:40%">Under · On · Over</th>
          </tr>
        </thead>
        <tbody>
          ${scored
            .map(
              (x) => `
            <tr>
              <td class="name">${esc(x.segment.label)}</td>
              <td class="num">${Math.round(x.targetW)} W</td>
              <td class="num">${Math.round(x.avgPowerW)} W</td>
              <td class="num">${pct(x.compliance)}</td>
              <td>
                <div class="bar">
                  <span style="width:${x.under * 100}%;background:var(--under)"></span>
                  <span style="width:${x.compliance * 100}%;background:var(--on)"></span>
                  <span style="width:${x.over * 100}%;background:var(--over)"></span>
                </div>
              </td>
            </tr>`,
            )
            .join('')}
        </tbody>
      </table>
    </main>
  `);

  root.append(page);
  const canvas = $<HTMLCanvasElement>(page, '.power-chart-summary');
  const hrCanvas = page.querySelector<HTMLCanvasElement>('.hr-chart-summary');
  const draw = () => {
    drawProfile(canvas, { segments: session.segments, ftp: s.ftp, samples: session.samples, tolerance: session.tolerance, detailed: true });
    if (hrCanvas) drawHrStrip(hrCanvas, { samples: session.samples, range: [0, session.duration], lthr });
  };
  page.querySelector<HTMLButtonElement>('[data-role=accept-lthr]')?.addEventListener('click', (e) => {
    const btn = e.currentTarget as HTMLButtonElement;
    onAcceptLthr(Number(btn.dataset.lthr));
    btn.replaceWith(Object.assign(document.createElement('span'), { className: 'label', textContent: 'Zones updated ✓' }));
  });
  page.querySelector<HTMLButtonElement>('[data-role=accept-ftp]')?.addEventListener('click', (e) => {
    const btn = e.currentTarget as HTMLButtonElement;
    onAcceptFtp(Number(btn.dataset.ftp));
    btn.replaceWith(Object.assign(document.createElement('span'), { className: 'label', textContent: 'FTP updated ✓' }));
  });
  draw();
  window.addEventListener('resize', draw);
  $(page, '[data-role=done]').addEventListener('click', onDone);
  animateXp(page);

  const statusEl = page.querySelector<HTMLElement>('[data-role=strava-status]');
  let alive = true;
  const runUpload = () => {
    if (!statusEl || !upload) return;
    statusEl.innerHTML = stravaLine('uploading');
    void upload().then((st) => {
      if (!alive) return;
      statusEl.innerHTML = stravaLine(st);
      statusEl.querySelector('[data-role=retry-upload]')?.addEventListener('click', runUpload);
    });
  };
  if (manualUpload && statusEl) {
    statusEl.innerHTML = `<span class="trainer-status">Simulated ride: not uploaded automatically.</span>
      <button class="link" data-role="manual-upload">Upload to Strava anyway</button>`;
    statusEl.querySelector('[data-role=manual-upload]')?.addEventListener('click', runUpload);
  } else {
    runUpload();
  }
  page.querySelector('[data-role=fit]')?.addEventListener('click', () => {
    const startedAtMs = s.startedAtMs ?? Date.now() - s.seconds * 1000;
    const bytes = encodeFitActivity({
      startedAtMs,
      utcOffsetS: -new Date(startedAtMs).getTimezoneOffset() * 60,
      summary: s,
      samples: session.samples,
    });
    const url = URL.createObjectURL(new Blob([bytes], { type: 'application/vnd.ant.fit' }));
    const a = Object.assign(document.createElement('a'), { href: url, download: fitFileName(s, startedAtMs) });
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  });
  window.scrollTo(0, 0);

  return () => {
    alive = false;
    window.removeEventListener('resize', draw);
  };
}
