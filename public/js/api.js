// ---------- API layer ----------
async function request(path, opts = {}) {
  const res = await fetch(path, {
    headers: opts.body && !(opts.body instanceof FormData) ? { 'Content-Type': 'application/json' } : undefined,
    credentials: 'same-origin',
    ...opts,
    body: opts.body && !(opts.body instanceof FormData) ? JSON.stringify(opts.body) : opts.body,
  });
  let data = null;
  try { data = await res.json(); } catch { /* non-JSON */ }
  if (!res.ok) {
    const err = new Error(data?.error || `Request failed (${res.status})`);
    err.status = res.status;
    throw err;
  }
  return data;
}

export const api = {
  get: p => request(p),
  post: (p, body) => request(p, { method: 'POST', body }),
  put: (p, body) => request(p, { method: 'PUT', body }),
  del: p => request(p, { method: 'DELETE' }),
  upload: (p, formData) => request(p, { method: 'POST', body: formData }),
};

// Data service that works for both real projects and the public demo.
// pid === 'demo' → read-only sample dataset endpoints.
export function dataService(pid) {
  const demo = pid === 'demo';
  const base = demo ? '/api/demo' : `/api/projects/${pid}`;
  return {
    demo,
    pid,
    project: () => demo
      ? Promise.resolve({ project: { id: 'demo', name: 'Sample Sales Dataset (Demo)', source_filename: 'sample_sales_data.csv', has_cleaned: 0 } })
      : api.get(base),
    data: (q = '') => api.get(`${base}/data${q}`),
    profile: () => api.get(`${base}/profile`),
    kpis: () => api.get(`${base}/kpis`),
    analysis: () => api.get(`${base}/analysis`),
    insights: () => api.get(`${base}/insights`),
    ask: question => api.post(`${base}/ask`, { question }),
  };
}
