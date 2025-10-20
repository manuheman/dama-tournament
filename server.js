const dotenv = require("dotenv");
dotenv.config();
require('dotenv').config(); // MUST be first


const express = require("express");
const mongoose = require("mongoose");
const bodyParser = require("body-parser");
const path = require("path");
const http = require("http");
const { Server } = require("socket.io");
const bot  = require('./bot');
const Fixture = require("./models/fixture");  // adjust path as needed
const User = require('./models/user'); // adjust path as needed
const Tournament = require('./models/tournament')
const Withdraw = require('./models/withdraw'); // adjust path if needed
const paymentsRouter = require('./routes/payments');
const withdrawalsRouter = require('./routes/withdrawals');
const { startScheduler: startReconcileScheduler } = require('./services/reconcile');
const PORT = process.env.PORT || 3000;

const redisHelper = require('./utils/redisHelper');

// Redis Client and room functions (assumed implemented)
const {
  redisClient,
  createOrJoinRoom,
  getRoom,
  updateRoom,
  deleteRoom,

} = require("./utils/redisClient");


const {


  createOrJoinRoomDama1V1,
  getRoomDama1V1,
  updateRoomDama1V1,
  deleteRoomDama1V1,
  leaveRoomDama1V1,
  getAllRoomsDama1V1,
  saveGameState,
  getGameState,
  applyMove,
  getValidMoves,
  initializeBoard
} = require('./utils/redisHelper'); // <-- check this path!

const app = express();
const server = http.createServer(app);
const io = new Server(server);
const socketUtil = require('./utils/socket');
socketUtil.init(io);
// ====== Constants ======
const TURN_TIME = 30; // seconds per turn (adjust as needed)

const TIMER_DURATION = 600; // 10 minutes in seconds


// MongoDB connection
mongoose
  .connect(process.env.MONGO_URL || "mongodb://localhost:27017/my_node_project")
  .then(() => console.log("✅ MongoDB connected"))
  .catch((err) => console.error("❌ MongoDB connection error:", err));

// Middleware
// Preserve rawBody for HMAC verification routes (Chapa webhooks/approvals)
app.use(bodyParser.json({
  verify: (req, res, buf) => {
    try { req.rawBody = Buffer.from(buf); } catch {}
  }
}));
// app.use(express.json()); // bodyParser.json handles JSON and preserves raw body
app.use(express.static(path.join(__dirname, "public")));


// Decoupled payments/withdrawals routers
app.use("/api", paymentsRouter);
app.use('/api', withdrawalsRouter);

// Telegram webhook endpoint (bot instance is created and webhook set in ./bot)
const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
if (!TELEGRAM_BOT_TOKEN) {
  console.error('❌ TELEGRAM_BOT_TOKEN not set. Bot webhook route will not be mounted.');
} else {
  app.post(`/bot${TELEGRAM_BOT_TOKEN}`, (req, res) => {
    try { bot.processUpdate(req.body); } catch {}
    res.sendStatus(200);
  });
}


// Webhook raw body is applied only inside routes/payments.js

// Root route
const oneVsOneUserRouter = require('./routes/1v1user');
app.use('/1v1user', oneVsOneUserRouter);
app.get("/", (req, res) => res.send("✅ Node.js Server is running"));

// Socket.io: join room per telegram_id for live balance updates
io.on('connection', (socket) => {
  try {
    const telegramId = socket.handshake.query?.telegramId;
    if (telegramId) {
      socket.join(`tg:${String(telegramId)}`);
      console.log('[socket] joined user room', telegramId);
    }
  } catch {}
});

// Static admin routes
app.get("/admin/user", (req, res) =>
  res.sendFile(path.join(__dirname, "public", "admin-user.html"))
);
app.get("/admin/tournament", (req, res) =>
  res.sendFile(path.join(__dirname, "public", "admin-tournament.html"))
);
app.get("/admin/fixture-generated", (req, res) =>
  res.sendFile(path.join(__dirname, "public", "admin-fixture-generated.html"))
);
app.get("/tournament-status", (req, res) =>
  res.sendFile(path.join(__dirname, "public", "tournament-status.html"))
);

// Game route: handle Redis room create/join
app.get("/game.html", async (req, res) => {
  const { fixtureId, userId } = req.query;
  if (!fixtureId || !userId)
    return res.status(400).send("❌ Missing fixtureId or userId");

  try {
    const { room, created, error } = await createOrJoinRoom(fixtureId, userId);
    if (error) return res.status(403).send(`❌ ${error}`);

    console.log(`${created ? "Room created" : "Room joined"}:`, room);
    res.sendFile(path.join(__dirname, "public", "game.html"));
  } catch (err) {
    console.error("❌ Room join error:", err);
    res.status(500).send("❌ Server error");
  }
});

// API routes
app.use("/api/admin/users", require("./routes/users"));
app.use("/api/admin/tournaments", require("./routes/tournaments"));
app.use("/api/admin/fixtures", require("./routes/fixtures"));
app.use("/api/user", require("./routes/users"));
app.use('/api/admin/game-results', require('./routes/game-results'));



// 404 fallback
app.use((req, res) => res.status(404).json({ error: "Route not found" }));

// --- HELPER FUNCTIONS ---

app.post("/send-notification", async (req, res) => {
  const { telegramId, message } = req.body;
  if (!telegramId || !message) {
    return res.status(400).json({ error: "telegramId and message are required" });
  }
  try {
    await bot.sendMessage(telegramId, message);
    return res.json({ success: true, telegramId, message });
  } catch (err) {
    console.error("Failed to send notification:", err);
    return res.status(500).json({ error: "Failed to send notification" });
  }
});

function sendTelegramMessage(telegramId, message) {
  if (!telegramId) {
    console.log(`[TELEGRAM] No telegramId provided, message not sent.`);
    return;
  }
  bot
    .sendMessage(telegramId, message)
    .then(() => {
      console.log(`[TELEGRAM] ✅ Message sent successfully to ${telegramId}`);
    })
    .catch((err) => {
      console.error(
        `[TELEGRAM] ❌ Failed to send message to ${telegramId}:`,
        err.message
      );
    });
}

function initializeNewBoard() {
  const board = Array(8)
    .fill(null)
    .map(() => Array(8).fill(null));
  for (let r = 0; r < 3; r++)
    for (let c = 0; c < 8; c++)
      if ((r + c) % 2 === 1) board[r][c] = { player: 2, king: false };
  for (let r = 5; r < 8; r++)
    for (let c = 0; c < 8; c++)
      if ((r + c) % 2 === 1) board[r][c] = { player: 1, king: false };
  return board;
}

