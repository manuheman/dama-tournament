

require('dotenv').config(); // MUST be first

const express = require("express");
const mongoose = require("mongoose");
const bodyParser = require("body-parser");
const path = require("path");
const http = require("http");
const { Server } = require("socket.io");
const bot = require("./bot");
const Fixture = require("./models/fixture");  // adjust path as needed
const User = require('./models/user'); // adjust path as needed
const Tournament = require('./models/tournament')




// Redis Client and room functions (assumed implemented)
const {
  redisClient,
  createOrJoinRoom,
  getRoom,
  updateRoom,
  deleteRoom,
} = require("./utils/redisClient");

const app = express();
const PORT = process.env.PORT || 4000; // change from 3000
const server = http.createServer(app);
const io = new Server(server);
// ====== Constants ======


const TIMER_DURATION = 600; // 10 minutes in seconds


// MongoDB connection
mongoose
  .connect(
    process.env.MONGO_URL || "mongodb://localhost:27017/my_node_project",
    {
      useNewUrlParser: true,
      useUnifiedTopology: true,
    }
  )
  .then(() => console.log("✅ MongoDB connected"))
  .catch((err) => console.error("❌ MongoDB connection error:", err));

// Middleware
app.use(bodyParser.json());
app.use(express.json()); // must be BEFORE routes
app.use(express.static(path.join(__dirname, "public")));

const paymentRoutes = require("./routes/PaymentRoutes");

app.use("/api", paymentRoutes);

// Telegram bot webhook
;

const TelegramBot = require('node-telegram-bot-api');
const axios = require('axios');

// ✅ Load token & ngrok url from env
const TELEGRAM_BOT_TOKEN =
  process.env.TELEGRAM_BOT_TOKEN || '7707852242:AAFj5rrpS82yaUZHfbM6QqA7RZMji1d5HIo';
const NGROK_URL =
  process.env.NGROK_URL || 'https://20a4bcbca83d.ngrok-free.app';

// ✅ Initialize bot (Express will handle requests)
global.bot = new TelegramBot(TELEGRAM_BOT_TOKEN, { webHook: true });

// ✅ Function to set webhook only once
async function initWebhook() {
  try {
    const url = `${NGROK_URL}/bot${TELEGRAM_BOT_TOKEN}`;

    // check existing webhook
    const res = await axios.get(
      `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/getWebhookInfo`
    );

    if (res.data.result.url !== url) {
      // set webhook if not already set
      await axios.post(
        `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/setWebhook`,
        { url }
      );
      console.log(`[Webhook] Set to: ${url}`);
    } else {
      console.log(`[Webhook] Already set to: ${url}`);
    }
  } catch (err) {
    console.error('[Webhook] Error setting webhook:', err.response?.data || err.message);
  }
}

initWebhook();

console.log('[Telegram Bot Initialized]');

// ✅ Webhook endpoint for Telegram
app.post(`/bot${TELEGRAM_BOT_TOKEN}`, (req, res) => {
  bot.processUpdate(req.body);
  res.sendStatus(200);
});

// Root route
app.get("/", (req, res) => res.send("✅ Node.js Server is running"));

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

// notification.js

function sendTelegramMessage(telegramId, message) {
  if (!telegramId) {
    console.log(`[TELEGRAM] No telegramId provided, message not sent.`);
    return;
  }

  bot.sendMessage(telegramId, message)
    .then(() => {
      console.log(`[TELEGRAM] ✅ Message sent successfully to ${telegramId}`);
    })
    .catch((err) => {
      console.error(`[TELEGRAM] ❌ Failed to send message to ${telegramId}:`, err.message);
    });
}


// Initialize new board (standard Ethiopian Dama start)
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

// Apply a move to a board (mutates board)
function applyMoveToBoard(board, move) {
  const { from, to, capture } = move;
  board[to.row][to.col] = board[from.row][from.col];
  board[from.row][from.col] = null;
  if (capture) board[capture.row][capture.col] = null;
}


//result saver

const GameResult = require("./models/Gameresult");

/**
 * Save a game result to the database.
 *
 * @param {string} fixtureId - The ID of the fixture (match).
 * @param {string} player1Id - MongoDB ObjectId string for player 1.
 * @param {string|null} player2Id - MongoDB ObjectId string for player 2, or null if no opponent.
 * @param {number} winner - Number indicating winner: 0 = draw, 1 = player1 wins, 2 = player2 wins.
 * @param {Array} finalBoard - Final board state array.
 *
 * @throws Will throw an error if required data is missing or save fails.
 */
