// Go Game Frontend Client

const EMPTY = 0;
const BLACK = 1;
const WHITE = 2;

// Initialize or restore playerId from sessionStorage
let playerId = sessionStorage.getItem('go_player_id');
if (!playerId) {
  playerId = 'user_' + Math.random().toString(36).substring(2, 10);
  sessionStorage.setItem('go_player_id', playerId);
}

// Get roomId from URL if present
const urlParams = new URLSearchParams(window.location.search);
const initialUrlRoom = urlParams.get('room');

// DOM Elements - Room Card
const roomInputContainer = document.getElementById('roomInputContainer');
const roomCodeInput = document.getElementById('roomCodeInput');
const roomPillDisplay = document.getElementById('roomPillDisplay');
const roomIdDisplay = document.getElementById('roomIdDisplay');
const roomInitialButtons = document.getElementById('roomInitialButtons');
const btnJoinRoom = document.getElementById('btnJoinRoom');
const btnCreateRoom = document.getElementById('btnCreateRoom');
const roomActiveButtons = document.getElementById('roomActiveButtons');
const copyLinkBtn = document.getElementById('copyLinkBtn');
const btnEndOrLeaveRoom = document.getElementById('btnEndOrLeaveRoom');

// DOM Elements - Game Setup Card
const boardSizeRow = document.getElementById('boardSizeRow');
const boardSizeSelect = document.getElementById('boardSizeSelect');
const toggleCoords = document.getElementById('toggleCoords');
const boardColorPicker = document.getElementById('boardColorPicker');
const btnRestartGame = document.getElementById('btnRestartGame');

// DOM Elements - Board & Status
const canvas = document.getElementById('goBoard');
const ctx = canvas.getContext('2d');
const turnBanner = document.getElementById('turnBanner');
const turnText = document.getElementById('turnText');
const playerRoleDisplay = document.getElementById('playerRoleDisplay');
const opponentStatus = document.getElementById('opponentStatus');
const blackCapturesEl = document.getElementById('blackCaptures');
const whiteCapturesEl = document.getElementById('whiteCaptures');
const btnPass = document.getElementById('btnPass');
const btnResign = document.getElementById('btnResign');
const btnStartGame = document.getElementById('btnStartGame');
const boardSection = document.querySelector('.board-section');
const ruleNotification = document.getElementById('ruleNotification');

// DOM Elements - Scoring
const scoringPanel = document.getElementById('scoringPanel');
const scoreBlackStonesEl = document.getElementById('scoreBlackStones');
const scoreBlackTerritoryEl = document.getElementById('scoreBlackTerritory');
const scoreBlackTotalEl = document.getElementById('scoreBlackTotal');
const scoreWhiteStonesEl = document.getElementById('scoreWhiteStones');
const scoreWhiteTerritoryEl = document.getElementById('scoreWhiteTerritory');
const scoreKomiEl = document.getElementById('scoreKomi');
const scoreWhiteTotalEl = document.getElementById('scoreWhiteTotal');
const scoreWinnerBanner = document.getElementById('scoreWinnerBanner');
const btnConfirmScore = document.getElementById('btnConfirmScore');
const btnResumePlay = document.getElementById('btnResumePlay');

// Game State cache
let isInRoom = false;
let isHost = false;
let currentRoomId = null;
let myRole = 'none'; // 'black', 'white', 'spectator', 'none'
let myColor = null;
let currentGameState = null;
let gameStarted = false;
let currentPlayers = { black: false, white: false };
let hoverCoord = null;
let notificationTimeout = null;
let showCoordinates = false; // Minimalist aesthetic as in photo
let boardColor = localStorage.getItem('go_board_color') || '#b8bfc7';

// Apply saved or default board color to CSS slab wrapper
document.documentElement.style.setProperty('--slab-bg', boardColor);

if (boardColorPicker) {
  boardColorPicker.value = boardColor;
  boardColorPicker.addEventListener('input', (e) => {
    boardColor = e.target.value;
    document.documentElement.style.setProperty('--slab-bg', boardColor);
    localStorage.setItem('go_board_color', boardColor);
    drawBoard();
  });
}

