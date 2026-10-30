import { el, esc, toast, confirmModal, spinnerHTML, emptyStateHTML, fmtInt } from '../util.js';
import { api } from '../api.js';

export async function renderProjects({ layoutApp }) {
  const node = el(`<div>
    <div class="toolbar">
      <div><h2 style="font-size:22px">My Projects</h2>
      <p class="muted small">Saved analyses — metadata lives in the database, dataset files are stored per-project on the server.</p></div>
      <div class="grow"></div>
      <a class="btn btn-outline" href="#/w/demo/dashboard">▶ Demo dashboard</a>
      <a class="btn btn-primary" href="#/upload">+ New analysis</a>
    </div>
    <div id="list">${spinnerHTML('Loading your projects…')}</div>
  </div>`);
  layoutApp(node, { active: 'projects', title: 'My Projects' });
  await load(node);
}

async function load(node) {
  const list = node.querySelector('#list');
  try {
    const { projects } = await api.get('/api/projects');
    if (!projects.length) {
      list.innerHTML = emptyStateHTML('🗂️', 'No projects yet',
        'Upload your first Excel or CSV file to create an analysis project, or explore the demo dashboard with sample data.',
        `<a class="btn btn-primary" href="#/upload">Upload a file</a>`);
      return;
    }
    list.innerHTML = '';
    const grid = el('<div class="grid grid-3"></div>');
    for (const p of projects) grid.appendChild(card(p, node));
    list.appendChild(grid);
  } catch (e) {
    list.innerHTML = emptyStateHTML('⚠️', 'Could not load projects', e.message);
  }
}

function card(p, node) {
  const c = el(`<div class="card fade-up">
    <div style="display:flex;justify-content:space-between;gap:8px;align-items:flex-start">
      <h3 style="font-size:16px;word-break:break-word">${esc(p.name)}</h3>
      ${p.has_cleaned ? '<span class="badge teal">cleaned</span>' : '<span class="badge">original</span>'}
    </div>
    <p class="small muted" style="margin:6px 0 12px">📄 ${esc(p.source_filename)}<br/>
      ${fmtInt(p.row_count)} rows · ${p.col_count} columns${p.has_cleaned ? ` · cleaned: ${fmtInt(p.cleaned_row_count)} rows` : ''}<br/>
      <span class="small">Updated ${esc((p.updated_at || '').replace('T', ' ').slice(0, 16))} UTC</span></p>
    <div style="display:flex;gap:8px;flex-wrap:wrap">
      <a class="btn btn-primary btn-sm" href="#/w/${p.id}/dashboard">Open</a>
      <button class="btn btn-outline btn-sm" data-a="rename">Rename</button>
      <button class="btn btn-danger btn-sm" data-a="delete">Delete</button>
    </div>
  </div>`);
  c.querySelector('[data-a="rename"]').onclick = async () => {
    const name = prompt('New project name:', p.name);
    if (name === null) return;
    if (!name.trim()) return toast('Project name cannot be empty.', 'error');
    try {
      await api.put(`/api/projects/${p.id}`, { name: name.trim() });
      toast('Project renamed.', 'success');
      load(node);
    } catch (e) { toast(e.message, 'error'); }
  };
  c.querySelector('[data-a="delete"]').onclick = async () => {
    const ok = await confirmModal('Delete project?', `"${p.name}" and its stored dataset files will be permanently deleted. This cannot be undone.`, 'Delete');
    if (!ok) return;
    try {
      await api.del(`/api/projects/${p.id}`);
      toast('Project deleted.', 'success');
      load(node);
    } catch (e) { toast(e.message, 'error'); }
  };
  return c;
}
