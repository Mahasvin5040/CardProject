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
/*
socket.on('your-hand', (hand) => {
    const handArea = document.getElementById('myHandArea');
    const numCards = hand.length;
    
    // Clear area if you have no cards
    if (numCards === 0) {
        handArea.innerHTML = '<div style="color: #a1a1aa; text-align: center; width: 100%;"><em>Safe!</em></div>';
        return;
    }

    handArea.innerHTML = hand.map((card, index) => {
        const imagePath = getCardImagePath(card);
        let leftPos;

        if (numCards === 1) {
            // If only 1 card, lock it directly in the center 
            // (50% minus half the 90px card width)
            leftPos = `calc(50% - 45px)`; 
        } else {
            // Distribute cards smoothly from 0% to 100% of the container
            const fraction = index / (numCards - 1);
            
            // Formula: Push right by %, but pull left by the card's width % to keep it inside the box
            leftPos = `calc(${fraction * 100}% - ${fraction * 90}px)`;
        }

        // Apply the calculated position and a natural z-index
        return `<div class="my-card" style="
            background-image: url('${imagePath}'); 
            left: ${leftPos}; 
            z-index: ${index};">
        </div>`;
    }).join('');
});
*/
// ==========================================
// ANIMATION & RENDERING STATE
// ==========================================
let isAnimating = false;
let pendingHand = null;
let pendingGameState = null;
let amIActiveTurn = false;

// Trigger ripple/riffle shuffle animation on player cards
function triggerHandShuffle(container = document.getElementById('myHandArea')) {
    /* Wave animation commented out to test pure sliding motion
    if (!container) return;
    const cards = container.querySelectorAll('.my-card-visual');
    cards.forEach((card, index) => {
        card.classList.remove('riffle-even', 'riffle-odd');
        void card.offsetWidth; // Force CSS reflow to retrigger animation
        card.style.animationDelay = `${index * 45}ms`;
        if (index % 2 === 0) {
            card.classList.add('riffle-even');
        } else {
            card.classList.add('riffle-odd');
        }
    });
    */
}

// Trigger subtle ripple on opponent hand slots
function triggerOpponentShuffle(slotId) {
    const slot = document.getElementById(slotId);
    if (!slot) return;
    const cards = slot.querySelectorAll('.opponent-card-visual');
    cards.forEach((card, index) => {
        card.classList.remove('riffle-even', 'riffle-odd', 'riffle');
        void card.offsetWidth;
        card.style.animationDelay = `${index * 40}ms`;
        if (slotId === 'slot-top') {
            card.classList.add(index % 2 === 0 ? 'riffle-even' : 'riffle-odd');
        } else {
            card.classList.add('riffle');
        }
    });
}

// Unique key per card to track positions during shuffles
function getCardKey(card) {
    if (!card) return 'UNKNOWN';
    if (card.value === 'z' || card.isZombie) {
        return 'ZOMBIE';
    }
    return `${card.suit}_${card.value}`;
}

// Complete the active animation, clean up proxies, and flush pending network states
function completeAnimation() {
    isAnimating = false;
    document.querySelectorAll('.anim-card-proxy').forEach(p => p.remove());

    if (pendingHand !== null) {
        renderMyHand(pendingHand);
        pendingHand = null;
    }
    if (pendingGameState !== null) {
        renderGameState(pendingGameState);
        pendingGameState = null;
    }
}

