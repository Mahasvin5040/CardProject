/**
 * Go Game Logic Engine
 * Implements standard rules including:
 * - Placement
 * - Liberties and Captures (groups, orthogonal liberties)
 * - Suicide Rule (forbidden unless it results in captures)
 * - Ko Rule (prevents board position repetition)
 * - Game Ending (2 consecutive passes or resignation)
 * - Chinese Area Scoring (Area = living stones + surrounded empty points + komi)
 */

export const EMPTY = 0;
export const BLACK = 1;
export const WHITE = 2;

export const GAME_STATUS = {
  WAITING: 'WAITING',
  PLAYING: 'PLAYING',
  SCORING: 'SCORING',
  ENDED: 'ENDED'
};

export class GoGame {
  constructor(size = 19, komi = 7.5) {
    this.size = size;
    this.komi = komi;
    this.reset();
  }

  reset() {
    this.board = Array.from({ length: this.size }, () => Array(this.size).fill(EMPTY));
    this.currentTurn = BLACK;
    this.status = GAME_STATUS.PLAYING;
    this.consecutivePasses = 0;
    this.captures = { [BLACK]: 0, [WHITE]: 0 };
    this.moveHistory = []; // { player, x, y, captured, type: 'move'|'pass' }
    this.boardHistory = [this.serializeBoard(this.board)]; // History of serialized board states
    this.lastMove = null;
    this.winner = null;
    this.winReason = null;
    this.scoreResult = null;
    this.deadStones = new Set(); // Set of "r,c" coordinates marked dead in scoring
  }

  serializeBoard(board = this.board) {
    return board.map(row => row.join('')).join('');
  }

  getOpponent(color) {
    return color === BLACK ? WHITE : BLACK;
  }

  isValidCoord(r, c) {
    return r >= 0 && r < this.size && c >= 0 && c < this.size;
  }

  getAdjacent(r, c) {
    const adj = [];
    if (r > 0) adj.push({ r: r - 1, c });
    if (r < this.size - 1) adj.push({ r: r + 1, c });
    if (c > 0) adj.push({ r, c: c - 1 });
    if (c < this.size - 1) adj.push({ r, c: c + 1 });
    return adj;
  }

  /**
   * Finds the group of stones connected to (startR, startC) and its liberties.
   */
  getGroupAndLiberties(board, startR, startC) {
    const color = board[startR][startC];
    if (color === EMPTY) {
      return { stones: [], liberties: new Set() };
    }

    const visited = Array.from({ length: this.size }, () => Array(this.size).fill(false));
    const stones = [];
    const liberties = new Set();
    const queue = [{ r: startR, c: startC }];
    visited[startR][startC] = true;

    while (queue.length > 0) {
      const { r, c } = queue.shift();
      stones.push({ r, c });

      for (const neighbor of this.getAdjacent(r, c)) {
        const neighborColor = board[neighbor.r][neighbor.c];
        if (neighborColor === EMPTY) {
          liberties.add(`${neighbor.r},${neighbor.c}`);
        } else if (neighborColor === color && !visited[neighbor.r][neighbor.c]) {
          visited[neighbor.r][neighbor.c] = true;
          queue.push(neighbor);
        }
      }
    }

    return { stones, liberties };
  }

  /**
   * Validates if placing a stone at (r, c) for player `color` is legal.
   * Returns: { valid: boolean, error?: string, capturedStones?: Array<{r, c}>, nextBoard?: Array<Array<number>> }
   */
  validateMove(r, c, color = this.currentTurn) {
    if (this.status !== GAME_STATUS.PLAYING) {
      return { valid: false, error: 'Game is not in playing state' };
    }

    if (color !== this.currentTurn) {
      return { valid: false, error: 'Not your turn' };
    }

    if (!this.isValidCoord(r, c)) {
      return { valid: false, error: 'Invalid coordinate' };
    }

    if (this.board[r][c] !== EMPTY) {
      return { valid: false, error: 'Point is already occupied' };
    }

    // 1. Simulate stone placement
    const nextBoard = this.board.map(row => [...row]);
    nextBoard[r][c] = color;
    const opponent = this.getOpponent(color);

    // 2. Check for captures of adjacent opponent groups
    const capturedStones = [];
    const checkedOpponents = new Set();

    for (const neighbor of this.getAdjacent(r, c)) {
      if (nextBoard[neighbor.r][neighbor.c] === opponent) {
        const key = `${neighbor.r},${neighbor.c}`;
        if (!checkedOpponents.has(key)) {
          const groupInfo = this.getGroupAndLiberties(nextBoard, neighbor.r, neighbor.c);
          for (const stone of groupInfo.stones) {
            checkedOpponents.add(`${stone.r},${stone.c}`);
          }
          if (groupInfo.liberties.size === 0) {
            capturedStones.push(...groupInfo.stones);
          }
        }
      }
    }

    // Remove captured stones from simulated board
    for (const stone of capturedStones) {
      nextBoard[stone.r][stone.c] = EMPTY;
    }

    // 3. Suicide Rule:
    // If no opponent stones were captured, check if the placed stone's group has any liberties.
    // If it has 0 liberties, it is suicide and thus ILLEGAL.
    const myGroup = this.getGroupAndLiberties(nextBoard, r, c);
    if (myGroup.liberties.size === 0) {
      return {
        valid: false,
        error: 'Suicide move is not allowed: stone group would have zero liberties'
      };
    }

    // 4. Ko Rule:
    // A move must not recreate a previous board position.
    // Specifically, Simple Ko forbids recreating the board position from before the opponent's previous move.
    // (And positional superko forbids recreating ANY prior board state in the game).
    const nextBoardHash = this.serializeBoard(nextBoard);

    // Check simple Ko (position 2 plies ago, right before opponent moved)
    if (this.boardHistory.length >= 2) {
      const previousState = this.boardHistory[this.boardHistory.length - 2];
      if (nextBoardHash === previousState) {
        return {
          valid: false,
          error: 'Ko rule violation: cannot repeat the previous board position immediately'
        };
      }
    }

    // Optional: Positional Superko check (prevent repetition of any prior board state)
    if (this.boardHistory.includes(nextBoardHash)) {
      return {
        valid: false,
        error: 'Superko violation: cannot recreate an identical board position from earlier in the game'
      };
    }

    return {
      valid: true,
      capturedStones,
      nextBoard
    };
  }

