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

1. **Rules foundation (complete):** this architecture document, a pure
   JavaScript two-player rules engine, and Vitest tests. No playable app yet.
2. **2D single-player release (complete):** deliver a responsive Vue 3 browser
   game using plain JavaScript and Vite. Include manual and drag-and-drop fleet
   setup, randomize/clear controls, built-in Easy/Medium/Hard local AI, classic
   battle rules, end-of-game fleet reveal, replay, and local match history.
   Complete this single-player release before later game modes.
3. **Local pass-and-play (specified, not implemented):** add exactly two humans
   on the same device, private sequential setup, shared battle boards with
   unhit ships hidden, and local-match history/replay as specified below.
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
- `moveShip(game, playerId, shipId, position, orientation)` atomically repositions
  an existing ship during setup, ignoring its own previous cells for collision
  checks. Invalid moves leave the input state unchanged.
- `rotateShip(game, playerId, shipId)` rotates an existing setup ship into the
  nearest legal position, retaining the original if rotation is impossible.
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

## Phase 2 confirmed decisions

- Deliver a playable, responsive 2D browser game for desktop and mobile using
  Vue 3, plain JavaScript, and Vite. Keep the rules engine framework-independent;
  do not add a graphics library or 3D.
- Use the classic 10 by 10 board and fleet above. The human selects a ship,
  chooses horizontal/vertical orientation, and places by click or drag-and-drop.
  Include randomize and clear controls. Ships may touch, but cannot overlap or
  extend off-board. Provide accessible controls that also work on touch devices.
- Setup refinement: placed ships can be dragged from any occupied segment,
  retaining the grabbed segment's offset. Preview the candidate cells in green
  for legal placement and red for overlap or board-edge violations. Invalid
  drops and cancelled drags preserve the last valid placement.
- Right-click a placed ship to change orientation (`R` on a focused ship cell
  is the keyboard equivalent). Choose the legal anchor with the smallest
  Manhattan distance from its previous anchor; ties use row then column order.
  If no rotated placement exists, report the error and keep the old placement.
- Render visible ships with continuous top-down hull, bow and deck outlines,
  without exposing hidden enemy ships. Darken only the main background gradient
  by 50% (RGB channels), leaving panel colors and the broader UI unchanged.
- Randomize the AI fleet and keep it hidden during play. Reveal it when the match
  ends. Announce the randomly selected first shooter before the first shot.
- Preserve the engine's turn and validation behavior: one shot per turn; hits,
  including sinks, retain the turn; a miss passes it; repeated targets are
  rejected; sunk ships are identified by name; the final sink ends the game.
  Use the engine APIs and surface its rule errors; do not duplicate rules in UI.
- Offer Easy (random legal unshot cell), Medium (hunt/target around hits), and
  Hard (score each unshot cell by the number of legal placements of remaining
  unsunk ship lengths through it and choose a highest-scoring cell). Medium is
  the default and difficulty is selected before each match. AI may use only its
  own shots and publicly revealed sunk-ship lengths, never hidden fleet layout.
- At completion, provide a new-fleet rematch and replay of the finished match.
  Replay supports previous/next shot and play/pause. Keep enough match data to
  reproduce playback and reveal the AI fleet for review.
- Persist up to the 10 most recent completed matches in browser storage across
  reloads, with a clear-history control. No account or server synchronization.
  Validate stored data and explicitly report malformed or unavailable storage;
  do not silently present a success-shaped fallback. Do not change engine
  behavior to provide persistence or replay.
- Use side-by-side boards on desktop and stack them on narrow/mobile screens.
  Use a clean, modern naval/tactical visual style with restrained colors.
- This phase does not include pass-and-play, online networking/signaling,
  external AI providers, tactical economy/items, or 3D.
- Run the local development server with `npm run dev`; create the production
  bundle with `npm run build`.
- Run unit tests with `npm test`. For the desktop and mobile-emulated browser
  regressions, install Chromium with `npx playwright install chromium` after
  `npm install`, then run `npm run test:browser`. The runner starts and stops
  its own local Vite server.

## Phase 2 definition of done