// Render your private hand into the DOM with smooth FLIP sliding animation
function renderMyHand(hand) {
    const handArea = document.getElementById('myHandArea');
    if (!handArea) return;

    if (hand.length === 0) {
        handArea.innerHTML = '<div style="color: #a1a1aa; margin-top: 50px;"><em>You are safe!</em></div>';
        return;
    }

    // 1. FIRST: Capture existing card positions by card key
    const oldPositions = new Map();
    const oldWrappers = handArea.querySelectorAll('.my-card-wrapper');
    oldWrappers.forEach(el => {
        el.style.transform = '';
        el.style.transition = '';
        const key = el.dataset.cardKey;
        if (key) {
            oldPositions.set(key, el.getBoundingClientRect());
        }
    });

    // 2. LAST: Render the new card order
    handArea.innerHTML = hand.map((card, index) => {
        const imagePath = getCardImagePath(card);
        const cardKey = getCardKey(card);
        return `
            <div class="my-card-wrapper" data-card-key="${cardKey}" data-card-index="${index}">
                <div class="my-card-visual" style="background-image: url('${imagePath}');"></div>
            </div>
        `;
    }).join('');

    // 3. INVERT & PLAY: Animate cards visibly gliding from their old to new positions
    if (oldPositions.size > 0) {
        const newWrappers = handArea.querySelectorAll('.my-card-wrapper');
        let anyCardMoved = false;

        newWrappers.forEach((el, index) => {
            const key = el.dataset.cardKey;
            const oldRect = oldPositions.get(key);

            if (oldRect) {
                const newRect = el.getBoundingClientRect();
                const dx = oldRect.left - newRect.left;
                const dy = oldRect.top - newRect.top;

                if (Math.abs(dx) > 1 || Math.abs(dy) > 1) {
                    anyCardMoved = true;
                    // Invert: position back to old coordinates
                    el.style.transform = `translate(${dx}px, ${dy}px)`;
                    el.style.transition = 'none';
                    // Elevate cards sliding across so they layer nicely
                    el.style.zIndex = `${30 + index}`;
                }
            } else {
                // New card added to hand: slight pop-in
                el.style.transform = 'scale(0.85) translateY(-20px)';
                el.style.opacity = '0';
                el.style.transition = 'none';
                anyCardMoved = true;
            }
        });

        if (anyCardMoved) {
            // Force browser reflow to commit initial inverted transforms
            void handArea.offsetWidth;

            requestAnimationFrame(() => {
                newWrappers.forEach((el, index) => {
                    const stagger = index * 25; // Slight stagger makes shuffling feel organic
                    el.style.transition = `transform 0.65s cubic-bezier(0.2, 0.9, 0.3, 1) ${stagger}ms, opacity 0.35s ease ${stagger}ms`;
                    el.style.transform = '';
                    el.style.opacity = '1';
                });

                // Trigger subtle tilt wave to complement the sliding
                setTimeout(() => {
                    triggerHandShuffle();
                    // Clean up temporary inline styles once animation settles
                    setTimeout(() => {
                        newWrappers.forEach(el => {
                            el.style.transition = '';
                            el.style.zIndex = '';
                        });
                    }, 750);
                }, 80);
            });
            return;
        }
    }

    // Default trigger when dealt initially or no cards moved
    triggerHandShuffle();
}