  /**
   * Plays a move at (r, c) for player `color`.
   */
  playMove(r, c, color = this.currentTurn) {
    const validation = this.validateMove(r, c, color);
    if (!validation.valid) {
      return validation;
    }

    const { capturedStones, nextBoard } = validation;

    // Apply board change
    this.board = nextBoard;
    this.captures[color] += capturedStones.length;
    this.consecutivePasses = 0;
    this.lastMove = { r, c, color };

    // Record history
    const nextHash = this.serializeBoard(this.board);
    this.boardHistory.push(nextHash);
    this.moveHistory.push({
      type: 'move',
      player: color,
      r,
      c,
      captured: capturedStones
    });

    // Advance turn
    this.currentTurn = this.getOpponent(color);

    return {
      valid: true,
      capturedStones,
      lastMove: this.lastMove,
      currentTurn: this.currentTurn
    };
  }

  /**
   * Passes the turn for the given player.
   */
  pass(color = this.currentTurn) {
    if (this.status !== GAME_STATUS.PLAYING) {
      return { valid: false, error: 'Game is not in playing state' };
    }

    if (color !== this.currentTurn) {
      return { valid: false, error: 'Not your turn' };
    }

    this.consecutivePasses += 1;
    this.lastMove = { type: 'pass', color };
    this.boardHistory.push(this.serializeBoard(this.board));
    this.moveHistory.push({
      type: 'pass',
      player: color
    });

    if (this.consecutivePasses >= 2) {
      // Game ended by 2 consecutive passes -> enter scoring phase
      this.status = GAME_STATUS.SCORING;
      this.calculateScore();
      return {
        valid: true,
        gameEnded: true,
        status: this.status,
        scoreResult: this.scoreResult
      };
    }

    this.currentTurn = this.getOpponent(color);
    return {
      valid: true,
      gameEnded: false,
      currentTurn: this.currentTurn
    };
  }

  /**
   * Resigns the game for player `color`.
   */
  resign(color = this.currentTurn) {
    if (this.status !== GAME_STATUS.PLAYING && this.status !== GAME_STATUS.SCORING) {
      return { valid: false, error: 'Game is already ended' };
    }

    this.winner = this.getOpponent(color);
    this.winReason = `${color === BLACK ? 'Black' : 'White'} resigned`;
    this.status = GAME_STATUS.ENDED;

    return {
      valid: true,
      winner: this.winner,
      winReason: this.winReason,
      status: this.status
    };
  }

  /**
   * Toggles a stone group as dead/alive during the scoring phase.
   */
  toggleDeadStone(r, c) {
    if (this.status !== GAME_STATUS.SCORING && this.status !== GAME_STATUS.ENDED) {
      return { valid: false, error: 'Can only mark dead stones during scoring' };
    }

    if (!this.isValidCoord(r, c) || this.board[r][c] === EMPTY) {
      return { valid: false, error: 'No stone at this coordinate' };
    }

    const key = `${r},${c}`;
    const isCurrentlyDead = this.deadStones.has(key);
    const { stones } = this.getGroupAndLiberties(this.board, r, c);

    for (const s of stones) {
      const stoneKey = `${s.r},${s.c}`;
      if (isCurrentlyDead) {
        this.deadStones.delete(stoneKey);
      } else {
        this.deadStones.add(stoneKey);
      }
    }

    this.calculateScore();
    return {
      valid: true,
      deadStones: Array.from(this.deadStones),
      scoreResult: this.scoreResult
    };
  }

