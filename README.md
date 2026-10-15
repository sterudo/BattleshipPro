# BattleshipPro Specification: Battleship Tactical Matrix (Enhanced Multiplayer Battleship)

## 1. Project Overview & Architecture

* **Framework:** Vue.js 3 (Composition API, Single File Components), styled with Tailwind CSS and Lucide/FontAwesome icons.
* **Hosting:** GitHub Pages (Static site hosting).
* **Multiplayer Connectivity:**
* *Primary Strategy:* **Serverless Peer-to-Peer (WebRTC)** using lightweight signaling (e.g., PeerJS or WebRTC with a public STUN server).
* *Fallback:* Lightweight relay backend for room management and message forwarding.


* **Graphics / View Modes:**
* **2D Mode:** Clean, crisp tactical grid interface optimized for quick moves and mobile/desktop play.
* **3D Mode (Toggleable):** Built using Three.js / TresJS featuring water shaders, buoyant ship models, explosion particle effects, and cinematic camera sweeps.



---

## 2. Game Modes & AI Integration

### 2.1 Game Modes

1. **Single Player vs. AI:** Play against local or API-driven AI opponents.
2. **Local Multiplayer (Pass-and-Play / Same Device):** Non-AI multi-player mode on a single screen.
3. **Online Multiplayer (2 to 4 Players):** Real-time lobby creation, room codes, custom configuration, and turn synchronization via WebRTC.

### 2.2 AI Engine & Provider Architecture (`aiEngine.js`)

The game must support pluggable AI backends configured via a settings menu:

* **Local AI Providers:**
* **Ollama API:** Connects to a local instance (e.g., `http://localhost:11434`) with user-selectable models (e.g., `llama3`, `mistral`, `phi3`).
* **LM Studio:** Connects via OpenAI-compatible local endpoint (e.g., `http://localhost:1234/v1`).


* **Cloud AI Provider:**
* **Google Gemini API:** Configurable via user-inputted API Key, with model selection (e.g., `gemini-2.5-flash`, `gemini-2.5-pro`).


* **Host Control Rule:** In online multiplayer lobbies, AI bots can be added to empty slots, but **only by the host user** who has configured valid local or API-driven AI credentials. The host’s client processes or coordinates the AI turns and propagates actions to peers.

---

## 3. Local Multiplayer (Pass-and-Play) Special Rules

When playing locally on one computer without AI:

1. **Secret Setup Phase:** Players take turns at the device to position their fleets and buy initial pre-game items while the screen is hidden/blacked out for others.
2. **Battle Phase Display:** All active player battle grids are displayed side-by-side or toggled cleanly.
3. **Tactical Item Adjustments for Local Visibility:**

* Secret items that break local screen equity (such as **Mines**, **Turn Passes**, or hidden **Ship Movements**) are adjusted or restricted so that physical screen-peeking doesn't instantly spoil hidden mechanics.
* **Armor and Stealth** can be purchased or configured during the pre-game setup phase. During actual gameplay, turns involving hidden actions skip visual confirmation states to keep opponent boards secret.

---

## 4. Core Mechanics & Economic Balancing

### 4.1 The "Money/Turn" Economy

* **Concept:** Instead of a strict 1-shot-per-turn model, players spend turn action points/credits.
* **Safeguards:** Turn Time Limit (e.g., 45s) and a Max Hoard Limit (max 3 unspent tokens) to prevent stalling.

### 4.2 Action Menu (Purchased by skipping a standard shot)

1. **Armor Plates (Max 5 per ship / Pool limit per game):** Absorbs 1 hit. Reveals part presence on first hit without sinking.
2. **Big Bomb (3x3 Area of Effect):** Cost: 1 full turn + **1 random part of your own ship is revealed** to opponents. Center cell full hit; surrounding 8 cells act as radar sweeps.
3. **Stealth Tech (Max 4 per player pool):** Shields a ship from Big Bomb detection and radar pings until it moves or fires.
4. **Ship Repositioning:** Move a living ship 1 space forward or backward along its axis.
5. **Turn Pass / Feint:** Passes action to confuse opponents.
6. **Tactical Mines (Max 3 per player):** Invisible mine placed on water tiles. Detonates if an opponent moves or fires onto it (reported as generic damage).

---

## 5. Suggested Additional Mods (For Future Expansion)

* **Sonar Pulse:** Spend a turn to check for *any* ship presence in a chosen 2x2 quadrant.
* **Decoy Buoy:** A fake "ship signature" that registers as a small boat on radar/Big Bombs.
* **Repair Crew:** Spend a turn patching up 1 damaged (non-destroyed) ship segment.
* **Fog of War Currents:** Random drift events every few rounds shifting unanchored ships.

---

## 6. Multi-Player Turn Order & Scaling Rules

* For $N$ players ($N \ge 2$): Each round gives a player **$N - 1$ sub-actions/moves** distributed across their turn phase against other specific opponents.
* **Global Inventory Caps:** Shared resource limits to prevent spamming items.

---

## 7. Technical Requirements for the AI Agent Harness

### Component Structure (`src/`)

```text
src/
├── assets/             # 3D models (GLTF), audio effects, textures
├── components/
│   ├── GameGrid.vue    # Dual-mode rendering (2D HTML Canvas/DOM & 3D Three.js)
│   ├── ActionPanel.vue # Economy & shop interface for Armor, Mines, Big Bombs
│   ├── Lobby.vue       # P2P WebRTC / Room signaling & Host AI Manager
│   ├── AISettings.vue  # Configuration panel for Ollama, LM Studio, & Gemini API Key
│   ├── Scoreboard.vue  # Player health, resources, and turn timers
│   └── ChatLog.vue     # In-game tactical chat & event logs
├── engine/
│   ├── gameLogic.js    # Core state machine, validation rules, turn resolution
│   ├── aiBridge.js     # Unified AI client supporting Ollama, LM Studio (OpenAI compat), and Gemini SDK
│   └── netcode.js      # WebRTC / PeerJS wrapper for serverless multiplayer
└── App.vue

```

### State Management Rules

* Immutable state updates using Pinia or Vue reactive stores.
* Deterministic state validation across P2P peers and host-managed AI clients.
