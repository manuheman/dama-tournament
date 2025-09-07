document.getElementById('fixture-form').addEventListener('submit', async (e) => {
  e.preventDefault();

  const uniqueId = document.getElementById('uniqueId').value.trim();
  const resultDiv = document.getElementById('fixture-result');
  resultDiv.innerHTML = 'Generating fixtures...';

  if (!uniqueId) {
    resultDiv.innerHTML = '<p style="color: red;">Please enter a tournament uniqueId.</p>';
    return;
  }

  try {
    // Note uniqueId is part of the URL path
    const response = await fetch(`/api/admin/fixtures/generate/${encodeURIComponent(uniqueId)}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),  // empty body or you can omit body for POST if your backend allows
    });

    if (!response.ok) {
      const errorData = await response.json();
      resultDiv.innerHTML = `<p style="color: red;">Error: ${errorData.message}</p>`;
      return;
    }

    const data = await response.json();

    if (!data.fixtures || data.fixtures.length === 0) {
      resultDiv.innerHTML = '<p>No fixtures generated (not enough players or other issue).</p>';
      return;
    }

    let html = '<h2>Generated Fixtures:</h2><ul>';
    data.fixtures.forEach((match, index) => {
      // If your Fixture model stores players as ObjectIds, and you want names here,
      // make sure your backend populates player1 and player2 before sending JSON.
      // Otherwise here you just show IDs or "BYE".
      const player1 = match.player1?.telegram_username || match.player1?.name || match.player1 || 'Player 1';
      const player2 = match.player2 ? (match.player2.telegram_username || match.player2.name || match.player2) : 'BYE (No opponent)';
      html += `<li>Match ${index + 1}: ${player1} vs ${player2}</li>`;
    });
    html += '</ul>';

    resultDiv.innerHTML = html;
  } catch (err) {
    console.error(err);
    resultDiv.innerHTML = `<p style="color: red;">Unexpected error occurred.</p>`;
  }
});
