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

- **ERG** — the trainer holds the target watts for you (FTMS *Set Target Power*).
- **Target** — the trainer simulates a flat road (FTMS *Set Simulation*, 1% grade); you hit the
  number with gears and legs. This is where the on/under/over feedback earns its keep.

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
