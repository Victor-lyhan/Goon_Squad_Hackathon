# MVP III: a 30-second demo (human-written, added 5:15 p.m. Sat)

**This file overrides SPEC.md MVP II and replaces `docs/mvp2-ui-redesign.md` wherever they conflict** (colors, fonts, simulator controls, page structure). The matching rules, the business-only stops (homes are never pickup, drop-off or storage points), the Google route cache and the tests stay as they are.

Goal: a judge understands Relay in 30 seconds by watching one package move from one business to another on employees' commutes.

## Priorities (in order; finish one before starting the next)

### P1. Simulator readability (most demo value)
- Pick a package → **Play** runs that package's journey at a fixed pace and **automatically skips the overnight gap** (a short "Overnight at <relay point>" card for about 1 second, then the morning). One Play/Pause button. No speed control, scrubber or next-event buttons.
- Draw each carrier's **full commute** (home → work in the morning, work → home in the evening) as a thin line in that employee's color; the part where they carry the package is drawn thick.
- **Day vs night must be obvious**: the evening/night part dims the map (dark overlay or dark map style) with a moon icon and the time; morning is light with a sun icon.
- **Package marker**: large (about 2x the current size), high-contrast, always on top, with a soft halo.
- **Symbols instead of numbered events**: origin business = filled square, relay point = diamond with "Overnight" label, handoff = two-arrow swap icon at the exact spot, final destination = flag/checkmark. Each symbol has a short label ("Handed to Maria", "Delivered 9:12 a.m.").
- Focus on package paths: other employees and businesses are faded (about 30% opacity) during playback.

### P2. Remove features (fewer things to break)
**Keep:** the homepage; the simulator with journey playback; Business "send a package → match result → tracking"; the Employee commute + job; the inspector, including its extra detail; the **direct vs relay comparison panel**.
**Remove:** the setup drawer (generate / import / export / recompute); speed, scrubber and next-event controls; layer toggles; keyboard shortcut hints; the Help page. Delete their code and tests, don't just hide them. Do not touch the matching engine or API while removing UI.

### P3. Story retune (human runs the fetch)
- Most story packages should be easy to follow like "Navy Yard grinder burrs": **one package, 2 employees, 3 businesses (sender, relay point, recipient)**. Keep **at least two direct examples** (1 employee, 2 businesses) so direct vs relay is still shown.
- Agents edit `fixtures/nyc/demoStory.json` and the story test only; any new routes go in a QUESTIONS.md line "NEEDS FETCH", and a human runs `npm run fetch:routes`. The story must stay 100% matched.

### P4. Visual restyle (transit-industrial minimalism: Linear / Vercel / Stripe / Swiss transit / MTA)
Restyle, don't rebuild: tokens + the homepage first, then lighter passes on the simulator, Business and Employee pages.
- Base: background `#F7F7F4`, text/ink `#171C24`, primary `#1D5075`, hairline borders `#E3E3DE`, no gradients, no heavy shadows, 6px radius max.
- Fonts: **Inter** for UI (Geist fallback), **IBM Plex Mono** for times, IDs, distances and prices.
- **Map colors chosen to differentiate as much as possible** (and to work for color-blind viewers): package = `#E8590C` orange; carrier 1 = `#1D5075` blue; carrier 2 = `#0F8A5F` green; relay points = ink `#171C24` diamonds; faded/background items = `#A8ABB2`. Never rely on color alone: carriers also get a letter badge (A, B) and symbols keep their shapes.
- Homepage: one sentence of what Relay does, one large "Watch a package" button that opens the simulator on the Navy Yard example and starts playing, and two smaller entries (Business, Employee). The stats strip may stay if it is one line.

## Freeze
- **Feature freeze 9:30 p.m. Sat.** After that: bug fixes, copy and polish only.
- Code freeze 5 a.m. Sun stays.

## Planner notes
- Issues are complete slices; tag P1–P4 in the title. Do P1 and P2 first.
- **Out of scope:** two relay points (multi-hop). One relay point maximum; do not change the matching engine or shared contracts.
- Anything conflicting with `docs/mvp2-ui-redesign.md`: this file wins.