if (toggleCoords) {
  toggleCoords.checked = showCoordinates;
  toggleCoords.addEventListener('change', () => {
    showCoordinates = toggleCoords.checked;
    drawBoard();
  });
}

// Connect to socket.io
const socket = io();

// Setup room URL
function updateUrl(id) {
  if (id) {
    const newUrl = `${window.location.origin}${window.location.pathname}?room=${id}`;
    window.history.replaceState({ path: newUrl }, '', newUrl);
  } else {
    window.history.replaceState({}, '', window.location.pathname);
  }
}

// Show temporary rule alert
function showNotification(msg, isInfo = false) {
  ruleNotification.textContent = msg;
  ruleNotification.className = `notification ${isInfo ? 'info' : ''}`;
  ruleNotification.classList.remove('hidden');

  if (notificationTimeout) clearTimeout(notificationTimeout);
  notificationTimeout = setTimeout(() => {
    ruleNotification.classList.add('hidden');
  }, 4000);
}

// UI State Switcher: Reset to initial landing screen (disabled board, room input visible)
function resetToInitialScreen() {
  isInRoom = false;
  isHost = false;
  currentRoomId = null;
  myRole = 'none';
  myColor = null;
  currentGameState = null;
  gameStarted = false;
  currentPlayers = { black: false, white: false };
  hoverCoord = null;

  // Clear query parameter from URL
  updateUrl(null);

  // Disable board and other cards via CSS class
  document.body.classList.add('not-in-room');
  boardSection.classList.add('board-disabled');

  // Room Info Card view
  roomInputContainer.classList.remove('hidden');
  roomPillDisplay.classList.add('hidden');
  roomInitialButtons.classList.remove('hidden');
  roomActiveButtons.classList.add('hidden');
  roomCodeInput.value = '';

  // Game Setup Card view
  boardSizeRow.classList.remove('hidden');
  boardSizeSelect.disabled = false;
  btnRestartGame.classList.remove('hidden');
  btnRestartGame.disabled = false;

  // Actions
  btnPass.disabled = true;
  btnResign.disabled = true;
  btnStartGame.classList.add('hidden');
  btnStartGame.disabled = true;

  // Status & Captures reset
  turnBanner.className = 'turn-banner';
  turnText.textContent = 'No Active Game';
  playerRoleDisplay.textContent = 'None';
  playerRoleDisplay.style.color = '#7e8796';
  opponentStatus.textContent = 'Create or join a room to play';
  opponentStatus.style.display = 'block';
  blackCapturesEl.textContent = '0';
  whiteCapturesEl.textContent = '0';
  scoringPanel.classList.add('hidden');

  // Draw empty clean board
  drawBoard();
}

// UI State Switcher: Setup active room
function setupActiveRoomUI(host) {
  isInRoom = true;
  isHost = host;

  // Enable cards container
  document.body.classList.remove('not-in-room');
  updateUrl(currentRoomId);

  // Switch Room Info card to active room view
  roomInputContainer.classList.add('hidden');
  roomPillDisplay.classList.remove('hidden');
  roomIdDisplay.textContent = currentRoomId;
  roomInitialButtons.classList.add('hidden');
  roomActiveButtons.classList.remove('hidden');

  if (host) {
    // Host has "End Room" button and retains board size setting
    btnEndOrLeaveRoom.textContent = 'End Room';
    btnEndOrLeaveRoom.className = 'btn btn-danger btn-full';
    boardSizeRow.classList.remove('hidden');
    btnRestartGame.classList.remove('hidden');
  } else {
    // Guest has "Leave Room" button and board size option is removed
    btnEndOrLeaveRoom.textContent = 'Leave Room';
    btnEndOrLeaveRoom.className = 'btn btn-secondary btn-full';
    boardSizeRow.classList.add('hidden'); // Host only
    btnRestartGame.classList.add('hidden'); // Host only
  }

  updateLobbyAndGameUI();
}

