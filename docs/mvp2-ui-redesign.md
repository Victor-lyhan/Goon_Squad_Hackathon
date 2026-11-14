# MVP II UI redesign (human-written; source of truth for all UI work in M7–M9)

Wording update: the app now uses real NYC locations with simulated deliveries. Replace "synthetic city" with "Real NYC locations · simulated deliveries" and replace "hub" with "relay point (network business)" everywhere in the UI.

## 1. Simulator UI

Full-screen, full-width, map-first layout inspired by the structure of kepler.gl (not its branding). No cards or metrics above the map. The simulator spans the whole screen horizontally.

- Map (center, most of the screen): NYC on a light, desaturated Google basemap using Google Maps custom styling to simplify the map (hide POI and transit labels, muted water and parks, light gray roads), with deck.gl layers on top (via @deck.gl/google-maps GoogleMapsOverlay) for routes, network businesses and moving vehicles/packages. Not dark; routes stand out in the accent color, everything else stays quiet. Clean and modern.
- Left panel (controls, collapsible): scenario (seed, employee and package counts, detour limit), playback (play/pause, speed, scrubber, next event, jump to morning, finish, reset), layer toggles (routes, businesses, homes, packages), focus selector, Start new planning cycle.
- Right panel (inspect, collapsible): the selected business, employee or package: timeline, legs, ETA, extra minutes, reward. When nothing is selected, a compact summary: delivered/requested, matched/requested, average extra minutes.
- Interactions: hover shows a tooltip with name and role; click selects the item, highlights its routes and packages, dims everything else and fills the right panel; Esc clears the selection. A package marker visibly travels with its carrier, waits at the relay business overnight, then travels with the second carrier. Interactions between businesses, employees and packages must be obvious.
- Focus mode: choose one employee or one business; the map shows only their routes, packages and the businesses they interact with.
- **Package journey mode (the primary way to understand Relay):** selecting a package, from the map, the package list in the left panel, or a link from the Business/Employee workspaces, switches the map to that package's journey only:
  - Shows just the sender business, the recipient business, the relay business (if any) and the one or two carriers involved. Everything else is hidden or heavily dimmed.
  - Each carrier's normal commute is a faint line; their actual route with the package stops is a highlighted line. Leg 1 and leg 2 use two distinct colors, and the legend says which carrier is which.
  - Numbered stop markers on the map in order: 1 Pickup at sender → 2 Drop at relay business (relay only) → 3 Pickup at relay business next morning → 4 Delivered at recipient.
  - The map auto-zooms to fit the journey. The package marker moves along with its current carrier and sits at the relay business overnight.
  - The right panel shows a vertical journey timeline with the same numbered steps: time, place, carrier, extra minutes, plus the current status. Clicking a step seeks the simulation to that moment and pans the map to it.
  - "Play journey" plays the simulation and auto-skips the empty gaps (overnight, before pickup) so the whole delivery can be watched in under ~30 seconds.
  - A clear exit ("Back to network" / Esc) returns to the full view.
- Desktop-first. On narrow screens, a simple message asking to open on desktop is acceptable.
- Focus on clear functionality first; aesthetics are very important too.

## 2. App-wide redesign (Business, Employee, homepage)

Redesign the Relay web application UI with a visual language inspired by Palantir's corporate website and Foundry/AIP software interfaces. Make Relay feel like a serious enterprise logistics operations platform, NOT a generic AI-generated SaaS landing page. Use Palantir as a stylistic reference only: no copied logos, proprietary layouts or branded assets.

Relay has exactly three primary destinations, which must be the unmistakable focus of the homepage and global navigation:
- Business: create shipment requests, find delivery matches, manage deliveries.
- Employee: manage commute, departure times, maximum detour time, assigned packages.
- Simulator: visualize the NYC delivery network, matching routes, relay points and simulated delivery operations.

### Visual direction (design tokens)
- IBM Plex Sans for interface typography; IBM Plex Mono selectively for data, timestamps, identifiers and small technical labels.
- Text #151B26. Canvas #F7F8FA. Surfaces white. Borders #D7DDE5. Accent #28618A.
- Predominantly square corners (2–4px radius). Thin 1px dividers and borders. Spacing on a 4px/8px scale.
- Clear typography hierarchy, precise alignment, minimal purposeful icons.
- No unnecessary shadows, gradients, blobs, illustrations or decorative patterns.
- Avoid the AI-dashboard look: oversized rounded cards, colorful feature icons, gradient CTAs, pill-shaped everything, excessive badges, repeated explanatory sections.

### Homepage
1. Compact full-width header: Relay identity, the three destinations, subtle "Real NYC locations · simulated deliveries" indicator.
2. Introduction: "Delivery infrastructure, powered by existing commutes." plus at most two short lines.
3. Compact operational summary: business count, commuter count, relay points, matched/requested deliveries. Understated typography, no oversized widgets.
4. Three equally prominent workspace entries (Business, Employee, Simulator), each with a short workspace identifier, large title, one sentence, an understated "Open workspace" action, subtle precise hover state, fully clickable surface and keyboard focus.
5. Minimal footer identifying the environment as simulated.
Remove the three-step "Commute / Match / Simulated Delivery" feature cards and the long "Run the demo" instructions; move any walkthrough to a separate Help / Guided demo page.

### Workspaces
- Business: shipments table as the primary content; clear "New delivery" action; search, filters, status indicators; dedicated delivery details and match results.
- Employee: saved commute as the primary content (address search for home, not node clicking); clear route and availability controls; assigned deliveries and commute constraints; straightforward departure times and permitted detour.

### Implementation requirements
- Reusable design-token system; refactor components that enforce the old rounded-card style.
- Desktop and mobile responsive (Business and Employee must work at 390 px), accessible, proper contrast, keyboard navigation, obvious interactive states.
- No filler metrics, fabricated functionality, decorative dashboards or redundant copy.
- Quality bar: a user arriving on the homepage immediately understands which of the three workspaces to open, without reading a tutorial.
