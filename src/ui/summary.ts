import { clock, pct } from '../core/format';
import type { Session } from '../core/session';
import { $, esc, html } from './dom';
import { drawProfile } from './profile';

export interface SummaryProps {
  session: Session;
  onDone(): void;
}

/** Hold the line this well and you've earned the flaming bibs. */
const CREST_COMPLIANCE = 0.9;

function verdict(compliance: number): string {
  if (compliance >= 0.9) return 'Dialled <em>in.</em>';
  if (compliance >= 0.75) return 'Solid <em>work.</em>';
  if (compliance >= 0.5) return 'Got it <em>done.</em>';
  return 'Ride <em>logged.</em>';
}

export function renderSummary(root: HTMLElement, { session, onDone }: SummaryProps): () => void {
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
        ${s.compliance >= CREST_COMPLIANCE ? `<img class="crest" src="/brand/crest.jpg" alt="Big Bib Energy — earned" />` : ''}
      </section>

      <section class="kpis">
        <div class="hero-kpi"><span class="label">On target</span><span class="num">${pct(s.compliance)}</span></div>
        <div><span class="label">Time</span><span class="num">${clock(s.seconds)}</span></div>
        <div><span class="label">Avg power</span><span class="num">${Math.round(s.avgPower)}</span></div>
        <div><span class="label">Norm. power</span><span class="num">${Math.round(s.normalizedPower)}</span></div>
        <div><span class="label">TSS</span><span class="num">${Math.round(s.tss)}</span></div>
        <div><span class="label">IF</span><span class="num">${s.intensityFactor.toFixed(2)}</span></div>
      </section>

      <canvas></canvas>

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
  const canvas = $<HTMLCanvasElement>(page, 'canvas');
  const draw = () =>
    drawProfile(canvas, { segments: session.segments, ftp: s.ftp, samples: session.samples, tolerance: session.tolerance, detailed: true });
  draw();
  window.addEventListener('resize', draw);
  $(page, '[data-role=done]').addEventListener('click', onDone);
  window.scrollTo(0, 0);

  return () => window.removeEventListener('resize', draw);
}