// UI Logic: Coordinates board disabled state, start button, and setup card controls
function updateLobbyAndGameUI() {
  if (!isInRoom) return;

  if (!gameStarted) {
    // 1. Board is disabled for BOTH players immediately after room is created & while waiting
    boardSection.classList.add('board-disabled');

    // 2. Pass & Resign buttons are disabled before game begins
    btnPass.disabled = true;
    btnResign.disabled = true;

    // 3. Start button: ONLY visible to host under pass/resign
    if (isHost) {
      btnStartGame.classList.remove('hidden');
      // Disabled immediately after creation, enabled once opponent connects
      btnStartGame.disabled = !currentPlayers.white;
    } else {
      btnStartGame.classList.add('hidden');
      btnStartGame.disabled = true;
    }

    // 4. Board size selector & restart board button enabled for host before start
    if (isHost) {
      boardSizeSelect.disabled = false;
      btnRestartGame.disabled = false;
    } else {
      boardSizeSelect.disabled = true;
      btnRestartGame.disabled = true;
    }

    // 5. Turn banner & opponent status text
    turnBanner.className = 'turn-banner';
    if (!currentPlayers.white) {
      turnText.textContent = 'Waiting for Opponent';
      opponentStatus.textContent = 'Waiting for opponent to connect (share the room link)...';
      opponentStatus.style.display = 'block';
    } else {
      if (isHost) {
        turnText.textContent = 'Opponent Ready';
        opponentStatus.textContent = 'Opponent joined! Press "Start Game" to begin.';
      } else {
        turnText.textContent = 'Waiting for Host';
        opponentStatus.textContent = 'Connected! Waiting for host to start the game...';
      }
      opponentStatus.style.display = 'block';
    }
  } else {
    // Game HAS started
    // 1. Board is enabled for both players
    boardSection.classList.remove('board-disabled');

    // 2. Start button disappears
    btnStartGame.classList.add('hidden');
    btnStartGame.disabled = true;

    // 3. Board size selector & restart board button disabled so host cannot restart mid-game
    boardSizeSelect.disabled = true;
    if (currentGameState && (currentGameState.status === 'PLAYING' || currentGameState.status === 'SCORING')) {
      btnRestartGame.disabled = true;
    } else if (currentGameState && currentGameState.status === 'ENDED') {
      btnRestartGame.disabled = !isHost;
    }

    // 4. Pass & Resign buttons based on current turn
    if (currentGameState && currentGameState.status === 'PLAYING') {
      btnPass.disabled = (myColor !== currentGameState.currentTurn);
      btnResign.disabled = (myColor === null);
      opponentStatus.style.display = 'none';
    } else if (currentGameState && (currentGameState.status === 'SCORING' || currentGameState.status === 'ENDED')) {
      btnPass.disabled = true;
      btnResign.disabled = true;
    }
  }
}

// Button Events: Create Room
btnCreateRoom.addEventListener('click', () => {
  const size = parseInt(boardSizeSelect.value, 10) || 19;
  socket.emit('create_room', { playerId, size });
});

// Button Events: Join Room
btnJoinRoom.addEventListener('click', () => {
  const code = roomCodeInput.value.trim().toUpperCase();
  if (!code) {
    showNotification('Please enter a room code.');
    roomCodeInput.focus();
    return;
  }
  socket.emit('join_room', { roomId: code, playerId });
});

roomCodeInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') {
    btnJoinRoom.click();
  }
});

// Button Events: Copy Link
copyLinkBtn.addEventListener('click', async () => {
  if (!currentRoomId) return;
  const link = `${window.location.origin}${window.location.pathname}?room=${currentRoomId}`;
  try {
    await navigator.clipboard.writeText(link);
    copyLinkBtn.textContent = 'Copied!';
    setTimeout(() => {
      copyLinkBtn.textContent = 'Copy Room Link';
    }, 2000);
  } catch (err) {
    prompt('Copy this link to invite Player 2:', link);
  }
});

