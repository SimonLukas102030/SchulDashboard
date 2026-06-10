import {
  login, logout, getChannels, getConversations,
  getMessages, sendMessage, getFolder, getFileDownloadUrl, getMe,
} from './stashcat.js';

// ── Session state ─────────────────────────────────────
let _session   = null; // { clientKey, deviceId, email, password }
let _channels  = [];
let _convos    = [];
let _activeId  = null;
let _activeConvo = false;
let _folderStack = []; // [{id, name}] breadcrumb

function genDeviceId() {
  const stored = sessionStorage.getItem('sc-device-id');
  if (stored) return stored;
  const id = 'sd-' + Math.random().toString(36).slice(2, 18);
  sessionStorage.setItem('sc-device-id', id);
  return id;
}

// ── Public API ────────────────────────────────────────
export async function initCloud(creds) {
  const deviceId = genDeviceId();
  const clientKey = await login(creds.email, creds.password, deviceId);
  _session = { clientKey, deviceId, email: creds.email, password: creds.password };
}

export function hasSession() { return !!_session; }

export async function teardown() {
  if (_session) await logout(_session.clientKey, _session.deviceId);
  _session = null;
  _channels = []; _convos = [];
  _activeId = null;
}

// ── Main render entry ─────────────────────────────────
export async function renderCloudGelb(containerEl) {
  containerEl.innerHTML = `
    <div class="sc-layout">
      <aside class="sc-sidebar" id="sc-sidebar">
        <div class="sc-sidebar-header">
          <span class="sc-tabs">
            <button class="sc-tab active" data-tab="channels">Kanäle</button>
            <button class="sc-tab" data-tab="dms">Nachrichten</button>
            <button class="sc-tab" data-tab="files">Dateien</button>
          </span>
        </div>
        <div class="sc-list" id="sc-list"><div class="sp-loading">Laden…</div></div>
      </aside>
      <main class="sc-main" id="sc-main">
        <div class="sc-welcome">
          <div class="sc-welcome-icon">💬</div>
          <p>Wähle einen Kanal oder eine Konversation.</p>
        </div>
      </main>
    </div>
  `;

  // Tab switching
  containerEl.querySelectorAll('.sc-tab').forEach(tab => {
    tab.onclick = () => {
      containerEl.querySelectorAll('.sc-tab').forEach(t => t.classList.remove('active'));
      tab.classList.add('active');
      const which = tab.dataset.tab;
      if (which === 'channels') renderChannelList();
      else if (which === 'dms') renderConvoList();
      else if (which === 'files') renderFileManager(null);
    };
  });

  await ensureSession();
  await renderChannelList();
}

async function ensureSession() {
  if (_session) return;
  throw new Error('Nicht eingeloggt — Gelbe Cloud Credentials fehlen.');
}

// ── Sidebar lists ─────────────────────────────────────
async function renderChannelList() {
  const list = document.getElementById('sc-list');
  if (!list) return;
  list.innerHTML = '<div class="sp-loading">Laden…</div>';
  try {
    _channels = await getChannels(_session.clientKey, _session.deviceId);
    list.innerHTML = _channels.length === 0
      ? '<div class="sp-empty">Keine Kanäle.</div>'
      : _channels.map(ch => `
          <div class="sc-item ${_activeId === ch.id && !_activeConvo ? 'active' : ''}"
               data-id="${ch.id}" data-type="channel">
            <span class="sc-item-name">${esc(ch.name)}</span>
            ${ch.unread ? `<span class="sc-badge">${ch.unread}</span>` : ''}
          </div>`).join('');
    list.querySelectorAll('.sc-item').forEach(el => {
      el.onclick = () => openChannel(el.dataset.id, el.dataset.type === 'conversation');
    });
  } catch (err) {
    list.innerHTML = `<div class="sp-error">Fehler: ${esc(err.message)}</div>`;
  }
}

