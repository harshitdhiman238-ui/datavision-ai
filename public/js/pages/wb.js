// Shared workbench helpers (context strip + demo banner)
import { el, esc, fmtInt } from '../util.js';
import { dataService } from '../api.js';

export function wbFrame(pid, innerHTML) {
  return el(`<div>
    ${pid === 'demo' ? `<div class="demo-banner">🧪 <b>Demo mode — sample data.</b> Everything below is computed live from the bundled sample sales dataset. It is read-only: <a href="#/register">create a free account</a> to upload and clean your own files.</div>` : ''}
    <div class="ctx-strip" id="ctxStrip"><span class="spinner sm"></span> Loading dataset info…</div>
    ${innerHTML}
  </div>`);
}

export async function fillCtx(node, pid, extra = '') {
  const svc = dataService(pid);
  try {
    const { project } = await svc.project();
    const strip = node.querySelector('#ctxStrip');
    if (!strip) return project;
    strip.innerHTML = `
      <span>🗂️ <b>${esc(project.name)}</b></span>
      <span class="badge">${esc(project.source_filename)}</span>
      ${project.has_cleaned
        ? `<span class="badge teal">using cleaned data · ${fmtInt(project.cleaned_row_count)} rows</span>`
        : `<span class="badge">original data${project.row_count ? ` · ${fmtInt(project.row_count)} rows` : ''}</span>`}
      ${extra}`;
    return project;
  } catch (e) {
    const strip = node.querySelector('#ctxStrip');
    if (strip) strip.innerHTML = `<span class="badge red">⚠️ ${esc(e.message)}</span>`;
    throw e;
  }
}
