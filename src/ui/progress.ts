// Power level, rank, streak and patches: the home panel and the summary reveal.

import { Achievement, ACHIEVEMENTS, Earned, tiersEarned } from '../core/achievements';
import type { Progression, XpBreakdown } from '../core/progression';
import { asset } from './asset';
import { esc } from './dom';

const TIER_NAMES: Record<number, string[]> = {
  1: [''],
  3: ['Bronze', 'Silver', 'Gold'],
  4: ['Bronze', 'Silver', 'Gold', 'Platinum'],
};
export const tierName = (a: Achievement, tier: number) => TIER_NAMES[a.tiers.length]?.[tier] ?? '';

const fmt = (n: number) => Math.round(n).toLocaleString('en-US');

/** A patch: the embroidered art (name stitched in), with a progress ring while locked and a tier ring once earned. */
export function patch(a: Achievement, tier: number, opts: { progress?: number; size?: 'lg' } = {}): string {
  const earned = tier >= 0;
  const tierCls = earned && a.tiers.length > 1 ? ` tier-${tier}` : '';
  const next = a.tiers[Math.min(a.tiers.length - 1, tier + 1)];
  const pct = !earned || tier < a.tiers.length - 1 ? Math.min(1, (opts.progress ?? 0) / next) : 1;
  const title = earned ? `${a.name}${tierName(a, tier) ? ` · ${tierName(a, tier)}` : ''}` : `Locked: ${a.hint}`;
  return `
    <div class="patch-badge${earned ? ' earned' : ''}${tierCls}${opts.size === 'lg' ? ' lg' : ''}" title="${esc(title)}"
         role="img" aria-label="${esc(title)}" style="--p:${pct}">
      <img src="${asset(`patches/${a.id}.jpg`)}" alt="" loading="lazy" decoding="async" />
    </div>`;
}

export function progressPanel(p: Progression, weeklyGoal: number): string {
  const { rank, next, progress } = p.rank;
  const tiers = tiersEarned(p.achievements);
  const earnedCount = ACHIEVEMENTS.filter((a) => tiers[a.id] >= 0).length;
  const dots = Array.from({ length: weeklyGoal }, (_, i) => `<i class="${i < p.streak.thisWeek ? 'on' : ''}"></i>`).join('');
  return `
    <section class="progress-panel">
      <div class="pl">
        <span class="label">Power level</span>
        <span class="num pl-value">${fmt(p.xp)}</span>
        <div class="rank-name">${esc(rank.name)}</div>
        <div class="rank-bar"><span style="width:${progress * 100}%"></span></div>
        <span class="label">${next ? `${fmt(next.xp - p.xp)} to ${esc(next.name)}` : 'Max rank. Absolute unit.'}</span>
      </div>
      <div class="streak">
        <span class="label">Weekly streak</span>
        <span class="num streak-value">${p.streak.weeks}<small>${p.streak.weeks === 1 ? 'week' : 'weeks'}</small></span>
        <div class="week-dots" title="${p.streak.thisWeek} of ${weeklyGoal} rides this week">${dots}</div>
        <div class="goal">
          <span class="label">Goal ${weeklyGoal}/week</span>
          <button class="link" data-goal="-1" aria-label="Lower weekly goal">−</button>
          <button class="link" data-goal="1" aria-label="Raise weekly goal">+</button>
        </div>
      </div>
      <div class="patches-summary">
        <span class="label">Patches</span>
        <span class="num">${earnedCount}<small>/ ${ACHIEVEMENTS.length}</small></span>
        <button class="link" data-role="toggle-wall">Show the wall</button>
      </div>
    </section>
    <section class="patch-wall" hidden>
      ${(['precision', 'effort', 'consistency', 'volume', 'silly'] as const)
        .map(
          (cat) => `
        <div class="wall-row">
          <span class="label">${cat}</span>
          <div class="wall-patches">${ACHIEVEMENTS.filter((a) => a.category === cat)
            .map((a) => patch(a, tiers[a.id], { progress: p.achievements.progress[a.id] }))
            .join('')}</div>
        </div>`,
        )
        .join('')}
    </section>`;
}

export interface Reveal {
  xp?: XpBreakdown;
  simulated: boolean;
  before: Progression;
  after: Progression;
  newlyEarned: Earned[];
}

function breakdown(x: XpBreakdown): string {
  const parts = [`TSS ${Math.round(x.base)}`];
  if (x.precision !== 1) parts.push(`× ${x.precision.toFixed(2)} precision`);
  if (x.finished) parts.push('× 1.10 finished');
  if (x.streakBonus) parts.push(`+${Math.round(x.streakBonus * 100)}% streak`);
  return parts.join(' · ');
}

export function xpReveal(r: Reveal): string {
  if (r.simulated) return `<section class="xp-reveal"><span class="trainer-status">Simulated rides don't earn XP.</span></section>`;
  if (!r.xp) return '';
  const rankUp = r.after.rank.rank.n > r.before.rank.rank.n;
  const cards = r.newlyEarned
    .map((e, i) => {
      const a = ACHIEVEMENTS.find((x) => x.id === e.id)!;
      return `
        <div class="reveal-card" style="animation-delay:${900 + i * 180}ms">
          ${patch(a, e.tier, { size: 'lg' })}
          <div>
            <span class="label">${tierName(a, e.tier) ? `${tierName(a, e.tier)} · ` : ''}New patch</span>
            <div class="reveal-name">${esc(a.name)}</div>
          </div>
        </div>`;
    })
    .join('');
  const { rank, next, progress } = r.after.rank;
  const startPct = rankUp ? 0 : r.before.rank.progress * 100;
  return `
    <section class="xp-reveal">
      <div class="xp-line">
        <span class="num xp-gain" data-xp="${r.xp.xp}">+0</span><span class="label">XP</span>
        <span class="trainer-status">${esc(breakdown(r.xp))}</span>
      </div>
      <div class="xp-rank">
        <span class="label">Power level ${fmt(r.after.xp)} · ${esc(rank.name)}</span>
        <div class="rank-bar"><span style="--from:${startPct}%;--to:${progress * 100}%"></span></div>
        ${next ? `<span class="label">${fmt(next.xp - r.after.xp)} to ${esc(next.name)}</span>` : ''}
      </div>
      ${rankUp ? `<div class="rank-up"><span class="label">Rank up</span><span class="rank-up-name">${esc(rank.name)}</span></div>` : ''}
      ${cards ? `<div class="reveal-cards">${cards}</div>` : ''}
    </section>`;
}

/** Counts the XP number up from 0. */
export function animateXp(root: ParentNode) {
  const el = root.querySelector<HTMLElement>('.xp-gain');
  if (!el) return;
  const target = Number(el.dataset.xp);
  const t0 = performance.now();
  const tick = (t: number) => {
    const k = Math.min(1, (t - t0) / 900);
    el.textContent = `+${Math.round(target * (1 - (1 - k) ** 3))}`;
    if (k < 1) requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
}
