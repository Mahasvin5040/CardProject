const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');

const engine = require('./zombie.js');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

const PORT = process.env.PORT || 3000;

// Serve static frontend files from the "public" folder
app.use(express.static(path.join(__dirname, 'public')));

// Keep track of active game rooms in the server's memory
const rooms = {};

function generateRoomCode() {
  const characters = 'ABCDEFGHIJKLMNPQRSTUVWXYZ123456789';
  let result = '';
  for (let i = 0; i < 4; i++) {
    result += characters.charAt(Math.floor(Math.random() * characters.length));
  }
  return result;
}

function sendPrivateHands(roomCode) {
  const room = rooms[roomCode];
  if (!room) return;
  room.players.forEach(player => {
    const targetSocketId = player.socketId || player.id;
    io.to(targetSocketId).emit('your-hand', player.hand);
  });
}

// added code: helper to identify joker cards
function isJokerCard(card) {
  if (!card) return false;
  return Boolean(
    card.isJoker ||
    card.isZombie ||
    (typeof card.value === 'string' && card.value.startsWith('z')) ||
    (typeof card.suit === 'string' && card.suit.startsWith('Z')) ||
    card.value === 'z'
  );
}

// added code: evaluate game over condition and multiple losers
function getGameEndState(room) {
  if (!room) return { isGameOver: false, losers: [], loserDetails: [], loserName: null };

  const activePlayersWithCards = room.players.filter(p => p.hand.length > 0);
  const allCardsInPlay = room.players.flatMap(p => p.hand);
  const nonJokerCards = allCardsInPlay.filter(c => !isJokerCard(c));

  // Game ends if all normal pairs have been matched (only Jokers remain in play)
  // or if active players with cards is down to 1 or 0
  const isGameOver = (allCardsInPlay.length > 0 && nonJokerCards.length === 0) || (activePlayersWithCards.length <= 1);

  if (!isGameOver) {
    return { isGameOver: false, losers: [], loserDetails: [], loserName: null };
  }

  // Find all players holding jokers
  let losers = room.players.filter(p => p.hand.some(c => isJokerCard(c)));
  if (losers.length === 0) {
    losers = activePlayersWithCards;
  }

  const loserDetails = losers.map(p => ({
    id: p.id,
    name: p.name,
    jokerCount: p.hand.filter(c => isJokerCard(c)).length || p.hand.length
  }));

  let loserName = 'Unknown';
  if (loserDetails.length === 1) {
    loserName = loserDetails[0].name;
  } else if (loserDetails.length === 2) {
    loserName = `${loserDetails[0].name} and ${loserDetails[1].name}`;
  } else if (loserDetails.length > 2) {
    loserName = loserDetails.slice(0, -1).map(l => l.name).join(', ') + ', and ' + loserDetails[loserDetails.length - 1].name;
  }

  return {
    isGameOver: true,
    losers,
    loserDetails,
    loserName
  };
}

/**
 * Broadcasts the general public layout to everyone in the room 
 * (Who is playing, how many cards they hold, and whose turn it is).
 */
function broadcastGameState(roomCode) {
  const room = rooms[roomCode];
  if (!room) return;

  // Strip out full hand details for public update to prevent screen-peeking cheats
  const publicPlayers = room.players.map(p => ({
    id: p.id,
    name: p.name,
    cardCount: p.hand.length
  }));

  // added code: evaluate game over state and multiple losers
  const endState = getGameEndState(room);
  const isOver = room.gameState === 'game-over' || endState.isGameOver;

  const totalDeck = room.totalDeckCards || (52 + (room.jokerCount || 1));
  const cardsInPlay = room.players.reduce((sum, p) => sum + p.hand.length, 0);
  const pairsMade = Math.floor((totalDeck - cardsInPlay) / 2);

  io.to(roomCode).emit('game-state-update', {
    players: publicPlayers,
    currentTurnId: isOver ? null : (room.players[room.currentTurnIndex] ? room.players[room.currentTurnIndex].id : null),
    lastPair: room.lastPair || null,
    pairsMade: pairsMade,
    cardsRemaining: cardsInPlay,
    totalDeckCards: totalDeck,
    isGameOver: isOver,
    loserName: endState.loserName,
    loserDetails: endState.loserDetails,
    jokerCount: room.jokerCount || 1
  });
}

