import { el, esc } from '../util.js';
import { api } from '../api.js';
import { state, go, refreshUser } from '../app.js';

function setFieldError(form, name, msg) {
  const f = form.querySelector(`[data-field="${name}"]`);
  if (!f) return;
  f.classList.toggle('has-error', !!msg);
  f.querySelector('.err').textContent = msg || '';
  f.querySelector('.input')?.classList.toggle('invalid', !!msg);
}
function showFormError(form, msg) {
  const e = form.closest('.auth-card').querySelector('.form-error');
  e.textContent = msg || '';
  e.classList.toggle('show', !!msg);
}

export function renderLogin({ layoutPublic }) {
  const node = el(`<main class="auth-wrap"><div class="card auth-card">
    <h2>Welcome back</h2>
    <p class="sub">Log in to your DataVision AI workspace.</p>
    <div class="form-error"></div>
    <form id="f" novalidate>
      <div class="field" data-field="email"><label>Email address</label>
        <input class="input" type="email" name="email" placeholder="you@example.com" autocomplete="email"/><div class="err"></div></div>
      <div class="field" data-field="password"><label>Password</label>
        <input class="input" type="password" name="password" placeholder="••••••••" autocomplete="current-password"/><div class="err"></div></div>
      <button class="btn btn-primary" style="width:100%" type="submit">Log in</button>
    </form>
    <p class="small muted" style="margin-top:16px;text-align:center">New here? <a href="#/register">Create an account</a> · <a href="#/w/demo/dashboard">try the demo</a></p>
  </div></main>`);

  const form = node.querySelector('#f');
  form.onsubmit = async e => {
    e.preventDefault();
    showFormError(form, '');
    const email = form.email.value.trim(), password = form.password.value;
    let ok = true;
    setFieldError(form, 'email', email ? (/.+@.+\..+/.test(email) ? '' : 'Enter a valid email address.') : 'Email is required.');
    setFieldError(form, 'password', password ? '' : 'Password is required.');
    if (!email || !/.+@.+\..+/.test(email) || !password) return;
    const btn = form.querySelector('button');
    btn.disabled = true; btn.innerHTML = '<span class="spinner sm"></span> Logging in…';
    try {
      await api.post('/api/auth/login', { email, password });
      await refreshUser();
      go(sessionStorage.getItem('dv_after_login') || '#/analyze');
      sessionStorage.removeItem('dv_after_login');
    } catch (err) {
      showFormError(form, err.message);
      btn.disabled = false; btn.textContent = 'Log in';
    }
  };
  layoutPublic(node);
}

export function renderRegister({ layoutPublic }) {
  const node = el(`<main class="auth-wrap"><div class="card auth-card">
    <h2>Create your account</h2>
    <p class="sub">Free for students, demos and portfolios.</p>
    <div class="form-error"></div>
    <form id="f" novalidate>
      <div class="field" data-field="name"><label>Full name</label>
        <input class="input" name="name" placeholder="e.g. Priya Sharma" autocomplete="name"/><div class="err"></div></div>
      <div class="field" data-field="email"><label>Email address</label>
        <input class="input" type="email" name="email" placeholder="you@example.com" autocomplete="email"/><div class="err"></div></div>
      <div class="field" data-field="password"><label>Password</label>
        <input class="input" type="password" name="password" placeholder="At least 8 characters" autocomplete="new-password"/>
        <div class="hint">Minimum 8 characters, with letters and numbers. Stored only as a bcrypt hash.</div><div class="err"></div></div>
      <div class="field" data-field="confirm"><label>Confirm password</label>
        <input class="input" type="password" name="confirm" placeholder="Repeat password" autocomplete="new-password"/><div class="err"></div></div>
      <button class="btn btn-primary" style="width:100%" type="submit">Create account</button>
    </form>
    <p class="small muted" style="margin-top:16px;text-align:center">Already registered? <a href="#/login">Log in</a></p>
  </div></main>`);

  const form = node.querySelector('#f');
  form.onsubmit = async e => {
    e.preventDefault();
    showFormError(form, '');
    const name = form.name.value.trim(), email = form.email.value.trim(), password = form.password.value, confirm = form.confirm.value;
    setFieldError(form, 'name', name.length >= 2 ? '' : 'Please enter your name (2+ characters).');
    setFieldError(form, 'email', /.+@.+\..+/.test(email) ? '' : 'Enter a valid email address.');
    setFieldError(form, 'password', password.length >= 8 && /[0-9]/.test(password) && /[A-Za-z]/.test(password) ? '' : 'Use 8+ characters including letters and numbers.');
    setFieldError(form, 'confirm', password === confirm ? '' : 'Passwords do not match.');
    if (node.querySelector('.has-error')) return;
    const btn = form.querySelector('button');
    btn.disabled = true; btn.innerHTML = '<span class="spinner sm"></span> Creating account…';
    try {
      await api.post('/api/auth/register', { name, email, password });
      await refreshUser();
      go('#/analyze');
    } catch (err) {
      showFormError(form, err.message);
      btn.disabled = false; btn.textContent = 'Create account';
    }
  };
  layoutPublic(node);
}
