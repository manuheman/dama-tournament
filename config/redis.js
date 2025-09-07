const { createClient } = require('redis');

const redisClient = createClient({
  url: 'redis://localhost:6379', // Default Redis port
});

redisClient.on('error', (err) => {
  console.error('❌ Redis Client Error', err);
});

redisClient.on('connect', () => {
  console.log('✅ Redis connected');
});

redisClient.on('ready', () => {
  console.log('✅ Redis ready');
});

// Game state management functions
const gameStateManager = {
  // Save game state to Redis
  async saveGameState(fixtureId, gameState) {
    try {
      const key = `game:${fixtureId}`;
      await redisClient.set(key, JSON.stringify(gameState), 'EX', 3600); // Expire in 1 hour
      console.log(`💾 Game state saved for fixture ${fixtureId}`);
      return true;
    } catch (error) {
      console.error('❌ Error saving game state:', error);
      return false;
    }
  },

  // Get game state from Redis
  async getGameState(fixtureId) {
    try {
      const key = `game:${fixtureId}`;
      const state = await redisClient.get(key);
      if (state) {
        console.log(`📖 Game state retrieved for fixture ${fixtureId}`);
        return JSON.parse(state);
      }
      return null;
    } catch (error) {
      console.error('❌ Error getting game state:', error);
      return null;
    }
  },

  // Delete game state
  async deleteGameState(fixtureId) {
    try {
      const key = `game:${fixtureId}`;
      await redisClient.del(key);
      console.log(`🗑️ Game state deleted for fixture ${fixtureId}`);
      return true;
    } catch (error) {
      console.error('❌ Error deleting game state:', error);
      return false;
    }
  },

  // Save player room info
  async saveGameRoom(fixtureId, roomData) {
    try {
      const key = `room:${fixtureId}`;
      await redisClient.set(key, JSON.stringify(roomData), 'EX', 3600);
      console.log(`💾 Room data saved for fixture ${fixtureId}`);
      return true;
    } catch (error) {
      console.error('❌ Error saving room data:', error);
      return false;
    }
  },

  // Get player room info
  async getGameRoom(fixtureId) {
    try {
      const key = `room:${fixtureId}`;
      const roomData = await redisClient.get(key);
      if (roomData) {
        console.log(`📖 Room data retrieved for fixture ${fixtureId}`);
        return JSON.parse(roomData);
      }
      return null;
    } catch (error) {
      console.error('❌ Error getting room data:', error);
      return null;
    }
  }
};

module.exports = {
  redisClient,
  gameStateManager
};