// Render table slots and opponent hands
function renderGameState({ players, currentTurnId, lastPair }) {
    const turnIndicator = document.getElementById('turnIndicator');
    amIActiveTurn = (socket.id === currentTurnId);

    // 1. Clear all table slots and the overflow list
    document.getElementById('slot-top').innerHTML = '';
    document.getElementById('slot-left').innerHTML = '';
    document.getElementById('slot-right').innerHTML = '';
    document.getElementById('hiddenPlayersList').innerHTML = '';

    const N = players.length;
    const myIndex = players.findIndex(p => p.id === socket.id);
    if (myIndex === -1) return;

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

    // 3. Map out table slots
    let leftId = null, topId = null, rightId = null;
    if (N === 2) {
        topId = players[(myIndex + 1) % N].id;
    } else if (N === 3) {
        leftId = players[(myIndex + 1) % N].id;
        rightId = players[(myIndex + 2) % N].id;
    } else if (N >= 4) {
        leftId = players[(myIndex + 1) % N].id;
        topId = players[(myIndex + 2) % N].id;
        rightId = players[(myIndex - 1 + N) % N].id;
    }

    // 4. Render opponents
    players.forEach(player => {
        if (player.id === socket.id) return;

        const isTheirTurn = player.id === currentTurnId;
        const isTargetNeighbor = player.id === nextNeighbor.id;

        let cardsHTML = '';
        for (let c = 0; c < player.cardCount; c++) {
            if (amIActiveTurn && isTargetNeighbor) {
                cardsHTML += `
                    <div class="opponent-card-wrapper clickable" data-card-index="${c}" onclick="sendDrawRequest('${player.id}', ${c})">
                        <div class="opponent-card-visual active-target"></div>
                    </div>`;
            } else {
                cardsHTML += `
                    <div class="opponent-card-wrapper" data-card-index="${c}">
                        <div class="opponent-card-visual"></div>
                    </div>`;
            }
        }

        const tableSlotContent = `
            <div class="player-slot-content" data-player-id="${player.id}" style="background: ${isTheirTurn ? 'rgba(56, 189, 248, 0.2)' : 'transparent'};">
                <strong>${player.name}</strong> ${isTheirTurn ? '⚡' : ''} ${isTargetNeighbor && amIActiveTurn ? '👈' : ''}<br>
                <div class="side-hand-container">
                    ${cardsHTML || '<em>Safe!</em>'}
                </div>
            </div>
        `;

        if (player.id === leftId) {
            document.getElementById('slot-left').innerHTML = tableSlotContent;
        } else if (player.id === topId) {
            document.getElementById('slot-top').innerHTML = tableSlotContent;
        } else if (player.id === rightId) {
            document.getElementById('slot-right').innerHTML = tableSlotContent;
        } else {
            const hiddenStatusColor = isTheirTurn ? '#38bdf8' : '#ffffff';
            const hiddenFontWeight = isTheirTurn ? 'bold' : 'normal';

            let hiddenHTML = `
                <div class="hidden-player-entry" data-player-id="${player.id}" style="color: ${hiddenStatusColor}; font-weight: ${hiddenFontWeight}; margin-bottom: 8px; font-size: 16px;">
                    ${player.name} ${isTheirTurn ? '⚡' : ''} ${isTargetNeighbor && amIActiveTurn ? '👈 (Draw here!)' : ''}
                </div>
            `;
            if (amIActiveTurn && isTargetNeighbor && player.cardCount > 0) {
                 hiddenHTML += `<div class="side-hand-container hidden-hand-container">${cardsHTML}</div>`;
            }
            document.getElementById('hiddenPlayersList').innerHTML += hiddenHTML;
        }
    });

    // added code (lines 391 - 415): render center discard pile showing last made pair
    const discardPile = document.getElementById('discardPile');
    const actionText = document.getElementById('actionText');

    if (discardPile) {
        if (lastPair && Array.isArray(lastPair) && lastPair.length === 2) {
            const cardImg1 = getCardImagePath(lastPair[0]);
            const cardImg2 = getCardImagePath(lastPair[1]);

            discardPile.style.display = 'flex';
            discardPile.innerHTML = `
                <div class="center-pair-container">
                    <div class="center-pair-card card-first" style="background-image: url('${cardImg1}');"></div>
                    <div class="center-pair-card card-second" style="background-image: url('${cardImg2}');"></div>
                </div>
            `;
            if (actionText) {
                actionText.style.display = 'none';
            }
        } else {
            discardPile.style.display = 'none';
            discardPile.innerHTML = '';
            if (actionText) {
                actionText.style.display = 'block';
                actionText.textContent = 'Game Started';
            }
        }
    }
}

// ==========================================
// CARD ANIMATION ORCHESTRATION
// ==========================================