function applyMoveToBoard(board, move) {
  const { from, to, capture } = move;
  board[to.row][to.col] = board[from.row][from.col];
  board[from.row][from.col] = null;
  if (capture) board[capture.row][capture.col] = null;
}

const GameResult = require("./models/Gameresult");

async function saveGameResult(
  fixtureId,
  player1TelegramId,
  player2TelegramId,
  winner,
  finalBoard
) {
  try {
    const fixture = await Fixture.findById(fixtureId).populate("tournament");
    if (!fixture) throw new Error("Fixture not found");

    const tournamentUniqueId = fixture.tournament?.uniqueId || null;

    const player1 = await User.findOne({ telegram_id: player1TelegramId }).lean();
    if (!player1) throw new Error("Player 1 not found");

    let player2 = null;
    if (player2TelegramId) {
      player2 = await User.findOne({ telegram_id: player2TelegramId }).lean();
      if (!player2) throw new Error("Player 2 not found");
    }

    const gameResult = new GameResult({
      roomId: fixture.roomId || fixtureId,
      player1: player1._id,
      player1TelegramId: player1.telegram_id,
      player2: player2?._id || null,
      player2TelegramId: player2?.telegram_id || null,
      winner,
      finalBoard,
      tournamentUniqueId,
      playedAt: new Date(),
    });

    await gameResult.save();
    console.log("Game result saved with tournamentUniqueId:", tournamentUniqueId);
  } catch (err) {
    console.error("Error saving game result:", err);
    throw err;
  }
}

function hasFurtherCapture(board, pos, player) {
  const directions = [
    { dr: -1, dc: -1 },
    { dr: -1, dc: 1 },
    { dr: 1, dc: -1 },
    { dr: 1, dc: 1 },
  ];

  const piece = board[pos.row][pos.col];
  if (!piece || piece.player !== player) return false;

  for (const { dr, dc } of directions) {
    const enemyRow = pos.row + dr;
    const enemyCol = pos.col + dc;
    const jumpRow = pos.row + 2 * dr;
    const jumpCol = pos.row + 2 * dc;

    if (
      enemyRow < 0 ||
      enemyRow >= 8 ||
      enemyCol < 0 ||
      enemyCol >= 8 ||
      jumpRow < 0 ||
      jumpRow >= 8 ||
      jumpCol < 0 ||
      jumpCol >= 8
    )
      continue;

    const enemyPiece = board[enemyRow][enemyCol];
    const landingSquare = board[jumpRow][jumpCol];

    if (enemyPiece && enemyPiece.player !== player && !landingSquare) {
      return true;
    }
  }

  return false;
}

function hasAnyValidMoves(board, player) {
  const directions = [
    { dr: -1, dc: -1 },
    { dr: -1, dc: 1 },
    { dr: 1, dc: -1 },
    { dr: 1, dc: 1 },
  ];

  function getValidMovesForPiece(r, c) {
    const p = board[r][c];
    if (!p || p.player !== player) return [];

    let moves = [];

    if (p.king) {
      for (const { dr, dc } of directions) {
        let rr = r + dr;
        let cc = c + dc;

        while (
          rr >= 0 &&
          rr < 8 &&
          cc >= 0 &&
          cc < 8 &&
          board[rr][cc] === null
        ) {
          moves.push({
            from: { row: r, col: c },
            to: { row: rr, col: cc },
            capture: null,
          });
          rr += dr;
          cc += dc;
        }

        if (
          rr >= 0 &&
          rr < 8 &&
          cc >= 0 &&
          cc < 8 &&
          board[rr][cc] &&
          board[rr][cc].player !== player
        ) {
          let rrr = rr + dr;
          let ccc = cc + dc;
          while (
            rrr >= 0 &&
            rrr < 8 &&
            ccc >= 0 &&
            ccc < 8 &&
            board[rrr][ccc] === null
          ) {
            moves.push({
              from: { row: r, col: c },
              to: { row: rrr, col: ccc },
              capture: { row: rr, col: cc },
            });
            rrr += dr;
            ccc += dc;
          }
        }
      }
    } else {
      const captureDirs = directions;
      for (const { dr, dc } of captureDirs) {
        const r1 = r + dr,
          c1 = c + dc,
          r2 = r + 2 * dr,
          c2 = c + 2 * dc;
        if (
          r2 >= 0 &&
          r2 < 8 &&
          c2 >= 0 &&
          c2 < 8 &&
          board[r1][c1] &&
          board[r1][c1].player !== player &&
          board[r2][c2] === null
        ) {
          moves.push({
            from: { row: r, col: c },
            to: { row: r2, col: c2 },
            capture: { row: r1, col: c1 },
          });
        }
      }
      if (moves.length > 0) return moves;

      const fwdDirs =
        player === 1
          ? [
              { dr: -1, dc: -1 },
              { dr: -1, dc: 1 },
            ]
          : [
              { dr: 1, dc: -1 },
              { dr: 1, dc: 1 },
            ];
      for (const { dr, dc } of fwdDirs) {
        const r1 = r + dr,
          c1 = c + dc;
        if (r1 >= 0 && r1 < 8 && c1 >= 0 && c1 < 8 && board[r1][c1] === null) {
          moves.push({
            from: { row: r, col: c },
            to: { row: r1, col: c1 },
            capture: null,
          });
        }
      }
    }

    return moves;
  }

  for (let r = 0; r < 8; r++) {
    for (let c = 0; c < 8; c++) {
      if (board[r][c] && board[r][c].player === player) {
        if (getValidMovesForPiece(r, c).length > 0) return true;
      }
    }
  }

  return false;
}