async function renderConvoList() {
  const list = document.getElementById('sc-list');
  if (!list) return;
  list.innerHTML = '<div class="sp-loading">Laden…</div>';
  try {
    _convos = await getConversations(_session.clientKey, _session.deviceId);
    list.innerHTML = _convos.length === 0
      ? '<div class="sp-empty">Keine Konversationen.</div>'
      : _convos.map(c => `
          <div class="sc-item ${_activeId === c.id && _activeConvo ? 'active' : ''}"
               data-id="${c.id}" data-type="conversation">
            <span class="sc-item-name">${esc(c.name)}</span>
            ${c.unread ? `<span class="sc-badge">${c.unread}</span>` : ''}
          </div>`).join('');
    list.querySelectorAll('.sc-item').forEach(el => {
      el.onclick = () => openChannel(el.dataset.id, el.dataset.type === 'conversation');
    });
  } catch (err) {
    list.innerHTML = `<div class="sp-error">Fehler: ${esc(err.message)}</div>`;
  }
}

// ── Message thread ────────────────────────────────────
async function openChannel(id, isConvo) {
  _activeId    = id;
  _activeConvo = isConvo;

  // Mark active in sidebar
  document.querySelectorAll('.sc-item').forEach(el => {
    el.classList.toggle('active', el.dataset.id === id);
  });

  const main = document.getElementById('sc-main');
  if (!main) return;
  const name = (isConvo ? _convos : _channels).find(x => x.id === id)?.name ?? id;

  main.innerHTML = `
    <div class="sc-thread">
      <div class="sc-thread-header">
        <span class="sc-thread-title">${esc(name)}</span>
        <button class="btn btn-ghost btn-sm" id="sc-refresh">↻</button>
      </div>
      <div class="sc-messages" id="sc-messages"><div class="sp-loading">Laden…</div></div>
      <form class="sc-compose" id="sc-compose">
        <input type="text" class="sc-input" id="sc-msg-input" placeholder="Nachricht…" autocomplete="off" />
        <button type="submit" class="btn btn-primary btn-sm">Senden</button>
      </form>
    </div>
  `;

  document.getElementById('sc-refresh').onclick = () => loadMessages(id, isConvo);
  document.getElementById('sc-compose').onsubmit = async e => {
    e.preventDefault();
    const input = document.getElementById('sc-msg-input');
    const text  = input.value.trim();
    if (!text) return;
    input.value = '';
    try {
      await sendMessage(_session.clientKey, _session.deviceId, id, text, isConvo);
      await loadMessages(id, isConvo);
    } catch (err) {
      alert('Senden fehlgeschlagen: ' + err.message);
    }
  };

  await loadMessages(id, isConvo);
}

async function loadMessages(id, isConvo) {
  const box = document.getElementById('sc-messages');
  if (!box) return;
  box.innerHTML = '<div class="sp-loading">Laden…</div>';
  try {
    const msgs = await getMessages(_session.clientKey, _session.deviceId, id, isConvo);
    if (msgs.length === 0) {
      box.innerHTML = '<div class="sp-empty">Keine Nachrichten.</div>';
      return;
    }
    box.innerHTML = msgs.map(m => renderMessage(m)).join('');
    box.scrollTop = box.scrollHeight;
  } catch (err) {
    box.innerHTML = `<div class="sp-error">Fehler: ${esc(err.message)}</div>`;
  }
}

function renderMessage(m) {
  const time = m.createdAt
    ? m.createdAt.toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' })
    : '';
  const date = m.createdAt
    ? m.createdAt.toLocaleDateString('de-DE', { day: 'numeric', month: 'short' })
    : '';

  let body;
  if (m.encrypted) {
    body = `<span class="sc-msg-encrypted">🔒 Verschlüsselt</span>`;
  } else if (m.hasFile) {
    body = `<span class="sc-msg-file">📎 ${esc(m.fileName ?? 'Datei')}</span>`;
  } else {
    body = `<span class="sc-msg-text">${esc(m.text ?? '')}</span>`;
  }

  return `
    <div class="sc-msg">
      <div class="sc-msg-meta">
        <span class="sc-msg-sender">${esc(m.sender)}</span>
        <span class="sc-msg-time">${date} ${time}</span>
      </div>
      <div class="sc-msg-body">${body}</div>
    </div>`;
}

