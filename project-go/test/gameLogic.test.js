import test from 'node:test';
import assert from 'node:assert/strict';
import { GoGame, BLACK, WHITE, EMPTY, GAME_STATUS } from '../src/gameLogic.js';

test('GoGame - Basic placement and turn alternation', () => {
  const game = new GoGame(9);
  assert.equal(game.currentTurn, BLACK);

  // Black plays (2, 2)
  const res1 = game.playMove(2, 2, BLACK);
  assert.equal(res1.valid, true);
  assert.equal(game.board[2][2], BLACK);
  assert.equal(game.currentTurn, WHITE);

  // White plays (2, 3)
  const res2 = game.playMove(2, 3, WHITE);
  assert.equal(res2.valid, true);
  assert.equal(game.board[2][3], WHITE);
  assert.equal(game.currentTurn, BLACK);

  // Playing on occupied spot should fail
  const resOccupied = game.playMove(2, 2, BLACK);
  assert.equal(resOccupied.valid, false);

  // Playing out of turn should fail
  const resTurn = game.playMove(5, 5, WHITE);
  assert.equal(resTurn.valid, false);
});

test('GoGame - Capturing a single stone in center', () => {
  const game = new GoGame(9);

  // Black plays (1, 2)
  game.playMove(1, 2, BLACK);
  // White plays at (2, 2) [target stone]
  game.playMove(2, 2, WHITE);
  // Black surrounds White stone
  game.playMove(3, 2, BLACK); // bottom
  game.playMove(8, 8, WHITE); // White passes elsewhere
  game.playMove(2, 1, BLACK); // left
  game.playMove(8, 7, WHITE); // White passes elsewhere

  // Board now has White at (2, 2) with only 1 liberty at (2, 3)
  const whiteGroup = game.getGroupAndLiberties(game.board, 2, 2);
  assert.equal(whiteGroup.liberties.size, 1);
  assert.ok(whiteGroup.liberties.has('2,3'));

  // Black delivers capture move at (2, 3)
  const captureRes = game.playMove(2, 3, BLACK);
  assert.equal(captureRes.valid, true);
  assert.equal(game.board[2][2], EMPTY); // White stone removed!
  assert.equal(game.captures[BLACK], 1);
  assert.deepEqual(captureRes.capturedStones, [{ r: 2, c: 2 }]);
});

test('GoGame - Capturing a multi-stone group', () => {
  const game = new GoGame(9);

  // White places stones at (0, 0) and (0, 1) in the corner
  // Let's set up the board directly for testing multi-capture
  game.board[0][0] = WHITE;
  game.board[0][1] = WHITE;
  game.board[1][0] = BLACK;
  game.board[1][1] = BLACK;
  game.currentTurn = BLACK;

  // White stones at (0,0) and (0,1) currently share liberty at (0, 2)
  const whiteGroup = game.getGroupAndLiberties(game.board, 0, 0);
  assert.equal(whiteGroup.stones.length, 2);
  assert.equal(whiteGroup.liberties.size, 1);
  assert.ok(whiteGroup.liberties.has('0,2'));

  // Black plays (0, 2) to capture both White stones
  const res = game.playMove(0, 2, BLACK);
  assert.equal(res.valid, true);
  assert.equal(res.capturedStones.length, 2);
  assert.equal(game.board[0][0], EMPTY);
  assert.equal(game.board[0][1], EMPTY);
  assert.equal(game.captures[BLACK], 2);
});

test('GoGame - Suicide Rule: Cannot play stone with 0 liberties without capturing', () => {
  const game = new GoGame(9);

  // Surround point (1, 1) with White stones
  game.board[0][1] = WHITE;
  game.board[2][1] = WHITE;
  game.board[1][0] = WHITE;
  game.board[1][2] = WHITE;
  game.currentTurn = BLACK;

  // Black trying to play in the enclosed empty eye (1, 1) is suicide!
  const res = game.playMove(1, 1, BLACK);
  assert.equal(res.valid, false);
  assert.match(res.error, /suicide/i);
  assert.equal(game.board[1][1], EMPTY); // Board remains untouched
});

test('GoGame - Suicide Rule Exception: Allowed if move captures opponent stones', () => {
  const game = new GoGame(9);

  // Setup: Black stones surrounding White stone at (0, 0)
  // White at (0, 0) has liberty only at (0, 1) and (1, 0)
  // Black has (1, 0).
  game.board[0][0] = WHITE;
  game.board[1][0] = BLACK;
  game.board[0][2] = BLACK;
  game.board[1][1] = BLACK;
  // Point (0, 1) is adjacent to White at (0, 0), Black at (0, 2), Black at (1, 1).
  // If Black plays (0, 1), it captures White at (0, 0)!
  // Even though (0, 1) has no liberties of its own beforehand, because it captures (0, 0), it is LEGAL!
  game.currentTurn = BLACK;

  const res = game.playMove(0, 1, BLACK);
  assert.equal(res.valid, true);
  assert.equal(game.board[0][0], EMPTY); // White stone captured
  assert.equal(game.board[0][1], BLACK); // Black stone placed
  assert.equal(game.captures[BLACK], 1);
});