async function saveGameResult(fixtureId, player1TelegramId, player2TelegramId, winner, finalBoard) {
  try {
    const fixture = await Fixture.findById(fixtureId).populate('tournament');
    if (!fixture) throw new Error('Fixture not found');

    const tournamentUniqueId = fixture.tournament?.uniqueId || null;

    // Fetch players by telegram_id (assuming IDs passed are telegram IDs)
    const player1 = await User.findOne({ telegram_id: player1TelegramId }).lean();
    if (!player1) throw new Error('Player 1 not found');

    let player2 = null;
    if (player2TelegramId) {
      player2 = await User.findOne({ telegram_id: player2TelegramId }).lean();
      if (!player2) throw new Error('Player 2 not found');
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
    console.log('Game result saved with tournamentUniqueId:', tournamentUniqueId);
  } catch (err) {
    console.error('Error saving game result:', err);
    throw err;
  }
}



// Check if a given piece at position can capture again
function hasFurtherCapture(board, pos, player) {
  const directions = [
    { dr: -1, dc: -1 },
    { dr: -1, dc: 1 },
    { dr: 1, dc: -1 },
    { dr: 1, dc: 1 },
  ];

  const piece = board[pos.row][pos.col];
  if (!piece || piece.player !== player) return false;

  // Allow all directions for capturing, regardless of king status
  for (const { dr, dc } of directions) {
    const enemyRow = pos.row + dr;
    const enemyCol = pos.col + dc;
    const jumpRow = pos.row + 2 * dr;
    const jumpCol = pos.col + 2 * dc;

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
      return true; // Can still capture
    }
  }

  return false;
}

