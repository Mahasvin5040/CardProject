// Lobby Page Logic
const socket = io();

const roomCode = sessionStorage.getItem('om_roomCode');
const playerId = sessionStorage.getItem('om_playerId');
const isHost = sessionStorage.getItem('om_isHost') === 'true';

let isHostUser = isHost;
let currentJokerCount = 1;

if (!roomCode || !playerId) {
    // If user arrived without an active room session, send to landing
    window.location.href = '/index.html';
} else {
    document.getElementById('displayRoomCode').textContent = roomCode;

    // Connect to room in lobby
    socket.emit('sync-lobby', { roomCode, playerId });

    socket.on('lobby-synced', (data) => {
        document.getElementById('displayRoomCode').textContent = data.roomCode;
        isHostUser = Boolean(data.isHost);
        if (isHostUser) {
            document.getElementById('startGameBtn').style.display = 'inline-block';
        } else {
            document.getElementById('startGameBtn').style.display = 'none';
        }
        updateJokerDisplay(data.jokerCount || 1, isHostUser);
        renderPlayerList(data.players);
    });

    socket.on('room-update', (data) => {
        const players = Array.isArray(data) ? data : (data && data.players ? data.players : []);
        if (data && typeof data === 'object' && !Array.isArray(data)) {
            if (data.hostId) {
                isHostUser = (data.hostId === playerId);
                const startBtn = document.getElementById('startGameBtn');
                if (startBtn) startBtn.style.display = isHostUser ? 'inline-block' : 'none';
            }
            if (typeof data.jokerCount === 'number') {
                updateJokerDisplay(data.jokerCount, isHostUser);
            }
        }
        renderPlayerList(players);
    });

    // added code: update joker count in real-time
    socket.on('joker-count-update', ({ jokerCount }) => {
        updateJokerDisplay(jokerCount, isHostUser);
    });

    let isNavigatingToGame = false;

    socket.on('game-started', () => {
        isNavigatingToGame = true;
        window.location.href = '/oldMaid.html';
    });

    // added code: alert error messages without disconnecting unless room is invalid
    socket.on('error-message', (msg) => {
        alert(msg);
        if (msg.includes('not found')) {
            window.location.href = '/index.html';
        }
    });

    // added code: notify server if tab/window is closed in lobby
    window.addEventListener('beforeunload', () => {
        if (!isNavigatingToGame && roomCode && playerId) {
            socket.emit('leave-room', { roomCode, playerId });
        }
    });
}

// added code: render player list with return status indicators
function renderPlayerList(players) {
    const list = document.getElementById('playerList');
    if (!list) return;
    list.innerHTML = '';
    players.forEach(p => {
        const li = document.createElement('li');
        const you = (p.id === playerId ? ' (You)' : '');
        const status = (p.inLobby !== false) ? '' : ' ⏳ (Returning...)';
        li.textContent = p.name + you + status;
        li.style.margin = '8px 0';
        li.style.fontSize = '18px';
        if (p.inLobby === false) {
            li.style.color = '#94a3b8';
        }
        list.appendChild(li);
    });
}

function triggerStartGame() {
    socket.emit('start-game', { roomCode, playerId });
}

// added code: update UI for joker count
function updateJokerDisplay(count, canEdit) {
    currentJokerCount = count;
    const display = document.getElementById('jokerCountDisplay');
    if (display) display.textContent = count;

    const decBtn = document.getElementById('jokerDecBtn');
    const incBtn = document.getElementById('jokerIncBtn');

    if (decBtn && incBtn) {
        if (!canEdit) {
            decBtn.style.display = 'none';
            incBtn.style.display = 'none';
        } else {
            decBtn.style.display = 'inline-flex';
            incBtn.style.display = 'inline-flex';
            decBtn.disabled = (count <= 1);
            incBtn.disabled = (count >= 5);
        }
    }
}

// added code: adjust joker count handler for host
function adjustJokerCount(delta) {
    if (!isHostUser) return;
    const newCount = Math.min(5, Math.max(1, currentJokerCount + delta));
    if (newCount !== currentJokerCount) {
        currentJokerCount = newCount;
        updateJokerDisplay(newCount, true);
        socket.emit('set-joker-count', { roomCode, jokerCount: newCount, playerId });
    }
}

// added code: leave party action
function leaveParty() {
    socket.emit('leave-room', { roomCode, playerId });
    sessionStorage.removeItem('om_roomCode');
    sessionStorage.removeItem('om_isHost');
    window.location.href = '/index.html';
}
