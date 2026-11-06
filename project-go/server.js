import express from 'express';
import http from 'http';
import { Server } from 'socket.io';
import path from 'path';
import { fileURLToPath } from 'url';
import { RoomManager } from './src/roomManager.js';
import { BLACK, WHITE } from './src/gameLogic.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: '*'
  }
});

const PORT = process.env.PORT || 3000;
const roomManager = new RoomManager();

// Serve static frontend files
app.use(express.static(path.join(__dirname, 'public')));

// Simple health & room check API
app.get('/api/room/:roomId', (req, res) => {
  const room = roomManager.getRoom(req.params.roomId);
  if (!room) {
    return res.status(404).json({ error: 'Room not found' });
  }
  res.json({
    id: room.id,
    size: room.size,
    hasBlack: !!room.blackPlayerId,
    hasWhite: !!room.whitePlayerId,
    gameStarted: room.gameStarted,
    gameState: room.game.getState()
  });
});

io.on('connection', (socket) => {
  let currentRoomId = null;
  let currentPlayerId = null;

  socket.on('create_room', ({ playerId, size }) => {
    const boardSize = size === 9 || size === 13 || size === 19 ? size : 19;
    const room = roomManager.createRoom(boardSize, playerId);
    currentRoomId = room.id;
    currentPlayerId = playerId;
    socket.join(room.id);

    socket.emit('room_joined', {
      roomId: room.id,
      role: 'black',
      isHost: true,
      gameStarted: room.gameStarted,
      state: room.game.getState(),
      players: {
        black: true,
        white: false
      }
    });

    io.to(room.id).emit('players_updated', {
      black: true,
      white: false,
      spectatorsCount: 0,
      gameStarted: room.gameStarted
    });
  });

  socket.on('join_room', ({ roomId, playerId }) => {
    if (!roomId) {
      return socket.emit('join_error', { error: 'Please enter a room code.' });
    }
    roomId = roomId.toUpperCase().trim();
    const result = roomManager.joinRoom(roomId, playerId, socket.id);
    if (result.error) {
      return socket.emit('join_error', { error: result.error });
    }

    const { room, role, isHost } = result;
    currentRoomId = room.id;
    currentPlayerId = playerId;
    socket.join(room.id);

    // Send assignment and state to this socket
    socket.emit('room_joined', {
      roomId: room.id,
      role,
      isHost,
      gameStarted: room.gameStarted,
      state: room.game.getState(),
      players: {
        black: !!room.blackPlayerId,
        white: !!room.whitePlayerId
      }
    });

    // Notify room of updated player presence
    io.to(room.id).emit('players_updated', {
      black: !!room.blackPlayerId,
      white: !!room.whitePlayerId,
      spectatorsCount: room.spectatorIds.size,
      gameStarted: room.gameStarted
    });
  });

  socket.on('start_game', ({ roomId, playerId }) => {
    if (!roomId) return;
    const targetRoomId = roomId.toUpperCase().trim();
    const result = roomManager.startGame(targetRoomId, playerId);
    if (!result.success) {
      return socket.emit('error_message', result.error);
    }

    const room = result.room;
    io.to(targetRoomId).emit('game_started', {
      state: room.game.getState(),
      gameStarted: true
    });
    io.to(targetRoomId).emit('players_updated', {
      black: !!room.blackPlayerId,
      white: !!room.whitePlayerId,
      spectatorsCount: room.spectatorIds.size,
      gameStarted: true
    });
  });

  socket.on('leave_room', ({ roomId, playerId }) => {
    if (!roomId) return;
    const targetRoomId = roomId.toUpperCase().trim();
    const result = roomManager.leaveRoom(targetRoomId, playerId);
    socket.leave(targetRoomId);
    currentRoomId = null;

    socket.emit('left_room_success');

    if (result.success && result.room) {
      io.to(targetRoomId).emit('players_updated', {
        black: !!result.room.blackPlayerId,
        white: !!result.room.whitePlayerId,
        spectatorsCount: result.room.spectatorIds.size,
        gameStarted: result.room.gameStarted
      });
      io.to(targetRoomId).emit('player_left', { playerId });
    }
  });

  socket.on('end_room', ({ roomId, playerId }) => {
    if (!roomId) return;
    const targetRoomId = roomId.toUpperCase().trim();
    const room = roomManager.getRoom(targetRoomId);
    if (!room) return;

    if (room.hostPlayerId && room.hostPlayerId !== playerId) {
      return socket.emit('error_message', 'Only the host can end the room.');
    }

    // Broadcast to all clients in the room before deletion
    io.to(targetRoomId).emit('room_ended', { message: 'The host has ended the room.' });

    roomManager.endRoom(targetRoomId, playerId);
    currentRoomId = null;
  });

  socket.on('make_move', ({ roomId, playerId, r, c }) => {
    const room = roomManager.getRoom(roomId);
    if (!room) {
      return socket.emit('error_message', 'Room not found');
    }

    if (!room.gameStarted) {
      return socket.emit('error_message', 'Game has not started yet. Waiting for host to press Start Game.');
    }

    const role = roomManager.getPlayerRole(room, playerId);
    const color = roomManager.getColorFromRole(role);

    if (!color) {
      return socket.emit('error_message', 'You are spectating and cannot make moves.');
    }

    const result = room.game.playMove(r, c, color);
    if (!result.valid) {
      return socket.emit('move_error', { error: result.error });
    }

    // Broadcast updated state to all in room
    io.to(roomId).emit('game_updated', {
      state: room.game.getState(),
      gameStarted: room.gameStarted,
      lastAction: { type: 'move', r, c, color, captured: result.capturedStones }
    });
  });

  socket.on('pass', ({ roomId, playerId }) => {
    const room = roomManager.getRoom(roomId);
    if (!room) return;

    if (!room.gameStarted) {
      return socket.emit('error_message', 'Game has not started yet.');
    }

    const role = roomManager.getPlayerRole(room, playerId);
    const color = roomManager.getColorFromRole(role);
    if (!color) {
      return socket.emit('error_message', 'Spectators cannot pass.');
    }

    const result = room.game.pass(color);
    if (!result.valid) {
      return socket.emit('move_error', { error: result.error });
    }

    io.to(roomId).emit('game_updated', {
      state: room.game.getState(),
      gameStarted: room.gameStarted,
      lastAction: { type: 'pass', color, gameEnded: result.gameEnded }
    });
  });

  socket.on('resign', ({ roomId, playerId }) => {
    const room = roomManager.getRoom(roomId);
    if (!room) return;

    if (!room.gameStarted) {
      return socket.emit('error_message', 'Game has not started yet.');
    }

    const role = roomManager.getPlayerRole(room, playerId);
    const color = roomManager.getColorFromRole(role);
    if (!color) {
      return socket.emit('error_message', 'Spectators cannot resign.');
    }

    const result = room.game.resign(color);
    if (!result.valid) {
      return socket.emit('move_error', { error: result.error });
    }

    io.to(roomId).emit('game_updated', {
      state: room.game.getState(),
      gameStarted: room.gameStarted,
      lastAction: { type: 'resign', color }
    });
  });

  socket.on('toggle_dead_stone', ({ roomId, playerId, r, c }) => {
    const room = roomManager.getRoom(roomId);
    if (!room) return;

    const role = roomManager.getPlayerRole(room, playerId);
    if (role !== 'black' && role !== 'white') {
      return socket.emit('error_message', 'Spectators cannot mark dead stones.');
    }

    const result = room.game.toggleDeadStone(r, c);
    if (!result.valid) {
      return socket.emit('move_error', { error: result.error });
    }

    io.to(roomId).emit('game_updated', {
      state: room.game.getState(),
      gameStarted: room.gameStarted,
      lastAction: { type: 'toggle_dead_stone', r, c }
    });
  });

  socket.on('confirm_score', ({ roomId, playerId }) => {
    const room = roomManager.getRoom(roomId);
    if (!room) return;

    room.game.confirmScore();
    io.to(roomId).emit('game_updated', {
      state: room.game.getState(),
      gameStarted: room.gameStarted,
      lastAction: { type: 'confirm_score' }
    });
  });

  socket.on('resume_play', ({ roomId, playerId }) => {
    const room = roomManager.getRoom(roomId);
    if (!room) return;

    const result = room.game.resumePlay();
    if (!result.valid) {
      return socket.emit('move_error', { error: result.error });
    }

    io.to(roomId).emit('game_updated', {
      state: room.game.getState(),
      gameStarted: room.gameStarted,
      lastAction: { type: 'resume_play' }
    });
  });

  socket.on('restart_game', ({ roomId, playerId, size }) => {
    const room = roomManager.getRoom(roomId);
    if (!room) return;
    if (room.hostPlayerId && room.hostPlayerId !== playerId) {
      return socket.emit('error_message', 'Only the host can restart the game or change board size.');
    }
    if (room.gameStarted && room.game.status === 'PLAYING') {
      return socket.emit('error_message', 'Cannot restart the board while a game is in progress.');
    }

    const updatedRoom = roomManager.resetRoomGame(roomId, size, playerId);
    if (!updatedRoom) {
      return socket.emit('error_message', 'Unable to restart game.');
    }

    io.to(roomId).emit('game_updated', {
      state: updatedRoom.game.getState(),
      gameStarted: updatedRoom.gameStarted,
      lastAction: { type: 'restart' }
    });
    io.to(roomId).emit('players_updated', {
      black: !!updatedRoom.blackPlayerId,
      white: !!updatedRoom.whitePlayerId,
      spectatorsCount: updatedRoom.spectatorIds.size,
      gameStarted: updatedRoom.gameStarted
    });
  });

  socket.on('disconnect', () => {
    if (currentRoomId && currentPlayerId) {
      const room = roomManager.getRoom(currentRoomId);
      if (room) {
        roomManager.handleDisconnect(socket.id);
      }
    }
  });
});

server.listen(PORT, () => {
  console.log(`Go game server running at http://localhost:${PORT}`);
});