// 1. You draw a card from an opponent: card lifts, flies, flips over 180deg to face-up into your hand
function animateCardDraw(targetPlayerId, cardIndex, stolenCard) {
    isAnimating = true;

    // Find the clicked source card element
    const targetSlot = document.querySelector(`[data-player-id="${targetPlayerId}"]`);
    let sourceCard = null;
    if (targetSlot) {
        const wrappers = targetSlot.querySelectorAll('.opponent-card-wrapper');
        sourceCard = wrappers[cardIndex] || wrappers[0];
    }

    const startRect = sourceCard ? sourceCard.getBoundingClientRect() : {
        left: window.innerWidth / 2 - 30,
        top: 60,
        width: 60,
        height: 90
    };

    // Determine initial rotation from orientation
    let initialRotate = '0deg';
    if (sourceCard && sourceCard.closest('.position-left')) initialRotate = '90deg';
    if (sourceCard && sourceCard.closest('.position-right')) initialRotate = '-90deg';

    // Target position in your hand area
    const handArea = document.getElementById('myHandArea');
    const handRect = handArea.getBoundingClientRect();
    const targetLeft = Math.max(20, handRect.left + (handRect.width / 2) - 60);
    const targetTop = handRect.top;

    // Create 3D card proxy
    const proxy = document.createElement('div');
    proxy.className = 'anim-card-proxy';
    proxy.style.left = `${startRect.left}px`;
    proxy.style.top = `${startRect.top}px`;
    proxy.style.width = `${startRect.width}px`;
    proxy.style.height = `${startRect.height}px`;
    proxy.style.transform = `rotate(${initialRotate})`;

    const inner = document.createElement('div');
    inner.className = 'anim-card-inner';

    const back = document.createElement('div');
    back.className = 'anim-card-face anim-card-back';

    const front = document.createElement('div');
    front.className = 'anim-card-face anim-card-front';
    front.style.backgroundImage = `url('${getCardImagePath(stolenCard)}')`;

    inner.appendChild(back);
    inner.appendChild(front);
    proxy.appendChild(inner);
    document.body.appendChild(proxy);

    if (sourceCard) {
        sourceCard.style.opacity = '0';
    }

    // Trigger flight and 3D flip
    requestAnimationFrame(() => {
        proxy.style.left = `${targetLeft}px`;
        proxy.style.top = `${targetTop}px`;
        proxy.style.width = '120px';
        proxy.style.height = '174px';
        proxy.style.transform = 'rotate(0deg)';
        inner.classList.add('flipped');
    });

    setTimeout(() => {
        completeAnimation();
    }, 650);
}

// 2. An opponent draws from you: card lifts from your hand, flips face-down, flies to opponent slot
function animateCardStolen(drawerId, cardIndex) {
    isAnimating = true;

    const myWrappers = document.querySelectorAll('#myHandArea .my-card-wrapper');
    const sourceCard = myWrappers[cardIndex] || myWrappers[myWrappers.length - 1];

    const startRect = sourceCard ? sourceCard.getBoundingClientRect() : {
        left: window.innerWidth / 2 - 60,
        top: window.innerHeight - 190,
        width: 120,
        height: 174
    };

    // Find the opponent slot that drew the card
    const drawerSlot = document.querySelector(`[data-player-id="${drawerId}"]`);
    const targetRect = drawerSlot ? drawerSlot.getBoundingClientRect() : {
        left: window.innerWidth / 2 - 30,
        top: 60,
        width: 60,
        height: 90
    };

    let targetRotate = '0deg';
    if (drawerSlot && drawerSlot.closest('.position-left')) targetRotate = '90deg';
    if (drawerSlot && drawerSlot.closest('.position-right')) targetRotate = '-90deg';

    const proxy = document.createElement('div');
    proxy.className = 'anim-card-proxy';
    proxy.style.left = `${startRect.left}px`;
    proxy.style.top = `${startRect.top}px`;
    proxy.style.width = `${startRect.width}px`;
    proxy.style.height = `${startRect.height}px`;

    const inner = document.createElement('div');
    inner.className = 'anim-card-inner flipped'; // starts flipped face-up

    const back = document.createElement('div');
    back.className = 'anim-card-face anim-card-back';

    const front = document.createElement('div');
    front.className = 'anim-card-face anim-card-front';

    const visual = sourceCard ? sourceCard.querySelector('.my-card-visual') : null;
    if (visual && visual.style.backgroundImage) {
        front.style.backgroundImage = visual.style.backgroundImage;
    } else {
        front.style.backgroundImage = `url('/assets/cards/BackBlue.png')`;
    }

    inner.appendChild(back);
    inner.appendChild(front);
    proxy.appendChild(inner);
    document.body.appendChild(proxy);

    if (sourceCard) {
        sourceCard.style.opacity = '0';
    }

    requestAnimationFrame(() => {
        proxy.style.left = `${targetRect.left + (targetRect.width / 2) - 30}px`;
        proxy.style.top = `${targetRect.top + (targetRect.height / 2) - 45}px`;
        proxy.style.width = '60px';
        proxy.style.height = '90px';
        proxy.style.transform = `rotate(${targetRotate})`;
        inner.classList.remove('flipped'); // flips to face-down
    });

    setTimeout(() => {
        completeAnimation();
    }, 650);
}