// --- HANDLE GAME OVER (with detailed logs and notifications) ---
async function handleGameOver(fixtureId, winnerNumber, timeUp = false, finalBoard = []) {
  try {
    console.log(`\n=== handleGameOver called ===`);
    console.log(`[INFO] fixtureId=${fixtureId}, winnerNumber=${winnerNumber}, timeUp=${timeUp}`);

    const fixture = await Fixture.findById(fixtureId);
    if (!fixture) {
      console.error(`[ERROR] Fixture ${fixtureId} not found.`);
      return;
    }

    if (![1, 2].includes(winnerNumber)) {
      console.error(`[ERROR] Invalid winner number "${winnerNumber}". Must be 1 or 2.`);
      return;
    }

    const winnerUserId = winnerNumber === 1 ? fixture.player1 : fixture.player2;
    const loserUserId = winnerNumber === 1 ? fixture.player2 : fixture.player1;

    if (!winnerUserId) {
      console.error(`[ERROR] Winner Player ${winnerNumber} is missing in fixture ${fixtureId}. Aborting.`);
      return;
    }

    // Atomically mark fixture completed
    const updatedFixture = await Fixture.findOneAndUpdate(
      { _id: fixtureId, status: { $ne: 'completed' } },
      { status: 'completed', result: winnerNumber },
      { new: true }
    );

    if (!updatedFixture) {
      console.log(`[INFO] Game over already handled for fixture ${fixtureId}. Skipping.`);
      return;
    }

    console.log(`[INFO] Fixture ${fixtureId} marked as completed with winner=${winnerNumber}`);

    // Fetch player data
    const winnerUser = await User.findById(winnerUserId).lean();
    const loserUser = loserUserId ? await User.findById(loserUserId).lean() : null;

    const winnerTelegram = winnerUser?.telegram_id;
    const loserTelegram = loserUser?.telegram_id;

    // ✅ Send Telegram messages
    if (winnerTelegram) {
      const message = timeUp
        ? `🎉 Congratulations! You won the match because your opponent ran out of time.`
        : `🎉 Congratulations! You won the match.`;
      sendTelegramMessage(winnerTelegram, message);
      console.log(`[TELEGRAM] Sent winner notification to ${winnerTelegram}`);
    }

    if (loserTelegram) {
      const message = timeUp
        ? `⏰ Time's up! You lost the match because you ran out of time.`
        : `😔 Sorry! You lost the match.`;
      sendTelegramMessage(loserTelegram, message);
      console.log(`[TELEGRAM] Sent loser notification to ${loserTelegram}`);
    }

    // Save game result
    try {
      await saveGameResult(fixtureId, winnerTelegram, loserTelegram, winnerNumber, finalBoard);
      console.log(`[INFO] Game result successfully saved for fixture ${fixtureId}`);
    } catch (err) {
      console.error(`[ERROR] Failed to save game result for fixture ${fixtureId}:`, err);
    }

    // Trigger next round pairing
    const populatedFixture = await Fixture.findById(fixtureId).populate('tournament');
    const tournamentUniqueId = populatedFixture?.tournament?.uniqueId;

    if (tournamentUniqueId) {
      console.log(`[INFO] Triggering pairWinnersAndCreateMatches for tournament ${tournamentUniqueId}`);
      await pairWinnersAndCreateMatches(tournamentUniqueId);
      console.log(`[INFO] pairWinnersAndCreateMatches completed for tournament ${tournamentUniqueId}`);
    } else {
      console.log(`[WARN] No tournament info found on fixture ${fixtureId}, skipping pairing.`);
    }

    console.log(`=== handleGameOver completed for fixture ${fixtureId} ===\n`);
  } catch (err) {
    console.error('[ERROR] Error in handleGameOver:', err);
  }
}


// --- Example placeholder for Telegram message sending ---


// Start game timer for room (broadcast every second)
// Start game timer for room (broadcast every second)
async function startGameTimer(fixtureId, room) {
  if (room.timerInterval) clearInterval(room.timerInterval);

  let timerLeft = await getRoomTimer(fixtureId);
  if (timerLeft === null) {
    timerLeft = TIMER_DURATION;
    await setRoomTimer(fixtureId, timerLeft);
  }

  room.timerInterval = setInterval(async () => {
    timerLeft--;
    if (timerLeft < 0) {
      clearInterval(room.timerInterval);
      room.timerInterval = null;

      room.status = "ended";

        // Delete the fixture from DB
    


      // Count pieces for both players
      let player1Count = 0;
      let player2Count = 0;
      for (const row of room.board) {
        for (const cell of row) {
          if (cell) {
            if (cell.player === 1) player1Count++;
            else if (cell.player === 2) player2Count++;
          }
        }
      }

      // Determine winner by piece count
      // Determine winner by piece count
let winner = 0;
if (player1Count > player2Count) {
  winner = 1;
} else if (player2Count > player1Count) {
  winner = 2;
}

// Save game result to DB

try {
  await saveGameResult(
    fixtureId,
    room.players[0]?.userId,
    room.players[1]?.userId,
    winner,
    room.board
  );
  console.log("Game result saved to DB (timer end)");
} catch (err) {
  console.error("Failed to save game result (timer end):", err);
}

await handleGameOver(fixtureId, winner, true); // call here

      await updateRoom(fixtureId, {
        players: room.players.map((p) => p.userId),
        status: room.status,
        board: room.board,
        currentPlayer: room.currentPlayer,
        timer: 0,
      });

      // Send different messages to winner and loser
      room.players.forEach((p, idx) => {
        if (p.socket) {
          if (winner === 0) {
            // Draw
            p.socket.emit("game-over", {
              winner: 0,
              message: `Time's up! It's a draw with equal pieces (${player1Count} vs ${player2Count}).`,
            });
          } else {
            const playerNumber = idx + 1;
            if (playerNumber === winner) {
              p.socket.emit("game-over", {
                winner,
                message: `Time's up! Congratulations, you win the game with more pieces (${
                  playerNumber === 1 ? player1Count : player2Count
                })!`,
              });
            } else {
              p.socket.emit("game-over", {
                winner,
                message: `Time's up! Sorry, you lose the game with fewer pieces (${
                  playerNumber === 1 ? player1Count : player2Count
                }).`,
              });
            }
          }
        }
      });
      return;
    }

    await setRoomTimer(fixtureId, timerLeft);

    room.players.forEach((p) => {
      if (p.socket)
        p.socket.emit("timer-update", { timeLeftSeconds: timerLeft });
    });
  }, 1000);
}

//Auto win checker
const FIVE_MINUTES = 5 * 60 * 1000; // 5 minutes in ms
const rooms = {}; // in-memory room cache




/**
 * Check and apply auto-win for a given fixture
 * @param {String} fixtureId
 */
function emitToRoom(room, event, payload) {
  room.players.forEach(p => p.socket?.emit(event, payload));
}



/**
 * Check and apply auto-win for a fixture
 * @param {String} fixtureId
 */
