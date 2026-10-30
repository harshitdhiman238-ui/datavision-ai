import { el, esc, toast, spinnerHTML, emptyStateHTML, renderTable, fmtInt, makeChart, confirmModal } from '../util.js';
import { api } from '../api.js';
import { state } from '../app.js';

export async function renderAdmin({ layoutApp }) {
  const node = el(`<div>
    <h2 style="font-size:22px;margin-bottom:4px">Admin Area</h2>
    <p class="muted small" style="margin-bottom:18px">Usage statistics and user management. Visible to administrators only — the API enforces this server-side as well.</p>
    <div id="stats">${spinnerHTML('Loading statistics…')}</div>
    <div class="card" style="margin-top:18px"><div class="card-title">User accounts</div><div id="users">${spinnerHTML('Loading users…')}</div></div>
    <div class="card" style="margin-top:18px"><div class="card-title">Recent activity</div><div id="activity"></div></div>
  </div>`);
  layoutApp(node, { active: 'admin', title: 'Admin Area' });
  load(node);
}

async function load(node) {
  try {
    const s = await api.get('/api/admin/stats');
    node.querySelector('#stats').innerHTML = `
      <div class="kpi-grid">
        ${[['Registered users', s.users], ['Administrators', s.admins], ['Projects', s.projects], ['Dataset rows stored', s.rowsStored], ['Uploads (7 days)', s.uploads7d], ['Logins (7 days)', s.logins7d]]
          .map(([l, v]) => `<div class="kpi-card"><div class="k-label">${l}</div><div class="k-value">${fmtInt(v)}</div></div>`).join('')}
      </div>
      ${s.signupsByDay.length ? `<div class="chart-card"><h3>Signups by day</h3><div class="chart-box" style="height:200px"><canvas id="suChart"></canvas></div></div>` : ''}`;
    if (s.signupsByDay.length) {
      makeChart(node.querySelector('#suChart'), {
        type: 'bar',
        data: { labels: s.signupsByDay.map(x => x.d), datasets: [{ label: 'Signups', data: s.signupsByDay.map(x => x.c), backgroundColor: 'rgba(59,130,246,.7)', borderRadius: 5 }] },
        options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { display: false } }, scales: { y: { ticks: { stepSize: 1 } } } },
      });
    }
    node.querySelector('#activity').innerHTML = renderTable(
      s.recent.map(r => ({ Time: (r.created_at || '').replace('T', ' ').slice(0, 19), User: r.email || '—', Action: r.action, Detail: (r.detail || '').slice(0, 60) })), null, { max: 25 });
  } catch (e) {
    node.querySelector('#stats').innerHTML = emptyStateHTML('⚠️', 'Could not load statistics', e.message);
  }
  loadUsers(node);
}

async function loadUsers(node) {
  const box = node.querySelector('#users');
  try {
    const { users } = await api.get('/api/admin/users');
    box.innerHTML = `<div class="table-wrap"><table class="dv">
      <thead><tr><th>ID</th><th>Name</th><th>Email</th><th>Role</th><th>Projects</th><th>Joined</th><th>Actions</th></tr></thead>
      <tbody>${users.map(u => `<tr data-id="${u.id}">
        <td>${u.id}</td><td>${esc(u.name)}</td><td>${esc(u.email)}</td>
        <td><span class="badge ${u.role === 'admin' ? 'blue' : ''}">${u.role}</span></td>
        <td class="num">${u.project_count}</td><td>${esc((u.created_at || '').slice(0, 10))}</td>
        <td>${u.id === state.user.id ? '<span class="muted small">you</span>' : `
          <button class="btn btn-sm btn-outline" data-a="role">${u.role === 'admin' ? 'Make user' : 'Make admin'}</button>
          <button class="btn btn-sm btn-danger" data-a="del">Delete</button>`}</td>
      </tr>`).join('')}</tbody></table></div>
      <p class="small muted" style="margin-top:8px">Deleting a user removes their account, projects and stored dataset files. Password hashes are never displayed.</p>`;

    box.querySelectorAll('button[data-a]').forEach(btn => btn.onclick = async () => {
      const tr = btn.closest('tr');
      const id = tr.dataset.id;
      const u = users.find(x => String(x.id) === id);
      if (btn.dataset.a === 'role') {
        try {
          await api.put(`/api/admin/users/${id}/role`, { role: u.role === 'admin' ? 'user' : 'admin' });
          toast(`Role updated for ${u.email}.`, 'success');
          loadUsers(node);
        } catch (e) { toast(e.message, 'error'); }
      } else {
        const ok = await confirmModal('Delete user?', `${u.email} and all of their projects and datasets will be permanently removed.`, 'Delete user');
        if (!ok) return;
        try {
          await api.del(`/api/admin/users/${id}`);
          toast('User deleted.', 'success');
          loadUsers(node);
        } catch (e) { toast(e.message, 'error'); }
      }
    });
  } catch (e) {
    box.innerHTML = emptyStateHTML('⚠️', 'Could not load users', e.message);
  }
}