// Button Events: End or Leave Room
btnEndOrLeaveRoom.addEventListener('click', () => {
  if (!isInRoom || !currentRoomId) return;

  if (isHost) {
    if (confirm('Are you sure you want to end this room for all players?')) {
      socket.emit('end_room', { roomId: currentRoomId, playerId });
      resetToInitialScreen();
      showNotification('You ended the room.', true);
    }
  } else {
    if (confirm('Are you sure you want to leave this room?')) {
      socket.emit('leave_room', { roomId: currentRoomId, playerId });
      resetToInitialScreen();
      showNotification('You left the room.', true);
    }
  }
});

// In-Game Buttons
btnPass.addEventListener('click', () => {
  if (!isInRoom || !currentGameState || !gameStarted || currentGameState.status !== 'PLAYING') return;
  socket.emit('pass', { roomId: currentRoomId, playerId });
});

btnResign.addEventListener('click', () => {
  if (!isInRoom || !currentGameState || !gameStarted || (currentGameState.status !== 'PLAYING' && currentGameState.status !== 'SCORING')) return;
  if (confirm('Are you sure you want to resign the game?')) {
    socket.emit('resign', { roomId: currentRoomId, playerId });
  }
});

btnStartGame.addEventListener('click', () => {
  if (!isInRoom || !isHost || !currentPlayers.white) return;
  socket.emit('start_game', { roomId: currentRoomId, playerId });
});

boardSizeSelect.addEventListener('change', () => {
  if (isInRoom && isHost && !gameStarted) {
    const size = parseInt(boardSizeSelect.value, 10);
    socket.emit('restart_game', { roomId: currentRoomId, playerId, size });
  }
});

btnRestartGame.addEventListener('click', () => {
  if (!isInRoom || !isHost) return;
  const size = parseInt(boardSizeSelect.value, 10);
  socket.emit('restart_game', { roomId: currentRoomId, playerId, size });
});

btnConfirmScore.addEventListener('click', () => {
  if (!isInRoom) return;
  socket.emit('confirm_score', { roomId: currentRoomId, playerId });
});

btnResumePlay.addEventListener('click', () => {
  if (!isInRoom) return;
  socket.emit('resume_play', { roomId: currentRoomId, playerId });
});

// Socket Events
socket.on('room_joined', ({ roomId: joinedRoomId, role, isHost: hostStatus, gameStarted: started, state, players }) => {
  currentRoomId = joinedRoomId;
  myRole = role;
  myColor = role === 'black' ? BLACK : role === 'white' ? WHITE : null;
  gameStarted = !!started;
  currentPlayers = players || { black: true, white: false };

  setupActiveRoomUI(hostStatus);

  playerRoleDisplay.textContent = role.toUpperCase();
  if (role === 'black') {
    playerRoleDisplay.style.color = '#fff';
  } else if (role === 'white') {
    playerRoleDisplay.style.color = '#e0e0e0';
  } else {
    playerRoleDisplay.style.color = '#9aa2b1';
  }

  updatePlayerPresence(currentPlayers);
  updateGameState(state);
  updateLobbyAndGameUI();
});

socket.on('join_error', ({ error }) => {
  showNotification(error);
  resetToInitialScreen();
});

socket.on('room_ended', ({ message }) => {
  showNotification(message || 'The host has ended the room.', true);
  resetToInitialScreen();
});

socket.on('player_left', () => {
  showNotification('Opponent has left the room.', true);
});

socket.on('left_room_success', () => {
  resetToInitialScreen();
});

socket.on('players_updated', (players) => {
  if (!isInRoom) return;
  currentPlayers = { black: !!players.black, white: !!players.white };
  if (players.gameStarted !== undefined) {
    gameStarted = !!players.gameStarted;
  }
  updatePlayerPresence(currentPlayers);
  updateLobbyAndGameUI();
});

socket.on('game_started', ({ state, gameStarted: started }) => {
  if (!isInRoom) return;
  gameStarted = started !== undefined ? started : true;
  updateGameState(state);
  updateLobbyAndGameUI();
  showNotification('Game has started! Black moves first.', true);
});

