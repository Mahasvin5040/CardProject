const socket = io();
let currentRoomCode = null;

// UI View Switcher Helper
function showLobby(roomCode) {
    currentRoomCode = roomCode;
    document.getElementById('landingScreen').style.display = 'none';
    document.getElementById('lobbyScreen').style.display = 'block';
    document.getElementById('displayRoomCode').textContent = roomCode;
}

// Action: Create Room
function createRoom() {
    const name = document.getElementById('playerName').value.trim();
    if (!name) return alert("Please enter a name first!");
    
    socket.emit('create-room', { playerName: name });
    // The host should see the "Start Game" button
    document.getElementById('startGameBtn').style.display = 'inline-block';
}

// Action: Join Room
function joinRoom() {
    const name = document.getElementById('playerName').value.trim();
    const code = document.getElementById('roomCodeInput').value.trim();
    if (!name || !code) return alert("Please enter both your name and a room code!");

    socket.emit('join-room', { roomCode: code, playerName: name });
}

// --- SERVER EVENT LISTENERS ---

socket.on('room-created', ({ roomCode }) => {
    showLobby(roomCode);
});

socket.on('join-success', ({ roomCode }) => {
    showLobby(roomCode);
});

socket.on('error-message', (msg) => {
    alert(msg);
});

socket.on('room-update', (players) => {
    const list = document.getElementById('playerList');
    list.innerHTML = ''; // Clear previous elements
    
    players.forEach(p => {
        const li = document.createElement('li');
        li.textContent = p.name;
        list.appendChild(li);
    });
});

// Action: Triggered when host clicks "Start Game"
function triggerStartGame() {
    if (currentRoomCode) {
        socket.emit('start-game', { roomCode: currentRoomCode });
    }
}

// --- NEW GAME NETWORKING LISTENERS ---

socket.on('game-started', () => {
    // Hide lobby layout, display the table
    document.getElementById('lobbyScreen').style.display = 'none';
    document.getElementById('gameScreen').style.display = 'block';
});

// Receive your secret cards safely from the server referee
socket.on('your-hand', (hand) => {
    const handArea = document.getElementById('myHandArea');
    handArea.innerHTML = hand.map(c => {
        const color = (c.suit === '♥' || c.suit === '♦') ? 'red' : 'black';
        return `<div class="card" style="color: ${color};">${c.value}<br>${c.suit}</div>`;
    }).join('');
});

// Sync the public layout showing opponent counts and active turns
let amIActiveTurn = false;

socket.on('game-state-update', ({ players, currentTurnId }) => {
    const turnIndicator = document.getElementById('turnIndicator');
    amIActiveTurn = (socket.id === currentTurnId);

    // 1. Clear out all the old HTML contents in opponent slots
    document.getElementById('slot-top').innerHTML = '';
    document.getElementById('slot-left').innerHTML = '';
    document.getElementById('slot-right').innerHTML = '';

    // 2. Locate our position index in the circle
    const myIndex = players.findIndex(p => p.id === socket.id);
    
    // 3. Find our active draw target (the player to your right)
    let targetIndex = (myIndex + 1) % players.length;
    while (players[targetIndex].id !== socket.id && players[targetIndex].cardCount === 0) {
        targetIndex = (targetIndex + 1) % players.length;
    }
    const nextNeighbor = players[targetIndex];

    // Update Turn banner text
    if (amIActiveTurn) {
        turnIndicator.textContent = `Your Turn! Pick a card from ${nextNeighbor.name}`;
    } else {
        const currentActive = players.find(p => p.id === currentTurnId);
        turnIndicator.textContent = `${currentActive ? currentActive.name : 'Someone'} is picking...`;
    }

    // 4. Assign remaining players to Left, Top, Right slots sequentially relative to us
    const orderSlots = ['slot-right', 'slot-top', 'slot-left'];
    let slotAssignmentCounter = 0;

    for (let i = 1; i < players.length; i++) {
        const evalIndex = (myIndex + i) % players.length;
        const player = players[evalIndex];

        // Skip rendering ourselves in opponent areas
        if (player.id === socket.id) continue;

        const assignedSlotId = orderSlots[slotAssignmentCounter] || 'slot-top';
        slotAssignmentCounter++;

        const isTheirTurn = player.id === currentTurnId;
        const isTargetNeighbor = player.id === nextNeighbor.id;

        // Render card buttons or back covers
        let cardsHTML = '';
        for (let c = 0; c < player.cardCount; c++) {
            if (amIActiveTurn && isTargetNeighbor) {
                // Clickable target from screenshot
                cardsHTML += `<button class="opponent-card-btn active-target" onclick="sendDrawRequest('${player.id}', ${c})">🎴</button>`;
            } else {
                cardsHTML += `<span class="opponent-card-btn" style="cursor: default;">🎴</span>`;
            }
        }

        // Inject the player content block into the calculated CSS positioning slot
        document.getElementById(assignedSlotId).innerHTML = `
            <div style="background: ${isTheirTurn ? 'rgba(56, 189, 248, 0.2)' : 'transparent'}; padding: 10px; border-radius: 8px;">
                <strong>${player.name}</strong> ${isTheirTurn ? '⚡' : ''}<br>
                <div class="side-hand-container" style="display:flex; gap: 4px; justify-content: center;">
                    ${cardsHTML || '<em>Safe!</em>'}
                </div>
            </div>
        `;
    }
});

// Action: Emits the click event choice to the server referee
function sendDrawRequest(targetPlayerId, cardIndex) {
    if (!amIActiveTurn) return;
    socket.emit('draw-card', {
        roomCode: currentRoomCode,
        targetPlayerId,
        cardIndex
    });
}

// Listen for end-of-game trigger
socket.on('game-over', ({ loserName }) => {
    document.getElementById('turnIndicator').innerHTML = `🚨 <strong>GAME OVER!</strong> ${loserName} is left holding the Joker! 🤡`;
    document.getElementById('opponentsArea').innerHTML = '';
});