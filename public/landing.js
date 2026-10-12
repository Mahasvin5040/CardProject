// Session and Landing Page Logic
const socket = io();

// Ensure unique playerId per browser tab session
function getPlayerId() {
    let pid = sessionStorage.getItem('om_playerId');
    if (!pid) {
        pid = 'p_' + Math.random().toString(36).substring(2, 11);
        sessionStorage.setItem('om_playerId', pid);
    }
    return pid;
}

function createRoom() {
    const name = document.getElementById('playerName').value.trim();
    if (!name) return alert("Please enter a name first!");

    const playerId = getPlayerId();
    sessionStorage.setItem('om_playerName', name);
    sessionStorage.setItem('om_isHost', 'true');

    socket.emit('create-room', { playerName: name, playerId });
}

function joinRoom() {
    const name = document.getElementById('playerName').value.trim();
    const code = document.getElementById('roomCodeInput').value.trim();
    if (!name || !code) return alert("Please fill in both your name and room code!");

    const playerId = getPlayerId();
    sessionStorage.setItem('om_playerName', name);
    sessionStorage.setItem('om_isHost', 'false');

    socket.emit('join-room', { playerName: name, roomCode: code, playerId });
}

socket.on('room-created', ({ roomCode, playerId }) => {
    sessionStorage.setItem('om_roomCode', roomCode);
    if (playerId) sessionStorage.setItem('om_playerId', playerId);
    window.location.href = '/lobby.html';
});

socket.on('join-success', ({ roomCode, playerId }) => {
    sessionStorage.setItem('om_roomCode', roomCode);
    if (playerId) sessionStorage.setItem('om_playerId', playerId);
    window.location.href = '/lobby.html';
});

socket.on('error-message', (msg) => {
    alert(msg);
});

// added code: restore player name and support enter key
window.addEventListener('DOMContentLoaded', () => {
    const savedName = sessionStorage.getItem('om_playerName');
    const nameInput = document.getElementById('playerName');
    if (savedName && nameInput) {
        nameInput.value = savedName;
    }

    const roomInput = document.getElementById('roomCodeInput');
    if (roomInput) {
        roomInput.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') joinRoom();
        });
    }
    if (nameInput) {
        nameInput.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') {
                if (roomInput && roomInput.value.trim().length > 0) {
                    joinRoom();
                } else {
                    createRoom();
                }
            }
        });
    }
});