socket.on('game_updated', ({ state, gameStarted: started, lastAction }) => {
  if (!isInRoom) return;
  if (started !== undefined) {
    gameStarted = !!started;
  }
  updateGameState(state);
  updateLobbyAndGameUI();

  if (lastAction) {
    if (lastAction.type === 'pass') {
      const actor = lastAction.color === BLACK ? 'Black' : 'White';
      if (lastAction.gameEnded) {
        showNotification(`${actor} passed. Both players passed: Entering Chinese Area Scoring!`, true);
      } else {
        showNotification(`${actor} passed their turn.`, true);
      }
    } else if (lastAction.type === 'resign') {
      const actor = lastAction.color === BLACK ? 'Black' : 'White';
      showNotification(`${actor} resigned. Game over!`, true);
    }
  }
});

socket.on('move_error', ({ error }) => {
  showNotification(error);
});

socket.on('error_message', (msg) => {
  showNotification(msg);
});

function updatePlayerPresence(players) {
  currentPlayers = { black: !!players.black, white: !!players.white };
  updateLobbyAndGameUI();
}

function updateGameState(state) {
  currentGameState = state;
  boardSizeSelect.value = state.size;

  // Update Turn Banner & Scoring only if game has started
  if (gameStarted) {
    if (state.status === 'PLAYING') {
      if (state.currentTurn === BLACK) {
        turnBanner.className = 'turn-banner black-turn';
        turnText.textContent = "Black's Turn" + (myColor === BLACK ? ' (You)' : '');
      } else {
        turnBanner.className = 'turn-banner white-turn';
        turnText.textContent = "White's Turn" + (myColor === WHITE ? ' (You)' : '');
      }
      scoringPanel.classList.add('hidden');
      btnPass.disabled = (myColor !== state.currentTurn);
      btnResign.disabled = (myColor === null);
    } else if (state.status === 'SCORING' || state.status === 'ENDED') {
      turnBanner.className = 'turn-banner';
      turnText.textContent = state.status === 'SCORING' ? 'Scoring Phase' : 'Game Ended';
      btnPass.disabled = true;
      btnResign.disabled = true;
      renderScoring(state);
    }
  }

  // Update Captures
  blackCapturesEl.textContent = state.captures[BLACK] || 0;
  whiteCapturesEl.textContent = state.captures[WHITE] || 0;

  drawBoard();
  updateLobbyAndGameUI();
}

//  drawBoard();
//}

function renderScoring(state) {
  scoringPanel.classList.remove('hidden');
  const score = state.scoreResult;
  if (!score) return;

  scoreBlackStonesEl.textContent = score.black.stones;
  scoreBlackTerritoryEl.textContent = score.black.territory;
  scoreBlackTotalEl.textContent = score.black.total;

  scoreWhiteStonesEl.textContent = score.white.stones;
  scoreWhiteTerritoryEl.textContent = score.white.territory;
  scoreKomiEl.textContent = score.white.komi;
  scoreWhiteTotalEl.textContent = score.white.total.toFixed(1);

  if (state.winner || score.winner) {
    const reason = state.winReason || score.winReason;
    scoreWinnerBanner.textContent = `Result: ${reason}`;
    scoreWinnerBanner.style.display = 'block';
  } else {
    scoreWinnerBanner.style.display = 'none';
  }

  if (state.status === 'ENDED') {
    btnConfirmScore.disabled = true;
    btnConfirmScore.textContent = 'Score Finalized';
    btnResumePlay.disabled = true;
  } else {
    btnConfirmScore.disabled = false;
    btnConfirmScore.textContent = 'Accept Final Score';
    btnResumePlay.disabled = false;
  }
}

// ---------------- Go Board Drawing Engine ---------------- //

const COLUMN_LABELS = ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'J', 'K', 'L', 'M', 'N', 'O', 'P', 'Q', 'R', 'S', 'T'];
const CELL_SIZE = 36; // Fixed cell size across all board sizes so tile dimensions remain identical

