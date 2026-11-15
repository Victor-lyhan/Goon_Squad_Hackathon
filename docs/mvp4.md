# MVP IV: AI requests, moving employees, the Relay vs traditional study (human-written, 7:50 p.m. Sat)

Adds to `docs/mvp3.md`; MVP III rules still hold (business-only stops, one relay point maximum, the 30-second demo). Three independent tracks that touch different files; run them in parallel. Tag issues F1, F2, F3.

## F2. Moving employees in every playback (most important; done by 9:30 p.m.)
- The **employee is the main moving object**: a large marker with the carrier's color and letter badge that travels the **whole commute**, home → work in the morning and work → home in the evening, in every playback (a single package journey and Play with no package picked).
- The **package is a badge riding on the employee marker** while carried. At pickup it visibly joins the employee; at a relay point it is dropped and waits (with the "Overnight" label); the next carrier picks it up; at the destination it is dropped with the delivered symbol.
- Day and night stay obvious; the overnight skip stays.
- Homes are only where commutes start and end (synthetic points); never a pickup, drop-off or storage point.
- If home ↔ business route lines are missing from the cache, add a NEEDS FETCH line to QUESTIONS.md (a human runs `npm run fetch:routes`); until then draw a straight dashed line, never crash.

## F1. Requests in plain English with Gemini (done by 10:30 p.m.)
- The Business "New delivery" view is mainly **one large text box**: e.g. "Deliver an envelope from Etsy to Brooklyn Roasting by 10 a.m. tomorrow."
- New endpoint `POST /api/v2/parse-request` → server calls the Gemini API with a JSON-schema (structured output) prompt that includes the list of network businesses, item categories, and the current simulated date/time. It returns a draft: sender id, recipient id, item/category, size, deadline, plus anything it could not fill.
- The page shows the draft as an **editable confirmation card**; the user clicks **Send** and the existing shipment API and matching run unchanged. The LLM never submits on its own.
- Stops must be network businesses; anything else (e.g. a home or street address) is rejected with a plain message.
- **Fallback:** if `GEMINI_API_KEY` is missing, the call fails, or it takes more than 6 s, a deterministic rule-based parser (business-name matching, simple time phrases) fills what it can; the regular form is always one click away ("Fill in the form instead").
- Keys: `GEMINI_API_KEY` and optional `GEMINI_MODEL` (default `gemini-2.5-flash`) in `.env`, **server only**: never in client code, a `VITE_` variable, logs, tests or commits. Send the key in the `x-goog-api-key` header (never as `?key=` in the URL); new AI Studio keys are "auth keys" (they may start with `AQ`), so do not validate the key's prefix. Tests mock the Gemini call.
- Show a small "Parsed by Gemini" / "Parsed offline" label on the card.

## F3. Relay vs traditional delivery study (done by 10:30 p.m.)
- A script `npm run study` runs many full simulations (several seeds × employee counts × package counts × detour limits) on the committed NYC cache and writes `data/study/results.json`.
- Compare each matched package with a **traditional courier baseline** (a dedicated same-day/next-day courier trip from sender to recipient).
- Metrics per package and totals: **cost to the sender**, **added vehicle miles**, **CO₂**, **delivery time vs the courier's promised window**, and match rate.
- **Assumptions are chosen in Relay's favor, but each must be a plausible, real-world-defensible value and is shown on the page with its value and a short reason** (no invented sources, no hidden assumptions). The goal: Relay clearly beats traditional delivery on cost, added miles and CO₂, and is competitive on time when compared with standard next-day B2B courier service (not same-hour couriers).
- Output: a separate, self-contained page `client/public/study.html` (also linked from the homepage as "The numbers") with headline numbers, charts (cost, miles, CO₂ per package; distribution across runs), and the assumptions table.
- Must not change matching or the story; read-only use of the engine.

## Freeze
- F2 by **9:30 p.m.**; F1 and F3 by **10:30 p.m.** (they are standalone). After that: fixes and polish only. Code freeze 5 a.m. stays.