test('GoGame - Ko Rule: Prevents immediate recapture repeating board', () => {
  const game = new GoGame(9);

  // Classic Ko setup:
  // Black stones at (1, 0), (0, 1), (1, 2)
  // White stones at (2, 1), (1, 2) - wait, let's set exact classic Ko shape:
  //   . B W .
  //   B . B W
  //   . B W .
  // Points:
  // Black at: (1, 0), (0, 1), (2, 1)
  // White at: (0, 2), (2, 2), (1, 3)
  // And White has a stone at (1, 1)
  game.board[1][0] = BLACK;
  game.board[0][1] = BLACK;
  game.board[2][1] = BLACK;

  game.board[0][2] = WHITE;
  game.board[2][2] = WHITE;
  game.board[1][3] = WHITE;

  // White stone at (1, 1)
  game.board[1][1] = WHITE;

  // Let initial state be tracked
  game.boardHistory = [game.serializeBoard(game.board)];
  game.currentTurn = BLACK;

  // Black plays at (1, 2), capturing White at (1, 1)
  const blackMove = game.playMove(1, 2, BLACK);
  assert.equal(blackMove.valid, true);
  assert.equal(game.board[1][1], EMPTY); // White at (1, 1) captured!
  assert.equal(game.board[1][2], BLACK); // Black at (1, 2) placed

  // Now it is White's turn.
  // White immediately attempts to recapture at (1, 1) which would recreate the exact prior board position!
  const whiteMove = game.playMove(1, 1, WHITE);
  assert.equal(whiteMove.valid, false);
  assert.match(whiteMove.error, /ko/i);
  assert.equal(game.board[1][1], EMPTY); // Stone was NOT placed
});

test('GoGame - Game ending via two consecutive passes', () => {
  const game = new GoGame(9);
  assert.equal(game.status, GAME_STATUS.PLAYING);

  // Black passes
  const pass1 = game.pass(BLACK);
  assert.equal(pass1.valid, true);
  assert.equal(pass1.gameEnded, false);
  assert.equal(game.consecutivePasses, 1);
  assert.equal(game.currentTurn, WHITE);

  // White passes
  const pass2 = game.pass(WHITE);
  assert.equal(pass2.valid, true);
  assert.equal(pass2.gameEnded, true);
  assert.equal(game.consecutivePasses, 2);
  assert.equal(game.status, GAME_STATUS.SCORING);
  assert.notEqual(game.scoreResult, null);
});

test('GoGame - Resignation', () => {
  const game = new GoGame(9);
  const res = game.resign(BLACK);
  assert.equal(res.valid, true);
  assert.equal(game.status, GAME_STATUS.ENDED);
  assert.equal(game.winner, WHITE);
  assert.match(game.winReason, /black resigned/i);
});

test('GoGame - Chinese Area Scoring calculation', () => {
  // 9x9 board with 81 points
  const game = new GoGame(9, 7.5);

  // Let's divide the board vertically:
  // Black creates a wall on col 3: (0,3) to (8,3)
  // White creates a wall on col 5: (0,5) to (8,5)
  // Col 4 is dame (neutral).
  // Columns 0, 1, 2 are Black territory: 9 rows * 3 cols = 27 points.
  // Black stones: 9 stones on col 3.
  // Total Black Area = 9 + 27 = 36.
  //
  // Columns 6, 7, 8 are White territory: 9 rows * 3 cols = 27 points.
  // White stones: 9 stones on col 5.
  // Total White Area = 9 + 27 + 7.5 (komi) = 43.5.
  //
  // Col 4: 9 neutral dame points.
  // 36 + 43.5 - 7.5 + 9 = 81 points total board coverage!

  for (let r = 0; r < 9; r++) {
    game.board[r][3] = BLACK;
    game.board[r][5] = WHITE;
  }

  const score = game.calculateScore();
  assert.equal(score.black.stones, 9);
  assert.equal(score.black.territory, 27);
  assert.equal(score.black.total, 36);

  assert.equal(score.white.stones, 9);
  assert.equal(score.white.territory, 27);
  assert.equal(score.white.komi, 7.5);
  assert.equal(score.white.total, 43.5);

  assert.equal(score.dame, 9);
  assert.equal(score.winner, WHITE);
  assert.equal(score.diff, -7.5); // White ahead by 7.5
});

test('GoGame - Dead stone marking in scoring', () => {
  const game = new GoGame(9, 7.5);
  game.status = GAME_STATUS.SCORING;

  // Black has 1 stone at (2, 2)
  game.board[2][2] = BLACK;
  game.calculateScore();
  assert.equal(game.scoreResult.black.stones, 1);

  // Toggle (2, 2) dead
  const toggleRes = game.toggleDeadStone(2, 2);
  assert.equal(toggleRes.valid, true);
  assert.ok(toggleRes.deadStones.includes('2,2'));
  assert.equal(game.scoreResult.black.stones, 0);

  // Untoggle (2, 2)
  game.toggleDeadStone(2, 2);
  assert.equal(game.scoreResult.black.stones, 1);
});

test('GoGame - Resume play from scoring phase', () => {
  const game = new GoGame(9);
  game.pass(BLACK);
  game.pass(WHITE);
  assert.equal(game.status, GAME_STATUS.SCORING);

  const res = game.resumePlay();
  assert.equal(res.valid, true);
  assert.equal(game.status, GAME_STATUS.PLAYING);
  assert.equal(game.consecutivePasses, 0);
});
