# XP, ranks & achievements — design

Branch: `gamification`. Decisions: **effort × precision** XP, **weekly** streaks, **full v1 with
patch art**, **avatar cosmetics** unlocked by rank. Friend leaderboards come later (they need
the crews API); everything here is built from Big Bib Energy's own ride data, so it can be shared
with friends later without touching Strava-sourced data.

## Principles

- **Reward doing the workout well**, not raw watts. TSS is relative to each rider's FTP, so an
  hour at threshold is worth the same to a 180 W and a 350 W rider.
- **Everything is derived from ride history.** Each ride stores a small set of *facts*; XP, rank
  and achievements are a pure fold over those facts. No separate progression state to sync, new
  achievements apply retroactively, and it works across devices through the synced ride history.
- **Simulated rides earn nothing.** They're for trying the app.

## Ride facts

Recorded at the end of every ride and stored in its summary (locally and in `POST /api/rides`):

| Fact | Notes |
|---|---|
| `mode` | `erg` or `target`, whichever was used for most of the ride |
| `simulated` | from the trainer; excluded from XP and achievements |
| `seconds`, `tss`, `kJ` | kJ = Σ power (W·s) / 1000 |
| `compliance` | on-target share of scored time (already computed) |
| `completed` | reached the end of the workout rather than ending early |
| `bestBlock` | longest steady block ≥ 20 min and its compliance |
| `intervalsAllOn` | every block ≥ 1 min at target intensity ≥ 0.88 FTP scored ≥ 90% |
| `powerZoneSeconds[7]`, `hrZoneSeconds[5]` | HR only with LTHR set |
| `maxAvatarLevel` | 1–5, the highest power-up reached |
| `pauses`, `ergReleases`, `reconnects` | counts during the ride |
| `startHourLocal` | 0–23 |
| `avgCadence` | when a cadence source exists |
| `crest` | earned the flaming-bibs crest (≥ 90% on target) |

Rides from before this feature have no facts. They count toward volume (rides, hours) and XP
(from TSS and compliance, at the ERG-neutral multiplier) but not fact-based achievements.

## XP

```
precision = mode === 'target' ? 0.5 + compliance : 1.0      // 0.5×–1.5× in Target, neutral in ERG
xp        = min(300, tss × precision)
          × (completed ? 1.10 : 1)
          × (1 + min(0.25, 0.05 × streakWeeks))               // +5% per streak week, max +25%
```

- **Why ERG is neutral:** in ERG the trainer holds the watts, so on-target is near 100% for
  everyone. Precision only means something in Target mode, where the rider holds the line.
- **Cap of 300 per ride** blunts marathon farming and FTP sandbagging (a low FTP inflates TSS).
  Leaderboards will show FTP next to XP.
- A typical 1 h sweet-spot ride (~60 TSS) earns ~65 XP in ERG and ~85 XP well ridden in Target.

**Power level** = total XP, shown as a big number on home: *"Power level 4,210"*.

## Ranks

| # | Rank | XP | ≈ at 3 rides/week | Unlock |
|---|---|---|---|---|
| 1 | Pedal Pusher | 0 | — | |
| 2 | Sweat Apprentice | 250 | 1 week | |
| 3 | Tempo Tamer | 750 | 3 weeks | |
| 4 | Sweet Spot Samurai | 1,750 | 7 weeks | Aura palette: *Steel* (blue-white) |
| 5 | Threshold Warrior | 3,500 | 3½ months | |
| 6 | VO2 Vanguard | 6,000 | 6 months | Aura palette: *Emerald* |
| 7 | **Super Sweatyan** | **9,001** | 9 months | Golden-hair avatar variant ("It's over 9000") |
| 8 | Super Sweatyan 2 | 14,000 | 14 months | Lightning crackle at every level |
| 9 | Super Sweatyan 3 | 21,000 | 1¾ years | Long-hair variant |
| 10 | Ultra Instinct Watts | 30,000 | 2½ years | Silver aura, calm eyes |

Unlocked cosmetics are chosen on home (rider picker gains an aura/variant row); the default stays
the current look.

## Streaks (weekly)

- A **streak week** is a Monday–Sunday local week with ≥ `weeklyGoal` real rides (default 3,
  adjustable 1–7). The streak is the number of consecutive streak weeks up to the last complete
  week, plus the current week if it has already hit the goal.
- Rest days never break it. Missing the goal in a week resets it to 0.
- Home shows a flame with the streak count and "2 of 3 this week".

## Achievements

Patches, some tiered (bronze / silver / gold). *Criteria apply to real rides only.*

