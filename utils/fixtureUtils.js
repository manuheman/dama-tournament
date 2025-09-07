// utils/fixtureUtils.js

function checkLate(fixture) {
  const { matchTime, player1JoinTime, player2JoinTime, player1, player2 } = fixture;

  const lateLimit = 5 * 60 * 1000; // 5 minutes in ms
  let latePlayers = [];

  if (player1JoinTime && player1JoinTime.getTime() - matchTime.getTime() > lateLimit) {
    latePlayers.push(player1);
  }

  if (player2JoinTime && player2JoinTime.getTime() - matchTime.getTime() > lateLimit) {
    latePlayers.push(player2);
  }

  return latePlayers;
}

module.exports = { checkLate };
