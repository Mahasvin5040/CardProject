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
  const characters = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
  let result = '';
  for (let i = 0; i < 4; i++) {
    result += characters.charAt(Math.floor(Math.random() * characters.length));
  }
  return result;
}

function sendPrivateHands(roomCode) {
  const room = rooms[roomCode];
  room.players.forEach(player => {
    io.to(player.id).emit('your-hand', player.hand);
  });
}

/**
 * Broadcasts the general public layout to everyone in the room 
 * (Who is playing, how many cards they hold, and whose turn it is).
 */
function broadcastGameState(roomCode) {
  const room = rooms[roomCode];
  
  // Strip out full hand details for public update to prevent screen-peeking cheats
  const publicPlayers = room.players.map(p => ({
    id: p.id,
    name: p.name,
    cardCount: p.hand.length
  }));

  io.to(roomCode).emit('game-state-update', {
    players: publicPlayers,
    currentTurnId: room.players[room.currentTurnIndex].id
  });
}

// ==========================================
// SOCKET.IO EVENT HANDLING
// ==========================================
io.on('connection', (socket) => {
  // ... (Keep your create-room and join-room event listeners) ...
  console.log(`👤 User connected: ${socket.id}`);

  // 1. EVENT: Create Room
  socket.on('create-room', ({ playerName }) => {
    const roomCode = generateRoomCode();
    
    rooms[roomCode] = {
      players: [],
      gameState: 'lobby',
      hostId: socket.id
    };

    console.log(`✨ New room created: ${roomCode} by ${playerName}`);
    
    socket.join(roomCode);
    rooms[roomCode].players.push({ id: socket.id, name: playerName, hand: [] });

    socket.emit('room-created', { roomCode });
    io.to(roomCode).emit('room-update', rooms[roomCode].players);
  });

  // 2. EVENT: Join Room
  socket.on('join-room', ({ roomCode, playerName }) => {
    if (!roomCode) return;
    roomCode = roomCode.toUpperCase().trim();

    if (!rooms[roomCode]) {
      socket.emit('error-message', 'Room not found! Check your code.');
      return;
    }

    if (rooms[roomCode].gameState !== 'lobby') {
      socket.emit('error-message', 'Game has already started in this room!');
      return;
    }

    socket.join(roomCode);
    rooms[roomCode].players.push({ id: socket.id, name: playerName, hand: [] });
    
    console.log(`🚪 ${playerName} joined room: ${roomCode}`);
    
    socket.emit('join-success', { roomCode });
    io.to(roomCode).emit('room-update', rooms[roomCode].players);
  });

  // 3. EVENT: Start Game (Triggered by Host)
  socket.on('start-game', ({ roomCode }) => {
    const room = rooms[roomCode];
    
    // Safety checks
    if (!room) return;
    if (socket.id !== room.hostId) return; // Only host can start
    if (room.players.length < 2) {
      socket.emit('error-message', 'You need at least 2 players to start!');
      return;
    }

    room.gameState = 'playing';

    // A. Create and shuffle our custom Joker deck using the engine
    let deck = engine.createZombieDeck();
    engine.shuffle(deck);

    // B. Deal cards directly into our room's player objects
    engine.dealCards(deck, room.players);

    // C. Force all players to strip out initial value/color matching pairs
    room.players.forEach(player => {
      player.hand = engine.discardPairs(player.hand);
    });

    // D. Pick a random player to start the game
    room.currentTurnIndex = Math.floor(Math.random() * room.players.length);

    // Tell everyone in the room that the game has officially started
    io.to(roomCode).emit('game-started');

    // E. Send out individual card states and sync the master layout
    sendPrivateHands(roomCode);
    broadcastGameState(roomCode);
  });

  // 5. EVENT: Pull Card from Neighbor
  socket.on('draw-card', ({ roomCode, targetPlayerId, cardIndex }) => {
    const room = rooms[roomCode];
    if (!room || room.gameState !== 'playing') return;

    const currentTurnPlayer = room.players[room.currentTurnIndex];
    
    // Safety check: Validate it is actually this user's turn
    if (socket.id !== currentTurnPlayer.id) return;

    const targetPlayer = room.players.find(p => p.id === targetPlayerId);
    if (!targetPlayer || targetPlayer.hand.length === 0) return;

    // Remove card from opponent's hand array
    const [stolenCard] = targetPlayer.hand.splice(cardIndex, 1);
    
    // Add card to current player's hand array
    currentTurnPlayer.hand.push(stolenCard);

    // Filter out any value/color matching pairs formed by this draw
    currentTurnPlayer.hand = engine.discardPairs(currentTurnPlayer.hand);

    // ==========================================
    // NEW: SHUFFLE BOTH HANDS TO RANDOMIZE POSITIONS
    // ==========================================
    if (currentTurnPlayer.hand.length > 0) {
      engine.shuffle(currentTurnPlayer.hand);
    }
    if (targetPlayer.hand.length > 0) {
      engine.shuffle(targetPlayer.hand);
    }
    // Check Win/Loss states
    // A player is out of cards if their hand length hits 0
    
    // Advance turn index to the next active player holding cards
    let attempts = 0;
    do {
      room.currentTurnIndex = (room.currentTurnIndex + 1) % room.players.length;
      attempts++;
    } while (room.players[room.currentTurnIndex].hand.length === 0 && attempts < room.players.length);

    // Check if Game Over (Only 1 player left holding the Joker)
    const activePlayersWithCards = room.players.filter(p => p.hand.length > 0);
    
    if (activePlayersWithCards.length === 1) {
      room.gameState = 'game-over';
      io.to(roomCode).emit('game-over', { loserName: activePlayersWithCards[0].name });
      return;
    }

    // Otherwise, continue game: update cards and layout state
    sendPrivateHands(roomCode);
    broadcastGameState(roomCode);
  });

  // 4. EVENT: Disconnect
  socket.on('disconnect', () => {
    console.log(`❌ User disconnected: ${socket.id}`);
    
    // Simple cleanup: search rooms and remove player if game hasn't started
    for (const roomCode in rooms) {
      const room = rooms[roomCode];
      const pIndex = room.players.findIndex(p => p.id === socket.id);
      if (pIndex !== -1) {
        room.players.splice(pIndex, 1);
        if (room.players.length === 0) {
          delete rooms[roomCode]; // Delete empty rooms
          console.log(`🧹 Deleted empty room: ${roomCode}`);
        } else {
          // If the host left before starting, assign a new host
          if (room.hostId === socket.id) {
            room.hostId = room.players[0].id;
          }
          io.to(roomCode).emit('room-update', room.players);
        }
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
