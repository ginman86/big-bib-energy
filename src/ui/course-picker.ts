// Course picker: a dialog of course cards (profile, length, climbing), "Surprise me", and GPX import.

import { climbText, distanceText, Units } from '../core/format';
import type { CourseMeta } from '../courses';
import { $, esc } from './dom';

export const SURPRISE = 'random';

export interface CoursePickerProps {
  courses: CourseMeta[];
  /** Selected course ID, or SURPRISE. */
  courseId: string;
  units: Units;
  /** One-off message about a GPX import. */
  note?: string;
  open: boolean;
  onOpen(open: boolean): void;
  onPick(id: string): void;
  onImport(files: File[]): void;
  onDelete(id: string): void;
}

/** A small filled elevation profile as inline SVG. */
function previewSvg(m: CourseMeta): string {
  const lo = Math.min(...m.preview);
  const hi = Math.max(...m.preview);
  // At least 120 m of range, so small hills stay small next to real climbs.
  const span = Math.max(120, hi - lo);
  const w = 200;
  const h = 44;
  const pts = m.preview.map((e, i) => `${((i / (m.preview.length - 1)) * w).toFixed(1)},${(h - 2 - ((e - lo) / span) * (h - 6)).toFixed(1)}`);
  return `<svg class="course-preview" viewBox="0 0 ${w} ${h}" preserveAspectRatio="none" aria-hidden="true">
    <path d="M0,${h} L${pts.join(' L')} L${w},${h} Z"/></svg>`;
}

function card(m: CourseMeta, selected: boolean, units: Units): string {
  const stats = [
    distanceText(m.lapMeters, units),
    `${climbText(m.climbMeters, units)} ↑`,
    m.maxGrade >= 0.02 ? `max ${Math.round(m.maxGrade * 100)}%` : '',
  ].filter(Boolean);
  const tags = [m.terrain, m.kind === 'out-and-back' ? 'Out & back' : '', m.altitudeM >= 1000 ? `${climbText(m.altitudeM, units).replace(/\B(?=(\d{3})+(?!\d))/g, ',')} altitude` : ''].filter(Boolean);
  return `
    <li class="course-card${selected ? ' selected' : ''}">
      <button class="course-pick" data-course="${esc(m.id)}" aria-pressed="${selected}">
        ${previewSvg(m)}
        <span class="course-card-name">${esc(m.name)}</span>
        <span class="hint">${esc(m.place || (m.custom ? 'Imported' : ''))}</span>
        <span class="label">${stats.join(' · ')}</span>
        <span class="course-tags">${tags.map((t) => `<span class="label">${esc(t)}</span>`).join('')}</span>
      </button>
      ${m.custom ? `<button class="link course-delete" data-delete-course="${esc(m.id)}">Delete</button>` : ''}
    </li>`;
}

/** Status-bar chip label. */
export function courseChipLabel(p: Pick<CoursePickerProps, 'courses' | 'courseId'>): string {
  if (p.courseId === SURPRISE) return 'Surprise course';
  return p.courses.find((c) => c.id === p.courseId)?.name ?? 'Course';
}

export function coursePicker(p: CoursePickerProps): string {
  const mine = p.courses.filter((c) => c.custom);
  const builtin = p.courses.filter((c) => !c.custom);
  return `
    <dialog class="wall-dialog course-dialog" data-role="courses" aria-label="Courses">
      <header class="sheet-head">
        <span class="wordmark">Courses</span>
        <button class="link" data-role="close-courses">Close</button>
      </header>
      <p class="hint course-intro">Where your watts take you: speed and distance come from the course's hills, your weight and the air at its altitude.
        Routes © <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">OpenStreetMap contributors</a>; elevations from USGS, NRCan and IGN.</p>
      <ol class="course-grid">
        <li class="course-card${p.courseId === SURPRISE ? ' selected' : ''}">
          <button class="course-pick surprise" data-course="${SURPRISE}" aria-pressed="${p.courseId === SURPRISE}">
            <span class="course-card-name">Surprise me</span>
            <span class="hint">A different course each ride</span>
          </button>
        </li>
        ${builtin.map((m) => card(m, m.id === p.courseId, p.units)).join('')}
      </ol>
      <div class="course-import">
        <div>
          <span class="label">Your own</span>
          <p class="hint">Draw a route in Strava, RideWithGPS or Komoot, export it as GPX and drop it here. Loops stay loops; anything else rides out and back.</p>
          ${p.note ? `<p class="hint course-note">${esc(p.note)}</p>` : ''}
        </div>
        <button class="btn" data-role="import-gpx">Import GPX</button>
        <input type="file" data-role="gpx-file" accept=".gpx" multiple hidden />
      </div>
      ${mine.length ? `<ol class="course-grid">${mine.map((m) => card(m, m.id === p.courseId, p.units)).join('')}</ol>` : ''}
    </dialog>`;
}

export function bindCoursePicker(page: HTMLElement, p: CoursePickerProps): () => void {
  const dialog = $<HTMLDialogElement>(page, '[data-role=courses]');
  const onClose = () => p.onOpen(false);
  dialog.addEventListener('close', onClose);
  dialog.addEventListener('click', (e) => {
    if (e.target === dialog) dialog.close();
  });
  $(dialog, '[data-role=close-courses]').addEventListener('click', () => dialog.close());
  dialog.querySelectorAll<HTMLButtonElement>('[data-course]').forEach((b) => b.addEventListener('click', () => p.onPick(b.dataset.course!)));
  dialog.querySelectorAll<HTMLButtonElement>('[data-delete-course]').forEach((b) =>
    b.addEventListener('click', () => p.onDelete(b.dataset.deleteCourse!)),
  );
  const file = $<HTMLInputElement>(dialog, '[data-role=gpx-file]');
  $(dialog, '[data-role=import-gpx]').addEventListener('click', () => file.click());
  file.addEventListener('change', () => {
    const files = [...(file.files ?? [])];
    file.value = '';
    if (files.length) p.onImport(files);
  });
  if (p.open && !dialog.open) dialog.showModal();
  return () => dialog.removeEventListener('close', onClose);
}