async function checkAutoWin(fixtureId) {
  try {
    const fixture = await Fixture.findById(fixtureId).lean();
    if (!fixture) return console.log(`[Auto Win] Fixture ${fixtureId} not found.`);

    const { matchTime, player1, player2 } = fixture;
    if (!matchTime) return console.log(`[Auto Win] Fixture ${fixtureId} has no matchTime.`);

    const room = rooms[fixtureId];
    const connectedPlayers = room
      ? room.players.filter(p => p.socket).map(p => p.userId)
      : [];

    // Skip auto-win if both players are connected
    if (
      connectedPlayers.length === 2 ||
      (player2 && connectedPlayers.includes(player1.toString()) && connectedPlayers.includes(player2.toString()))
    ) {
      return console.log(`[Auto Win] Both players have joined. Skipping auto-win.`);
    }

    // Check elapsed time
    const elapsed = new Date().getTime() - new Date(matchTime).getTime();
    if (elapsed < FIVE_MINUTES) {
      const waitTime = FIVE_MINUTES - elapsed;
      console.log(`[Auto Win] Waiting ${Math.ceil(waitTime / 1000)}s before auto-win...`);
      // Use a single scheduled check per fixture
      if (room) {
        clearTimeout(room.autoWinTimeout);
        room.autoWinTimeout = setTimeout(() => checkAutoWin(fixtureId), waitTime);
      } else {
        setTimeout(() => checkAutoWin(fixtureId), waitTime);
      }
      return;
    }

    // Determine winner
    let winnerObjectId;
    if (connectedPlayers.length === 1) {
      const winnerUser = await User.findOne({ telegram_id: connectedPlayers[0] }).lean();
      if (!winnerUser) return console.error(`[Auto Win] Player not found: ${connectedPlayers[0]}`);
      winnerObjectId = winnerUser._id;
      console.log(`[Auto Win] Only one player joined. Winner: ${winnerObjectId}`);
    } else {
      // No players joined → random winner
      const players = [player1, player2].filter(Boolean);
      winnerObjectId = players[Math.floor(Math.random() * players.length)];
      console.log(`[Auto Win] No players joined. Random winner: ${winnerObjectId}`);
    }

    const winnerNumber = fixture.player1.toString() === winnerObjectId.toString() ? 1 : 2;
    const loserNumber = winnerNumber === 1 ? 2 : 1;
    const loserObjectId = loserNumber === 1 ? fixture.player1 : fixture.player2;

    // Update fixture in DB
    await Fixture.findByIdAndUpdate(fixtureId, {
      result: winnerNumber,
      status: 'completed',
    });

    // Update in-memory room
    if (room) room.status = 'completed';

    // Notify via sockets
    if (room) {
      const winnerSocket = room.players.find(p => p.userId === winnerObjectId.toString())?.socket;
      const loserSocket = room.players.find(p => p.userId === loserObjectId.toString())?.socket;

      if (winnerSocket) winnerSocket.emit('game-over', { message: '🎉 You win! Auto-win applied.' });
      if (loserSocket) loserSocket.emit('game-over', { message: '😞 You lost. Auto-win applied.' });
    }

    // Notify via Telegram
    const [winnerUser, loserUser] = await Promise.all([
      User.findById(winnerObjectId).lean(),
      User.findById(loserObjectId).lean(),
    ]);

    if (winnerUser?.telegram_id) {
      sendTelegramMessage(winnerUser.telegram_id, `🎉 Auto-Win! You won the match for fixture ${fixtureId}.`);
    }
    if (loserUser?.telegram_id) {
      sendTelegramMessage(loserUser.telegram_id, `😞 Auto-Win applied! You lost the match for fixture ${fixtureId}.`);
    }

    console.log(`[Auto Win] Fixture ${fixtureId} completed. Winner: ${winnerObjectId}`);
  } catch (err) {
    console.error('[Error in checkAutoWin]:', err);
  }
}

// Make globally accessible
global.checkAutoWin = checkAutoWin;
global.FIVE_MINUTES = FIVE_MINUTES;
global.rooms = rooms;

console.log('[Auto Win Module] checkAutoWin loaded.');

module.exports = { checkAutoWin, FIVE_MINUTES, rooms };


// --------------------- Redis helpers ---------------------
async function getTurnTimer(fixtureId) {
  const val = await redisClient.get(`game:${fixtureId}:turnTimer`);
  return val !== null ? parseInt(val, 10) : null;
}

async function setTurnTimer(fixtureId, seconds) {
  await redisClient.set(`game:${fixtureId}:turnTimer`, seconds);
}

// --------------------- Turn timer logic ---------------------
async function resetTurnTimer(fixtureId) {
  const room = rooms[fixtureId];
  if (!room) return;

  // Clear existing interval
  if (room.turnTimerInterval) {
    clearInterval(room.turnTimerInterval);
    room.turnTimerInterval = null;
  }

  room.turnTimeRemaining = TURN_TIME;

  // Persist timer in Redis
  await setTurnTimer(fixtureId, TURN_TIME);

  // Emit initial timer update
  room.players.forEach(p => {
    if (p.socket) {
      p.socket.emit("turn-timer-update", { timeLeft: room.turnTimeRemaining });
    }
  });
}

async function swapTurn(fixtureId) {
  const room = rooms[fixtureId];
  if (!room) return;

  // Swap current player
  room.currentPlayer = room.currentPlayer === 1 ? 2 : 1;

  // Notify all players
  room.players.forEach((p, idx) => {
    if (p.socket) {
      p.socket.emit("turn-swapped", { 
        currentPlayer: room.currentPlayer, 
        yourTurn: idx + 1 === room.currentPlayer 
      });
    }
  });

  // Reset timer for new turn
  await resetTurnTimer(fixtureId);
  await startTurnTimer(fixtureId);
}

async function startTurnTimer(fixtureId) {
  const room = rooms[fixtureId];
  if (!room) return;

  // Clear interval if exists
  if (room.turnTimerInterval) {
    clearInterval(room.turnTimerInterval);
    room.turnTimerInterval = null;
  }

  // Load persisted timer from Redis or use default
  let timeLeft = await getTurnTimer(fixtureId);
  if (timeLeft === null) timeLeft = TURN_TIME;

  room.turnTimeRemaining = timeLeft;

  room.turnTimerInterval = setInterval(async () => {
    room.turnTimeRemaining--;

    // Persist timer
    await setTurnTimer(fixtureId, room.turnTimeRemaining);

    // Emit timer update
    room.players.forEach(p => {
      if (p.socket) {
        p.socket.emit("turn-timer-update", { timeLeft: room.turnTimeRemaining });
      }
    });

    // Time expired, swap turn
    if (room.turnTimeRemaining <= 0) {
      clearInterval(room.turnTimerInterval);
      room.turnTimerInterval = null;

      room.players.forEach(p => {
        if (p.socket) {
          p.socket.emit("turn-timeout", { currentPlayer: room.currentPlayer });
        }
      });

      await swapTurn(fixtureId);
    }
  }, 1000);
}