// ==========================================
// SOCKET.IO EVENT HANDLING
// ==========================================
io.on('connection', (socket) => {
  // ... (Keep your create-room and join-room event listeners) ...
  console.log(`👤 User connected: ${socket.id}`);

  // 1. EVENT: Create Room
  socket.on('create-room', ({ playerName, playerId }) => {
    const roomCode = generateRoomCode();
    const pid = playerId || socket.id;

    rooms[roomCode] = {
      players: [],
      gameState: 'lobby',
      hostId: pid,
      lastPair: null,
      jokerCount: 1, // added code: configurable joker count defaulting to 1
      totalDeckCards: 53
    };

    console.log(`✨ New room created: ${roomCode} by ${playerName} (${pid})`);

    socket.join(roomCode);
    // added code: initialize player with inLobby true
    rooms[roomCode].players.push({ id: pid, socketId: socket.id, name: playerName, hand: [], inLobby: true });

    socket.emit('room-created', { roomCode, playerId: pid });
    io.to(roomCode).emit('room-update', rooms[roomCode].players.map(p => ({ id: p.id, name: p.name, inLobby: p.inLobby })));
  });

  // 2. EVENT: Join Room
  socket.on('join-room', ({ roomCode, playerName, playerId }) => {
    if (!roomCode) return;
    roomCode = roomCode.toUpperCase().trim();
    const pid = playerId || socket.id;

    if (!rooms[roomCode]) {
      socket.emit('error-message', 'Room not found! Check your code.');
      return;
    }

    if (rooms[roomCode].gameState !== 'lobby') {
      socket.emit('error-message', 'Game has already started in this room!');
      return;
    }

    socket.join(roomCode);
    const existing = rooms[roomCode].players.find(p => p.id === pid);
    if (existing) {
      existing.socketId = socket.id;
      existing.name = playerName;
      existing.inLobby = true;
      if (existing.disconnectTimeout) {
        clearTimeout(existing.disconnectTimeout);
        existing.disconnectTimeout = null;
      }
    } else {
      // added code: initialize player with inLobby true
      rooms[roomCode].players.push({ id: pid, socketId: socket.id, name: playerName, hand: [], inLobby: true });
    }

    console.log(`🚪 ${playerName} joined room: ${roomCode} (${pid})`);

    socket.emit('join-success', { roomCode, playerId: pid });
    io.to(roomCode).emit('room-update', rooms[roomCode].players.map(p => ({ id: p.id, name: p.name, inLobby: p.inLobby })));
  });

  // EVENT: Sync Lobby (multi-page transition to lobby.html)
  socket.on('sync-lobby', ({ roomCode, playerId }) => {
    if (!roomCode) return;
    roomCode = roomCode.toUpperCase().trim();
    const room = rooms[roomCode];
    if (!room) {
      socket.emit('error-message', 'Room not found!');
      return;
    }

    const player = room.players.find(p => p.id === playerId);
    if (!player) {
      socket.emit('error-message', 'Player not found in room!');
      return;
    }

    if (player.disconnectTimeout) {
      clearTimeout(player.disconnectTimeout);
      player.disconnectTimeout = null;
    }
    player.socketId = socket.id;
    // added code: mark player in lobby and clear hand
    player.inLobby = true;
    player.hand = [];
    socket.join(roomCode);

    // added code: reset room state to lobby if returning after game-over
    if (room.gameState === 'game-over') {
      room.gameState = 'lobby';
    }

    const isHost = (room.hostId === playerId);
    socket.emit('lobby-synced', {
      roomCode,
      isHost,
      jokerCount: room.jokerCount || 1, // added code: sync configured joker count
      players: room.players.map(p => ({ id: p.id, name: p.name, inLobby: p.inLobby }))
    });
    io.to(roomCode).emit('room-update', room.players.map(p => ({ id: p.id, name: p.name, inLobby: p.inLobby })));
  });

  // added code: host configures the amount of jokers in the deck
  socket.on('set-joker-count', ({ roomCode, jokerCount, playerId }) => {
    if (!roomCode) return;
    roomCode = roomCode.toUpperCase().trim();
    const room = rooms[roomCode];
    if (!room || room.gameState !== 'lobby') return;

    const callerId = playerId || socket.id;
    if (callerId !== room.hostId && !room.players.find(p => p.id === room.hostId && p.socketId === socket.id)) {
      return;
    }

    const count = Math.min(5, Math.max(1, parseInt(jokerCount, 10) || 1));
    room.jokerCount = count;
    console.log(`🃏 Room ${roomCode} joker count set to ${count} by ${callerId}`);

    io.to(roomCode).emit('joker-count-update', { jokerCount: room.jokerCount });
  });

  // added code: handle player intentionally leaving the room
  socket.on('leave-room', ({ roomCode, playerId }) => {
    if (!roomCode) return;
    roomCode = roomCode.toUpperCase().trim();
    const room = rooms[roomCode];
    if (!room) return;

    const pid = playerId || socket.id;
    const pIndex = room.players.findIndex(p => p.id === pid || p.socketId === socket.id);
    if (pIndex !== -1) {
      const leavingPlayer = room.players[pIndex];
      if (leavingPlayer.disconnectTimeout) {
        clearTimeout(leavingPlayer.disconnectTimeout);
        leavingPlayer.disconnectTimeout = null;
      }
      room.players.splice(pIndex, 1);
      console.log(`👋 ${leavingPlayer.name} left room ${roomCode}`);

      if (room.players.length === 0) {
        delete rooms[roomCode];
        console.log(`🧹 Deleted empty room: ${roomCode}`);
      } else {
        if (room.hostId === pid) {
          room.hostId = room.players[0].id;
        }
        io.to(roomCode).emit('room-update', room.players.map(p => ({ id: p.id, name: p.name, inLobby: p.inLobby })));
      }
    }
  });

  // 3. EVENT: Start Game (Triggered by Host)
  socket.on('start-game', ({ roomCode, playerId }) => {
    const room = rooms[roomCode];

    // Safety checks
    if (!room) return;
    const callerId = playerId || socket.id;
    if (callerId !== room.hostId && !room.players.find(p => p.id === room.hostId && p.socketId === socket.id)) return;
    if (room.players.length < 2) {
      socket.emit('error-message', 'You need at least 2 players to start!');
      return;
    }

    // added code: ensure all players are connected and in lobby before starting
    if (room.players.some(p => !p.socketId || p.inLobby === false)) {
      socket.emit('error-message', 'Waiting for all players to be present in the lobby!');
      return;
    }

    room.gameState = 'playing';
    room.lastPair = null;

    // A. Create and shuffle our custom Joker deck using the engine with configured jokers
    const jokerCount = room.jokerCount || 1;
    let deck = engine.createZombieDeck(jokerCount);
    room.totalDeckCards = deck.length;
    engine.shuffle(deck);

    // B. Deal cards directly into our room's player objects
    engine.dealCards(deck, room.players);

    // C. Force all players to strip out initial value/color matching pairs
    room.players.forEach(player => {
      player.hand = engine.discardPairs(player.hand);
      // added code: player leaves lobby state once game begins
      player.inLobby = false;
    });

    // D. Pick a random player to start the game
    room.currentTurnIndex = Math.floor(Math.random() * room.players.length);
    let attempts = 0;
    while (room.players[room.currentTurnIndex].hand.length === 0 && attempts < room.players.length) {
      room.currentTurnIndex = (room.currentTurnIndex + 1) % room.players.length;
      attempts++;
    }

    // Tell everyone in the room that the game has officially started
    io.to(roomCode).emit('game-started');

    // E. Send out individual card states and sync the master layout
    sendPrivateHands(roomCode);
    broadcastGameState(roomCode);
  });

  // EVENT: Sync Game (multi-page transition to oldMaid.html)
  socket.on('sync-game', ({ roomCode, playerId }) => {
    if (!roomCode) return;
    roomCode = roomCode.toUpperCase().trim();
    const room = rooms[roomCode];
    if (!room) {
      socket.emit('error-message', 'Room not found!');
      return;
    }

    const player = room.players.find(p => p.id === playerId);
    if (!player) {
      socket.emit('error-message', 'Player not found in room!');
      return;
    }

    if (player.disconnectTimeout) {
      clearTimeout(player.disconnectTimeout);
      player.disconnectTimeout = null;
    }
    player.socketId = socket.id;
    // added code: player is actively in game
    player.inLobby = false;
    socket.join(roomCode);

    // Send private cards to this player and sync game state
    socket.emit('your-hand', player.hand);
    broadcastGameState(roomCode);
  });

  // 5. EVENT: Pull Card from Neighbor
  socket.on('draw-card', ({ roomCode, targetPlayerId, cardIndex, playerId }) => {
    const room = rooms[roomCode];
    if (!room || room.gameState !== 'playing') return;

    const currentTurnPlayer = room.players[room.currentTurnIndex];

    // Safety check: Validate it is actually this user's turn
    const callerId = playerId || socket.id;
    if (callerId !== currentTurnPlayer.id && socket.id !== currentTurnPlayer.socketId && socket.id !== currentTurnPlayer.id) return;

    const targetPlayer = room.players.find(p => p.id === targetPlayerId);
    if (!targetPlayer || targetPlayer.hand.length === 0) return;

    // Remove card from opponent's hand array
    const [stolenCard] = targetPlayer.hand.splice(cardIndex, 1);

    // added code: check if drawn card forms a matching pair by value and color (jokers never pair)
    const stolenColor = engine.getCardColor(stolenCard.suit);
    const matchIndex = currentTurnPlayer.hand.findIndex(c => {
      if (isJokerCard(c) || isJokerCard(stolenCard)) {
        return false;
      }
      return c.value === stolenCard.value && engine.getCardColor(c.suit) === stolenColor;
    });

    if (matchIndex !== -1) {
      // Pair formed! Drop matching card from hand and store pair for the center pile
      const matchingCard = currentTurnPlayer.hand.splice(matchIndex, 1)[0];
      room.lastPair = [matchingCard, stolenCard];
    } else {
      // No match formed, add stolen card to hand
      currentTurnPlayer.hand.push(stolenCard);
    }

    // ==========================================
    // SHUFFLE BOTH HANDS TO RANDOMIZE POSITIONS
    // ==========================================
    if (currentTurnPlayer.hand.length > 0) {
      engine.shuffle(currentTurnPlayer.hand);
    }
    if (targetPlayer.hand.length > 0) {
      engine.shuffle(targetPlayer.hand);
    }

    // Advance turn index to the next active player holding cards
    let attempts = 0;
    do {
      room.currentTurnIndex = (room.currentTurnIndex + 1) % room.players.length;
      attempts++;
    } while (room.players[room.currentTurnIndex].hand.length === 0 && attempts < room.players.length);

    // added code: pass formedPair in animation events
    const formedPairPayload = (matchIndex !== -1 ? room.lastPair : null);

    const drawerSocketId = currentTurnPlayer.socketId || currentTurnPlayer.id;
    const targetSocketId = targetPlayer.socketId || targetPlayer.id;

    // Emit animation triggers to all players
    io.to(drawerSocketId).emit('animate-draw-card', {
      drawerId: currentTurnPlayer.id,
      targetPlayerId,
      cardIndex,
      stolenCard,
      formedPair: formedPairPayload
    });

    io.to(targetSocketId).emit('animate-card-stolen', {
      drawerId: currentTurnPlayer.id,
      targetPlayerId,
      cardIndex,
      formedPair: formedPairPayload
    });

    room.players.forEach(p => {
      if (p.id !== currentTurnPlayer.id && p.id !== targetPlayer.id) {
        const specSocketId = p.socketId || p.id;
        io.to(specSocketId).emit('animate-spectator-draw', {
          drawerId: currentTurnPlayer.id,
          targetPlayerId,
          cardIndex,
          formedPair: formedPairPayload
        });
      }
    });

    // added code: evaluate game over condition before broadcasting state
    const endState = getGameEndState(room);

    if (endState.isGameOver) {
      room.gameState = 'game-over';

      // added code: reset inLobby flag so returning to lobby is accurately tracked
      room.players.forEach(p => {
        p.inLobby = false;
      });

      sendPrivateHands(roomCode);
      broadcastGameState(roomCode);

      setTimeout(() => {
        io.to(roomCode).emit('game-over', {
          loserName: endState.loserName,
          loserDetails: endState.loserDetails
        });
      }, 1500);
    } else {
      sendPrivateHands(roomCode);
      broadcastGameState(roomCode);
    }
  });

  // 4. EVENT: Disconnect
  socket.on('disconnect', () => {
    console.log(`❌ User disconnected: ${socket.id}`);

    // Grace period before removing player to allow smooth page transitions
    for (const roomCode in rooms) {
      const room = rooms[roomCode];
      const player = room.players.find(p => (p.socketId === socket.id || p.id === socket.id));
      if (player) {
        player.socketId = null;

        // added code: if disconnected in lobby, immediately mark as not ready and notify room
        if (room.gameState === 'lobby') {
          player.inLobby = false;
          io.to(roomCode).emit('room-update', room.players.map(p => ({ id: p.id, name: p.name, inLobby: p.inLobby })));
        }

        const gracePeriod = (room.gameState === 'lobby') ? 2500 : 10000;
        player.disconnectTimeout = setTimeout(() => {
          const pIndex = room.players.findIndex(p => p.id === player.id);
          if (pIndex !== -1 && !player.socketId) {
            // added code: remove player if disconnected during lobby or after game-over
            if (room.gameState === 'lobby' || room.gameState === 'game-over') {
              room.players.splice(pIndex, 1);
              if (room.players.length === 0) {
                delete rooms[roomCode];
                console.log(`🧹 Deleted empty room: ${roomCode}`);
              } else {
                if (room.hostId === player.id) {
                  room.hostId = room.players[0].id;
                }
                io.to(roomCode).emit('room-update', room.players.map(p => ({ id: p.id, name: p.name, inLobby: p.inLobby })));
              }
            }
          }
        }, gracePeriod);
      }
    }
  });
});

// Start the server
server.listen(PORT, () => {
  console.log(`🚀 Server is humming happily on http://localhost:${PORT}`);
});

// ==========================================
// NETWORK HELPERS (Add these to bottom of server.js)
// ==========================================

/**
 * Socket.io rooms broadcast to everyone. But players shouldn't see 
 * each other's cards! This helper loops through the room and loops 
 * private 'your-hand' events specifically to each individual socket.
 */