- A new user can select a difficulty, place a legal fleet manually by click or
  drag-and-drop (or randomize it), start a game, and play a complete match.
- Human and AI shots flow only through the engine, respect turns, and give
  visible feedback for misses, hits, sinks, invalid/repeated shots, and victory.
  First shooter is shown before play; hidden AI ships are not exposed until end.
- Easy, Medium, and Hard select only legal unshot cells; Medium targets around
  unresolved hits, and Hard uses placement-count probability scores for the
  remaining ship lengths. Automated tests cover legality and strategy behavior.
- Results allow a fresh rematch and a navigable, playable shot-by-shot replay.
  Completed matches persist across reloads up to the 10-match limit; history can
  be cleared. Tests cover persistence, validation, and replay navigation.
- Layout is responsive and setup controls are usable with pointer, keyboard,
  and touch input. Malformed stored data, storage failures, and engine errors
  are presented as errors rather than ignored.
- `npm test` and `npm run build` pass. The project documents local run/build
  commands above.

## Phase 3 confirmed decisions

- Support exactly two local human players; 3-4 players remain deferred.
- Add a mode selector before fleet setup for single-player versus computer or
  local two-player play. Changing mode during a match requires confirmation
  before discarding that match.
- Allow optional player names, defaulting to Player 1 and Player 2.
- Persist the last-used player names in browser local storage and reuse them
  for new games. Single-player also allows a human name; its Player 1 default
  is shared with local two-player mode. Remember Player 2 separately.
- Trim surrounding whitespace and identify profiles case-insensitively, retaining
  the latest display capitalization. Local players must have distinct normalized
  names. A different normalized name selects or creates a separate profile;
  it does not rename a profile or transfer progress.
- Set up fleets privately in sequence. Player 1 places their fleet first using
  the existing setup controls, including movement, rotation, randomize and clear.
  Finishing setup hides that fleet behind a pass-device/Ready screen before
  Player 2 begins private setup. Never show the other player's fleet in setup.
- Once both fleets are complete, select the first shooter randomly and announce
  them on a shared screen. Require Start battle before enabling shots.
- During battle show both players' boards, but hide all unhit ship positions on
  both boards. Unlike single-player, even the current player's unhit fleet must
  remain hidden. This is shared-screen play, not a private-board battle mode.
- Clearly identify the current shooter and enable shooting only at their
  opponent's board. Keep classic rules: hits and sinks retain the turn until a
  miss; a miss immediately switches players without a battle handoff screen.
  Rejected shots do not change turns; announce sunk ships by name.
- At game end reveal both fleets, announce the winning player, and save the
  completed local match in the existing browser history with the same
  previous/next and play/pause replay controls.
- The most recent 10 completed matches across both modes share the existing
  history limit and clear-history control. Preserve existing single-player
  history and replay behavior while adding local mode and player labels.
- A local rematch retains player names, returns to private setup with empty
  fleets, and randomly selects the first shooter again after setup.
- Preserve desktop/mobile responsiveness and existing single-player behavior.
  Do not redesign the wider UI; the user is handling broader UI improvements.
- No online play, tactical items/economy, external AI providers, 3D, or 3-4
  player rules in this phase.

### Local high scores and name-based achievements

- Store player progress locally in the browser, independently of the last
  10 match replays. Clearing match history does not erase remembered names,
  personal bests, streaks, lifetime wins or unlocked achievements. No accounts,
  cross-device synchronization or verified player identity are implied.
- Maintain exactly two leaderboards: single-player (all AI difficulties
  combined) and local two-player. Only human winners of completed matches
  qualify; never create a computer profile.
- Rank by the winner's missed shots, lowest first. Keep one personal-best
  result per normalized name per mode. Break equal-miss ties by fewer shots
  fired by that winner, then the earliest qualifying result.
- Track a single combined consecutive-win streak per profile across both
  modes. A completed loss resets that profile's current streak; abandoning
  a match does not. Unlock streak milestones at 3, 5, 10, 20 and 50 wins.
- Count lifetime wins across both modes, unlocking First Victory and
  10, 50 and 100 lifetime-win milestones.
