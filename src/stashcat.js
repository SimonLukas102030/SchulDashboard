import { STASHCAT_PROXY } from './config.js';

const API_BASE  = 'https://api.stashcat.com';
const APP_NAME  = 'schul.cloud-browser-Chrome:120.0-4.11.1';

// ── Low-level ─────────────────────────────────────────
async function post(path, params) {
  const target = `${API_BASE}/${path}`;
  const body   = new URLSearchParams(params).toString();

  const resp = await fetch(`${STASHCAT_PROXY}/?target=${encodeURIComponent(target)}`, {
    method:  'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body,
  });

  if (!resp.ok) throw new Error(`Proxy-Fehler ${resp.status}`);
  const data = await resp.json();

  if (data.status?.value === 'FAILED') {
    throw new Error(data.status.message ?? data.status.short_message ?? 'stashcat-Fehler');
  }
  return data.payload;
}

// ── Auth ──────────────────────────────────────────────
export async function login(email, password, deviceId) {
  const payload = await post('auth/login', {
    email,
    password,
    device_id:  deviceId,
    app_name:   APP_NAME,
    encrypted:  'true',
    callable:   'true',
  });
  if (!payload.client_key) throw new Error('Login fehlgeschlagen — kein client_key');
  return payload.client_key;
}

export async function logout(clientKey, deviceId) {
  await post('auth/logout', { client_key: clientKey, device_id: deviceId }).catch(() => {});
}

// ── Channels ──────────────────────────────────────────
export async function getChannels(clientKey, deviceId) {
  const p = await post('channels/subscripted', { client_key: clientKey, device_id: deviceId });
  return (p.channels ?? []).map(ch => ({
    id:          ch.id,
    name:        ch.name,
    description: ch.description ?? '',
    memberCount: ch.member_count ?? 0,
    unread:      ch.unread_messages ?? 0,
    type:        'channel',
  }));
}

// ── Conversations (DMs) ───────────────────────────────
export async function getConversations(clientKey, deviceId) {
  const p = await post('message/conversations', { client_key: clientKey, device_id: deviceId });
  return (p.conversations ?? []).map(c => ({
    id:      c.id,
    name:    c.target?.name ?? c.target?.firstname + ' ' + (c.target?.lastname ?? ''),
    unread:  c.unread_messages ?? 0,
    lastMsg: c.last_message?.text ?? '',
    type:    'conversation',
  }));
}

// ── Messages ──────────────────────────────────────────
export async function getMessages(clientKey, deviceId, channelId, isConversation = false, count = 40) {
  const path   = isConversation ? 'message/conversation' : 'message/content';
  const idKey  = isConversation ? 'conversation_id' : 'channel_id';
  const p = await post(path, {
    client_key: clientKey,
    device_id:  deviceId,
    [idKey]:    channelId,
    count:      String(count),
  });

  const rawMessages = p.messages ?? p.channel_messages ?? [];
  return rawMessages.map(m => ({
    id:          m.id,
    sender:      m.sender?.firstname
                   ? `${m.sender.firstname} ${m.sender.lastname ?? ''}`.trim()
                   : (m.sender?.name ?? 'Unbekannt'),
    senderId:    m.sender?.id ?? '',
    text:        m.is_encrypted ? null : (m.text ?? ''),
    encrypted:   !!m.is_encrypted,
    createdAt:   m.created_at ? new Date(m.created_at * 1000) : null,
    hasFile:     !!(m.file_id || m.files?.length),
    fileId:      m.file_id ?? m.files?.[0]?.id ?? null,
    fileName:    m.files?.[0]?.name ?? null,
  })).reverse();
}

export async function sendMessage(clientKey, deviceId, channelId, text, isConversation = false) {
  const idKey = isConversation ? 'conversation_id' : 'channel_id';
  await post('message/send', {
    client_key:  clientKey,
    device_id:   deviceId,
    [idKey]:     channelId,
    text,
    is_encrypted: 'false',
  });
}

// ── Files ─────────────────────────────────────────────
export async function getFolder(clientKey, deviceId, folderId = null) {
  const params = { client_key: clientKey, device_id: deviceId };
  if (folderId) params.folder_id = folderId;
  const p = await post('file/folder', params);
  const items = [];
  for (const f of p.folders ?? []) {
    items.push({ id: f.id, name: f.name, type: 'folder', size: null });
  }
  for (const f of p.files ?? []) {
    items.push({
      id:   f.id,
      name: f.name,
      type: 'file',
      size: f.size ?? null,
      mime: f.mime ?? '',
      url:  f.url ?? null,
    });
  }
  return items;
}

export async function getFileDownloadUrl(clientKey, deviceId, fileId) {
  const p = await post('file/url', { client_key: clientKey, device_id: deviceId, file_id: fileId });
  return p.url ?? null;
}

// ── Users ─────────────────────────────────────────────
export async function getMe(clientKey, deviceId) {
  const p = await post('users/me', { client_key: clientKey, device_id: deviceId });
  return {
    id:    p.user?.id,
    name:  `${p.user?.firstname ?? ''} ${p.user?.lastname ?? ''}`.trim(),
    email: p.user?.email ?? '',
  };
}
