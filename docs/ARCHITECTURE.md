# Architecture

NAV KURD uses a central composition root and independent controllers. `src/main.ts` owns orchestration; feature logic belongs in `src/lib`. Modules communicate through explicit callbacks and snapshots instead of hidden global state.

## Rendering

MapLibre owns map rendering. GeoJSON sources are updated in bounded atomic transactions. Continuous visual work is scheduled through one frame-budget coordinator. Responsive overlays use visual-viewport metrics and deterministic CSS; target-dependent tutorial geometry performs a coalesced read phase followed by writes.

## State

Runtime state, lifecycle recovery, service state and release identity each have one owner. Camera and UI state survive browser backgrounding without document reload. Long-lived data caches are separate from transient HTTP caches.

## UI

All style files are imported through `src/styles.css`. Design and z-index tokens live in `src/styles/tokens.css`. Feature modules may consume tokens but may not invent stacking values.

## Canonical stacking model

Stacking is declared once in `src/styles/tokens.css`; feature styles cannot use numeric `z-index` values.

| Scope | Range | Ownership |
|---|---:|---|
| Local component | 0–5 | base, content, raised content, overlay, popover and local critical affordances inside an isolated component |
| Map rendering | 10–30 | map effects, map edge masks and map labels |
| Application surfaces | 100–200 | sheet, attribution, popups, route UI, controls, health, search, detail, account/contribution panels, QA and coordinate picker |
| Transitions and blocking UI | 210–250 | transitions, dialogs, confirmations, loading and unrecoverable critical state |

The local scope is contiguous from zero. Application values use documented ownership bands so a UI module can change without silently overtaking an unrelated feature. Source verification rejects negative, duplicate, undefined, unused or literal stacking values.