//game over checker function
function hasAnyValidMoves(board, player) {
  const directions = [
    { dr: -1, dc: -1 },
    { dr: -1, dc: 1 },
    { dr: 1, dc: -1 },
    { dr: 1, dc: 1 },
  ];

  // Helper to get valid moves for a piece at (r,c)
  function getValidMovesForPiece(r, c) {
    const p = board[r][c];
    if (!p || p.player !== player) return [];

    let moves = [];

    if (p.king) {
      // King moves any distance diagonally
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
      // Normal piece moves
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
      if (moves.length > 0) return moves; // must capture if possible

      // No captures: forward moves only
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

  // Check all pieces for player
  for (let r = 0; r < 8; r++) {
    for (let c = 0; c < 8; c++) {
      if (board[r][c] && board[r][c].player === player) {
        if (getValidMovesForPiece(r, c).length > 0) return true;
      }
    }
  }

  return false;
}

// Redis timer helpers
async function getRoomTimer(fixtureId) {
  try {
    const val = await redisClient.get(`game:${fixtureId}:timer`);
    return val !== null ? parseInt(val, 10) : null;
  } catch (err) {
    console.error("Redis getRoomTimer error:", err);
    return null;
  }
}

async function setRoomTimer(fixtureId, seconds) {
  try {
    await redisClient.set(
      `game:${fixtureId}:timer`,
      seconds,
      "EX",
      TIMER_DURATION
    );
  } catch (err) {
    console.error("Redis setRoomTimer error:", err);
  }
}
// --- PAIR WINNERS & CREATE MATCHES (with detailed logging) ---
async function pairWinnersAndCreateMatches(tournamentUniqueId) {
  if (!tournamentUniqueId) throw new Error('Invalid tournamentUniqueId format');

  const tournament = await Tournament.findOne({ uniqueId: tournamentUniqueId });
  if (!tournament) throw new Error('Tournament not found');

  console.log(`\n=== Pair Winners & Create Matches for tournament ${tournamentUniqueId} ===`);

  // Determine the last round with completed fixtures
  const lastCompletedFixture = await Fixture.find({ tournament: tournament._id, status: 'completed' })
    .sort({ round: -1 })
    .limit(1)
    .lean();

  const lastCompletedRound = lastCompletedFixture.length > 0 ? lastCompletedFixture[0].round : 0;
  const roundToPair = lastCompletedRound;

  // Collect winners from that round
  const completedFixtures = await Fixture.find({ tournament: tournament._id, round: roundToPair, status: 'completed' });
  if (completedFixtures.length === 0) {
    console.log(`[INFO] No completed fixtures found for round ${roundToPair}. Cannot pair winners.`);
    return;
  }

  const winners = completedFixtures.map(f => (f.result === 1 ? f.player1.toString() : f.player2?.toString())).filter(Boolean);
  const uniqueWinners = Array.from(new Set(winners));

  console.log(`[INFO] Round ${roundToPair} winners:`, uniqueWinners);

  if (uniqueWinners.length === 1) {
    console.log(`[INFO] Tournament ${tournamentUniqueId} final winner: ${uniqueWinners[0]}`);
    tournament.winner = uniqueWinners[0];
    tournament.status = 'finished';
    await tournament.save();

    const winnerUser = await User.findById(uniqueWinners[0]);
    if (winnerUser?.telegram_id) sendTelegramMessage(winnerUser.telegram_id, `🎉 Congratulations! You are the final winner!`);
    return;
  }

  if (uniqueWinners.length < 2) {
    console.log('[INFO] Not enough winners to create next round matches.');
    return;
  }

  // Create next round fixtures
  const nextRound = roundToPair + 1;
  const newFixtures = [];

  for (let i = 0; i < uniqueWinners.length; i += 2) {
    const player1 = uniqueWinners[i];
    const player2 = uniqueWinners[i + 1] || null;

    const fixture = await Fixture.create({
      tournament: tournament._id,
      player1,
      player2,
      status: 'waiting',
      round: nextRound,
      board: [],
    });

    newFixtures.push(fixture._id);
    console.log(`[INFO] Created Round ${nextRound} fixture ${fixture._id}: ${player1} vs ${player2 || 'BYE'}`);
  }

  tournament.fixtures.push(...newFixtures);
  tournament.currentRound = nextRound;
  await tournament.save();

  console.log(`[INFO] Tournament ${tournamentUniqueId} updated with ${newFixtures.length} new fixtures for Round ${nextRound}`);
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
async function checkAutoWin(fixtureId) {
  try {
    const fixture = await Fixture.findById(fixtureId);
    if (!fixture) {
      console.log(`[Auto Win] Fixture ${fixtureId} not found.`);
      return;
    }

    const { matchTime, player1, player2 } = fixture;
    if (!matchTime) {
      console.log(`[Auto Win] Fixture ${fixtureId} has no matchTime set yet.`);
      return;
    }

    const now = new Date();
    const room = rooms[fixtureId];

    // Get connected player IDs from sockets
    const connectedPlayers = room
      ? room.players.filter(p => p.socket).map(p => p.userId)
      : [];

    // Skip auto-win if both players are connected
    if (
      connectedPlayers.length === 2 ||
      (player2 &&
        connectedPlayers.includes(player1.toString()) &&
        connectedPlayers.includes(player2.toString()))
    ) {
      console.log(`[Auto Win] Both players have joined. Skipping auto-win.`);
      return;
    }

    // Calculate elapsed time
    const elapsed = now.getTime() - matchTime.getTime();
    if (elapsed < FIVE_MINUTES) {
      const waitTime = FIVE_MINUTES - elapsed;
      console.log(`[Auto Win] 5 minutes not reached yet. Waiting ${waitTime / 1000}s...`);
      setTimeout(() => checkAutoWin(fixtureId), waitTime);
      return;
    }

    console.log(`[Auto Win] 5 minutes passed since matchTime.`);

    let winnerObjectId;

    if (connectedPlayers.length === 1) {
      // Only one player joined → they win
      const winnerUser = await User.findOne({ telegram_id: connectedPlayers[0] });
      if (!winnerUser) {
        console.error(`[Auto Win] Connected player not found: ${connectedPlayers[0]}`);
        return;
      }
      winnerObjectId = winnerUser._id;
      console.log(`[Auto Win] Only one player joined. Winner ObjectId: ${winnerObjectId}`);
    } else if (connectedPlayers.length === 0) {
      // Neither joined → pick random winner
      const players = [player1, player2].filter(Boolean);
      winnerObjectId = players[Math.floor(Math.random() * players.length)];
      console.log(`[Auto Win] No players joined. Random winner ObjectId: ${winnerObjectId}`);
    }

    // Determine winner/loser numbers
    const winnerNumber = fixture.player1.equals(winnerObjectId) ? 1 : 2;
    const loserNumber = winnerNumber === 1 ? 2 : 1;
    const loserObjectId = loserNumber === 1 ? fixture.player1 : fixture.player2;

    // Update fixture
    fixture.result = winnerNumber;
    fixture.status = "completed";
    await fixture.save();
    if (room) room.status = "completed";

    // Notify players via sockets
    if (room) {
      const winnerSocket = room.players.find(p => p.userId === winnerObjectId?.toString())?.socket;
      const loserSocket = room.players.find(p => p.userId === loserObjectId?.toString())?.socket;

      if (winnerSocket) winnerSocket.emit("game-over", { message: "🎉 You win! Auto-win applied." });
      if (loserSocket) loserSocket.emit("game-over", { message: "😞 You lost. Auto-win applied." });
    }

    // ✅ Notify players via Telegram
    const winnerUser = await User.findById(winnerObjectId).lean();
    const loserUser = await User.findById(loserObjectId).lean();

    if (winnerUser?.telegram_id) {
      sendTelegramMessage(winnerUser.telegram_id, `🎉 Auto-Win! You won the match for fixture ${fixture._id}.`);
    }
    if (loserUser?.telegram_id) {
      sendTelegramMessage(loserUser.telegram_id, `😞 Auto-Win applied! You lost the match for fixture ${fixture._id}.`);
    }

    console.log(`[Auto Win] Fixture ${fixtureId} completed. Winner ObjectId: ${winnerObjectId}`);
  } catch (err) {
    console.error("[Error in checkAutoWin]:", err);
  }
}

// Make globally accessible
global.checkAutoWin = checkAutoWin;
global.FIVE_MINUTES = FIVE_MINUTES;
global.rooms = rooms;

console.log('[Auto Win Module] checkAutoWin loaded and attached to global scope.');

module.exports = { checkAutoWin, FIVE_MINUTES, rooms };



// --------------------- Redis helpers ---------------------
const TURN_TIME = 30; // 30 seconds per turn

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
// Start server

server.listen(PORT, () => {
  console.log(`🚀 Server running at http://localhost:${PORT}`);
});
