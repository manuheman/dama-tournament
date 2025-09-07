const express = require('express');
const router = express.Router();
const Fixture = require('../models/fixture');
const Tournament = require('../models/tournament');
const GameRoom = require('../models/gameroom');

// Note: checkAutoWin, FIVE_MINUTES, and rooms are attached to global scope in server.js
// Do NOT require them here; use global.checkAutoWin etc.

// telegramHelper.js OR at top of your fixtures router
function sendMatchTimeNotification(fixture) {
  if (!global.bot) {
    console.warn('[Telegram Notification]: bot not initialized');
    return;
  }

  const message = `🕒 Your match is scheduled at ${fixture.matchTime?.toLocaleString() || 'TBD'}`;

  if (fixture.player1?.telegram_id) {
    global.bot.sendMessage(fixture.player1.telegram_id, message)
      .then(() => console.log(`[Telegram Notification Sent]: Player 1 (${fixture.player1.telegram_id}) for Fixture ${fixture._id}`))
      .catch(err => console.error(`[Telegram Notification Failed]: Player 1 (${fixture.player1.telegram_id}) for Fixture ${fixture._id}`, err));
  } else {
    console.log(`[Telegram Notification Skipped]: Player 1 missing telegram_id for Fixture ${fixture._id}`);
  }

  if (fixture.player2?.telegram_id) {
    global.bot.sendMessage(fixture.player2.telegram_id, message)
      .then(() => console.log(`[Telegram Notification Sent]: Player 2 (${fixture.player2.telegram_id}) for Fixture ${fixture._id}`))
      .catch(err => console.error(`[Telegram Notification Failed]: Player 2 (${fixture.player2.telegram_id}) for Fixture ${fixture._id}`, err));
  } else {
    console.log(`[Telegram Notification Skipped]: Player 2 missing telegram_id for Fixture ${fixture._id}`);
  }
}

module.exports = { sendMatchTimeNotification };


// GET all fixtures (with roomId info)
router.get('/', async (req, res) => {
  try {
    const fixtures = await Fixture.find()
      .populate('tournament', 'uniqueId type balance')
      .populate('player1', 'telegram_username name')
      .populate('player2', 'telegram_username name');

    const gameRooms = await GameRoom.find({}, 'fixtureId roomId').lean();
    const roomMap = {};
    gameRooms.forEach(room => {
      if (room.fixtureId) roomMap[room.fixtureId.toString()] = room.roomId;
    });

    const now = new Date();
    const formattedFixtures = fixtures.map(fx => {
      const readyToPlay = fx.matchTime && now >= fx.matchTime && fx.player2; // ready if matchTime passed & has opponent
      let resultText = null;
      if (fx.result === "player1") resultText = "Player 1 Wins";
      else if (fx.result === "player2") resultText = "Player 2 Wins";
      else if (fx.result === "draw") resultText = "Draw";

      return {
        _id: fx._id,
        tournamentCode: fx.tournament?.uniqueId || 'N/A',
        tournamentType: fx.tournament?.type || 'N/A',
        tournamentBalance: fx.tournament?.balance || 'N/A',
        player1: fx.player1 ? (fx.player1.telegram_username || fx.player1.name) : 'N/A',
        player2: fx.player2 ? (fx.player2.telegram_username || fx.player2.name) : 'BYE',
        result: fx.result || null,
        resultText,
        matchTime: fx.matchTime || null,
        roomId: roomMap[fx._id.toString()] || null,
        readyToPlay, // frontend can enable Play button based on this
      };
    });

    res.json(formattedFixtures);
  } catch (err) {
    console.error('[GET Fixtures Error]:', err);
    res.status(500).json({ message: 'Error fetching fixtures.' });
  }
});

// DELETE a fixture by ID
router.delete('/:id', async (req, res) => {
  try {
    await Fixture.findByIdAndDelete(req.params.id);
    console.log(`[Fixture Deleted]: ${req.params.id}`);
    res.json({ message: 'Fixture deleted successfully' });
  } catch (err) {
    console.error('[DELETE Fixture Error]:', err);
    res.status(500).json({ message: 'Error deleting fixture' });
  }
});

// DELETE all fixtures by tournament uniqueId
router.delete('/delete-by-tournament/:uniqueId', async (req, res) => {
  try {
    const { uniqueId } = req.params;
    const tournament = await Tournament.findOne({ uniqueId });
    if (!tournament) {
      console.warn(`[Tournament Not Found]: ${uniqueId}`);
      return res.status(404).json({ message: 'Tournament not found' });
    }

    await Fixture.deleteMany({ tournament: tournament._id });
    console.log(`[All Fixtures Deleted for Tournament]: ${uniqueId}`);
    res.json({ message: `All fixtures for tournament ${uniqueId} deleted successfully.` });
  } catch (err) {
    console.error('[DELETE Fixtures by Tournament Error]:', err);
    res.status(500).json({ message: 'Error deleting fixtures by tournament' });
  }
});

