// Workout builder: blocks and text syntax, kept in sync, with a live profile preview.

import { newWorkoutId } from '../core/formats';
import { normalizedPower, trainingStress } from '../core/metrics';
import { expand, free, ramp, Step, steady, targetAt, totalDuration, Workout } from '../core/workout';
import { formatWorkoutText, parseWorkoutText, WorkoutSyntaxError } from '../core/workout-text';
import { clock } from '../core/format';
import { $, esc, html } from './dom';
import { drawProfile } from './profile';

export interface BuilderOptions {
  /** Workout to edit, or a starting point (import, duplicate). Omit for a blank workout. */
  initial?: Workout;
  /** True when `initial` is already saved (edit), false for new/import/duplicate. */
  existing?: boolean;
  warnings?: string[];
  ftp: number;
  onSave(w: Workout): void;
}

const DEFAULT_STEPS: Step[] = [ramp(600, 0.5, 0.75, 'Warm up'), steady(1200, 0.88), ramp(480, 0.65, 0.4, 'Cool down')];

/** "10", "10:30", "90s", "1h5m": bare numbers are minutes. */
export function parseDuration(v: string): number | undefined {
  const t = v.trim().toLowerCase();
  let m = t.match(/^(\d+):(\d{1,2})$/);
  if (m) return Number(m[1]) * 60 + Number(m[2]);
  if (/^\d+(\.\d+)?$/.test(t)) return Math.round(Number(t) * 60);
  m = t.match(/^(?:(\d+)h)?\s*(?:(\d+)m)?\s*(?:(\d+)s)?$/);
  if (m && (m[1] || m[2] || m[3])) return Number(m[1] ?? 0) * 3600 + Number(m[2] ?? 0) * 60 + Number(m[3] ?? 0);
  return undefined;
}

const pctOf = (f: number) => Math.round(f * 1000) / 10;

