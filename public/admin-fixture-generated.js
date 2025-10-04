document.addEventListener('DOMContentLoaded', () => {
  const tbody = document.querySelector('#fixtures-table tbody');
  const modalOverlay = document.getElementById('modalOverlay');
  const editModal = document.getElementById('editModal');
  const matchTimeInput = document.getElementById('matchTimeInput');
  const saveBtn = document.getElementById('saveBtn');
  const cancelBtn = document.getElementById('cancelBtn');

  let currentTournamentCode = null;

  async function loadFixtures() {
    try {
      const res = await fetch('/api/admin/fixtures');
      if (!res.ok) throw new Error('Failed to fetch fixtures');

      const fixtures = await res.json();

      if (!fixtures.length) {
        tbody.innerHTML = `<tr><td colspan="9" style="text-align:center;">No fixtures generated yet.</td></tr>`;
        return;
      }

      // Group fixtures by tournamentCode
      const grouped = {};
      fixtures.forEach(fx => {
        if (!grouped[fx.tournamentCode]) {
          grouped[fx.tournamentCode] = {
            tournamentType: fx.tournamentType,
            tournamentBalance: fx.tournamentBalance,
            fixtures: []
          };
        }
        grouped[fx.tournamentCode].fixtures.push(fx);
      });

      tbody.innerHTML = '';

      Object.entries(grouped).forEach(([tournamentCode, data], idx) => {
        const numRooms = data.fixtures.filter(f => f.roomId).length;

        const tr = document.createElement('tr');
        tr.innerHTML = `
          <td>${idx + 1}</td>
          <td>${tournamentCode}</td>
          <td>${data.tournamentType}</td>
          <td>${data.tournamentBalance}</td>
          <td colspan="4"></td>
          <td>
            <button class="view-fixtures-btn" data-tournament="${tournamentCode}">View Fixtures</button>
            <button class="set-matchtime-btn" data-tournament="${tournamentCode}" style="margin-top:5px;">Set Match Time</button>
            <button class="delete-tournament-btn" data-tournament="${tournamentCode}" style="margin-top:5px;">Delete All Fixtures</button>
            <br/>
            <small style="color:green;">${numRooms} room(s) created</small>
          </td>
        `;
        tbody.appendChild(tr);

        const detailRow = document.createElement('tr');
        detailRow.style.display = 'none';
        detailRow.classList.add('fixtures-detail-row');
        detailRow.innerHTML = `
          <td colspan="9">
            <ul class="fixtures-list" id="fixtures-list-${tournamentCode}"></ul>
          </td>
        `;
        tbody.appendChild(detailRow);
      });

      // View Fixtures toggle
      tbody.querySelectorAll('.view-fixtures-btn').forEach(button => {
        button.addEventListener('click', e => {
          const tournamentCode = e.target.getAttribute('data-tournament');
          toggleFixtures(tournamentCode);
        });
      });

      // Set Match Time for entire tournament
      tbody.querySelectorAll('.set-matchtime-btn').forEach(button => {
        button.addEventListener('click', e => {
          currentTournamentCode = e.target.getAttribute('data-tournament');
          // Optional: pre-fill with first match time if exists
          const firstFixture = grouped[currentTournamentCode].fixtures[0];
          matchTimeInput.value = firstFixture.matchTime
            ? new Date(firstFixture.matchTime).toISOString().slice(0, 16)
            : '';
          modalOverlay.style.display = 'block';
          editModal.style.display = 'block';
        });
      });

      // Delete all fixtures
      tbody.querySelectorAll('.delete-tournament-btn').forEach(button => {
        button.addEventListener('click', async e => {
          const tournamentCode = e.target.getAttribute('data-tournament');
          if (!confirm(`Delete ALL fixtures for tournament ${tournamentCode}?`)) return;

          try {
            const res = await fetch(`/api/admin/fixtures/delete-by-tournament/${tournamentCode}`, {
              method: 'DELETE'
            });
            if (!res.ok) throw new Error('Failed to delete fixtures');
            alert('All fixtures deleted successfully.');
            loadFixtures();
          } catch (err) {
            console.error(err);
            alert('Error deleting fixtures.');
          }
        });
      });

      // Toggle fixture details
      async function toggleFixtures(tournamentCode) {
        const detailRow = [...tbody.querySelectorAll('.fixtures-detail-row')]
          .find(row => row.querySelector(`#fixtures-list-${tournamentCode}`));
        if (!detailRow) return;

        if (detailRow.style.display === 'none') {
          const ul = detailRow.querySelector(`#fixtures-list-${tournamentCode}`);
          const matches = grouped[tournamentCode].fixtures;

          ul.innerHTML = matches.map((fx, i) => {
            const matchTimeValue = fx.matchTime
              ? new Date(fx.matchTime).toISOString().slice(0, 16)
              : '';

            const roomLine = fx.roomId
              ? `<br/><span style="color:green;">Room ID: ${fx.roomId}</span>
                 <button data-room-id="${fx.roomId}" class="delete-room-btn" style="margin-left:10px;">Delete Room</button>`
              : `<span style="color:red;">No room yet</span>`;

            return `
              <li style="margin-bottom:12px;">
                <strong>Match ${i + 1}:</strong> ${fx.player1} vs ${fx.player2 || 'BYE'}<br/>
                Result: ${fx.result || '-'}<br/>
                Match Time: ${matchTimeValue || '-'}<br/>
                ${roomLine}
              </li>
            `;
          }).join('');

          // Delete room listeners
          ul.querySelectorAll('.delete-room-btn').forEach(btn => {
            btn.addEventListener('click', deleteRoomHandler);
          });

          detailRow.style.display = '';
        } else {
          detailRow.style.display = 'none';
        }
      }

      // Delete room handler
      async function deleteRoomHandler(e) {
        const roomId = e.target.getAttribute('data-room-id');
        if (!confirm(`Delete game room with Room ID ${roomId}?`)) return;

        try {
          const res = await fetch(`/api/game-rooms/${roomId}`, { method: 'DELETE' });
          if (!res.ok) throw new Error('Failed to delete room');
          alert('✅ Room deleted successfully.');
          loadFixtures();
        } catch (err) {
          console.error('Delete room error:', err);
          alert('❌ Error deleting room.');
        }
      }

    } catch (error) {
      console.error('Error loading fixtures:', error);
      tbody.innerHTML = `<tr><td colspan="9" style="text-align:center;">Error loading fixtures.</td></tr>`;
    }
  }

  // Modal Save
  saveBtn.addEventListener('click', async () => {
    if (!currentTournamentCode) return;
    const newTime = matchTimeInput.value;
    if (!newTime) return alert('Please select a match time.');

    try {
      const res = await fetch(`/api/admin/fixtures/set-matchtime/${currentTournamentCode}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ matchTime: new Date(newTime).toISOString() })
      });

      if (!res.ok) throw new Error('Failed to set match time.');

      alert('✅ Match time set for all matches in this tournament.');
      modalOverlay.style.display = 'none';
      editModal.style.display = 'none';
      loadFixtures();
    } catch (err) {
      console.error(err);
      alert('❌ Error setting match time.');
    }
  });

  cancelBtn.addEventListener('click', () => {
    modalOverlay.style.display = 'none';
    editModal.style.display = 'none';
  });

  // Initial load
  loadFixtures();
});
