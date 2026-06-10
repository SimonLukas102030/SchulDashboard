import { WEBUNTIS_PROXY } from './config.js';

// ── Mock data (serverUrl === 'mock://') ───────────────
const _MOCK_DOW = {
  1: [
    { p: 1, su: 'Mathe',      ro: 'R204',       te: 'Hr. Schmidt', c: '' },
    { p: 2, su: 'Mathe',      ro: 'R204',       te: 'Hr. Schmidt', c: '' },
    { p: 3, su: 'Deutsch',    ro: 'R101',       te: 'Fr. Müller',  c: '' },
    { p: 4, su: 'Englisch',   ro: 'R202',       te: 'Fr. Weber',   c: '' },
    { p: 5, su: 'Geschichte', ro: 'R105',       te: 'Hr. Braun',   c: 'cancelled' },
    { p: 6, su: 'Sport',      ro: 'Sporthalle', te: 'Hr. Fischer', c: '' },
  ],
  2: [
    { p: 1, su: 'Physik',     ro: 'R310', te: 'Hr. Klein',  c: '' },
    { p: 2, su: 'Bio',        ro: 'R308', te: 'Fr. Lange',  c: '' },
    { p: 3, su: 'Chemie',     ro: 'R307', te: 'Fr. Wolf',   c: 'irregular' },
    { p: 4, su: 'Informatik', ro: 'R405', te: 'Hr. Schulz', c: '' },
    { p: 5, su: 'Informatik', ro: 'R405', te: 'Hr. Schulz', c: '' },
    { p: 6, su: 'PB',         ro: 'R103', te: 'Hr. Braun',  c: '' },
  ],
  3: [
    { p: 1, su: 'Deutsch',  ro: 'R101',      te: 'Fr. Müller',  c: '' },
    { p: 2, su: 'Mathe',    ro: 'R204',      te: 'Hr. Schmidt', c: '' },
    { p: 3, su: 'Englisch', ro: 'R202',      te: 'Fr. Weber',   c: '' },
    { p: 4, su: 'Englisch', ro: 'R202',      te: 'Fr. Weber',   c: '' },
    { p: 5, su: 'PB',       ro: 'R103',      te: 'Hr. Braun',   c: '' },
    { p: 6, su: 'Musik',    ro: 'Musikraum', te: 'Fr. Meyer',   c: '' },
  ],
  4: [
    { p: 1, su: 'Bio',        ro: 'R308',       te: 'Fr. Lange',   c: '' },
    { p: 2, su: 'Chemie',     ro: 'R307',       te: 'Fr. Wolf',    c: '' },
    { p: 3, su: 'Geschichte', ro: 'R105',       te: 'Hr. Braun',   c: '' },
    { p: 4, su: 'Sport',      ro: 'Sporthalle', te: 'Hr. Fischer', c: '' },
    { p: 5, su: 'Sport',      ro: 'Sporthalle', te: 'Hr. Fischer', c: '' },
    { p: 6, su: 'Mathe',      ro: 'R204',       te: 'Hr. Schmidt', c: '' },
  ],
  5: [
    { p: 1, su: 'Englisch',   ro: 'R202', te: 'Fr. Weber',   c: '' },
    { p: 2, su: 'Physik',     ro: 'R310', te: 'Hr. Klein',   c: '' },
    { p: 3, su: 'Physik',     ro: 'R310', te: 'Hr. Klein',   c: '' },
    { p: 4, su: 'Informatik', ro: 'R405', te: 'Hr. Schulz',  c: '' },
    { p: 5, su: 'PB',         ro: 'R103', te: 'Hr. Braun',   c: 'cancelled' },
  ],
};

const _MOCK_TIMES = [
  null,
  { s: 745,  e: 830  },
  { s: 830,  e: 915  },
  { s: 930,  e: 1015 },
  { s: 1015, e: 1100 },
  { s: 1115, e: 1200 },
  { s: 1200, e: 1245 },
  { s: 1330, e: 1415 },
  { s: 1415, e: 1500 },
  { s: 1500, e: 1545 },
];

function _mockForDate(d) {
  const dow = d.getDay();
  if (dow === 0 || dow === 6) return [];
  const di = toDateInt(d);
  return (_MOCK_DOW[dow] ?? []).map(e => {
    const t = _MOCK_TIMES[e.p];
    return { date: di, startT: t.s, endT: t.e, start: fmtTime(t.s), end: fmtTime(t.e),
             subject: e.su, room: e.ro, teacher: e.te,
             status: e.c === 'cancelled' ? 'cancelled' : e.c === 'irregular' ? 'irregular' : 'normal' };
  });
}

function _mockWeek(date = new Date()) {
  const { mon, fri } = weekBounds(date);
  const out = [];
  for (const d = new Date(mon); d <= fri; d.setDate(d.getDate() + 1)) {
    out.push(..._mockForDate(new Date(d)));
  }
  return mergeSamePeriods(out);
}

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
  if (creds.serverUrl === 'mock://') return mergeSamePeriods(_mockForDate(new Date()));
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
  if (creds.serverUrl === 'mock://') return _mockWeek(date);
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
