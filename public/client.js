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

function getCardImagePath(card) {
    if (card.value === 'z' || card.isZombie) {
        return '/assets/cards/JokerW.png';
    }

    // Convert suits to simple letters: ♥ -> H, ♦ -> D, ♣ -> C, ♠ -> S
    const suitMap = { '♥': 'H', '♦': 'D', '♣': 'C', '♠': 'S' };
    const suitLetter = suitMap[card.suit] || 'X';

    // Map values (A = 1, J = 11, Q = 12, K = 13) or keep numeric values
    let numericValue = card.value;
    if (card.value === 'A') numericValue = 1;
    if (card.value === 'J') numericValue = 11;
    if (card.value === 'Q') numericValue = 12;
    if (card.value === 'K') numericValue = 13;

    return `/assets/cards/${suitLetter}${numericValue}.png`;
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
    
    handArea.innerHTML = hand.map(card => {
        const imagePath = getCardImagePath(card);
        return `<div class="card" style="background-image: url('${imagePath}');"></div>`;
    }).join('');
});

// Sync the public layout showing opponent counts and active turns
let amIActiveTurn = false;

socket.on('game-state-update', ({ players, currentTurnId }) => {
    const turnIndicator = document.getElementById('turnIndicator');
    amIActiveTurn = (socket.id === currentTurnId);

    // 1. Clear all table slots and the overflow list
    document.getElementById('slot-top').innerHTML = '';
    document.getElementById('slot-left').innerHTML = '';
    document.getElementById('slot-right').innerHTML = '';
    document.getElementById('hiddenPlayersList').innerHTML = '';

    const N = players.length;
    const myIndex = players.findIndex(p => p.id === socket.id);
    
    // 2. Find our target neighbor dynamically (skipping empty hands)
    let targetIndex = (myIndex + 1) % N;
    while (players[targetIndex].id !== socket.id && players[targetIndex].cardCount === 0) {
        targetIndex = (targetIndex + 1) % N;
    }
    const nextNeighbor = players[targetIndex];

    // Update Turn Banner Text
    if (amIActiveTurn) {
        if (nextNeighbor.cardCount > 0) {
            turnIndicator.textContent = `🟢 Your Turn! Pick a card from ${nextNeighbor.name}`;
        } else {
            turnIndicator.textContent = "🟢 Your Turn! But no one else has cards left...";
        }
    } else {
        const currentActive = players.find(p => p.id === currentTurnId);
        turnIndicator.textContent = `⏳ ${currentActive ? currentActive.name : 'Someone'} is picking...`;
    }

    // 3. Map out exactly who sits where on the screen
    let leftId = null, topId = null, rightId = null;
    
    if (N === 2) {
        topId = players[(myIndex + 1) % N].id;
    } else if (N === 3) {
        leftId = players[(myIndex + 1) % N].id;
        rightId = players[(myIndex + 2) % N].id;
    } else if (N >= 4) {
        // Enforce your exact mapping for 4+ players
        leftId = players[(myIndex + 1) % N].id;           // 1st person after you
        topId = players[(myIndex + 2) % N].id;            // 2nd person after you
        rightId = players[(myIndex - 1 + N) % N].id;      // Last person before you
    }

    // 4. Render the UI for every opponent
    players.forEach(player => {
        if (player.id === socket.id) return; // Skip ourselves

        const isTheirTurn = player.id === currentTurnId;
        const isTargetNeighbor = player.id === nextNeighbor.id;

        // Generate the visual card blocks
        let cardsHTML = '';
        for (let c = 0; c < player.cardCount; c++) {
            if (amIActiveTurn && isTargetNeighbor) {
                cardsHTML += `<button class="opponent-card-btn active-target" onclick="sendDrawRequest('${player.id}', ${c})"></button>`;
            } else {
                cardsHTML += `<span class="opponent-card-btn" style="cursor: default;"></span>`;
            }
        }

        const tableSlotContent = `
            <div style="background: ${isTheirTurn ? 'rgba(56, 189, 248, 0.2)' : 'transparent'}; padding: 10px; border-radius: 8px;">
                <strong>${player.name}</strong> ${isTheirTurn ? '⚡' : ''} ${isTargetNeighbor && amIActiveTurn ? '👈' : ''}<br>
                <div class="side-hand-container" style="display:flex; gap: 4px; justify-content: center;">
                    ${cardsHTML || '<em>Safe!</em>'}
                </div>
            </div>
        `;

        // Route the HTML to the correct quadrant
        if (player.id === leftId) {
            document.getElementById('slot-left').innerHTML = tableSlotContent;
        } else if (player.id === topId) {
            document.getElementById('slot-top').innerHTML = tableSlotContent;
        } else if (player.id === rightId) {
            document.getElementById('slot-right').innerHTML = tableSlotContent;
        } else {
            // ROUTE TO HIDDEN OVERFLOW AREA
            const hiddenStatusColor = isTheirTurn ? '#38bdf8' : '#ffffff';
            const hiddenFontWeight = isTheirTurn ? 'bold' : 'normal';
            
            let hiddenHTML = `
                <div style="color: ${hiddenStatusColor}; font-weight: ${hiddenFontWeight}; margin-bottom: 8px; font-size: 16px;">
                    ${player.name} ${isTheirTurn ? '⚡' : ''} ${isTargetNeighbor && amIActiveTurn ? '👈 (Draw here!)' : ''}
                </div>
            `;

            // Fail-safe: Render miniature clickable cards ONLY if we are forced to draw from this hidden player
            if (amIActiveTurn && isTargetNeighbor && player.cardCount > 0) {
                 hiddenHTML += `<div style="display:flex; gap: 2px; justify-content: flex-end; margin-bottom: 12px; flex-wrap: wrap;">${cardsHTML}</div>`;
            }

            document.getElementById('hiddenPlayersList').innerHTML += hiddenHTML;
        }
    });
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