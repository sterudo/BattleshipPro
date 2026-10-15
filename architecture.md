# BattleshipPro architecture and development plan

## Confirmed direction

The first playable release is single-player Battleship against built-in local
strategy AI. The rules engine uses plain JavaScript, independent of frameworks.
Vue 3 is planned for the later UI. Add a graphics library only if the visuals
require one; no graphics library is selected for Phase 1.

This document records the clarified implementation scope. The README describes
the broader original vision; it is not authorization to implement its advanced
features in the first phase. Future sessions must follow this plan and update
this document with progress and any subsequently confirmed decisions before
changing scope. Unresolved future details remain deferred rather than assumed.

## Classic rules

- A 10 by 10 board uses zero-based row and column coordinates.
- Each player has one carrier (5 cells), battleship (4), cruiser (3),
  submarine (3), and destroyer (2).
- Ships are straight, horizontal or vertical. They may touch, including
  diagonally, but cannot overlap or extend outside the board.
- Setup supports manual placement with an orientation, randomizing a complete
  fleet, and clearing a fleet. Both fleets must be complete before play.
- Choose the first shooter randomly when starting the game. Expose that result
  before any shot so the later UI can announce it.
- A hit retains the turn, including when a ship sinks. A miss transfers the turn.
  Reject a repeated target without consuming the turn.
- Report the name of a ship when it sinks. Sinking the opposing fleet wins
  immediately and ends shooting.
- Use ordinary browser randomness in production. Randomness may be injected for
  tests, but seeded randomness and replay support are not part of Phase 1.

## Development phases

1. **Rules foundation (current phase):** this architecture document, a pure
   JavaScript two-player rules engine, and Vitest tests. No playable app yet.
2. **2D single-player release:** build the Vue 3 setup and battle UI, including
   manual placement/orientation, randomize/clear controls, first-shooter display,
   shot feedback, sunk-ship announcements, and victory display. Add built-in local
   AI: Easy chooses random unshot cells; Medium adds hunt/target after hits; Hard
   adds probability-based hunting. Complete this single-player release before
   later game modes. Detailed UI and AI behavior beyond these decisions should
   be clarified when this phase begins.
3. **Local pass-and-play:** add same-device human play and a private setup/turn
   handoff UX. Clarify visibility details before implementation.
4. **Online multiplayer:** add rooms and synchronized multiplayer with a small
   signaling/relay service. GitHub Pages can host static assets but is not
   assumed to provide that service. Networking protocol, hosting, and exact
   multiplayer rules (including 3-4 player behavior) require later decisions.
5. **Tactical expansion:** clarify and implement the economy and items separately
   from classic rules. The README's proposed items and balance values are future
   ideas, not Phase 1 requirements.
6. **3D stretch goal:** consider 3D only after the complete 2D experience.
   Select a graphics library then if necessary.

External AI providers (Ollama, LM Studio, Gemini) remain deferred, with no
committed implementation phase. Persistence, replay, tactical actions, online
services, and 3-4 player implementation are outside Phase 1.

## Phase 1 design

`src/engine/gameLogic.js` owns rules and state transitions. `tests/gameLogic.test.js`
uses Vitest; the project has no runtime dependencies. Run `npm test` for the
non-watch test suite.

State contains a `players` array with stable player IDs, each player's placed
ships and received shots, a `phase` (`setup`, `playing`, or `finished`),
`firstPlayerId`, `currentPlayerId`, and `winnerId`. Exactly two players are
supported now. Player IDs and an explicit target ID avoid baking human/AI roles
or a separate hard-coded opponent field into the engine; they do not implement
future multiplayer rules. Raw engine state is authoritative internal data, not a
privacy-filtered UI or network payload.

Public operations:

- `createGame(playerIds?)` creates two empty boards with default player IDs.
- `placeShip(game, playerId, shipId, position, orientation)` places an unplaced
  fleet ship; orientations are `horizontal` or `vertical`, extending toward
  increasing column or row respectively.
- `clearFleet(game, playerId)` removes that player's setup placements.
- `randomizeFleet(game, playerId, random?)` replaces that player's setup fleet
  with a complete legal fleet.
- `startGame(game, random?)` requires both fleets and selects the first shooter.
- `fireShot(game, shooterId, targetId, position)` returns `{ game, shot }`;
  `shot` reports `miss`, `hit`, or `sunk`, the ship ID when hit, and the ship name
  when sunk. The updated state reports turn ownership and victory.

Positions are `{ row, column }` integer coordinates. Successful operations return
new state without mutating input. Rejected operations throw a `RuleError` with a
machine-readable `code`; callers must surface that error instead of treating it
as a successful action. Tests inject a function returning a number in `[0, 1)`
where needed; production defaults to `Math.random`. Fleet generation chooses
among legal placements rather than relying on unbounded random retries.

## Phase 1 definition of done

- Architecture and the full ordered roadmap are recorded here.
- Engine code has no UI, AI, framework, network, or persistence dependencies.
- State starts in setup with two distinct players and empty fleets.
- Placement validates player/ship IDs, integer coordinates, orientation, bounds,
  overlap, and duplicate ships; touching ships remain legal.
- Randomize produces exactly the classic fleet without overlaps or off-board
  cells and replaces existing placements. Clear permits rebuilding a fleet.
- Only complete fleets can start; setup cannot change after play begins.
- First-shooter selection is random, testable, and available before play.
- Shots validate phase, shooter, opponent, bounds, and previous targets.
- Hits and sinks preserve the turn; misses transfer it; rejected shots change
  neither state nor turn. Sinks identify the ship by name.
- The final sink records a winner, ends the game, and prevents further shots.
- Vitest covers these rules, full-game victory, immutability, and randomized
  fleet legality. All tests pass.

## Progress

- Confirmed requirements and phase plan recorded.
- Phase 1 complete: framework-independent rules engine and Vitest coverage of all
  acceptance criteria, including legal randomized fleets and complete games.
- No later-phase implementation has started. The next phase is the Vue 3 2D
  single-player release with built-in local strategy AI; clarify its deferred
  details and update this document before implementation.
