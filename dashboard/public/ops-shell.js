const CRUCIX_SURFACES = [
  { id: 'dashboard', href: '/', label: 'Dashboard', tag: 'primary', desc: 'Main live intelligence terminal and map surface.' },
  { id: 'settings', href: '/settings', label: 'Operator settings', tag: 'read-only', desc: 'Operator visibility plane for current posture and boundaries.' },
  { id: 'source-ops', href: '/source-ops', label: 'Source ops', tag: 'operator', desc: 'Source inventory, health, and suppression workflow routing.' },
  { id: 'llm-ops', href: '/llm-ops', label: 'LLM ops', tag: 'operator', desc: 'Provider health, fallbacks, telemetry, and reasoning checks.' },
  { id: 'diagnostics', href: '/diagnostics', label: 'Diagnostics', tag: 'review', desc: 'Review queue, repair helpers, and runtime inspection.' },
  { id: 'admin-settings', href: '/admin/settings', label: 'Admin settings', tag: 'local-write', desc: 'Local-only writes, export/import, and runtime controls.' },
];

function esc(value){return String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));}
function row(key, value){return `<div class="row"><div class="key">${esc(key)}</div><div class="val">${value}</div></div>`;}
function tags(items){return `<div class="tags">${items.map(item => `<span class="tag">${esc(item)}</span>`).join('')}</div>`;}
function renderCard(title, subtitle, body){return `<section class="card"><div class="mini">${esc(subtitle)}</div><h2>${esc(title)}</h2>${body}</section>`;}
function renderSurfaceNav(activeId){
  return CRUCIX_SURFACES.map(surface => `<a class="nav-card${surface.id===activeId ? ' active' : ''}" href="${surface.href}"><div class="nav-card-title"><span>${esc(surface.label)}</span><span class="nav-tag">${esc(surface.tag)}</span></div><div class="nav-desc">${esc(surface.desc)}</div></a>`).join('');
}
function createRuntimeActionMonitor(shell, options = {}) {
  let handle = null;
  function clear(){
    if (handle) {
      clearTimeout(handle);
      handle = null;
    }
  }
  function schedule(message){
    clear();
    handle = setTimeout(() => {
      if (message) shell.status.textContent = message;
      options.onRefresh?.(message);
    }, options.intervalMs || 2000);
  }
  function update(latestEntry, state = {}) {
    const actionLabel = state.actionLabel || latestEntry?.action || 'runtime action';
    const queuedMessage = state.queuedMessage || `${actionLabel} is queued, polling…`;
    const preserveStatus = state.preserveStatus || null;
    if (latestEntry?.phase === 'queued') {
      schedule(queuedMessage);
      return { polling: true, preserveStatus: queuedMessage };
    }
    clear();
    if (preserveStatus && latestEntry?.phase) {
      const outcome = `Latest ${latestEntry?.action || actionLabel} outcome: ${latestEntry.phase} (${latestEntry.status || 'unknown'})`;
      shell.status.textContent = outcome;
      return { polling: false, preserveStatus: outcome };
    }
    return { polling: false, preserveStatus: preserveStatus || null };
  }
  return { clear, schedule, update };
}
const createRestartAuditMonitor = createRuntimeActionMonitor;
function mountOpsShell(options){
  const app = document.getElementById(options.appId || 'app');
  if (!app) throw new Error('Missing app mount');
  const shell = document.createElement('div');
  shell.className = 'wrap page-shell';
  if (options.width === 'wide') shell.dataset.width = 'wide';
  shell.innerHTML = `<div class="shell-top"><div><div class="kicker">${esc(options.kicker)}</div><h1>${esc(options.title)}</h1><div class="sub">${esc(options.subtitle)}</div></div><div class="shell-right"><div class="shell-actions" id="shellActions"></div><div class="shell-nav">${renderSurfaceNav(options.activeSurface)}</div></div></div><div id="shellStatus" class="note">${esc(options.loadingText || 'Loading…')}</div><div id="shellContent"></div>`;
  app.replaceWith(shell);
  const actions = shell.querySelector('#shellActions');
  (options.actions || []).forEach(action => {
    if (action.type === 'button') {
      const button = document.createElement('button');
      button.className = 'pill';
      button.type = 'button';
      button.id = action.id || '';
      button.textContent = action.label;
      if (action.title) button.title = action.title;
      actions.appendChild(button);
      return;
    }
    const anchor = document.createElement('a');
    anchor.className = 'pill';
    anchor.href = action.href;
    anchor.textContent = action.label;
    if (action.id) anchor.id = action.id;
    if (action.target) anchor.target = action.target;
    if (action.rel) anchor.rel = action.rel;
    actions.appendChild(anchor);
  });
  const content = shell.querySelector('#shellContent');
  if (options.contentClass) content.className = options.contentClass;
  if (options.width === 'wide') content.dataset.width = 'wide';
  return {
    shell,
    status: shell.querySelector('#shellStatus'),
    content,
    actions,
  };
}
window.CRUCIX_OPS_SHELL = { CRUCIX_SURFACES, esc, row, tags, renderCard, mountOpsShell, createRuntimeActionMonitor, createRestartAuditMonitor };
