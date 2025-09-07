// Fetch and display registered users in the table
async function fetchUsers() {
  try {
    const response = await fetch('/api/admin/users'); // Update API endpoint if needed
    if (!response.ok) throw new Error('Network response was not ok');

    const users = await response.json();
    const tbody = document.getElementById('users-table-body');
    tbody.innerHTML = '';

    users.forEach((user, index) => {
      const tr = document.createElement('tr');
      tr.innerHTML = `
        <td>${index + 1}</td>
        <td>${user.name}</td>
        <td>@${user.telegram_username || 'N/A'}</td>
        <td>${user.phone_number}</td>
        <td>${user.telegram_id}</td>
        <td>
          <button class="delete-user-btn" data-id="${user._id}" style="color: red;">Delete</button>
        </td>
      `;
      tbody.appendChild(tr);
    });

    // Attach click event to each "Delete User" button
    document.querySelectorAll('.delete-user-btn').forEach(button => {
      button.addEventListener('click', async (e) => {
        const userId = e.target.getAttribute('data-id');
        if (confirm('Are you sure you want to delete this user? This action cannot be undone.')) {
          try {
            const response = await fetch(`/api/admin/users/${userId}`, {
              method: 'DELETE',
            });

            if (!response.ok) throw new Error('Failed to delete user.');

            alert('User deleted successfully.');
            fetchUsers(); // Refresh the list
          } catch (err) {
            console.error(err);
            alert('Error deleting user.');
          }
        }
      });
    });

  } catch (error) {
    console.error('Failed to load users:', error);
  }
}

// Run fetchUsers on page load
document.addEventListener('DOMContentLoaded', fetchUsers);
