document.addEventListener('DOMContentLoaded', () => {
  const tbody = document.querySelector('#fixtures-table tbody');

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
            <button class="delete-tournament-btn" data-tournament="${tournamentCode}">Delete All Fixtures</button>
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
              ? `<br/>
                  <span style="color:green;">Room ID: ${fx.roomId}</span>
                  <button data-room-id="${fx.roomId}" class="delete-room-btn" style="margin-left:10px;">Delete Room</button>`
              : `<span style="color:red;">No room yet</span>`;

            return `
              <li style="margin-bottom:12px;">
                <strong>Match ${i + 1}:</strong> ${fx.player1} vs ${fx.player2 || 'BYE'}<br/>
                Result: ${fx.result || '-'}<br/>
                Match Time:
                <input type="datetime-local" id="matchTimeInput-${fx._id}" value="${matchTimeValue}" style="margin-right:8px;" />
                <button data-fixture-id="${fx._id}" class="save-matchtime-btn">Save</button>
                <span class="save-status" id="saveStatus-${fx._id}" style="margin-left:8px;color:green;display:none;">Saved!</span>
                <span class="save-error" id="saveError-${fx._id}" style="margin-left:8px;color:red;display:none;">Error saving.</span>
                ${roomLine}
              </li>
            `;
          }).join('');

          // Save match time listeners
          ul.querySelectorAll('.save-matchtime-btn').forEach(btn => {
            btn.addEventListener('click', async e => {
              const fixtureId = e.target.getAttribute('data-fixture-id');
              const input = document.querySelector(`#matchTimeInput-${fixtureId}`);
              const status = document.querySelector(`#saveStatus-${fixtureId}`);
              const error = document.querySelector(`#saveError-${fixtureId}`);

              status.style.display = 'none';
              error.style.display = 'none';

              const newTime = input.value;
              if (!newTime) {
                error.textContent = 'Please select a date/time.';
                error.style.display = '';
                return;
              }

              try {
                const response = await fetch(`/api/admin/fixtures/${fixtureId}`, {
                  method: 'PATCH',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({ matchTime: new Date(newTime).toISOString() })
                });

                if (!response.ok) throw new Error('Failed to save match time.');
                status.style.display = '';
              } catch (err) {
                console.error(err);
                error.style.display = '';
              }
            });
          });

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
          const res = await fetch(`/api/game-rooms/${roomId}`, {
            method: 'DELETE',
          });

          if (!res.ok) {
            let errData;
            try {
              errData = await res.json();
            } catch {
              errData = { error: 'Unknown error' };
            }
            throw new Error(errData.error || 'Failed to delete room');
          }

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

  // Initial load
  loadFixtures();
});