**Precision (Target mode)**
| ID | Name | Criteria |
|---|---|---|
| `dialled-in` | Dialled In | A ride ≥ 20 min at ≥ 90% on target — tiers: 1 / 10 / 50 rides |
| `laser-focus` | Laser Focus | ≥ 95% on target over ≥ 45 min |
| `metronome` | Metronome | `intervalsAllOn` on a ride with ≥ 3 such blocks |
| `hold-the-line` | Hold the Line | `bestBlock` ≥ 20 min at ≥ 95% |

**Effort**
| ID | Name | Criteria |
|---|---|---|
| `over-9000` | It's Over 9000 | Power level ≥ 9,001 |
| `full-transformation` | Full Transformation | `maxAvatarLevel` = 5 |
| `red-zone` | Red Zone | ≥ 120 s in power Z7 in one ride |
| `heart-of-steel` | Heart of Steel | ≥ 20 min in HR Z4 in one ride |
| `kilojoule-club` | Kilojoule Club | ≥ 1,000 kJ in one ride |
| `century-of-stress` | Century of Stress | TSS ≥ 100 in one ride |

**Consistency**
| ID | Name | Criteria |
|---|---|---|
| `first-ride` | Big Bib Debut | First real ride |
| `streak` | On Fire | Weekly streak — tiers: 2 / 4 / 8 / 12 weeks |
| `comeback-kid` | Comeback Kid | A ride after ≥ 14 days without one |
| `big-bib-energy` | Big Bib Energy | Earn the crest — tiers: 1 / 10 / 25 |

**Volume**
| ID | Name | Criteria |
|---|---|---|
| `rides` | Saddle Time | Rides — tiers: 10 / 50 / 100 |
| `hours` | Hours in the Pain Cave | Hours — tiers: 10 / 50 / 100 |

**Silly**
| ID | Name | Criteria |
|---|---|---|
| `early-bird` | Early Bird | Starts before 06:00 local |
| `night-owl` | Night Owl | Starts 22:00 or later |
| `spin-doctor` | Spin Doctor | Avg cadence ≥ 95 over ≥ 30 min |
| `grinder` | Grinder | Avg cadence < 75 over ≥ 30 min |
| `death-spiral-survivor` | Death Spiral Survivor | ≥ 1 ERG release and `completed` |
| `no-pause-button` | No Pause Button | ≥ 60 min, `completed`, 0 pauses |
| `back-from-the-void` | Back From the Void | ≥ 1 trainer reconnect and `completed` |

Each achievement has a hint for its locked state (e.g. *"Hold ≥ 95% for 45 minutes in Target
mode"*) and records the ride that first earned each tier.

## Where it shows up

- **Summary:** an animated XP breakdown (*"+62 XP · TSS 45 × 1.30 precision × 1.10 finished ·
  +10% streak"*), a rank-up moment that replays the avatar power-up (shake + flash) with the new
  rank name, and a reveal card for each new patch or tier.
- **Home:** power level and rank with progress to the next, the streak flame and weekly
  progress, and a **patch wall**: earned patches in colour (tier ring), locked ones dim with hints.
- **Later (friends):** weekly leaderboards for XP, streak and precision from Big Bib Energy rides.

## Art

- **Patches:** ~24 embroidered club patches with Nano Banana Pro, matching the home-screen patch
  (round, ivory + crimson on black, one icon each, name in the ring). Tiers are the same patch
  with a bronze / silver / gold outer ring: base art once per achievement, rings as CSS so we
  don't pay for tier variants. ≈ 24 × $0.14 ≈ $3.50.
- **Cosmetics:** per rider (m/f) × 5 power levels per variant (Super Sweatyan, SS3, Ultra
  Instinct) plus palette recolours → ~40 edits ≈ $3 with Nano Banana 2, reusing the consistency
  technique from the current avatars.

## Build plan

1. **Facts + core:** record ride facts; `core/progression.ts` (XP, ranks, streaks) and
   `core/achievements.ts` (rules as pure functions over history), fully tested.
2. **History source:** home and summary read local history merged with synced rides
   (`GET /api/rides`), deduped by ride ID; first sign-in uploads local history (this is Strava
   milestone 5's migration).
3. **UI:** summary XP breakdown and reveals; home power level, rank, streak and patch wall
   (typographic placeholders until art lands).
4. **Patch art** and the patch wall with tier rings.
5. **Avatar cosmetics** art and the picker.

Later: crews and leaderboards (API + opt-in), weekly goal reminders.
