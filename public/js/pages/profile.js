import { el, esc, toast } from '../util.js';
import { api } from '../api.js';
import { state, refreshUser } from '../app.js';

export async function renderProfile({ layoutApp }) {
  const me = await api.get('/api/auth/me');
  const u = me.user;
  const node = el(`<div style="max-width:640px">
    <div class="card" style="margin-bottom:18px">
      <div style="display:flex;gap:16px;align-items:center">
        <div class="avatar" style="width:56px;height:56px;font-size:22px">${esc(u.name[0].toUpperCase())}</div>
        <div>
          <h2 style="font-size:20px">${esc(u.name)} ${u.role === 'admin' ? '<span class="badge blue">admin</span>' : ''}</h2>
          <p class="muted small">${esc(u.email)} · member since ${esc((u.created_at || '').slice(0, 10))} · ${me.projectCount} project(s)</p>
        </div>
      </div>
    </div>
    <div class="card" style="margin-bottom:18px">
      <div class="card-title">Update name</div>
      <form id="nameForm">
        <div class="field"><label>Full name</label><input class="input" name="name" value="${esc(u.name)}"/></div>
        <button class="btn btn-primary btn-sm">Save name</button>
      </form>
    </div>
    <div class="card">
      <div class="card-title">Change password</div>
      <div class="card-sub">Passwords are stored only as bcrypt hashes.</div>
      <form id="pwdForm">
        <div class="field"><label>Current password</label><input class="input" type="password" name="cur" autocomplete="current-password"/></div>
        <div class="field"><label>New password</label><input class="input" type="password" name="pwd" autocomplete="new-password"/>
          <div class="hint">8+ characters, with letters and numbers.</div></div>
        <button class="btn btn-primary btn-sm">Change password</button>
      </form>
    </div>
  </div>`);

  node.querySelector('#nameForm').onsubmit = async e => {
    e.preventDefault();
    try {
      await api.put('/api/auth/me', { name: e.target.name.value });
      await refreshUser();
      toast('Name updated.', 'success');
    } catch (err) { toast(err.message, 'error'); }
  };
  node.querySelector('#pwdForm').onsubmit = async e => {
    e.preventDefault();
    try {
      await api.put('/api/auth/me', { currentPassword: e.target.cur.value, password: e.target.pwd.value });
      toast('Password changed.', 'success');
      e.target.reset();
    } catch (err) { toast(err.message, 'error'); }
  };
  layoutApp(node, { active: 'profile', title: 'My Profile' });
}
