import { GoGame, BLACK, WHITE, GAME_STATUS } from './gameLogic.js';

export class RoomManager {
  constructor() {
    this.rooms = new Map(); // roomId -> Room
  }

  generateRoomId() {
    return Math.random().toString(36).substring(2, 8).toUpperCase();
  }

  createRoom(size = 19, hostPlayerId = null, customId = null) {
    const roomId = customId || this.generateRoomId();
    const game = new GoGame(size);
    const room = {
      id: roomId,
      size,
      game,
      hostPlayerId,
      blackPlayerId: hostPlayerId, // Host takes Black by default
      whitePlayerId: null,
      spectatorIds: new Set(),
      playerSockets: new Map(), // playerId -> socketId
      createdAt: Date.now(),
      messages: [],
      gameStarted: false
    };
    this.rooms.set(roomId, room);
    return room;
  }

  getRoom(roomId) {
    if (!roomId) return null;
    return this.rooms.get(roomId.toUpperCase().trim());
  }

  /**
   * Assigns a player to a seat in an EXISTING room.
   * If the room does not exist, returns an error.
   */
  joinRoom(roomId, playerId, socketId) {
    const room = this.getRoom(roomId);
    if (!room) {
      return { error: 'Room not found. Please check the code.' };
    }

    room.playerSockets.set(playerId, socketId);

    // Check if player is already assigned a role (reconnection)
    let role = 'spectator';
    if (room.blackPlayerId === playerId) {
      role = 'black';
    } else if (room.whitePlayerId === playerId) {
      role = 'white';
    } else if (!room.blackPlayerId) {
      room.blackPlayerId = playerId;
      role = 'black';
    } else if (!room.whitePlayerId) {
      room.whitePlayerId = playerId;
      role = 'white';
    } else {
      room.spectatorIds.add(playerId);
      role = 'spectator';
    }

    const isHost = room.hostPlayerId === playerId;
    return { room, role, isHost };
  }

  leaveRoom(roomId, playerId) {
    const room = this.getRoom(roomId);
    if (!room) return { success: false };

    if (room.whitePlayerId === playerId) {
      room.whitePlayerId = null;
    } else if (room.blackPlayerId === playerId && room.hostPlayerId !== playerId) {
      room.blackPlayerId = null;
    }

    room.spectatorIds.delete(playerId);
    room.playerSockets.delete(playerId);

    return { success: true, room };
  }

  endRoom(roomId, playerId) {
    const room = this.getRoom(roomId);
    if (!room) return { success: false, error: 'Room not found' };

    // Only host can end room
    if (room.hostPlayerId && room.hostPlayerId !== playerId) {
      return { success: false, error: 'Only the host can end the room' };
    }

    this.rooms.delete(room.id);
    return { success: true };
  }

  getPlayerRole(room, playerId) {
    if (room.blackPlayerId === playerId) return 'black';
    if (room.whitePlayerId === playerId) return 'white';
    return 'spectator';
  }

  getColorFromRole(role) {
    if (role === 'black') return BLACK;
    if (role === 'white') return WHITE;
    return null;
  }

  startGame(roomId, playerId) {
    const room = this.getRoom(roomId);
    if (!room) {
      return { success: false, error: 'Room not found.' };
    }
    if (room.hostPlayerId && room.hostPlayerId !== playerId) {
      return { success: false, error: 'Only the host can start the game.' };
    }
    if (!room.whitePlayerId) {
      return { success: false, error: 'Cannot start game without an opponent.' };
    }
    if (room.gameStarted) {
      return { success: false, error: 'Game has already started.' };
    }

    room.gameStarted = true;
    return { success: true, room };
  }

  resetRoomGame(roomId, size, playerId) {
    const room = this.getRoom(roomId);
    if (!room) return null;

    // Only host can reset or change size
    if (room.hostPlayerId && room.hostPlayerId !== playerId) {
      return null;
    }

    // Host cannot restart during middle of a game
    if (room.gameStarted && room.game.status === GAME_STATUS.PLAYING) {
      return null;
    }

    if (size && (size === 9 || size === 13 || size === 19)) {
      room.size = size;
    }
    room.game = new GoGame(room.size);
    room.gameStarted = false;
    return room;
  }

  handleDisconnect(socketId) {
    // Keep player reservation so page refresh retains connection
  }
}