- Short battle unlocks at at most 40 total shots; Long battle unlocks at
  at least 140. Count shots by both players in a completed match, not elapsed
  time. Award these to every human participant, including the loser.
- Ships-advantage achievements require victory with exactly 1, 2, 3, 4 or 5
  own ships still afloat. Damaged but unsunk ships count. Each exact count is
  a separate achievement; winning with five does not also unlock counts 1-4.
- Flawless Aim unlocks on a win with zero missed shots by the winner.
- Achievements remain unlocked after later losses. Attribute results to the
  names used for the match, not a name selected later. Apply each completed
  match to player progress only once; opening or playing a replay must not
  change scores, streaks, lifetime wins or achievement credit.
- Existing unnamed single-player matches remain replayable but do not receive
  retrospective profile, score or achievement credit.
- This enumerated achievement set bounds Phase 3; further achievements require
  a later decision. Show high scores and profile achievements without a wider
  UI redesign. Storage failures and invalid progress data must be surfaced.

## Phase 3 definition of done

- Two humans can select local mode, optionally enter names, privately place
  complete legal fleets in sequence, acknowledge the setup handoff, and start
  battle after seeing the randomly selected first shooter.
- Hidden setup fleets and unhit ships during battle cannot be inferred from
  rendered ship silhouettes, cell styling, or accessible labels.
- Both battle boards are visible; only the opposing board accepts the active
  player's shots. Hit streaks, immediate miss handovers, shot validation,
  sinking and victory use the existing engine.
- A complete local match reveals both fleets and persists with correct player
  names and mode. Replays work after reload and share the 10-match cap without
  breaking older single-player records.
- Rematches repeat private setup with retained names and fresh fleets. Mode
  switching during a match requires confirmation; cancelling preserves it.
- Remembered names restore after reload, Player 1 is shared across modes,
  normalized names select the correct profiles, and local duplicate names
  are rejected. Names stored with finished matches remain stable in replays.
- Separate mode leaderboards retain each winner's personal best using the
  specified ordering. Profile achievements, lifetime wins and combined streaks
  persist independently of replay history. Completed local matches update
  both human profiles; single-player updates only its human profile.
- Tests cover achievement thresholds and exact ship counts, cross-mode streaks
  and loss resets, leaderboard ties, independent profile/history storage,
  duplicate-result protection and compatibility with unnamed legacy replays.
- Automated unit and desktop/mobile browser tests cover the new flow, privacy,
  turn switching, replay/history compatibility, and single-player regressions.
  Unit tests, browser regressions and production build pass.

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
- Phase 2 complete: responsive Vue 3/Vite game, three local AI strategies,
  accessible fleet setup and battle boards, completed-match persistence, replay,
  and history controls.
- Phase 2 review fixes: fleet dragging uses captured pointer events for mouse
  and touch, with cancellation, a drag indicator, and edge auto-scrolling;
  keyboard and click-to-place controls remain available. Pending AI turns are
  cancelled on restart/unmount, and each async continuation is tied to its own
  run so it cannot mutate a new match or reset a newer run's processing flag.
- Verification: `npm test` passes all 93 tests; `npm run test:browser` passes
  eight desktop/mobile browser regressions (two device-inapplicable cases skipped),
  covering real touch-event placement in Pixel 5 emulation, rotation, overlap,
  cancellation, mouse/keyboard placement, and restarting during an AI delay.
  `npm run build` produces the production bundle.
- Phase 2 placement refinements complete: movable placed ships, nearest-fit
  rotation, invalid-placement previews and rollback, top-down ship silhouettes,
  and a 50% darker main background.
- Phase 3 requirements clarified and recorded, including persistent names,
  mode-specific high scores and name-based achievements; implementation has
  completed: private local setup and pass-and-play, hidden battle fleets,
  named local replays, independent player profiles, two mode leaderboards,
  and persistent idempotent achievements.
- Phase 3 verification: `npm test` passes all 113 unit tests;
  `npm run test:browser` passes 12 desktop/mobile regressions (two
  device-inapplicable cases skipped), including local fleet privacy, turn
  handoff, named replay reload, rematches, and cancellation; `npm run build`
  succeeds.
