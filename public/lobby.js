// Lobby Page Logic
const socket = io();

const roomCode = sessionStorage.getItem('om_roomCode');
const playerId = sessionStorage.getItem('om_playerId');
const isHost = sessionStorage.getItem('om_isHost') === 'true';

if (!roomCode || !playerId) {
    // If user arrived without an active room session, send to landing
    window.location.href = '/index.html';
} else {
    document.getElementById('displayRoomCode').textContent = roomCode;

    // Connect to room in lobby
    socket.emit('sync-lobby', { roomCode, playerId });

    socket.on('lobby-synced', (data) => {
        document.getElementById('displayRoomCode').textContent = data.roomCode;
        if (data.isHost) {
            document.getElementById('startGameBtn').style.display = 'inline-block';
        } else {
            document.getElementById('startGameBtn').style.display = 'none';
        }
        renderPlayerList(data.players);
    });

    socket.on('room-update', (players) => {
        renderPlayerList(players);
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

// added code: leave party action
function leaveParty() {
    socket.emit('leave-room', { roomCode, playerId });
    sessionStorage.removeItem('om_roomCode');
    sessionStorage.removeItem('om_isHost');
    window.location.href = '/index.html';
}
