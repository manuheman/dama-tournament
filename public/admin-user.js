// Fetch and display registered users in the table
async function fetchUsers() {
  try {
    const response = await fetch('/api/admin/users'); // Get all users
    if (!response.ok) throw new Error('Network response was not ok');

    const users = await response.json();
    const tbody = document.getElementById('users-table-body');
    tbody.innerHTML = '';

    // Populate table rows
    users.forEach((user, index) => {
      const tr = document.createElement('tr');
      tr.innerHTML = `
        <td>${index + 1}</td>
        <td>${user.name}</td>
        <td>@${user.telegram_username || 'N/A'}</td>
        <td>${user.phone_number}</td>
        <td>${user.telegram_id}</td>
        <td>${user.oneVsOne_balance || 0} Birr</td>
        <td>
          <button class="increase-btn" data-telegram-id="${user.telegram_id}">+</button>
          <button class="decrease-btn" data-telegram-id="${user.telegram_id}">-</button>
          <button class="delete-user-btn" data-telegram-id="${user.telegram_id}" style="color: red;">Delete</button>
        </td>
      `;
      tbody.appendChild(tr);
    });

    // Increase balance
    document.querySelectorAll('.increase-btn').forEach(button => {
      button.addEventListener('click', async (e) => {
        const telegramId = e.target.getAttribute('data-telegram-id');
        try {
          const response = await fetch(`/api/admin/users/${telegramId}/balance`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ change: +10 })
          });
          if (!response.ok) throw new Error('Failed to increase balance');
          fetchUsers();
        } catch (err) {
          console.error(err);
          alert('Error increasing balance');
        }
      });
    });

    // Decrease balance
    document.querySelectorAll('.decrease-btn').forEach(button => {
      button.addEventListener('click', async (e) => {
        const telegramId = e.target.getAttribute('data-telegram-id');
        try {
          const response = await fetch(`/api/admin/users/${telegramId}/balance`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ change: -10 })
          });
          if (!response.ok) throw new Error('Failed to decrease balance');
          fetchUsers();
        } catch (err) {
          console.error(err);
          alert('Error decreasing balance');
        }
      });
    });

    // Delete user
    document.querySelectorAll('.delete-user-btn').forEach(button => {
      button.addEventListener('click', async (e) => {
        const telegramId = e.target.getAttribute('data-telegram-id');
        if (!confirm('Are you sure you want to delete this user? This action cannot be undone.')) return;
        try {
          const response = await fetch(`/api/admin/users/${telegramId}`, {
            method: 'DELETE'
          });
          if (!response.ok) throw new Error('Failed to delete user');
          alert('User deleted successfully');
          fetchUsers();
        } catch (err) {
          console.error(err);
          alert('Error deleting user');
        }
      });
    });

  } catch (err) {
    console.error('Failed to load users:', err);
    alert('Failed to load users');
  }
}

// Load users on page load
document.addEventListener('DOMContentLoaded', fetchUsers);
