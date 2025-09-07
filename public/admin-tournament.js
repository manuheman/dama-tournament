// Fetch and display registered tournaments as buttons with player lists
async function fetchTournaments() {
    try {
      const response = await fetch('/api/admin/tournaments');
      if (!response.ok) throw new Error('Network response was not ok');
  
      const tournaments = await response.json();
      const tbody = document.getElementById('tournaments-table-body');
      tbody.innerHTML = '';
  
      tournaments.forEach((tourn, index) => {
        const tr = document.createElement('tr');
  
        tr.innerHTML = `
          <td>${index + 1}</td>
          <td>${tourn.type}</td>
          <td>${tourn.balance}</td>
          <td>${tourn.status}</td>
          <td>${tourn.players.length}</td>
          <td>
            <button class="view-players-btn" data-index="${index}">View Players</button>
            <div id="player-list-${index}" class="player-list" style="display: none; margin-top: 10px;"></div>
          </td>
          <td>${tourn.uniqueId || 'Not Assigned'}</td>
          <td>
            <input type="text" id="uniqueIdInput-${index}" placeholder="Enter ID" />
            <button class="assign-id-btn" data-id="${tourn._id}" data-index="${index}">Assign ID</button>
            <button class="delete-tournament-btn" data-id="${tourn._id}" style="margin-left: 10px; color: red;">Delete</button>
          </td>
        `;
  
        tbody.appendChild(tr);
      });
  
      // Attach click event to each "View Players" button
      document.querySelectorAll('.view-players-btn').forEach(button => {
        button.addEventListener('click', (e) => {
          const index = e.target.getAttribute('data-index');
          togglePlayerList(tournaments[index].players, index);
        });
      });
  
      // Attach click event to each "Assign ID" button
      document.querySelectorAll('.assign-id-btn').forEach(button => {
        button.addEventListener('click', async (e) => {
          const tournamentId = e.target.getAttribute('data-id');
          const index = e.target.getAttribute('data-index');
          const inputValue = document.getElementById(`uniqueIdInput-${index}`).value.trim();
  
          if (!inputValue) {
            alert('Please enter a unique ID.');
            return;
          }
  
          try {
            const response = await fetch(`/api/admin/tournaments/${tournamentId}/assign-id`, {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json'
              },
              body: JSON.stringify({ uniqueId: inputValue })
            });
  
            if (!response.ok) throw new Error('Failed to assign unique ID.');
  
            alert('Unique ID assigned successfully.');
            fetchTournaments(); // Refresh the list
          } catch (err) {
            console.error(err);
            alert('Error assigning unique ID.');
          }
        });
      });
  
      // Attach click event to each "Delete Tournament" button
      document.querySelectorAll('.delete-tournament-btn').forEach(button => {
        button.addEventListener('click', async (e) => {
          const tournamentId = e.target.getAttribute('data-id');
          if (confirm('Are you sure you want to delete this tournament? This will remove all related data.')) {
            try {
              const response = await fetch(`/api/admin/tournaments/${tournamentId}`, {
                method: 'DELETE'
              });
              if (!response.ok) throw new Error('Failed to delete tournament.');
  
              alert('Tournament deleted successfully.');
              fetchTournaments(); // Refresh the list
            } catch (err) {
              console.error(err);
              alert('Error deleting tournament.');
            }
          }
        });
      });
  
    } catch (error) {
      console.error('Failed to load tournaments:', error);
    }
  }
  
  // Show or hide player list when button is clicked
  function togglePlayerList(players, index) {
    const playerDiv = document.getElementById(`player-list-${index}`);
  
    if (playerDiv.style.display === 'none') {
      // Show players
      if (players.length === 0) {
        playerDiv.innerHTML = '<p>No players in this tournament.</p>';
      } else {
        const playerList = players.map(player => `<p>@${player.telegram_username || 'N/A'} (${player.name})</p>`).join('');
        playerDiv.innerHTML = playerList;
      }
      playerDiv.style.display = 'block';
    } else {
      // Hide players
      playerDiv.style.display = 'none';
    }
  }
  
  // Run fetchTournaments on page load
  document.addEventListener('DOMContentLoaded', fetchTournaments);
  