  /**
   * Chinese Area Scoring (数子法 / Area Counting):
   * - Living stones on board count as 1 point of area for the owner.
   * - Connected empty spaces enclosed entirely by stones of one color count as territory for that color.
   * - White receives Komi (e.g., 7.5 points).
   * - Area(Black) = living Black stones + Black territory
   * - Area(White) = living White stones + White territory + Komi
   */
  calculateScore() {
    // 1. Effective board taking dead stones into account
    const effectiveBoard = this.board.map((row, r) =>
      row.map((val, c) => (this.deadStones.has(`${r},${c}`) ? EMPTY : val))
    );

    let blackStones = 0;
    let whiteStones = 0;

    for (let r = 0; r < this.size; r++) {
      for (let c = 0; c < this.size; c++) {
        if (effectiveBoard[r][c] === BLACK) blackStones++;
        else if (effectiveBoard[r][c] === WHITE) whiteStones++;
      }
    }

    // 2. Flood-fill to find connected empty regions and their surrounding borders
    const visited = Array.from({ length: this.size }, () => Array(this.size).fill(false));
    let blackTerritory = 0;
    let whiteTerritory = 0;
    let dame = 0;

    const territoryMap = Array.from({ length: this.size }, () => Array(this.size).fill(0));
    // 0 = none / stone, 1 = Black territory, 2 = White territory, 3 = Dame (neutral)

    for (let r = 0; r < this.size; r++) {
      for (let c = 0; c < this.size; c++) {
        if (effectiveBoard[r][c] === EMPTY && !visited[r][c]) {
          const region = [];
          const borderingColors = new Set();
          const queue = [{ r, c }];
          visited[r][c] = true;

          while (queue.length > 0) {
            const current = queue.shift();
            region.push(current);

            for (const neighbor of this.getAdjacent(current.r, current.c)) {
              const neighborColor = effectiveBoard[neighbor.r][neighbor.c];
              if (neighborColor === EMPTY) {
                if (!visited[neighbor.r][neighbor.c]) {
                  visited[neighbor.r][neighbor.c] = true;
                  queue.push(neighbor);
                }
              } else {
                borderingColors.add(neighborColor);
              }
            }
          }

          // Evaluate this empty region
          let owner = 0;
          if (borderingColors.has(BLACK) && !borderingColors.has(WHITE)) {
            owner = BLACK;
            blackTerritory += region.length;
          } else if (borderingColors.has(WHITE) && !borderingColors.has(BLACK)) {
            owner = WHITE;
            whiteTerritory += region.length;
          } else {
            owner = 3; // Neutral / Dame
            dame += region.length;
          }

          for (const pt of region) {
            territoryMap[pt.r][pt.c] = owner;
          }
        }
      }
    }

    const blackTotal = blackStones + blackTerritory;
    const whiteTotal = whiteStones + whiteTerritory + this.komi;
    const diff = blackTotal - whiteTotal;

    let winner = null;
    let winReason = '';
    if (diff > 0) {
      winner = BLACK;
      winReason = `Black wins by ${diff.toFixed(1)} points`;
    } else if (diff < 0) {
      winner = WHITE;
      winReason = `White wins by ${Math.abs(diff).toFixed(1)} points`;
    } else {
      winner = 0; // Jigo (draw - rare with fractional komi)
      winReason = 'Game ended in a draw';
    }

    this.scoreResult = {
      black: {
        stones: blackStones,
        territory: blackTerritory,
        total: blackTotal
      },
      white: {
        stones: whiteStones,
        territory: whiteTerritory,
        komi: this.komi,
        total: whiteTotal
      },
      dame,
      diff,
      winner,
      winReason,
      territoryMap
    };

    return this.scoreResult;
  }

  /**
   * Confirms final scoring and ends the game.
   */
  confirmScore() {
    this.calculateScore();
    this.winner = this.scoreResult.winner;
    this.winReason = this.scoreResult.winReason;
    this.status = GAME_STATUS.ENDED;
    return this.scoreResult;
  }

  /**
   * Resumes play if players disagree during scoring.
   */
  resumePlay() {
    if (this.status === GAME_STATUS.SCORING) {
      this.status = GAME_STATUS.PLAYING;
      this.consecutivePasses = 0;
      this.deadStones.clear();
      this.scoreResult = null;
      return { valid: true };
    }
    return { valid: false, error: 'Game is not in scoring state' };
  }

  /**
   * Returns a snapshot of the game state for clients.
   */
  getState() {
    return {
      size: this.size,
      komi: this.komi,
      board: this.board,
      currentTurn: this.currentTurn,
      status: this.status,
      captures: this.captures,
      lastMove: this.lastMove,
      winner: this.winner,
      winReason: this.winReason,
      scoreResult: this.scoreResult,
      deadStones: Array.from(this.deadStones),
      consecutivePasses: this.consecutivePasses,
      moveCount: this.moveHistory.length
    };
  }
}