//arif pay
app.get("/payment-callback", async (req, res) => {
  const { chatId, tournamentType, sessionId } = req.query;

  try {
    const status = await arifpay.Check_payment_status(sessionId);

    if (!status.error && status.data.status === "success") {
      // Payment succeeded, register user
      const user = await User.findOne({ telegram_id: chatId });
      const typeDefaults = {
        Silver: { balance: 50, maxPlayers: 8 },
        Gold: { balance: 100, maxPlayers: 32 },
        Platinum: { balance: 200, maxPlayers: 64 },
      };
      const { balance, maxPlayers } = typeDefaults[tournamentType];

      let tournament = await Tournament.findOne({ type: tournamentType, status: 'open' }).populate('players');

      if (tournament) {
        tournament.players.push(user._id);
        if (tournament.players.length >= tournament.maxPlayers) tournament.status = 'full';
        await tournament.save();
      } else {
        tournament = new Tournament({ type: tournamentType, balance, maxPlayers, players: [user._id] });
        await tournament.save();
      }

      // Notify user via bot
      bot.sendMessage(chatId, `🎉 Payment successful! You are registered for the ${tournamentType} Tournament.\n` +
        `💰 Entry: ${tournament.balance} Birr\n👥 Players: ${tournament.players.length}/${tournament.maxPlayers}\n` +
        `🏷️ Tournament Code: ${tournament.uniqueId}`
      );

      res.send("Payment confirmed and registration complete!");
    } else {
      res.send("Payment is pending or failed.");
    }
  } catch (err) {
    console.error("Payment callback error:", err);
    res.status(500).send("Error verifying payment");
  }
});




async function createChapaPayment(amount, user, phone) {
  const payload = {
    amount: amount,
    currency: 'ETB',
    email: user.email || 'guest@example.com',
    first_name: user.name,
    last_name: '',
    tx_ref: `1v1-${user.telegram_id}-${Date.now()}`,
    phone_number: phone,
    callback_url: `${NGROK_URL}/api/chapa-callback?chatId=${user.telegram_id}&amount=${amount}`
  };

  const response = await axios.post('https://api.chapa.co/v1/transaction/initialize', payload, {
    headers: { Authorization: `Bearer ${CHAPA_API_KEY}` }
  });

  return response.data.data.checkout_url; // Chapa checkout URL
}




