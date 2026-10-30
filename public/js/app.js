// ---------------------------------------------------------------
// DataVision AI — SPA shell, router and app state
// ---------------------------------------------------------------
import { $, el, esc, toast, destroyCharts } from './util.js';
import { api } from './api.js';
import { renderLanding, renderStaticPage } from './pages/landing.js';
import { renderLogin, renderRegister } from './pages/auth.js';
import { renderProjects } from './pages/projects.js';
import { renderUpload } from './pages/upload.js';
import { renderDashboard } from './pages/dashboard.js';
import { renderData } from './pages/data.js';
import { renderCharts } from './pages/charts.js';
import { renderInsights } from './pages/insights.js';
import { renderReports } from './pages/reports.js';
import { renderProfile } from './pages/profile.js';
import { renderAdmin } from './pages/admin.js';
import { renderAnalyze } from './pages/analyze.js';
import { renderSheet } from './pages/sheet.js';
import { renderBilling } from './pages/billing.js';
import { openCleanModal, mountChatDock, unmountChatDock, mountCalcDock, unmountCalcDock } from './widgets.js';

export const state = {
  user: null,
  booted: false,
  collapsed: localStorage.getItem('dv_sidebar') === '1',
};

// ---------- theme ----------
function applyTheme(t) {
  document.documentElement.dataset.theme = t;
  localStorage.setItem('dv_theme', t);
}
applyTheme(localStorage.getItem('dv_theme') || 'dark');
export function toggleTheme() {
  applyTheme(document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark');
  // re-render charts with new theme colors
  route();
}

// ---------- auth ----------
export async function refreshUser() {
  try { state.user = (await api.get('/api/auth/me')).user; }
  catch { state.user = null; }
}
export async function logout() {
  await api.post('/api/auth/logout', {});
  state.user = null;
  toast('You have been logged out.', 'success');
  location.hash = '#/';
}

// ---------- navigation helpers ----------
export const go = h => { location.hash = h; };

const WB_TABS = [
  { id: 'dashboard', icon: '📊', label: 'Dashboard' },
  { id: 'data', icon: '🧹', label: 'Data & Cleaning' },
  { id: 'charts', icon: '📈', label: 'Visualizations' },
  { id: 'insights', icon: '💡', label: 'Insights & Ask' },
  { id: 'reports', icon: '📄', label: 'Reports & Export' },
];

// ---------- layouts ----------
function publicLayout(contentNode, activeLink = '') {
  const app = $('#app');
  app.innerHTML = '';
  const nav = el(`<header class="site-nav"><div class="site-nav-inner">
    <a class="brand" href="#/"><img src="assets/logo.svg" alt=""/><span>DataVision&nbsp;<span class="ai">AI</span></span></a>
    <div class="links">
      <button class="icon-btn" id="themeBtn" title="Toggle light/dark mode">${document.documentElement.dataset.theme === 'dark' ? '☀️' : '🌙'}</button>
      ${state.user
        ? `<a class="btn btn-primary btn-sm" href="#/analyze">Open App →</a>`
        : `<a class="btn btn-outline btn-sm" href="#/login">Log in</a>
           <a class="btn btn-primary btn-sm" href="#/register">Sign up free</a>`}
    </div></div></header>`);
  nav.querySelector('#themeBtn').onclick = toggleTheme;
  app.appendChild(nav);
  app.appendChild(contentNode);
  app.appendChild(el(`<footer class="site-footer"><div class="site-footer-inner">
    <div><a class="brand" href="#/" style="font-size:16px"><img src="assets/logo.svg" alt=""/><span>DataVision&nbsp;<span class="ai">AI</span></span></a>
      <p class="small" style="margin-top:10px;max-width:300px">Smart data analytics platform — a BCA portfolio project. Upload, clean, analyse and report on your data.</p></div>
    <div><a href="#/about">About</a><a href="#/privacy">Privacy</a><a href="#/contact">Contact</a></div>
    <div class="small">© ${new Date().getFullYear()} DataVision AI</div>
  </div></footer>`));
}

function appLayout(contentNode, { active = '', pid = null, title = '' } = {}) {
  const app = $('#app');
  app.innerHTML = '';
  const isAdmin = state.user?.role === 'admin';
  const wbNav = pid ? `
    <div class="nav-label">Workspace</div>
    ${WB_TABS.map(t => `<a class="nav-item ${active === t.id ? 'active' : ''}" href="#/w/${pid}/${t.id}"><span class="ni">${t.icon}</span><span class="nt">${t.label}</span></a>`).join('')}` : '';

  const shell = el(`<div class="shell ${state.collapsed ? 'collapsed' : ''}">
    <div class="sidebar-overlay"></div>
    <aside class="sidebar">
      <a class="brand" href="#/"><img src="assets/logo.svg" alt=""/><span>DataVision&nbsp;<span class="ai">AI</span></span></a>
      <div class="nav-label">Menu</div>
      <a class="nav-item ${active === 'analyze' ? 'active' : ''}" href="#/analyze"><span class="ni">⚡</span><span class="nt">Auto Analysis</span></a>
      <a class="nav-item ${active === 'projects' ? 'active' : ''}" href="#/projects"><span class="ni">🗂️</span><span class="nt">My Projects</span></a>
      <a class="nav-item ${active === 'upload' ? 'active' : ''}" href="#/upload"><span class="ni">⬆️</span><span class="nt">Upload Data</span></a>
      <a class="nav-item ${active === 'sheet' ? 'active' : ''}" href="#/sheet"><span class="ni">📗</span><span class="nt">Spreadsheet</span></a>
      <div class="nav-label">Business Tools</div>
      <a class="nav-item ${active === 'quotation' ? 'active' : ''}" href="#/quotation"><span class="ni">🧾</span><span class="nt">Quotation Builder</span></a>
      <a class="nav-item ${active === 'invoice' ? 'active' : ''}" href="#/invoice"><span class="ni">💸</span><span class="nt">Bill / Invoice</span></a>
      ${wbNav}
      ${isAdmin ? `<div class="nav-label">Administration</div>
      <a class="nav-item ${active === 'admin' ? 'active' : ''}" href="#/admin"><span class="ni">🛡️</span><span class="nt">Admin Area</span></a>` : ''}
      <div class="spacer"></div>
      <a class="nav-item ${active === 'profile' ? 'active' : ''}" href="#/profile"><span class="ni">👤</span><span class="nt">My Profile</span></a>
      <button class="nav-item" id="sbLogout"><span class="ni">🚪</span><span class="nt">Log out</span></button>
      <div class="sidebar-user">
        <div class="avatar">${esc((state.user?.name || 'G')[0].toUpperCase())}</div>
        <div class="who"><div>${esc(state.user?.name || 'Guest (demo)')}</div><small>${esc(state.user?.email || 'not logged in')}</small></div>
      </div>
    </aside>
    <div class="main">
      <div class="topbar">
        <button class="icon-btn mobile-nav-toggle" id="mobileNav">☰</button>
        <button class="icon-btn" id="collapseBtn" title="Collapse sidebar">⟨⟩</button>
        <div class="page-title">${esc(title)}</div>
        <div class="right">
          ${pid && pid !== 'demo' ? `<button class="btn btn-ghost" id="cleanMyDataBtn" title="Quick clean: remove duplicates & fill missing values" style="padding:7px 14px;font-size:13px">🧹 <span class="cmd-label">Clean My Data</span></button>` : ''}
          <button class="icon-btn" id="themeBtn" title="Toggle light/dark mode">${document.documentElement.dataset.theme === 'dark' ? '☀️' : '🌙'}</button>
        </div>
      </div>
      <div class="content" id="pageContent"></div>
    </div>
  </div>`);

  shell.querySelector('#themeBtn').onclick = toggleTheme;
  shell.querySelector('#collapseBtn').onclick = () => {
    state.collapsed = !state.collapsed;
    localStorage.setItem('dv_sidebar', state.collapsed ? '1' : '0');
    shell.classList.toggle('collapsed', state.collapsed);
  };
  shell.querySelector('#mobileNav').onclick = () => shell.classList.add('mobile-open');
  shell.querySelector('.sidebar-overlay').onclick = () => shell.classList.remove('mobile-open');
  const lo = shell.querySelector('#sbLogout');
  if (state.user) lo.onclick = logout; else lo.onclick = () => go('#/login');
  if (!state.user) lo.querySelector('.nt').textContent = 'Log in';

  shell.querySelector('#pageContent').appendChild(contentNode);
  app.appendChild(shell);

  // Workspace extras: quick-clean modal + floating ask-your-data chat
  const cmd = shell.querySelector('#cleanMyDataBtn');
  if (cmd) cmd.onclick = () => openCleanModal(pid);
  if (pid) mountChatDock(pid); else unmountChatDock();
  mountCalcDock(); // quick calculator on all app pages
}

// ---------- router ----------
const routes = [
  { re: /^#?\/?$/, page: 'landing' },
  { re: /^#\/login$/, page: 'login' },
  { re: /^#\/register$/, page: 'register' },
  { re: /^#\/(about|privacy|contact)$/, page: 'static' },
  { re: /^#\/analyze$/, page: 'analyze', auth: true },
  { re: /^#\/projects$/, page: 'projects', auth: true },
  { re: /^#\/upload$/, page: 'upload', auth: true },
  { re: /^#\/sheet$/, page: 'sheet', auth: true },
  { re: /^#\/(quotation|invoice)$/, page: 'billing', auth: true },
  { re: /^#\/profile$/, page: 'profile', auth: true },
  { re: /^#\/admin$/, page: 'admin', auth: true, admin: true },
  { re: /^#\/w\/(demo|\d+)\/(dashboard|data|charts|insights|reports)$/, page: 'workbench' },
];

export async function route() {
  destroyCharts();
  unmountChatDock(); // re-mounted by appLayout on workspace pages
  unmountCalcDock(); // re-mounted by appLayout on app pages
  const hash = location.hash || '#/';
  const match = routes.map(r => ({ r, m: hash.match(r.re) })).find(x => x.m);
  if (!match) { location.hash = '#/'; return; }
  const { r, m } = match;

  if (r.auth && !state.user) {
    sessionStorage.setItem('dv_after_login', hash);
    toast('Please log in to access that page.');
    location.hash = '#/login';
    return;
  }
  if (r.admin && state.user?.role !== 'admin') {
    toast('Admin access required.', 'error');
    location.hash = '#/projects';
    return;
  }

  const ctx = { layoutPublic: publicLayout, layoutApp: appLayout };
  switch (r.page) {
    case 'analyze': return renderAnalyze(ctx);
    case 'landing': return renderLanding(ctx);
    case 'login': return renderLogin(ctx);
    case 'register': return renderRegister(ctx);
    case 'static': return renderStaticPage(ctx, m[1]);
    case 'projects': return renderProjects(ctx);
    case 'upload': return renderUpload(ctx);
    case 'sheet': return renderSheet(ctx);
    case 'billing': return renderBilling(ctx, m[1]);
    case 'profile': return renderProfile(ctx);
    case 'admin': return renderAdmin(ctx);
    case 'workbench': {
      const pid = m[1], tab = m[2];
      if (pid !== 'demo' && !state.user) {
        sessionStorage.setItem('dv_after_login', hash);
        toast('Please log in to open this project.');
        location.hash = '#/login';
        return;
      }
      const map = { dashboard: renderDashboard, data: renderData, charts: renderCharts, insights: renderInsights, reports: renderReports };
      return map[tab](ctx, pid);
    }
  }
}

window.addEventListener('hashchange', route);

(async function boot() {
  await refreshUser();
  state.booted = true;
  route();
})();
