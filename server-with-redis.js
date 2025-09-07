const express = require("express");
const mongoose = require("mongoose");
const bodyParser = require("body-parser");
const path = require("path");
const http = require("http");
const { Server } = require("socket.io");
const bot = require("./bot");
const { redisClient, gameStateManager } = require("./config/redis");

// Routes
const userRoutes = require("./routes/users");
const tournamentRoutes = require("./routes/tournaments");
const fixtureRoutes = require("./routes/fixtures");
const gameRoomRoutes = require("./routes/gamerooms");

// Models
const Fixture = require("./models/fixture");
const User = require("./models/user");

const app = express();
const PORT = 3000;
const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"],
  },
});

// In-memory fallback for game rooms
const gameRooms = {};

// Redis keys helper
const redisPlayersKey = (fixtureId) => `players:${fixtureId}`;

// Initialize Redis connection
async function initializeRedis() {
  try {
    await redisClient.connect();
    console.log("✅ Redis initialized successfully");
  } catch (err) {
    console.warn("⚠️ Redis not available, using in-memory storage");
  }
}

// MongoDB connection
mongoose
  .connect("mongodb://localhost:27017/my_node_project")
  .then(() => console.log("✅ MongoDB connected"))
  .catch((err) => console.error("❌ MongoDB connection error:", err));

// Middleware
app.use(bodyParser.json());
app.use(express.static(path.join(__dirname, "public")));

// Simple cache middleware placeholder
const cacheMiddleware = () => (req, res, next) => next();

// Telegram Bot Webhook (replace token with your env or config)
app.post(
  `/bot${process.env.TELEGRAM_BOT_TOKEN || "YOUR_TELEGRAM_BOT_TOKEN"}`,
  (req, res) => {
    bot.processUpdate(req.body);
    res.sendStatus(200);
  }
);

// Admin panel static pages
app.get("/", (req, res) => res.send("✅ Node.js Server with Redis is running"));
app.get("/admin/user", (req, res) =>
  res.sendFile(path.join(__dirname, "public", "admin-user.html"))
);
app.get("/admin/tournament", (req, res) =>
  res.sendFile(path.join(__dirname, "public", "admin-tournament.html"))
);
app.get("/admin/fixture-generated", (req, res) =>
  res.sendFile(path.join(__dirname, "public", "admin-fixture-generated.html"))
);

// API routes with optional caching
app.use("/api/admin/users", cacheMiddleware(), userRoutes);
app.use("/api/admin/tournaments", cacheMiddleware(), tournamentRoutes);
app.use("/api/admin/fixtures", fixtureRoutes);
app.use("/api/user", cacheMiddleware(), userRoutes);
app.use("/api/game-rooms", gameRoomRoutes);