// --- SOCKET.IO CONNECTION ---
// Socket connection handler
io.on("connection", async (socket) => {
  const { fixtureId, userId } = socket.handshake.query;

  if (!fixtureId || !userId) {
    socket.emit("error", "Missing fixtureId or userId");
    socket.disconnect(true);
    return;
  }

  try {
    let room = rooms[fixtureId];
    const now = new Date();

    // Load room from Redis or create new
    if (!room) {
      const redisRoom = await getRoom(fixtureId);
      if (redisRoom) {
        room = {
          ...redisRoom,
          players: redisRoom.players.map(id => ({ userId: id, socket: null })),
          timerInterval: null,
          turnTimerInterval: null,
        };
        rooms[fixtureId] = room;
      } else {
        room = {
          players: [{ userId, socket }],
          status: "waiting",
          board: initializeNewBoard(),
          currentPlayer: 1,
          timerInterval: null,
          turnTimerInterval: null,
        };
        rooms[fixtureId] = room;

        // Record player1 join time
        try {
          const fixture = await Fixture.findById(fixtureId);
          if (fixture) {
            const userDoc = await User.findOne({ telegram_id: userId });
            if (userDoc && !fixture.player1JoinTime && fixture.player1.equals(userDoc._id)) {
              fixture.player1JoinTime = now;
              await fixture.save();
              console.log(`[Join Time] Player 1 (creator) join time recorded: ${fixture.player1JoinTime}`);
            }

            if (fixture.matchTime) {
              const delay = Math.max(0, fixture.matchTime.getTime() + FIVE_MINUTES - now.getTime());
              setTimeout(() => checkAutoWin(fixtureId), delay);
            }
          }
        } catch (err) {
          console.error("[Error recording creator join time]:", err);
        }

        await updateRoom(fixtureId, {
          players: [userId],
          status: room.status,
          board: room.board,
          currentPlayer: room.currentPlayer,
          timer: TIMER_DURATION,
        });
        await setRoomTimer(fixtureId, TIMER_DURATION);

        socket.emit("room-waiting", { message: "Waiting for opponent..." });
      }
    }

    // Add or update player socket
    const existingIndex = room.players.findIndex(p => p.userId === userId);
    if (existingIndex !== -1) {
      room.players[existingIndex].socket = socket;
      console.log(`[Room Join] Player ${userId} reconnected to room ${fixtureId}`);
    } else {
      if (room.players.length < 2) {
        room.players.push({ userId, socket });
        room.status = room.players.length === 2 ? "ready" : "waiting";
        console.log(`[Room Join] Player ${userId} joined room ${fixtureId}`);

        // Record player2 join time
        try {
          const fixture = await Fixture.findById(fixtureId);
          if (fixture) {
            const userDoc = await User.findOne({ telegram_id: userId });
            if (userDoc && !fixture.player2JoinTime && fixture.player2.equals(userDoc._id)) {
              fixture.player2JoinTime = now;
              await fixture.save();
              console.log(`[Join Time] Player 2 (joiner) join time recorded: ${fixture.player2JoinTime}`);
            }
          }
        } catch (err) {
          console.error("[Error recording joiner join time]:", err);
        }

        if (room.status === "ready") {
          room.players.forEach(p => p.socket.emit("room-ready", { message: "Opponent joined! Game ready." }));

          // ✅ Start turn timer for ready game
          await startTurnTimer(fixtureId);
        }

        await updateRoom(fixtureId, {
          players: room.players.map(p => p.userId),
          status: room.status,
          board: room.board,
          currentPlayer: room.currentPlayer,
          timer: (await getRoomTimer(fixtureId)) ?? TIMER_DURATION,
        });

        if (room.status === "ready") startGameTimer(fixtureId, room);
      } else {
        socket.emit("room-full");
        socket.disconnect(true);
        return;
      }
    }

    // Sync state to player
    if (room.status === "waiting") {
      socket.emit("room-waiting", { message: "Waiting for opponent...", matchTime: room.matchTime });
    } else if (room.status === "ready") {
      const timerLeft = (await getTurnTimer(fixtureId)) ?? TURN_TIME;

      room.players.forEach((p, idx) => {
        if (p.socket) {
          p.socket.emit("room-ready", {
            playerNumber: idx + 1,
            board: room.board,
            currentPlayer: room.currentPlayer,
            yourTurn: idx + 1 === room.currentPlayer,
          });
          p.socket.emit("turn-timer-update", { timeLeft: timerLeft });
        }
      });

      // Ensure turn timer is running
      if (!room.turnTimerInterval) await startTurnTimer(fixtureId);

      if (!room.timerInterval) startGameTimer(fixtureId, room);
    } else if (room.status === "completed") {
      socket.emit("timer-expired");
    }

  } catch (err) {
    console.error("[Error in connection handler]:", err);
  }
;


  // Reconnect request (client asks for current state)
  socket.on("reconnect-request", async () => {
    const idx = room.players.findIndex((p) => p.userId === userId);
    if (idx !== -1) {
      const timerLeft = (await getRoomTimer(fixtureId)) ?? TIMER_DURATION;
      socket.emit("reconnected", {
        playerNumber: idx + 1,
        board: room.board,
        currentPlayer: room.currentPlayer,
        status: room.status,
        yourTurn: idx + 1 === room.currentPlayer,
      });
      socket.emit("timer-update", { timeLeftSeconds: timerLeft });

      // Notify opponent
     room.players.forEach((p) => {
  if (p.userId.toString() === winnerObjectId.toString()) {
    // winner found
  }
});

    }
  });

  // Helper function: check if any piece of the player can capture
  function playerHasAnyCaptures(board, player) {
    for (let r = 0; r < 8; r++) {
      for (let c = 0; c < 8; c++) {
        const piece = board[r][c];
        if (piece && piece.player === player) {
          if (hasFurtherCapture(board, { row: r, col: c }, player)) {
            return true;
          }
        }
      }
    }
    return false;
  }

  socket.on("make-move", async (move) => {
  try {
    const { fixtureId, userId } = socket.handshake.query;
    const room = rooms[fixtureId];
    if (!room || room.status !== "ready") return;

    const playerIndex = room.players.findIndex((p) => p.socket === socket);
    if (playerIndex === -1) return;
    const playerNumber = playerIndex + 1;

    if (playerNumber !== room.currentPlayer) {
      socket.emit("error", "Not your turn");
      return;
    }

    console.log(`[Make Move] Player ${playerNumber} is making a move`, move);

    // --- UPDATE BOARD STATE ---
    applyMoveToBoard(room.board, move);

    // --- KING PROMOTION LOGIC ---
    const piece = room.board[move.to.row][move.to.col];
    if (piece && !piece.king) {
      const reachedEnd =
        (piece.player === 1 && move.to.row === 0) ||
        (piece.player === 2 && move.to.row === 7);
      if (reachedEnd && !(move.capture && hasFurtherCapture(room.board, move.to, piece.player))) {
        piece.king = true;
        console.log(`[King Promotion] Player ${piece.player} piece promoted at row ${move.to.row}, col ${move.to.col}`);
      }
    }

    // --- MULTI-CAPTURE LOGIC ---
    if (move.capture) {
      const furtherCapture = hasFurtherCapture(room.board, move.to, piece.player);
      if (furtherCapture) {
        room.players.forEach((p, idx) => {
          if (p.socket) {
            p.socket.emit("move-made", {
              move,
              board: room.board,
              currentPlayer: room.currentPlayer,
              yourTurn: idx + 1 === room.currentPlayer,
              multiCapture: true,
            });
          }
        });

        // Save state without swapping turn
        await updateRoom(fixtureId, {
          players: room.players.map((p) => p.userId),
          status: room.status,
          board: room.board,
          currentPlayer: room.currentPlayer,
          timer: (await getTurnTimer(fixtureId)) ?? TURN_TIME,
        });

        return; // Do not swap turn yet
      }
    }

    // --- SWAP TURN ---
    room.currentPlayer = room.currentPlayer === 1 ? 2 : 1;

    // ✅ Reset and persist turn timer in Redis
     await resetTurnTimer(fixtureId);
     await startTurnTimer(fixtureId);

    console.log(`[Turn Swap] Next player: ${room.currentPlayer}`);

    // --- CHECK GAME OVER ---
    const opponent = room.currentPlayer;
    const opponentHasPieces = room.board.some((row) =>
      row.some((cell) => cell && cell.player === opponent)
    );
    const opponentHasMoves =
      playerHasAnyCaptures(room.board, opponent) ||
      hasAnyValidMoves(room.board, opponent);

    console.log(`[Game Over Check] Player ${opponent} has pieces: ${opponentHasPieces}, has moves: ${opponentHasMoves}`);

    if (!opponentHasPieces || !opponentHasMoves) {
      room.status = "ended";
      console.log("[Winner Detection] Determining winner...");

      const fixture = await Fixture.findById(fixtureId);
      if (!fixture) return;

      const winnerPlayerNumber = opponent === 1 ? 2 : 1;
      const winnerPlayerIndex = winnerPlayerNumber - 1;
      const winnerPlayer = room.players[winnerPlayerIndex];

      if (!winnerPlayer || !winnerPlayer.userId) return;

      const winnerTelegramId = winnerPlayer.userId;
      const winnerUserDoc = await User.findOne({ telegram_id: winnerTelegramId });
      if (!winnerUserDoc) return;

      let winnerNumber;
      if (winnerUserDoc._id.equals(fixture.player1)) winnerNumber = 1;
      else if (fixture.player2 && winnerUserDoc._id.equals(fixture.player2)) winnerNumber = 2;
      else return;

      room.players.forEach((p) => {
        if (!p.socket) return;
        if (p.userId === winnerTelegramId) {
          p.socket.emit("game-over", { message: "🎉 Congratulations! You win the match!" });
        } else {
          p.socket.emit("game-over", { message: "😞 Sorry! You lost the game." });
        }
      });

      // --- SAVE ROOM STATE IN REDIS ---
      await updateRoom(fixtureId, {
        players: room.players.map((p) => p.userId),
        status: room.status,
        board: room.board,
        currentPlayer: room.currentPlayer,
        timer: 0,
      });

      await handleGameOver(fixtureId, winnerNumber, false, room.board);
      return;
    }

    // --- SAVE ROOM STATE IN REDIS ---
    await updateRoom(fixtureId, {
      players: room.players.map((p) => p.userId),
      status: room.status,
      board: room.board,
      currentPlayer: room.currentPlayer,
      timer: (await getTurnTimer(fixtureId)) ?? TURN_TIME,
    });

    // --- BROADCAST MOVE TO PLAYERS ---
    room.players.forEach((p, idx) => {
      if (p.socket) {
        p.socket.emit("move-made", {
          move,
          board: room.board,
          currentPlayer: room.currentPlayer,
          yourTurn: idx + 1 === room.currentPlayer,
          multiCapture: false,
        });
      }
    });
  } catch (err) {
    console.error("[Error in make-move]:", err);
  }
});

  // Handle disconnects
 socket.on("disconnect", async () => {
    try {
      const room = rooms[fixtureId]; // fetch room again to ensure defined
      if (!room) return;

      // Remove socket reference (keep userId for reconnect)
      room.players = room.players.map((p) =>
        p.socket === socket ? { userId: p.userId, socket: null } : p
      );

      // Notify opponent(s)
      room.players.forEach((p) => {
        if (p.socket) p.socket.emit("opponent-disconnected");
      });

      // Save current state in Redis
      await updateRoom(fixtureId, {
        players: room.players.map((p) => p.userId),
        status: room.status,
        board: room.board,
        currentPlayer: room.currentPlayer,
        timer: (await getRoomTimer(fixtureId)) ?? TIMER_DURATION,
      });

      console.log(
        `Player disconnected from room ${fixtureId}. Connected players: ${
          room.players.filter((p) => p.socket).length
        }`
      );
    } catch (err) {
      console.error("[Error in disconnect handler]:", err);
    }
  });

   
});