export function openBuilder(opts: BuilderOptions) {
  const init = opts.initial;
  let steps: Step[] = init ? structuredClone(init.steps) : structuredClone(DEFAULT_STEPS);
  let view: 'blocks' | 'text' = 'blocks';

  const dialog = html<HTMLDialogElement>(`
    <dialog class="builder" aria-label="Workout builder">
      <header class="sheet-head">
        <span class="wordmark">${opts.existing ? 'Edit workout' : 'New workout'}</span>
        <button class="link" data-role="cancel">Cancel</button>
      </header>
      ${
        opts.warnings?.length
          ? `<ul class="import-warnings">${opts.warnings.map((w) => `<li>${esc(w)}</li>`).join('')}</ul>`
          : ''
      }
      <div class="builder-meta">
        <input class="builder-name" name="name" placeholder="Workout name" value="${esc(init?.name ?? '')}" maxlength="80" />
        <textarea class="builder-desc" name="description" placeholder="Description (optional)" rows="2" maxlength="500">${esc(init?.description ?? '')}</textarea>
      </div>
      <canvas class="builder-profile"></canvas>
      <div class="builder-stats hint" data-role="stats"></div>
      <div class="builder-tabs">
        <div class="seg">
          <button data-view="blocks" aria-pressed="true">Blocks</button>
          <button data-view="text" aria-pressed="false">Text</button>
        </div>
        <span class="hint" data-role="syntax-help" hidden>e.g. <code>10m 50>75, 3x(10m 90, 5m 55), 5m free, 8m 65>40 "Cool down"</code></span>
      </div>
      <div data-role="blocks"></div>
      <div data-role="text" hidden>
        <textarea class="builder-text num" spellcheck="false" rows="5"></textarea>
        <div class="builder-error" data-role="text-error"></div>
      </div>
      <footer class="builder-foot">
        <span class="builder-error" data-role="save-error"></span>
        <button class="btn primary" data-role="save">Save workout</button>
      </footer>
    </dialog>
  `);

  const canvas = $<HTMLCanvasElement>(dialog, '.builder-profile');
  const blocks = $(dialog, '[data-role=blocks]');
  const text = $<HTMLTextAreaElement>(dialog, '.builder-text');
  const textError = $(dialog, '[data-role=text-error]');

  const current = (): Workout => ({
    id: init?.id ?? newWorkoutId($<HTMLInputElement>(dialog, '.builder-name').value || 'workout'),
    name: $<HTMLInputElement>(dialog, '.builder-name').value.trim(),
    description: $<HTMLTextAreaElement>(dialog, '.builder-desc').value.trim(),
    steps,
  });

  function refreshPreview() {
    const segs = expand({ id: 'x', name: '', description: '', steps });
    const secs = totalDuration(segs);
    const watts = Array.from({ length: secs }, (_, t) => (targetAt(segs, t) ?? 0) * opts.ftp);
    const np = normalizedPower(watts);
    $(dialog, '[data-role=stats]').textContent = steps.length
      ? `${clock(secs)} · TSS ${Math.round(trainingStress(secs, np, opts.ftp))} · IF ${(np / opts.ftp).toFixed(2)} at FTP ${opts.ftp} W · ${steps.length} blocks`
      : 'No blocks yet';
    if (steps.length) drawProfile(canvas, { segments: segs, ftp: opts.ftp });
  }

  function row(s: Step, i: number): string {
    const dur = `<input class="b-dur num" data-i="${i}" value="${clock(s.duration)}" aria-label="Duration" />`;
    const power =
      s.kind === 'steady'
        ? `<input class="b-pow num" data-i="${i}" data-field="power" value="${pctOf(s.power)}" aria-label="% FTP" /><span class="hint">%</span>`
        : s.kind === 'ramp'
          ? `<input class="b-pow num" data-i="${i}" data-field="from" value="${pctOf(s.from)}" aria-label="From % FTP" /><span class="hint">→</span>
             <input class="b-pow num" data-i="${i}" data-field="to" value="${pctOf(s.to)}" aria-label="To % FTP" /><span class="hint">%</span>`
          : `<span class="hint">no target</span>`;
    return `
      <div class="b-row">
        <select class="b-kind" data-i="${i}" aria-label="Block type">
          <option value="steady" ${s.kind === 'steady' ? 'selected' : ''}>Steady</option>
          <option value="ramp" ${s.kind === 'ramp' ? 'selected' : ''}>Ramp</option>
          <option value="free" ${s.kind === 'free' ? 'selected' : ''}>Free ride</option>
        </select>
        ${dur}
        <span class="b-power">${power}</span>
        <input class="b-label" data-i="${i}" value="${esc(s.label ?? '')}" placeholder="Label" aria-label="Label" />
        <span class="b-actions">
          <button class="link" data-act="up" data-i="${i}" aria-label="Move up" ${i === 0 ? 'disabled' : ''}>↑</button>
          <button class="link" data-act="down" data-i="${i}" aria-label="Move down" ${i === steps.length - 1 ? 'disabled' : ''}>↓</button>
          <button class="link" data-act="dup" data-i="${i}" aria-label="Duplicate">⧉</button>
          <button class="link" data-act="del" data-i="${i}" aria-label="Delete">✕</button>
        </span>
      </div>`;
  }

  function renderBlocks() {
    blocks.innerHTML = `
      <div class="b-rows">${steps.map(row).join('')}</div>
      <div class="b-add">
        <span class="label">Add</span>
        <button class="btn" data-add="steady">Steady</button>
        <button class="btn" data-add="ramp">Ramp</button>
        <button class="btn" data-add="free">Free ride</button>
        <span class="b-set">
          <button class="btn" data-add="set">Interval set</button>
          <input class="b-set-n num" value="4" aria-label="Repeats" />×
          <input class="b-set-on num" value="3:00" aria-label="On duration" /> @
          <input class="b-set-onp num" value="110" aria-label="On % FTP" />% /
          <input class="b-set-off num" value="3:00" aria-label="Off duration" /> @
          <input class="b-set-offp num" value="50" aria-label="Off % FTP" />%
        </span>
      </div>`;
    refreshPreview();
  }

  // ——— Block edits ———

  blocks.addEventListener('change', (e) => {
    const el = e.target as HTMLInputElement | HTMLSelectElement;
    const i = Number(el.dataset.i);
    const s = steps[i];
    if (!s) return;
    if (el.classList.contains('b-kind')) {
      const k = el.value as Step['kind'];
      const p = s.kind === 'steady' ? s.power : s.kind === 'ramp' ? s.from : 0.6;
      steps[i] = k === 'steady' ? steady(s.duration, p, s.label) : k === 'ramp' ? ramp(s.duration, p, p + 0.1, s.label) : free(s.duration, s.label);
      renderBlocks();
      return;
    }
    if (el.classList.contains('b-dur')) {
      const d = parseDuration(el.value);
      if (d && d > 0) s.duration = d;
      el.value = clock(s.duration);
    } else if (el.classList.contains('b-pow')) {
      const v = Number(el.value) / 100;
      const ok = el.value.trim() !== '' && v >= 0 && v <= 4;
      if (s.kind === 'steady') {
        if (ok) s.power = v;
        el.value = String(pctOf(s.power));
      } else if (s.kind === 'ramp') {
        if (ok && el.dataset.field === 'from') s.from = v;
        if (ok && el.dataset.field === 'to') s.to = v;
        el.value = String(pctOf(el.dataset.field === 'from' ? s.from : s.to));
      }
    } else if (el.classList.contains('b-label')) {
      s.label = el.value.trim() || undefined;
    }
    refreshPreview();
  });

  blocks.addEventListener('click', (e) => {
    const b = (e.target as HTMLElement).closest<HTMLButtonElement>('button');
    if (!b) return;
    const i = Number(b.dataset.i);
    switch (b.dataset.act) {
      case 'up':
        [steps[i - 1], steps[i]] = [steps[i], steps[i - 1]];
        break;
      case 'down':
        [steps[i + 1], steps[i]] = [steps[i], steps[i + 1]];
        break;
      case 'dup':
        steps.splice(i + 1, 0, structuredClone(steps[i]));
        break;
      case 'del':
        steps.splice(i, 1);
        break;
    }
    const add = b.dataset.add;
    // New blocks go before a trailing cool-down, if there is one.
    const at = steps.length && /cool/i.test(steps[steps.length - 1].label ?? '') ? steps.length - 1 : steps.length;
    if (add === 'steady') steps.splice(at, 0, steady(300, 0.75));
    if (add === 'ramp') steps.splice(at, 0, ramp(300, 0.6, 0.9));
    if (add === 'free') steps.splice(at, 0, free(300));
    if (add === 'set') {
      const q = (c: string) => $<HTMLInputElement>(blocks, c).value;
      const n = Math.max(1, Math.min(50, Math.round(Number(q('.b-set-n')))));
      const on = parseDuration(q('.b-set-on'));
      const off = parseDuration(q('.b-set-off'));
      const onP = Number(q('.b-set-onp')) / 100;
      const offP = Number(q('.b-set-offp')) / 100;
      if (!on || !(onP > 0)) return;
      const set: Step[] = [];
      for (let k = 1; k <= n; k++) {
        set.push(steady(on, onP, `Interval ${k}/${n}`));
        if (off && k < n) set.push(steady(off, offP, `Recover ${k}/${n}`));
      }
      steps.splice(at, 0, ...set);
    }
    if (b.dataset.act || add) renderBlocks();
  });

  // ——— Text view ———

  let textTimer: ReturnType<typeof setTimeout> | undefined;
  text.addEventListener('input', () => {
    clearTimeout(textTimer);
    textTimer = setTimeout(() => {
      try {
        steps = parseWorkoutText(text.value);
        textError.textContent = '';
        refreshPreview();
      } catch (err) {
        if (!(err instanceof WorkoutSyntaxError)) throw err;
        textError.textContent = `${err.message} (at character ${err.at + 1})`;
      }
    }, 250);
  });

  function setView(v: typeof view) {
    if (v === view) return;
    if (v === 'blocks' && textError.textContent) return; // fix the text first
    view = v;
    dialog.querySelectorAll('[data-view]').forEach((b) => b.setAttribute('aria-pressed', String((b as HTMLElement).dataset.view === v)));
    blocks.hidden = v !== 'blocks';
    $(dialog, '[data-role=text]').hidden = v !== 'text';
    $(dialog, '[data-role=syntax-help]').hidden = v !== 'text';
    if (v === 'text') {
      text.value = formatWorkoutText(steps);
      textError.textContent = '';
    } else renderBlocks();
  }
  dialog.querySelectorAll<HTMLButtonElement>('[data-view]').forEach((b) => b.addEventListener('click', () => setView(b.dataset.view as typeof view)));

  // ——— Save / close ———

  $(dialog, '[data-role=save]').addEventListener('click', () => {
    const w = current();
    const err = !w.name ? 'Give it a name' : !steps.length ? 'Add at least one block' : textError.textContent ? 'Fix the text first' : '';
    $(dialog, '[data-role=save-error]').textContent = err;
    if (err) return;
    opts.onSave(w);
    dialog.close();
  });
  $(dialog, '[data-role=cancel]').addEventListener('click', () => dialog.close());
  dialog.addEventListener('close', () => dialog.remove());

  document.body.append(dialog);
  dialog.showModal();
  renderBlocks();
  if (!init?.name) $<HTMLInputElement>(dialog, '.builder-name').focus();
}
