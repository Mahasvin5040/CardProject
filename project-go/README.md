# Online Go (Weiqi / Baduk)

A clean, barebones web application where two online players can play Go in real-time.

## Features & Rules Enforced

- **Real-Time Online Multiplayer**:
  - Room-based matching with shareable links (`?room=XYZ`).
  - First player to connect is assigned **Black**, second player is **White**, extra connections are **Spectators**.
  - Session persistence: refreshing a browser tab preserves the player's role without interrupting the game.
- **Full Go Rule Enforcement**:
  - **Placement**: Legal intersection validation, alternating turns.
  - **Liberties & Captures**: Orthogonal liberty tracking for individual stones and connected stone groups. Surrounded groups (0 liberties) are captured and removed immediately.
  - **Suicide Rule**: Placing a stone with 0 liberties is strictly forbidden, unless the move captures opponent stones (standard Go rule).
  - **Ko Rule**: Simple Ko is enforced to prevent infinite loops (players cannot immediately recapture a single stone to recreate the identical prior board position).
  - **Game Ending**: Triggered by **two consecutive passes** or by **resignation**.
  - **Chinese Area Scoring (数子法)**:
    - Area is calculated as: **Living Stones on board + Surrounded Empty Territory + Komi (7.5 for White)**.
    - Connected empty regions are flood-filled to determine strictly enclosed territory.
    - Dead stone groups can be toggled directly by clicking on them during the scoring phase.
    - A "Resume Play" option is available if players want to continue playing out disputes.
- **Board Sizes**:
  - Supports **19×19** (Standard), **13×13** (Medium), and **9×9** (Quick games).
  - Star points (hoshi) and coordinates (A–T skipping 'I', 1–19).

## Running the Application

1. Install dependencies:
   ```bash
   npm install
   ```

2. Start the server:
   ```bash
   npm start
   ```

3. Open your browser:
   - Navigate to `http://localhost:3000`
   - Click **Copy Link** and open it in a second tab (or share with an opponent) to play Black vs White.

## Running Tests

Run the built-in test suite to verify rule implementations:
```bash
npm test
```