function getStarPoints(size) {
  if (size === 19) {
    return [
      { r: 3, c: 3 }, { r: 3, c: 9 }, { r: 3, c: 15 },
      { r: 9, c: 3 }, { r: 9, c: 9 }, { r: 9, c: 15 },
      { r: 15, c: 3 }, { r: 15, c: 9 }, { r: 15, c: 15 }
    ];
  } else if (size === 13) {
    return [
      { r: 3, c: 3 }, { r: 3, c: 9 },
      { r: 6, c: 6 },
      { r: 9, c: 3 }, { r: 9, c: 9 }
    ];
  } else if (size === 9) {
    return [
      { r: 2, c: 2 }, { r: 2, c: 6 },
      { r: 4, c: 4 },
      { r: 6, c: 2 }, { r: 6, c: 6 }
    ];
  }
  return [];
}

function getBoardMetrics() {
  const size = currentGameState ? currentGameState.size : parseInt(boardSizeSelect.value, 10) || 19;
  const padding = showCoordinates ? 36 : 26; // Compact margin matching image when coords are hidden
  const boardCanvasSize = (size - 1) * CELL_SIZE + padding * 2;
  const stoneRadius = CELL_SIZE * 0.475; // Stones fill grid with narrow tactile gap as in photo

  return { size, padding, cellSize: CELL_SIZE, stoneRadius, boardCanvasSize };
}

function boardToCanvas(r, c) {
  const { padding, cellSize } = getBoardMetrics();
  return {
    x: padding + c * cellSize,
    y: padding + r * cellSize
  };
}

function canvasToBoard(pixelX, pixelY) {
  const { size, padding, cellSize } = getBoardMetrics();
  const c = Math.round((pixelX - padding) / cellSize);
  const r = Math.round((pixelY - padding) / cellSize);

  if (r >= 0 && r < size && c >= 0 && c < size) {
    const center = boardToCanvas(r, c);
    const dist = Math.hypot(pixelX - center.x, pixelY - center.y);
    if (dist <= cellSize * 0.49) {
      return { r, c };
    }
  }
  return null;
}

