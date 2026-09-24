// The power-up rider. Five stacked images crossfade by level; levelling up shakes and flashes.

import { POWER_LEVELS } from '../core/avatar';
import { html } from './dom';

export type Rider = 'm' | 'f';

/** Flash colour when arriving at each level. */
const FLASH: Record<number, string> = { 2: '#ece8df', 3: '#e8b84a', 4: '#7db4ff', 5: '#c8102e' };

const src = (rider: Rider, level: number) => `/avatar/${rider}-${level}.jpg`;

export class Avatar {
  readonly el: HTMLElement;
  private readonly imgs: HTMLImageElement[];
  private level = 1;

  constructor(rider: Rider) {
    const levels = Array.from({ length: POWER_LEVELS }, (_, i) => i + 1);
    this.el = html(`
      <div class="avatar" data-level="1" aria-hidden="true">
        ${levels.map((l) => `<img src="${src(rider, l)}" alt="" decoding="async" class="${l === 1 ? 'show' : ''}" />`).join('')}
        <div class="flash"></div>
      </div>
    `);
    this.imgs = [...this.el.querySelectorAll('img')];
  }

  set(level: number) {
    if (level === this.level) return;
    if (level > this.level) {
      this.el.style.setProperty('--flash', FLASH[level]);
      this.el.classList.remove('powering');
      void this.el.offsetWidth; // restart the animation
      this.el.classList.add('powering');
    }
    this.level = level;
    this.el.dataset.level = String(level);
    this.imgs.forEach((img, i) => img.classList.toggle('show', i + 1 === level));
  }
}