// ── File manager ──────────────────────────────────────
async function renderFileManager(folderId) {
  if (folderId === null) {
    _folderStack = [{ id: null, name: 'Dateien' }];
  }

  const main = document.getElementById('sc-main');
  if (!main) return;

  main.innerHTML = `
    <div class="sc-files">
      <div class="sc-files-header">
        <div class="sc-breadcrumb" id="sc-breadcrumb">${renderBreadcrumb()}</div>
      </div>
      <div class="sc-file-list" id="sc-file-list"><div class="sp-loading">Laden…</div></div>
    </div>
  `;

  try {
    const items = await getFolder(_session.clientKey, _session.deviceId, folderId);
    const list  = document.getElementById('sc-file-list');
    if (!list) return;

    if (items.length === 0) {
      list.innerHTML = '<div class="sp-empty">Ordner ist leer.</div>';
      return;
    }

    list.innerHTML = items.map(item => `
      <div class="sc-file-item" data-id="${item.id}" data-type="${item.type}" data-name="${esc(item.name)}">
        <span class="sc-file-icon">${item.type === 'folder' ? '📁' : fileIcon(item.mime)}</span>
        <span class="sc-file-name">${esc(item.name)}</span>
        ${item.size ? `<span class="sc-file-size">${fmtSize(item.size)}</span>` : ''}
        ${item.type === 'file' ? `<button class="btn btn-ghost btn-sm sc-dl" data-id="${item.id}">⬇</button>` : ''}
      </div>`).join('');

    // Folder navigation
    list.querySelectorAll('.sc-file-item[data-type="folder"]').forEach(el => {
      el.onclick = () => {
        _folderStack.push({ id: el.dataset.id, name: el.dataset.name });
        renderFileManager(el.dataset.id);
      };
    });

    // Download
    list.querySelectorAll('.sc-dl').forEach(btn => {
      btn.onclick = async e => {
        e.stopPropagation();
        btn.disabled = true;
        try {
          const url = await getFileDownloadUrl(_session.clientKey, _session.deviceId, btn.dataset.id);
          if (url) window.open(url, '_blank');
          else alert('Download-URL nicht verfügbar.');
        } catch (err) {
          alert('Fehler: ' + err.message);
        }
        btn.disabled = false;
      };
    });

    // Breadcrumb navigation
    document.querySelectorAll('.sc-bc-item').forEach(el => {
      el.onclick = () => {
        const idx = parseInt(el.dataset.idx);
        _folderStack = _folderStack.slice(0, idx + 1);
        renderFileManager(_folderStack[_folderStack.length - 1].id);
      };
    });

  } catch (err) {
    const list = document.getElementById('sc-file-list');
    if (list) list.innerHTML = `<div class="sp-error">Fehler: ${esc(err.message)}</div>`;
  }
}

function renderBreadcrumb() {
  return _folderStack.map((entry, i) =>
    `<span class="sc-bc-item ${i === _folderStack.length - 1 ? 'active' : ''}"
           data-idx="${i}">${esc(entry.name)}</span>`
  ).join(' › ');
}

// ── Helpers ───────────────────────────────────────────
function esc(str) {
  return String(str ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function fmtSize(bytes) {
  if (bytes < 1024) return bytes + ' B';
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
  return (bytes / 1024 / 1024).toFixed(1) + ' MB';
}

function fileIcon(mime) {
  if (!mime) return '📄';
  if (mime.startsWith('image/'))       return '🖼';
  if (mime.startsWith('video/'))       return '🎬';
  if (mime.startsWith('audio/'))       return '🎵';
  if (mime.includes('pdf'))            return '📕';
  if (mime.includes('word') || mime.includes('document')) return '📝';
  if (mime.includes('spreadsheet') || mime.includes('excel')) return '📊';
  if (mime.includes('presentation') || mime.includes('powerpoint')) return '📊';
  if (mime.includes('zip') || mime.includes('archive')) return '🗜';
  return '📄';
}
