// tournamentUtils.js

const Fixture = require('./models/fixture');
const GameResult = require('./models/Gameresult');
const mongoose = require('mongoose');

/**
 * Fetch winners of completed matches in the given tournament,
 * then pair them to create new matches (fixtures).
 *
 * @param {string} tournamentUniqueId - The unique tournament ID to filter winners
 */
async function pairWinnersAndCreateMatches(tournamentUniqueId) {
  try {
    console.log(`Fetching winners for tournament: ${tournamentUniqueId}`);

    // Find all completed game results for this tournament
    const winnersResults = await GameResult.find({
      tournamentUniqueId,
      winner: { $in: [1, 2] }, // 1 = player1 wins, 2 = player2 wins
      result: { $ne: 'pending' } // exclude matches still in progress
    });

    if (winnersResults.length === 0) {
      console.log('No completed game results found for this tournament.');
      return;
    }

    // Extract winner IDs from results
    const winners = winnersResults
      .map((gr) => {
        if (gr.winner === 1) return gr.player1;
        if (gr.winner === 2) return gr.player2;
        return null;
      })
      .filter(Boolean);

    console.log(`Found ${winners.length} winners:`, winners);

    // Pair winners into matches
    for (let i = 0; i < winners.length; i += 2) {
      const player1Id = winners[i];
      const player2Id = winners[i + 1] || null;

      // Convert all IDs to ObjectId
      const player1ObjId = new mongoose.Types.ObjectId(player1Id);
      const player2ObjId = player2Id ? new mongoose.Types.ObjectId(player2Id) : null;
      const tournamentObjId = new mongoose.Types.ObjectId(tournamentUniqueId);

      const newFixture = new Fixture({
        tournament: tournamentObjId,
        player1: player1ObjId,
        player2: player2ObjId,
        status: 'pending',
        createdAt: new Date(),
      });

      await newFixture.save();
      console.log(
        `Created new fixture for players: ${player1Id} vs ${player2Id || 'waiting for opponent'}`
      );
    }
  } catch (error) {
    console.error('Error pairing winners and creating matches:', error);
  }
}

module.exports = { pairWinnersAndCreateMatches };