// Socket.io connection
io.on("connection", (socket) => {
  console.log("✅ Socket connected:", socket.id);

  socket.on("joinGame", async ({ fixtureId, username }) => {
    if (!fixtureId)
      return socket.emit("errorMessage", { message: "Missing fixtureId" });

    try {
      let game = await gameStateManager.getGameState(fixtureId);

      // Fetch fixture details
      const fixture = await Fixture.findById(fixtureId);
      if (!fixture)
        return socket.emit("errorMessage", { message: "Fixture not found." });

      // If game start time is set but not yet reached, notify client to wait
      if (
        fixture.startTime &&
        Date.now() < new Date(fixture.startTime).getTime()
      ) {
        const startTimeStr = new Date(fixture.startTime).toLocaleString();
        return socket.emit("waitingForStartTime", {
          message: `Game will start at ${startTimeStr}`,
        });
      }

      // If no Redis game state, fallback to in-memory rooms
      if (!game) {
        if (!gameRooms[fixtureId]) gameRooms[fixtureId] = [];
        const room = gameRooms[fixtureId];

        if (room.length >= 2)
          return socket.emit("roomFull", {
            message: "This game already has 2 players.",
          });

        const user = await User.findOne({ telegram_id: username });
        if (!user)
          return socket.emit("errorMessage", {
            message: "User not found in database.",
          });

        const playerName = user.name;

        // Check if reconnecting player (update socketId)
        const existingPlayerIndex = room.findIndex(
          (p) => p.username === playerName
        );
        if (existingPlayerIndex !== -1) {
          room[existingPlayerIndex].socketId = socket.id;
          socket.join(fixtureId);

          const playerNumber = existingPlayerIndex + 1;
          socket.emit("playerNumberAssigned", { playerNumber });

          // Send current or initialized game state
          const currentGameState = game || {
            board: null,
            currentTurn: 1,
            moves: [],
          };
          socket.emit("gameState", currentGameState);

          // Start game with player names and current turn
          const player1Name = room[0]?.username || "Player 1";
          const player2Name = room[1]?.username || "Player 2";
          socket.emit("startGame", {
            player1Name,
            player2Name,
            currentTurn: currentGameState.currentTurn || 1,
            currentTurnName:
              currentGameState.currentTurn === 2
                ? player2Name
                : player1Name,
          });

          socket.to(fixtureId).emit("opponentJoined", {
            playerNumber,
            username: playerName,
          });

          return;
        }

        // New player joins
        socket.join(fixtureId);
        room.push({ socketId: socket.id, username: playerName });

        const playerNumber = room.findIndex((p) => p.socketId === socket.id) + 1;
        socket.emit("playerNumberAssigned", { playerNumber });
        console.log(
          `🎮 Player ${playerNumber} (${playerName}) joined fixture ${fixtureId}`
        );

        socket.to(fixtureId).emit("opponentJoined", {
          playerNumber,
          username: playerName,
        });
        io.emit("fixtureOccupied", { fixtureId });
        io.to(fixtureId).emit("playerJoinedRoom", {
          fixtureId,
          joinedUsername: playerName,
        });

        if (room.length === 1) {
          socket.emit("waitingForOpponent");
        } else if (room.length === 2) {
          const [player1Name, player2Name] = [room[0].username, room[1].username];
          io.to(fixtureId).emit("startGame", {
            player1Name,
            player2Name,
            currentTurn: 1,
            currentTurnName: player1Name,
          });
        }

        // Update fixture roomId once on first player join
        if (fixture && !fixture.roomId) {
          try {
            fixture.roomId = fixtureId;
            await fixture.save();
            console.log(`📦 roomId set for fixture ${fixtureId}`);
          } catch (err) {
            console.error("❌ Failed to update roomId:", err);
          }
        }
      } else {
        // Redis-based game state logic
        socket.join(fixtureId);

        // Add player username to Redis set of players
        await redisClient.sAdd(redisPlayersKey(fixtureId), username);

        // Count players in Redis set
        const playersCount = await redisClient.sCard(redisPlayersKey(fixtureId));

        // Assign player number (max 2)
        const playerNumber = playersCount <= 2 ? playersCount : 2;
        socket.emit("playerNumberAssigned", { playerNumber });

        // Initialize game state if missing
        if (!game) {
          game = {
            board: null,
            currentTurn: 1,
            moves: [],
          };
          await gameStateManager.saveGameState(fixtureId, game);
        }

        socket.emit("gameState", game);

        socket.to(fixtureId).emit("opponentJoined", { playerNumber, username });

        if (playersCount === 1) {
          socket.emit("waitingForOpponent");
        } else if (playersCount === 2) {
          // Get players from Redis and start game
          const players = await redisClient.sMembers(redisPlayersKey(fixtureId));
          io.to(fixtureId).emit("startGame", {
            player1Name: players[0] || "Player 1",
            player2Name: players[1] || "Player 2",
            currentTurn: 1,
            currentTurnName: players[0] || "Player 1",
          });
        }
      }
    } catch (err) {
      console.error("❌ Join game error:", err);
      socket.emit("errorMessage", { message: err.message });
    }
  });

  socket.on("makeMove", async ({ fixtureId, move, boardState }) => {
    try {
      const room = gameRooms[fixtureId];
      if (!room) return;

      const playerIndex = room.findIndex((p) => p.socketId === socket.id);
      if (playerIndex === -1) return;

      const currentPlayerNumber = playerIndex + 1;
      const nextPlayerNumber = currentPlayerNumber === 1 ? 2 : 1;
      const nextPlayerName =
        room[nextPlayerNumber - 1]?.username || `Player ${nextPlayerNumber}`;

      socket.to(fixtureId).emit("opponentMove", move);

      // Save updated board state to Redis
      if (boardState) {
        await gameStateManager.saveGameState(fixtureId, boardState);
      }

      const isGameOver = move.gameOver || false;
      if (isGameOver) {
        const winnerName = room[currentPlayerNumber - 1].username;
        const loserName =
          room[nextPlayerNumber - 1]?.username || `Player ${nextPlayerNumber}`;
        io.to(fixtureId).emit("gameOver", {
          winnerNumber: currentPlayerNumber,
          loserNumber: nextPlayerNumber,
          winnerName,
          loserName,
        });
        console.log(`🏆 Game over in fixture ${fixtureId}. Winner: ${winnerName}`);

        // Clear game state on game over
        await gameStateManager.deleteGameState(fixtureId);
      } else {
        io.to(fixtureId).emit("turnUpdate", {
          currentTurn: nextPlayerNumber,
          currentTurnName: nextPlayerName,
        });
      }
    } catch (err) {
      console.error("❌ Make move error:", err);
      socket.emit("errorMessage", { message: err.message });
    }
  });

  socket.on("getGameState", async ({ fixtureId }, cb) => {
    try {
      const state = await gameStateManager.getGameState(fixtureId);
      if (cb) cb(state);
      else socket.emit("gameState", state);
    } catch (err) {
      console.error("❌ getGameState error:", err);
      if (cb) cb(null);
      else socket.emit("gameState", null);
    }
  });

  socket.on("gameOver", async ({ fixtureId, winner }) => {
    const room = gameRooms[fixtureId];
    if (!room) return;

    const winnerName = room[winner - 1]?.username || `Player ${winner}`;
    const loserNumber = winner === 1 ? 2 : 1;
    const loserName = room[loserNumber - 1]?.username || `Player ${loserNumber}`;

    io.to(fixtureId).emit("gameOver", {
      winnerNumber: winner,
      loserNumber,
      winnerName,
      loserName,
    });
    console.log(`🏆 Game over in fixture ${fixtureId}. Winner: ${winnerName}`);

    // Clear game state on game over
    await gameStateManager.deleteGameState(fixtureId);
  });

  socket.on("restartRequest", ({ fixtureId }) => {
    io.to(fixtureId).emit("restartApproved");
    console.log(`🔄 Restart approved for fixture ${fixtureId}`);
  });

  socket.on("disconnect", async () => {
    console.log("🔌 Socket disconnected:", socket.id);

    // Remove from in-memory gameRooms
    for (const [fixtureId, sockets] of Object.entries(gameRooms)) {
      const idx = sockets.findIndex((p) => p.socketId === socket.id);
      if (idx !== -1) {
        const disconnectedPlayer = sockets[idx];
        sockets.splice(idx, 1);

        if (sockets.length > 0) {
          io.to(fixtureId).emit("opponentDisconnected");
        } else {
          delete gameRooms[fixtureId];
          console.log(`🧹 Room ${fixtureId} cleared`);
        }

        // Remove player from Redis set if Redis connected
        try {
          if (
            redisClient.isOpen &&
            disconnectedPlayer &&
            disconnectedPlayer.username
          ) {
            await redisClient.sRem(
              redisPlayersKey(fixtureId),
              disconnectedPlayer.username
            );
          }
        } catch (err) {
          console.error("❌ Redis error removing player on disconnect:", err);
        }

        break;
      }
    }
  });
});

// Start server function
async function startServer() {
  await initializeRedis();

  server.listen(PORT, () => {
    console.log(`🚀 Server running at http://localhost:${PORT}`);
    console.log(
      `📊 Redis status: ${redisClient.isOpen ? "Connected" : "Using fallback"}`
    );
  });
}

startServer();