const dama = io.of('/dama');
const BOARD_SIZE = 8;

// ---------------------------
// Socket Connections
// ---------------------------
// =====================
// TURN TIMER (1v1 Dama)
// =====================
// =====================
// TURN TIMER (1v1 Dama)
// =====================
const roomTimers = new Map();

/**
 * Start or continue the turn timer for a room.
 * Automatically swaps turns when time runs out.
 */
async function startTurnTimer1V1(roomId, io) {
  // Clear any existing timer for safety
  if (roomTimers.has(roomId)) {
    clearInterval(roomTimers.get(roomId));
    roomTimers.delete(roomId);
  }

  let timeLeft = 30; // default turn time

  const interval = setInterval(async () => {
    try {
      // Fetch latest room state
      const room = await getRoomDama1V1(roomId);
      if (!room || !room.gameState) {
        console.log(`❌ Timer stopped: Room ${roomId} not active`);
        clearInterval(interval);
        roomTimers.delete(roomId);
        return;
      }

      // Only run timer if game is started
      if (room.gameState.status !== 'started') return;

      // Decrease timer
      timeLeft--;
      room.gameState.turnTime = timeLeft;

      // Save updated game state
      await saveGameState(roomId, room.gameState);

      // Notify clients of timer
      io.to(roomId).emit('turnTimerUpdate', {
        timeLeft,
        currentTurn: room.gameState.currentTurn
      });

      // -----------------------------
      // Handle timeout
      // -----------------------------
      if (timeLeft <= 0) {
        const currentPlayer = room.gameState.currentTurn;
        const opponent = Object.keys(room.gameState.colors).find(id => id !== currentPlayer);

        console.log(`⏰ Player ${currentPlayer} ran out of time in room ${roomId}. Swapping turn to ${opponent}`);

        // Swap turn to opponent
        room.gameState.currentTurn = opponent;
        room.gameState.turnTime = 30; // reset timer

        // Save updated game state
        await saveGameState(roomId, room.gameState);

        // Emit timeout event
        io.to(roomId).emit('turnTimeout', {
          previousPlayer: currentPlayer,
          nextPlayer: opponent,
          message: `⏰ Player ${currentPlayer} ran out of time. Turn passed to ${opponent}`
        });

        // 🔹 Emit full game state so front-end re-renders board automatically
        io.to(roomId).emit('gameState', room.gameState);

        // Restart timer for next player
        clearInterval(interval);
        roomTimers.delete(roomId);
        startTurnTimer1V1(roomId, io);
      }
    } catch (err) {
      console.error(`❌ Error in turn timer for room ${roomId}:`, err);
      clearInterval(interval);
      roomTimers.delete(roomId);
    }
  }, 1000);

  // Save interval reference
  roomTimers.set(roomId, interval);
}

/**
 * Reset turn timer manually (called after a valid player move)
 */
async function resetTurnTimer1V1(roomId, io) {
  console.log(`🔄 Resetting turn timer for room ${roomId}`);

  // Clear existing timer
  if (roomTimers.has(roomId)) {
    clearInterval(roomTimers.get(roomId));
    roomTimers.delete(roomId);
  }

  const room = await getRoomDama1V1(roomId);
  if (!room || !room.gameState || room.gameState.status !== 'started') return;

  // Reset timer for current player
  room.gameState.turnTime = 30;
  await saveGameState(roomId, room.gameState);

  // 🔹 NEW: Emit the updated game state so both players see changes immediately
  io.to(roomId).emit('gameState', room.gameState);

  // Start a new timer
  startTurnTimer1V1(roomId, io);
}



