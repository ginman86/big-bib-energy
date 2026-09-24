import { clock, pct } from '../core/format';
import { HR_ZONES, suggestLthr, sustainedMaxHr, timeInHrZones } from '../core/hr';
import { mean } from '../core/metrics';
import type { Session } from '../core/session';
import { asset } from './asset';
import { $, esc, html } from './dom';
import { drawHrStrip } from './hr-chart';
import { drawProfile } from './profile';

export interface SummaryProps {
  session: Session;
  lthr?: number;
  onAcceptLthr(lthr: number): void;
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

/** Hold the line this well and you've earned the flaming bibs. */
const CREST_COMPLIANCE = 0.9;

function verdict(compliance: number): string {
  if (compliance >= 0.9) return 'Dialled <em>in.</em>';
  if (compliance >= 0.75) return 'Solid <em>work.</em>';
  if (compliance >= 0.5) return 'Got it <em>done.</em>';
  return 'Ride <em>logged.</em>';
}

export function renderSummary(root: HTMLElement, { session, lthr, onAcceptLthr, onDone }: SummaryProps): () => void {
  const s = session.summary();
  const scored = s.segments.filter((x) => x.under + x.over + x.compliance > 0);

  const page = html(`
    <main class="summary">
      <header class="topbar">
        <span class="wordmark">Big Bib<i>/</i>Energy</span>
        <button class="btn primary" data-role="done">Done</button>
      </header>

      <section class="summary-head">
        <div>
          <h1>${verdict(s.compliance)}</h1>
          <div class="label">${esc(s.workoutName)} · FTP ${s.ftp} W</div>
        </div>
        ${s.compliance >= CREST_COMPLIANCE ? `<img class="crest" src="${asset('brand/crest.jpg')}" alt="Big Bib Energy — earned" />` : ''}
      </section>

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
  draw();
  window.addEventListener('resize', draw);
  $(page, '[data-role=done]').addEventListener('click', onDone);
  window.scrollTo(0, 0);

  return () => window.removeEventListener('resize', draw);
}