// PATCH match time and schedule auto-win


router.patch('/:fixtureId', async (req, res) => {
  try {
    const { fixtureId } = req.params;
    const { matchTime } = req.body;
    if (!matchTime) return res.status(400).json({ message: 'matchTime is required' });

    const fixture = await Fixture.findById(fixtureId)
      .populate('player1', 'telegram_id telegram_username name')
      .populate('player2', 'telegram_id telegram_username name');
    if (!fixture) return res.status(404).json({ message: 'Fixture not found' });

    fixture.matchTime = new Date(matchTime);
    await fixture.save();
    console.log(`[MatchTime Updated]: Fixture ${fixtureId} -> ${fixture.matchTime}`);

    // Send Telegram notification
    sendMatchTimeNotification(fixture);

    // Schedule auto-win
    if (global.checkAutoWin && global.FIVE_MINUTES) {
      const now = new Date();
      const delay = Math.max(0, fixture.matchTime.getTime() + global.FIVE_MINUTES - now.getTime());
      setTimeout(() => global.checkAutoWin(fixtureId), delay);
      console.log(`[Auto Win Scheduler]: checkAutoWin scheduled for fixture ${fixtureId} in ${delay / 1000}s`);
    } else {
      console.warn('[Auto Win Scheduler]: checkAutoWin function not found in global scope');
    }

    res.json({ message: 'Match time updated successfully' });
  } catch (error) {
    console.error('[PATCH MatchTime Error]:', error);
    res.status(500).json({ message: 'Internal server error' });
  }
});


// POST generate fixtures and optionally schedule auto-win
router.post('/generate/:uniqueId', async (req, res) => {
  try {
    const { uniqueId } = req.params;
    const tournament = await Tournament.findOne({ uniqueId }).populate('players');
    if (!tournament) return res.status(404).json({ message: 'Tournament not found' });

    if (!tournament.players || tournament.players.length < 2) {
      return res.status(400).json({ message: 'Not enough players to generate fixtures' });
    }

    await Fixture.deleteMany({ tournament: tournament._id });

    const players = [...tournament.players];
    const fixturesToCreate = [];

    for (let i = 0; i < players.length; i += 2) {
      const player1 = players[i];
      const player2 = players[i + 1] || null;

      fixturesToCreate.push({
        tournament: tournament._id,
        player1,
        player2,
        result: null,
        matchTime: null,
      });
    }

    const createdFixtures = await Fixture.insertMany(fixturesToCreate);
    console.log(`[Fixtures Generated]: ${createdFixtures.length} for tournament ${uniqueId}`);

    // Schedule auto-win for fixtures that have matchTime set
    createdFixtures.forEach(fx => {
      if (fx.matchTime && global.checkAutoWin && global.FIVE_MINUTES) {
        const delay = Math.max(0, fx.matchTime.getTime() + global.FIVE_MINUTES - Date.now());
        setTimeout(() => global.checkAutoWin(fx._id), delay);
        console.log(`[Auto Win Scheduler]: checkAutoWin scheduled for fixture ${fx._id} in ${delay / 1000}s`);
      }
    });

    res.status(201).json({
      message: `Generated ${createdFixtures.length} fixtures for tournament ${uniqueId}`,
      fixtures: createdFixtures,
    });
  } catch (error) {
    console.error('[Generate Fixtures Error]:', error);
    res.status(500).json({ message: 'Internal server error' });
  }
});

// POST create game room for fixture
router.post('/game-rooms/create', async (req, res) => {
  try {
    const { fixtureId } = req.body;
    if (!fixtureId) return res.status(400).json({ error: 'fixtureId is required' });

    const existingRoom = await GameRoom.findOne({ fixtureId });
    if (existingRoom) return res.status(400).json({ error: 'Room already exists for this fixture' });

    const roomId = 'ROOM_' + Math.random().toString(36).substring(2, 10).toUpperCase();
    const newRoom = new GameRoom({ fixtureId, roomId });
    await newRoom.save();

    console.log(`[Game Room Created]: ${roomId} for fixture ${fixtureId}`);
    res.status(201).json({ message: 'Room created successfully', roomId });
  } catch (error) {
    console.error('[Create Game Room Error]:', error);
    res.status(500).json({ error: 'Failed to create room' });
  }
});

// DELETE game room by fixtureId
router.delete('/game-rooms/delete/:fixtureId', async (req, res) => {
  try {
    const { fixtureId } = req.params;
    const deleted = await GameRoom.findOneAndDelete({ fixtureId });
    if (!deleted) return res.status(404).json({ error: 'Room not found' });

    console.log(`[Game Room Deleted]: Room for fixture ${fixtureId}`);
    res.json({ message: 'Room deleted successfully' });
  } catch (err) {
    console.error('[Delete Game Room Error]:', err);
    res.status(500).json({ error: 'Failed to delete room' });
  }
});

module.exports = router;
