# Big Bib Energy

A personal indoor-training app. No virtual world — just the workout, where you are in it,
and whether you're holding the number.

## Run

```sh
npm install
npm run dev        # http://localhost:5173
npm test           # core unit tests
npm run typecheck  # app + DOM-free core check
```

Deployed to GitHub Pages by `.github/workflows/deploy.yml` on every push to `main`.

Bluetooth trainers need Chrome or Edge (desktop or Android), served from `localhost` or HTTPS.
Without a trainer connected, rides use a simulated rider (speed 1×/4×/16×, ↑/↓ to push it off target).

## Trainers

One "Connect trainer" button; the app picks the best protocol the device offers:

| Device | Protocol | Modes |
|---|---|---|
| Elite Suito, Wahoo KICKR on current firmware, most modern trainers | FTMS | ERG + Target |
| Older Wahoo KICKR / KICKR Core firmware | Wahoo control over Cycling Power | ERG + Target |
| Any Bluetooth power meter (pedals, cranks, bike) | Cycling Power, read-only | Target only |

The Wahoo protocol is undocumented; encodings follow GoldenCheetah and Auuki. Protocol selection
and command bytes were verified against a scripted fake device, not yet real KICKR hardware.

## Modes

- **ERG** — the trainer holds the target watts for you. Soft start: the trainer stays on a free
  0% road until cadence holds above 55 rpm, then ramps from your current power to the target over
  10 s. It releases again if cadence drops below 40 rpm for 3 s (the ERG "death spiral") or when
  paused. Engaging time isn't scored.
- Stopping: below 20 rpm the rider is "coasting" — power reads and records 0 immediately
  (a spinning-down flywheel isn't rider power), and ERG releases after 1 s. A trainer that sends
  nothing for 3 s is treated as 0 W / 0 rpm rather than freezing on its last value.
- ERG step changes are sent 1 s early (ERG lead) so the trainer's 1–3 s control loop lands the
  new power on the interval boundary; ramps aren't led.
- Press **L** on the ride screen for a latency HUD: trainer data rate, age of the last reading,
  and measured ERG step response.
- **Target** — the trainer simulates a flat road (FTMS *Set Simulation*, 1% grade); you hit the
  number with gears and legs. This is where the on/under/over feedback earns its keep.

## Heart rate

Zones are anchored on **LTHR** (lactate threshold heart rate), the HR counterpart of FTP:
Z1 < 81%, Z2 81–89%, Z3 90–93%, Z4 94–99%, Z5 ≥ 100% (Friel's cycling zones, 5a–c merged).

- Set LTHR on the home screen, or estimate it from max HR (LTHR ≈ 90% of max) or age
  (max HR = 208 − 0.7 × age).
- The ride screen shows an HR strip on the same timeline as the power chart, over zone bands.
- The summary shows avg/max HR, time in zone, and, after steady ≥ 8 min blocks at ≥ 88% FTP that
  you actually held, suggests an updated LTHR. Highest sustained (5 s) HR from real sensors is
  remembered as "max seen".

## Rider avatar

An original ink-style rider (male or female, chosen on the home screen) powers up with your
zone: Z1–2 calm, Z3–4 glow, Z5 gold, Z6 gold + lightning, Z7 crimson. Images live in
`public/avatar/{m,f}-{1..5}.jpg` and were generated with Nano Banana 2 via OpenRouter using
`scripts/gen-image.py` (needs `OPENROUTER_API_KEY` in `.env.local`). Each level is an edit of the
calm image, with the matching male level passed as a style reference for the female set.

## Brand

Logos were generated with Nano Banana Pro (`--model google/gemini-3-pro-image`, better lettering).
The header wordmark is live text; the monogram is the favicon, the club patch sits on the home
screen, and the flaming-bibs crest appears on the summary when a ride is ≥ 90% on target.

Full-resolution masters for every generated image live in `art/` (not served); the web-sized
copies are in `public/`.

## Layout

```
src/core/      Pure logic, no DOM (type-checked with tsconfig.core.json). Portable to Rust later.
  workout.ts     Workout model (steps as fraction of FTP) → timeline segments
  session.ts     Ride state machine, driven by advance(dt, reading)
  compliance.ts  On/under/over classification and per-block scoring
  metrics.ts     NP, IF, TSS
  erg.ts         ERG soft start / low-cadence release
  latency.ts     ERG lead, notification rate, ERG step-response timing
  hr.ts          LTHR zones, estimates, time in zone, LTHR suggestions
  ftms.ts        Bluetooth FTMS / Heart Rate byte encode/decode
  cps.ts         Cycling Power decode, crank cadence, Wahoo control encoders
  history.ts     Ride records and rollups
src/devices/   Trainer interface, simulated rider, Bluetooth trainers (FTMS / Wahoo / power meter), HR strap
src/ui/        Home, ride, and summary screens; canvas profile renderer
src/workouts/  Built-in workout library
```

## Roadmap

- [ ] Verify against a real Elite Suito (ERG response, SIM mode feel)
- [ ] Verify against a real Wahoo KICKR (FTMS and legacy Wahoo protocol)
- [x] Separate heart-rate strap connection (verify with Garmin HRM)
- [ ] `.zwo` import
- [ ] `.fit` export
- [ ] Strava: OAuth as identity, auto-upload rides
- [ ] Small backend keyed by Strava athlete id: history, progress over time, streaks, shared stats with friends