// =====================
// SOCKET CONNECTION
// =====================
dama.on('connection', (socket) => {
  console.log(`✅ Player connected: ${socket.id}`);

  // -----------------------
  // Join Game Room
  // -----------------------
  socket.on('joinGameRoom', async ({ roomId, playerId, userName }) => {
    try {
      socket.join(roomId);

      const { room, created, error } = await createOrJoinRoomDama1V1(roomId, playerId, 0, userName);
      if (error) return socket.emit('errorMessage', error);

      if (created) {
        room.gameState = {
          board: initializeBoard(),
          colors: { [playerId]: 'red' },
          currentTurn: playerId,
          status: 'waiting',
          winner: null,
          turnTime: 30
        };
      } else {
        room.gameState.colors = room.gameState.colors || {};
        if (!room.gameState.colors[playerId]) {
          room.gameState.colors[playerId] = Object.values(room.gameState.colors).includes('red') ? 'green' : 'red';
        }
      }

      // Start game if 2 players
      if (room.players.length === 2 && room.gameState.status !== 'started') {
        room.gameState.status = 'started';
        await saveGameState(roomId, room.gameState);

        // Start first turn timer
        await startTurnTimer1V1(roomId, dama);
      } else {
        await saveGameState(roomId, room.gameState);
      }

      dama.to(roomId).emit('gameState', room.gameState);

    } catch (err) {
      console.error(err);
      socket.emit('errorMessage', 'Internal server error');
    }
  });

  // -----------------------
  // Player Move
  // -----------------------
  const OneVOneResult = require('./models/1V1result');
  const User = require('./models/user');
  const stakePercentage = 0.9; // 10% fee applied

socket.on('playerMove', async ({ roomId, playerId, fromRow, fromCol, toRow, toCol, captured }) => {
  try {
    console.log(`🎯 Player ${playerId} made a move in room ${roomId}`);

    const move = {
      from: { row: fromRow, col: fromCol },
      to: { row: toRow, col: toCol },
      capture: captured ? { row: captured[0], col: captured[1] } : null
    };

    // Apply the move logic
    const { success, gameState, multiCapture, error } = await applyMove(roomId, move, playerId, dama);
    if (!success) {
      console.warn(`⚠️ Invalid move by ${playerId}: ${error}`);
      return socket.emit('errorMessage', error);
    }

    // Fetch latest room
    const room = await getRoomDama1V1(roomId);
    if (!room) return console.warn(`⚠️ Room ${roomId} not found after move`);

    // Update room gameState
    room.gameState = gameState;

    // -----------------------------
    // Swap turn & reset timer
    // -----------------------------
    if (gameState.status === 'started' && !multiCapture) {
      const nextPlayer = Object.keys(room.gameState.colors).find(id => id !== playerId);
      room.gameState.currentTurn = nextPlayer;
      console.log(`🔄 Turn swapped: ${playerId} ➜ ${nextPlayer}`);

      await saveGameState(roomId, room.gameState);

      // Reset turn timer — client will refresh page on reset
      await resetTurnTimer1V1(roomId, dama);
    } else if (multiCapture) {
      console.log(`🔁 Multi-capture — ${playerId} keeps the turn`);
      await saveGameState(roomId, room.gameState);
    }

    // -----------------------------
    // Broadcast updated game state
    // -----------------------------
    dama.to(roomId).emit('gameState', room.gameState);
    console.log('📡 Updated gameState broadcasted successfully');

    // -----------------------------
    // Handle game finish
    // -----------------------------
    if (gameState.status === 'finished' && gameState.winner) {
      const stake = room?.betAmount || 0;
      const winningAmount = stake * 2 * 0.9; // 10% fee
      const winnerId = gameState.winner;

      console.log(`🏁 Game finished! Winner: ${winnerId}`);

      // Update winner balance
      const winnerUser = await User.findOne({ telegramId: winnerId });
      let newBalance = null;
      if (winnerUser) {
        winnerUser.oneVsOne_balance = (winnerUser.oneVsOne_balance || 0) + winningAmount;
        await winnerUser.save();
        newBalance = winnerUser.oneVsOne_balance;
        console.log(`💰 Updated winner balance: ${newBalance}`);
      }

      // Record match result
      if (room.players.length === 2) {
        await OneVOneResult.create({
          roomId,
          player1: { id: room.players[0], name: room.players[0] },
          player2: { id: room.players[1], name: room.players[1] },
          winner: winnerId,
          totalStake: stake * 2
        });
      }

      // Notify clients
      dama.to(roomId).emit('gameOver', {
        winnerId,
        message: `🏆 Player ${winnerId} wins!`,
        winningAmount,
        newBalance
      });

      // Cleanup
      if (roomTimers.has(roomId)) {
        clearInterval(roomTimers.get(roomId));
        roomTimers.delete(roomId);
      }
      await deleteRoomDama1V1(roomId);
      console.log(`🧹 Room ${roomId} cleaned up after game end`);
    }

  } catch (err) {
    console.error(`❌ playerMove error in room ${roomId}:`, err);
    socket.emit('errorMessage', 'Internal server error');
  }
});



  // -----------------------
  // Player Disconnect / Leave
  // -----------------------
  socket.on('dislink', async ({ roomId, playerId }) => {
    const leavingPlayerId = playerId || socket.id;

    const targetRooms = roomId
      ? [{ roomId }]
      : (await getAllRoomsDama1V1())
          .filter(r => r.players.includes(leavingPlayerId))
          .map(r => ({ roomId: r.roomId }));

    for (const r of targetRooms) {
      const room = await getRoomDama1V1(r.roomId);
      if (!room) continue;

      if (room.gameState.status === 'finished' || room.gameState.winner) {
        room.players = room.players.filter(p => p !== leavingPlayerId);
        delete room.gameState.colors[leavingPlayerId];

        if (room.players.length === 0) {
          if (roomTimers.has(r.roomId)) {
            clearInterval(roomTimers.get(r.roomId));
            roomTimers.delete(r.roomId);
          }
          await deleteRoomDama1V1(r.roomId);
        } else {
          await saveGameState(r.roomId, room.gameState);
          dama.to(r.roomId).emit('gameState', room.gameState);
        }

        socket.to(r.roomId).emit('playerLeft', { playerId: leavingPlayerId });
      } else {
        dama.to(r.roomId).emit('playerDisconnected', { playerId: leavingPlayerId });
      }
    }
  });

  // -----------------------
  // Reconnect Player
  // -----------------------
  const disconnectedPlayers = {};
  socket.on('reconnectPlayer', ({ roomId, playerId }) => {
    if (disconnectedPlayers[playerId]) {
      clearTimeout(disconnectedPlayers[playerId]);
      delete disconnectedPlayers[playerId];
      console.log(`🔹 Player ${playerId} reconnected`);
    }
  });
});




// Note: Legacy webhook handlers removed. Use routes in ./routes/payments.js under /api.

// ✅ View withdrawals
app.get('/withdrawals', (req, res) => res.json(withdrawals));

// Start server (use same HTTP server as socket.io)
server.listen(PORT, () => {
  console.log(`🚀 Server running on http://localhost:${PORT}`);
  try { startReconcileScheduler(); } catch {}
});