// 3. Spectator draw animation: a face-down card glides from target player's slot to drawer's slot
function animateSpectatorDraw(drawerId, targetPlayerId, cardIndex) {
    isAnimating = true;

    const targetSlot = document.querySelector(`[data-player-id="${targetPlayerId}"]`);
    const drawerSlot = document.querySelector(`[data-player-id="${drawerId}"]`);

    if (!targetSlot || !drawerSlot) {
        completeAnimation();
        return;
    }

    const sourceCards = targetSlot.querySelectorAll('.opponent-card-wrapper');
    const sourceCard = sourceCards[cardIndex] || sourceCards[0] || targetSlot;
    const startRect = sourceCard.getBoundingClientRect();
    const endRect = drawerSlot.getBoundingClientRect();

    let targetRotate = '0deg';
    if (drawerSlot.closest('.position-left')) targetRotate = '90deg';
    if (drawerSlot.closest('.position-right')) targetRotate = '-90deg';

    const proxy = document.createElement('div');
    proxy.className = 'anim-card-proxy';
    proxy.style.left = `${startRect.left}px`;
    proxy.style.top = `${startRect.top}px`;
    proxy.style.width = `${startRect.width || 60}px`;
    proxy.style.height = `${startRect.height || 90}px`;

    const inner = document.createElement('div');
    inner.className = 'anim-card-inner';
    const back = document.createElement('div');
    back.className = 'anim-card-face anim-card-back';
    inner.appendChild(back);
    proxy.appendChild(inner);
    document.body.appendChild(proxy);

    if (sourceCard && sourceCard !== targetSlot) {
        sourceCard.style.opacity = '0';
    }

    requestAnimationFrame(() => {
        proxy.style.left = `${endRect.left + (endRect.width / 2) - 30}px`;
        proxy.style.top = `${endRect.top + (endRect.height / 2) - 45}px`;
        proxy.style.width = '60px';
        proxy.style.height = '90px';
        proxy.style.transform = `rotate(${targetRotate})`;
    });

    setTimeout(() => {
        completeAnimation();
    }, 650);
}

// ==========================================
// SOCKET NETWORKING LISTENERS
// ==========================================

socket.on('your-hand', (hand) => {
    if (isAnimating) {
        pendingHand = hand;
        return;
    }
    renderMyHand(hand);
});

socket.on('game-state-update', (state) => {
    if (isAnimating) {
        pendingGameState = state;
        return;
    }
    renderGameState(state);
});

// Card draw animation events from server
socket.on('animate-draw-card', ({ targetPlayerId, cardIndex, stolenCard }) => {
    animateCardDraw(targetPlayerId, cardIndex, stolenCard);
});

socket.on('animate-card-stolen', ({ drawerId, cardIndex }) => {
    animateCardStolen(drawerId, cardIndex);
});

socket.on('animate-spectator-draw', ({ drawerId, targetPlayerId, cardIndex }) => {
    animateSpectatorDraw(drawerId, targetPlayerId, cardIndex);
});

// Action: Emits the click event choice to the server referee
function sendDrawRequest(targetPlayerId, cardIndex) {
    if (!amIActiveTurn || isAnimating) return;
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