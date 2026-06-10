import { WEBUNTIS_PROXY } from './config.js';

let _reqId = 0;

// ── Low-level JSON-RPC via CORS proxy ────────────────
async function rpc(target, method, params, sessionId = null, school = null) {
  const headers = { 'Content-Type': 'application/json' };
  if (sessionId) headers['X-Untis-Session'] = `${sessionId},${school ?? ''}`;

  const resp = await fetch(`${WEBUNTIS_PROXY}/?target=${encodeURIComponent(target)}`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ id: ++_reqId, jsonrpc: '2.0', method, params }),
  });

  if (!resp.ok) throw new Error(`Proxy-Fehler ${resp.status}`);
  const data = await resp.json();
  if (data.error) throw new Error(data.error.message ?? `WebUntis-Fehler ${data.error.code}`);
  return data.result;
}

function rpcTarget(serverUrl, school) {
  return `${serverUrl.replace(/\/$/, '')}/WebUntis/jsonrpc.do?school=${encodeURIComponent(school)}`;
}

// ── Public fetch functions ────────────────────────────
export async function fetchTodayTimetable(creds) {
  const { serverUrl, school, username, password } = creds;
  const target = rpcTarget(serverUrl, school);

  const auth = await rpc(target, 'authenticate', { user: username, password, client: 'SchulDashboard' });
  const { sessionId, personId, personType } = auth;

  const today = new Date();
  const dateInt = toDateInt(today);
  const raw = await rpc(target, 'getTimetable',
    { id: personId, type: personType, startDate: dateInt, endDate: dateInt },
    sessionId, school);

  rpc(target, 'logout', {}, sessionId, school).catch(() => {});
  return mergeSamePeriods(parsePeriods(raw ?? []));
}

export async function fetchWeekTimetable(creds, date = new Date()) {
  const { serverUrl, school, username, password } = creds;
  const target = rpcTarget(serverUrl, school);

  const auth = await rpc(target, 'authenticate', { user: username, password, client: 'SchulDashboard' });
  const { sessionId, personId, personType } = auth;

  const { mon, fri } = weekBounds(date);
  const raw = await rpc(target, 'getTimetable',
    { id: personId, type: personType, startDate: toDateInt(mon), endDate: toDateInt(fri) },
    sessionId, school);

  rpc(target, 'logout', {}, sessionId, school).catch(() => {});
  return mergeSamePeriods(parsePeriods(raw ?? []));
}

// ── Grouping helpers (used by stundenplan.js) ─────────
export function groupByTimeSlot(periods) {
  const slots = new Map();
  for (const p of periods) {
    const key = `${p.date}-${p.startT}-${p.endT}`;
    if (!slots.has(key)) slots.set(key, { start: p.start, end: p.end, date: p.date, periods: [] });
    slots.get(key).periods.push(p);
  }
  return [...slots.values()].sort((a, b) =>
    a.date !== b.date ? a.date - b.date : timeMins(a.start) - timeMins(b.start));
}

export function groupByDay(periods) {
  const days = new Map();
  for (const p of periods) {
    if (!days.has(p.date)) days.set(p.date, []);
    days.get(p.date).push(p);
  }
  return [...days.entries()].sort(([a], [b]) => a - b).map(([date, ps]) => ({
    date,
    label: dateLabel(date),
    slots: groupByTimeSlot(ps),
  }));
}

// ── Internal helpers ──────────────────────────────────
function parsePeriods(raw) {
  return raw
    .filter(p => p.lstype === 'ls' || p.lstype === 'ex')
    .map(p => ({
      date:    p.date,
      startT:  p.startTime,
      endT:    p.endTime,
      start:   fmtTime(p.startTime),
      end:     fmtTime(p.endTime),
      subject: p.su?.[0]?.name ?? '?',
      room:    p.ro?.[0]?.name ?? '-',
      teacher: p.te?.[0]?.name ?? '',
      status:  p.code === 'cancelled' ? 'cancelled'
             : p.code === 'irregular' ? 'irregular'
             : 'normal',
    }))
    .sort((a, b) => a.startT - b.startT);
}

function mergeSamePeriods(periods) {
  if (!periods.length) return [];
  const out = [];
  for (const cur of periods) {
    // Search backwards: parallel courses intersperse in startT-sorted order,
    // so the matching predecessor may not be the last element in `out`.
    let merged = false;
    for (let i = out.length - 1; i >= 0; i--) {
      const prev = out[i];
      if (prev.date    === cur.date    &&
          prev.endT    === cur.startT  &&
          prev.subject === cur.subject &&
          prev.room    === cur.room    &&
          prev.teacher === cur.teacher &&
          prev.status  === cur.status) {
        prev.endT = cur.endT;
        prev.end  = cur.end;
        merged = true;
        break;
      }
    }
    if (!merged) out.push({ ...cur });
  }
  return out;
}

function fmtTime(t) {
  return `${String(Math.floor(t / 100)).padStart(2, '0')}:${String(t % 100).padStart(2, '0')}`;
}

function toDateInt(d) {
  return d.getFullYear() * 10000 + (d.getMonth() + 1) * 100 + d.getDate();
}

function weekBounds(date) {
  const d   = new Date(date);
  const day = d.getDay();
  const mon = new Date(d); mon.setDate(d.getDate() + (day === 0 ? -6 : 1 - day));
  const fri = new Date(mon); fri.setDate(mon.getDate() + 4);
  return { mon, fri };
}

function timeMins(hhmm) {
  const [h, m] = hhmm.split(':').map(Number);
  return h * 60 + m;
}

function dateLabel(dateInt) {
  const y = Math.floor(dateInt / 10000);
  const m = Math.floor((dateInt % 10000) / 100);
  const d = dateInt % 100;
  return new Date(y, m - 1, d).toLocaleDateString('de-DE',
    { weekday: 'long', day: 'numeric', month: 'long' });
}