function drawBoard() {
  const { size, padding, cellSize, stoneRadius, boardCanvasSize } = getBoardMetrics();

  // Adjust canvas size dynamically for smaller boards so tile size remains identical
  if (canvas.width !== boardCanvasSize || canvas.height !== boardCanvasSize) {
    canvas.width = boardCanvasSize;
    canvas.height = boardCanvasSize;
  }

  const width = canvas.width;
  const height = canvas.height;

  // Clear Canvas with chosen board color
  ctx.fillStyle = boardColor;
  ctx.fillRect(0, 0, width, height);

  // Outer border line
  ctx.strokeStyle = '#22252a';
  ctx.lineWidth = 1.6;
  ctx.strokeRect(padding, padding, (size - 1) * cellSize, (size - 1) * cellSize);

  // Draw Inner Grid Lines
  ctx.strokeStyle = '#22252a';
  ctx.lineWidth = 1.15;

  for (let i = 1; i < size - 1; i++) {
    // Horizontal lines
    const y = padding + i * cellSize;
    ctx.beginPath();
    ctx.moveTo(padding, y);
    ctx.lineTo(padding + (size - 1) * cellSize, y);
    ctx.stroke();

    // Vertical lines
    const x = padding + i * cellSize;
    ctx.beginPath();
    ctx.moveTo(x, padding);
    ctx.lineTo(x, padding + (size - 1) * cellSize);
    ctx.stroke();
  }

  // Draw Star Points (Hoshi)
  const starPoints = getStarPoints(size);
  ctx.fillStyle = '#22252a';
  for (const pt of starPoints) {
    const pos = boardToCanvas(pt.r, pt.c);
    ctx.beginPath();
    ctx.arc(pos.x, pos.y, Math.max(3.2, cellSize * 0.085), 0, Math.PI * 2);
    ctx.fill();
  }

  // Draw Coordinate Labels only if enabled
  if (showCoordinates) {
    ctx.fillStyle = '#586171';
    ctx.font = `600 ${Math.max(10, cellSize * 0.28)}px -apple-system, sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';

    for (let c = 0; c < size; c++) {
      const label = COLUMN_LABELS[c] || (c + 1);
      const x = padding + c * cellSize;
      ctx.fillText(label, x, padding - 18);
      ctx.fillText(label, x, height - padding + 18);
    }

    for (let r = 0; r < size; r++) {
      const label = size - r;
      const y = padding + r * cellSize;
      ctx.fillText(label, padding - 18, y);
      ctx.fillText(label, width - padding + 18, y);
    }
  }

  // If not in game, stop here (drawn clean empty board)
  if (!currentGameState) {
    return;
  }

  // Draw Territory Markers (During Scoring or Game Over)
  if (currentGameState.scoreResult && currentGameState.scoreResult.territoryMap) {
    const territory = currentGameState.scoreResult.territoryMap;
    for (let r = 0; r < size; r++) {
      for (let c = 0; c < size; c++) {
        const t = territory[r][c];
        if (t === BLACK) {
          // Black Territory: sleek dark square
          const pos = boardToCanvas(r, c);
          const sqSize = cellSize * 0.28;
          ctx.fillStyle = '#17181c';
          ctx.fillRect(pos.x - sqSize / 2, pos.y - sqSize / 2, sqSize, sqSize);
        } else if (t === WHITE) {
          // White Territory: sleek white square with subtle border
          const pos = boardToCanvas(r, c);
          const sqSize = cellSize * 0.28;
          ctx.fillStyle = '#ffffff';
          ctx.strokeStyle = 'rgba(0, 0, 0, 0.2)';
          ctx.lineWidth = 1;
          ctx.fillRect(pos.x - sqSize / 2, pos.y - sqSize / 2, sqSize, sqSize);
          ctx.strokeRect(pos.x - sqSize / 2, pos.y - sqSize / 2, sqSize, sqSize);
        } else if (t === 3) {
          // Dame (Neutral): tiny neutral dot
          const pos = boardToCanvas(r, c);
          ctx.fillStyle = '#6b7280';
          ctx.beginPath();
          ctx.arc(pos.x, pos.y, cellSize * 0.08, 0, Math.PI * 2);
          ctx.fill();
        }
      }
    }
  }

  // Draw Stones
  const deadSet = new Set(currentGameState.deadStones || []);

  for (let r = 0; r < size; r++) {
    for (let c = 0; c < size; c++) {
      const stone = currentGameState.board[r][c];
      if (stone !== EMPTY) {
        const isDead = deadSet.has(`${r},${c}`);
        drawStone(r, c, stone, stoneRadius, isDead);
      }
    }
  }

  // Highlight Last Move
  if (currentGameState.lastMove && currentGameState.lastMove.r !== undefined) {
    const { r, c, color } = currentGameState.lastMove;
    const pos = boardToCanvas(r, c);
    ctx.save();
    ctx.fillStyle = color === BLACK ? '#ffffff' : '#17181c';
    ctx.beginPath();
    ctx.arc(pos.x, pos.y, stoneRadius * 0.22, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }

  // Draw Hover Ghost Stone
  if (
    isInRoom &&
    gameStarted &&
    hoverCoord &&
    currentGameState.status === 'PLAYING' &&
    currentGameState.board[hoverCoord.r][hoverCoord.c] === EMPTY &&
    currentGameState.currentTurn === myColor
  ) {
    drawGhostStone(hoverCoord.r, hoverCoord.c, myColor, stoneRadius);
  }
}

function drawStone(r, c, color, radius, isDead = false) {
  const pos = boardToCanvas(r, c);
  ctx.save();

  if (isDead) {
    ctx.globalAlpha = 0.4;
  }

  // Light shadow gradient ~7px diagonally to the bottom-left
  ctx.shadowColor = color === BLACK ? 'rgba(0, 0, 0, 0.24)' : 'rgba(0, 0, 0, 0.18)';
  ctx.shadowBlur = 7;
  ctx.shadowOffsetX = -5; // negative = left (~7px diagonal with offset-y: 5)
  ctx.shadowOffsetY = 5;  // positive = bottom

  // Singular solid color circle, no outline or glare
  ctx.fillStyle = color === BLACK ? '#17181c' : '#ffffff';
  ctx.beginPath();
  ctx.arc(pos.x, pos.y, radius, 0, Math.PI * 2);
  ctx.fill();

  ctx.restore();

  // If marked dead during scoring, draw a clean subtle red cross
  if (isDead) {
    ctx.save();
    ctx.strokeStyle = '#c53929';
    ctx.lineWidth = 2.5;
    const offset = radius * 0.5;
    ctx.beginPath();
    ctx.moveTo(pos.x - offset, pos.y - offset);
    ctx.lineTo(pos.x + offset, pos.y + offset);
    ctx.moveTo(pos.x + offset, pos.y - offset);
    ctx.lineTo(pos.x - offset, pos.y + offset);
    ctx.stroke();
    ctx.restore();
  }
}

function drawGhostStone(r, c, color, radius) {
  const pos = boardToCanvas(r, c);
  ctx.save();
  ctx.globalAlpha = 0.35;

  // Singular solid color circle, no outline
  ctx.fillStyle = color === BLACK ? '#17181c' : '#ffffff';
  ctx.beginPath();
  ctx.arc(pos.x, pos.y, radius, 0, Math.PI * 2);
  ctx.fill();

  ctx.restore();
}

// ---------------- Canvas Event Handlers ---------------- //

canvas.addEventListener('mousemove', (e) => {
  if (!isInRoom || !currentGameState || !gameStarted) {
    if (hoverCoord !== null) {
      hoverCoord = null;
      drawBoard();
    }
    return;
  }

  const rect = canvas.getBoundingClientRect();
  const scaleX = canvas.width / rect.width;
  const scaleY = canvas.height / rect.height;
  const mouseX = (e.clientX - rect.left) * scaleX;
  const mouseY = (e.clientY - rect.top) * scaleY;

  const coord = canvasToBoard(mouseX, mouseY);
  if (!coord) {
    if (hoverCoord !== null) {
      hoverCoord = null;
      drawBoard();
    }
    return;
  }

  if (!hoverCoord || hoverCoord.r !== coord.r || hoverCoord.c !== coord.c) {
    hoverCoord = coord;
    drawBoard();
  }
});

canvas.addEventListener('mouseleave', () => {
  hoverCoord = null;
  drawBoard();
});

canvas.addEventListener('click', (e) => {
  if (!isInRoom || !currentGameState || !gameStarted) return;

  const rect = canvas.getBoundingClientRect();
  const scaleX = canvas.width / rect.width;
  const scaleY = canvas.height / rect.height;
  const clickX = (e.clientX - rect.left) * scaleX;
  const clickY = (e.clientY - rect.top) * scaleY;

  const coord = canvasToBoard(clickX, clickY);
  if (!coord) return;

  if (currentGameState.status === 'PLAYING') {
    if (myColor !== currentGameState.currentTurn) {
      showNotification("It's not your turn!");
      return;
    }
    socket.emit('make_move', {
      roomId: currentRoomId,
      playerId,
      r: coord.r,
      c: coord.c
    });
  } else if (currentGameState.status === 'SCORING') {
    // During scoring, clicking a stone toggles dead/alive
    if (currentGameState.board[coord.r][coord.c] !== EMPTY) {
      socket.emit('toggle_dead_stone', {
        roomId: currentRoomId,
        playerId,
        r: coord.r,
        c: coord.c
      });
    }
  }
});

// Initial boot check:
if (initialUrlRoom) {
  roomCodeInput.value = initialUrlRoom.trim().toUpperCase();
  // Automatically attempt to join shared room URL
  socket.emit('join_room', {
    roomId: initialUrlRoom.trim().toUpperCase(),
    playerId
  });
} else {
  resetToInitialScreen();
}
