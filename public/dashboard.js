document.addEventListener('DOMContentLoaded', async () => {
  const TELEGRAM_ID = new URLSearchParams(window.location.search).get('userId');
  if (!TELEGRAM_ID) {
    console.error('🚨 Missing TELEGRAM_ID in URL query');
    alert('Missing user ID');
    return;
  }

  let userBalance = 0;
  let currentUserName = '';
  let selectedStake = 0;

  // -----------------------------
  // Fetch user info from server
  // -----------------------------
  const getUserInfo = async () => {
    try {
      console.log('ℹ️ Fetching user info...');
      const res = await fetch(`/1v1user/user/${TELEGRAM_ID}`);
      if (!res.ok) throw new Error(`HTTP error ${res.status}`);
      const user = await res.json();

      userBalance = user.oneVsOne_balance || 0;
      currentUserName = user.name || 'Unknown';

      console.log(`ℹ️ User info loaded: ${currentUserName}, Balance: ${userBalance}`);
      document.getElementById('username').textContent = currentUserName;
      document.getElementById('balance').textContent = `${userBalance} birr`;
      document.getElementById('createdAt').textContent = new Date(user.createdAt).toLocaleString();
    } catch (err) {
      console.error('❌ Failed to load user info:', err);
      alert('Failed to load user info');
    }
  };

  // -----------------------------
  // Update balance UI
  // -----------------------------
  const updateBalanceUI = () => {
    const balanceEl = document.getElementById('balance');
    balanceEl.textContent = `${userBalance} birr`;

    const playBtn = document.getElementById('playBtn');

    document.querySelectorAll('.stake-btn').forEach(btn => {
      const amount = Number(btn.textContent);
      btn.disabled = amount > userBalance;
      btn.classList.remove('selected');
      if (amount <= userBalance && selectedStake === amount) btn.classList.add('selected');
    });

    // Only disable button if selected stake exceeds balance
    if (selectedStake === 0) {
      playBtn.disabled = false; // allow user to select stake
      playBtn.textContent = 'Create Room';
    } else if (selectedStake > userBalance) {
      playBtn.disabled = true;
      playBtn.textContent = 'Insufficient Balance';
    } else {
      playBtn.disabled = false;
      playBtn.textContent = 'Create Room';
    }
  };

  // -----------------------------
  // Refresh balance from server
  // -----------------------------
  const refreshBalance = async () => {
    try {
      console.log('ℹ️ Refreshing balance...');
      const res = await fetch(`/1v1user/user/${TELEGRAM_ID}`);
      if (!res.ok) throw new Error(`HTTP error ${res.status}`);
      const user = await res.json();
      console.log(`ℹ️ Server returned balance: ${user.oneVsOne_balance}`);
      userBalance = user.oneVsOne_balance || 0;
      updateBalanceUI();
    } catch (err) {
      console.error('❌ Failed to refresh balance:', err);
    }
  };

  // -----------------------------
  // Stake Buttons
  // -----------------------------
  const stakeAmounts = [20, 40, 50, 100, 200, 300, 500, 700, 1000, 2000];
  const stakeButtonsContainer = document.getElementById('stakeButtons');

  stakeAmounts.forEach(amount => {
    const btn = document.createElement('button');
    btn.textContent = amount;
    btn.classList.add('stake-btn');
    btn.addEventListener('click', () => {
      selectedStake = amount;
      document.querySelectorAll('.stake-btn').forEach(b => b.classList.remove('selected'));
      btn.classList.add('selected');
      updateBalanceUI();
    });
    stakeButtonsContainer.appendChild(btn);
  });

  // -----------------------------
  // Play button → create a room
  // -----------------------------
  const handlePlayButton = () => {
    const playBtn = document.getElementById('playBtn');
    playBtn.addEventListener('click', async () => {
      if (!selectedStake) return alert('Please select a stake amount!');
      if (selectedStake > userBalance) return alert('Selected stake exceeds your balance!');

      try {
        console.log(`⚽ Creating room with stake ${selectedStake}`);
        const res = await fetch('/1v1user/create', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ creatorTelegramId: TELEGRAM_ID, betAmount: selectedStake })
        });
        const room = await res.json();
        if (room.error) return alert(room.error);

        console.log(`➡️ Room created: ${room.roomId}, redirecting...`);
        await refreshBalance();
        window.location.href = `/dama.html?userId=${TELEGRAM_ID}&roomId=${room.roomId}&stake=${room.betAmount}`;
      } catch (err) {
        console.error('❌ Failed to create room:', err);
        alert('Failed to create room');
      }
    });
  };

  // -----------------------------
  // Containers
  // -----------------------------
  const roomsContainer = document.getElementById('availableRooms');
  const myCreatedRoomsContainer = document.getElementById('myCreatedRooms');
  const gameHistoryContainer = document.getElementById('gameHistory');
  const myHistoryContainer = document.getElementById('myGameHistory');
  const btnGameHistory = document.getElementById('btnGameHistory');
  const btnMyHistory = document.getElementById('btnMyHistory');

  // -----------------------------
  // Load available rooms
  // -----------------------------
  const loadRooms = async () => {
    try {
      console.log('ℹ️ Loading rooms...');
      const res = await fetch(`/1v1user/rooms?userId=${TELEGRAM_ID}`);
      if (!res.ok) throw new Error(`HTTP error ${res.status}`);
      const rooms = await res.json();

      roomsContainer.innerHTML = '';
      myCreatedRoomsContainer.innerHTML = '';

      if (!rooms || rooms.length === 0) {
        roomsContainer.innerHTML = '<p>No available rooms</p>';
        myCreatedRoomsContainer.innerHTML = '<p>No games created yet.</p>';
        return;
      }

      let hasAvailable = false;
      let hasMyRooms = false;

      rooms.forEach(room => {
        const creatorName = room.creatorName || 'Unknown';
        const stake = Number(room.betAmount) || 0;
        const players = Array.isArray(room.players) ? room.players.map(p => p.telegramId || p) : [];
        const isPlayer = players.includes(TELEGRAM_ID);

        // My Rooms
        if (isPlayer) {
          hasMyRooms = true;
          const div = document.createElement('div');
          div.className = 'room';
          div.textContent = `Room ID: ${room.roomId} | Stake: ${stake} birr | Status: ${room.status}`;

          const rejoinBtn = document.createElement('button');
          rejoinBtn.textContent = 'Rejoin';
          rejoinBtn.addEventListener('click', () => {
            window.location.href = `/dama.html?userId=${TELEGRAM_ID}&roomId=${room.roomId}&stake=${room.betAmount}`;
          });

          div.appendChild(rejoinBtn);
          myCreatedRoomsContainer.appendChild(div);
        }

        // Available Rooms
        if (!isPlayer && (room.status === 'waiting' || room.players.length === 1)) {
          hasAvailable = true;
          const div = document.createElement('div');
          div.className = 'room';
          div.textContent = `Room ID: ${room.roomId} | Creator: ${creatorName} | Stake: ${stake} birr`;

          const joinBtn = document.createElement('button');
          joinBtn.textContent = 'Join';
          joinBtn.addEventListener('click', async () => {
            try {
              const joinRes = await fetch('/1v1user/join', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ roomId: room.roomId, userId: TELEGRAM_ID })
              });
              const joinData = await joinRes.json();
              if (joinData.error) return alert(joinData.error);

              await refreshBalance();
              window.location.href = `/dama.html?userId=${TELEGRAM_ID}&roomId=${room.roomId}&stake=${room.betAmount}`;
            } catch (err) {
              console.error('❌ Failed to join room:', err);
              alert('Failed to join room');
            }
          });

          div.appendChild(joinBtn);
          roomsContainer.appendChild(div);
        }
      });

      if (!hasAvailable) roomsContainer.innerHTML = '<p>No available rooms</p>';
      if (!hasMyRooms) myCreatedRoomsContainer.innerHTML = '<p>No games created yet.</p>';
    } catch (err) {
      console.error('❌ Failed to load rooms:', err);
      roomsContainer.innerHTML = '<p>Failed to load rooms</p>';
      myCreatedRoomsContainer.innerHTML = '<p>Failed to load my rooms</p>';
    }
  };

  // -----------------------------
  // Load all game history
  // -----------------------------
const loadGameHistory = async () => {
  try {
    const res = await fetch('/1v1user/history/all');
    if (!res.ok) throw new Error(`HTTP error ${res.status}`);
    const games = await res.json();

    console.log('📝 Game history raw data:', games);

    gameHistoryContainer.innerHTML = '';
    if (!games || games.length === 0) {
      gameHistoryContainer.innerHTML = '<p>No game history available.</p>';
      return;
    }

    games.forEach(g => {
      const div = document.createElement('div');
      div.className = 'room';

      const player1Id = g.player1?.telegramId;
      const player1Name = g.player1?.name || 'Unknown';
      const player1Stake = g.player1?.stake || 0;

      const player2Id = g.player2?.telegramId;
      const player2Name = g.player2?.name || 'Unknown';
      const player2Stake = g.player2?.stake || 0;

      // Determine winner name
      const winnerName =
        g.winner === player1Id ? player1Name :
        g.winner === player2Id ? player2Name :
        'No Winner';

      // Determine winning amount
      const winningAmount =
        winnerName === 'No Winner' ? 0 :
        g.winner === player1Id ? player1Stake :
        player2Stake;

      div.textContent = `Winner: ${winnerName} | Winning Amount: ${winningAmount} birr`;
      gameHistoryContainer.appendChild(div);
    });
  } catch (err) {
    console.error('❌ Failed to load game history:', err);
    gameHistoryContainer.innerHTML = '<p>Failed to load game history.</p>';
  }
};



  // -----------------------------
  // Load my history
  // -----------------------------
 const loadMyHistory = async () => {
  try {
    const res = await fetch(`/1v1user/history/my/${TELEGRAM_ID}`);
    if (!res.ok) throw new Error(`HTTP error ${res.status}`);
    const games = await res.json();

    myHistoryContainer.innerHTML = '';
    if (!games || games.length === 0) {
      myHistoryContainer.innerHTML = '<p>No history available.</p>';
      return;
    }

    games.forEach(g => {
      const div = document.createElement('div');
      div.className = 'room';

      // Find opponent name
      const opponent = g.players.find(p => (p.name || p) !== currentUserName);
      const opponentName = opponent?.name || opponent || 'Unknown';

      // Determine winning amount
      let winningAmount = 0;
      if (g.winner === currentUserName) {
        winningAmount = g.stake ? (g.stake * 0.9).toFixed(2) : 0; // 90% of stake as winning
      }

      div.textContent = `Opponent: ${opponentName} | Result: ${g.result} | Stake: ${g.stake} birr | Winning: ${winningAmount} birr`;
      myHistoryContainer.appendChild(div);
    });
  } catch (err) {
    console.error('❌ Failed to load my history:', err);
    myHistoryContainer.innerHTML = '<p>Failed to load my history.</p>';
  }
};


  // -----------------------------
  // Tab Navigation
  // -----------------------------
  btnGameHistory.addEventListener('click', () => {
    btnGameHistory.classList.add('active');
    btnMyHistory.classList.remove('active');
    gameHistoryContainer.classList.add('active');
    myHistoryContainer.classList.remove('active');
    loadGameHistory();
  });

  btnMyHistory.addEventListener('click', () => {
    btnMyHistory.classList.add('active');
    btnGameHistory.classList.remove('active');
    myHistoryContainer.classList.add('active');
    gameHistoryContainer.classList.remove('active');
    loadMyHistory();
  });

  // -----------------------------
  // Initialization
  // -----------------------------
  await getUserInfo();
  updateBalanceUI();
  handlePlayButton();
  await loadRooms();
  loadGameHistory();

  // -----------------------------
  // Auto refresh every 5s
  // -----------------------------
  setInterval(async () => {
    await refreshBalance();
    await loadRooms();
    if (btnGameHistory.classList.contains('active')) loadGameHistory();
    if (btnMyHistory.classList.contains('active')) loadMyHistory();
  }, 5000);
});
