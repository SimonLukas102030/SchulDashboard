import {
  register, signIn, signInWithGoogle, submitMasterPassword, setupMasterPassword,
  signOut, deleteAccount, resetMasterPassword, tryRestoreSession, checkHasUserDoc,
  onAuthStateChanged, getCurrentUser, isSetupInProgress,
  getKey, emergencyReset,
} from './auth.js';

// ?reset=1 — clears all local state and signs out (recovery for broken auth state)
if (new URLSearchParams(location.search).has('reset')) {
  await emergencyReset();
  history.replaceState({}, '', location.pathname);
}

const MOCK_MODE = new URLSearchParams(location.search).has('mock');
import {
  hasAnyService, loadPrefs, savePrefs,
  hasCredential, deleteCredential, loadCredential,
} from './credentials.js';
import { SERVICES, createWizard } from './wizard.js';
import { fetchTodayTimetable, fetchWeekTimetable } from './webuntis.js';
import { renderTodayWidget, renderWeekView } from './stundenplan.js';
import { initCloud, renderCloudGelb, hasSession, teardown as cloudTeardown } from './cloud-gelb.js';

// ── Element refs ──────────────────────────────────────
const $ = id => document.getElementById(id);

const authOverlay   = $('auth-overlay');
const masterOverlay = $('master-overlay');
const dashboard     = $('dashboard');
const toastCtn      = $('toast-container');
const loginForm     = $('login-form');
const loginError    = $('login-error');
const loginBtn      = $('login-btn');
const regForm       = $('register-form');
const regError      = $('register-error');
const regBtn        = $('reg-btn');
const masterForm    = $('master-form');
const masterError   = $('master-error');
const masterBtn     = $('master-btn');
const sidebarEmail  = $('sidebar-email');
const topbarEmail   = $('topbar-email');
const topbarTitle   = $('topbar-title');
const settingsEmail = $('settings-email');
const themeToggle   = $('theme-toggle');

// ── Toast ─────────────────────────────────────────────
export function toast(msg, type = 'info', ms = 3500) {
  const el = document.createElement('div');
  el.className = `toast ${type}`;
  el.textContent = msg;
  toastCtn.appendChild(el);
  setTimeout(() => el.remove(), ms);
}

// ── Button loading ────────────────────────────────────
function setLoading(btn, on) {
  if (on) {
    btn.dataset.label = btn.textContent;
    btn.innerHTML = '<span class="spinner"></span>';
    btn.disabled = true;
  } else {
    btn.textContent = btn.dataset.label ?? '';
    btn.disabled = false;
  }
}

const showErr  = (el, msg) => { el.textContent = msg; el.classList.add('visible'); };
const clearErr = el         => { el.textContent = '';  el.classList.remove('visible'); };

function authMsg(code) {
  const map = {
    'auth/invalid-email':              'Ungültige E-Mail-Adresse.',
    'auth/user-not-found':             'Kein Konto mit dieser E-Mail gefunden.',
    'auth/wrong-password':             'Falsches Passwort.',
    'auth/invalid-credential':         'E-Mail oder Passwort falsch.',
    'auth/email-already-in-use':       'Diese E-Mail ist bereits registriert.',
    'auth/weak-password':              'Passwort zu schwach (min. 6 Zeichen).',
    'auth/too-many-requests':          'Zu viele Versuche — bitte kurz warten.',
    'auth/network-request-failed':     'Netzwerkfehler — bitte Verbindung prüfen.',
    'auth/unauthorized-domain':        'Diese Domain ist in Firebase nicht autorisiert. Bitte in der Firebase Console → Auth → Einstellungen → Autorisierte Domains eintragen.',
    'auth/operation-not-allowed':      'Google-Login ist in Firebase nicht aktiviert.',
    'auth/cancelled-popup-request':    'Anmeldung abgebrochen.',
    'auth/redirect-cancelled-by-user': 'Anmeldung abgebrochen.',
    'auth/user-disabled':              'Dieses Konto wurde deaktiviert.',
    'auth/account-exists-with-different-credential': 'Diese E-Mail ist bereits mit einem anderen Anmeldeverfahren verknüpft.',
    'auth/redirect-no-result': null, // message comes from the Error object directly
  };
  return map[code] !== undefined ? map[code] : (code ? `Fehler: ${code}` : 'Unbekannter Fehler.');
}

// ── Screen transitions ────────────────────────────────
function showAuth() {
  authOverlay.classList.remove('hidden');
  masterOverlay.classList.add('hidden');
  dashboard.classList.remove('visible');
}

function showMaster(mode = 'unlock') {
  authOverlay.classList.add('hidden');
  masterOverlay.classList.remove('hidden');
  dashboard.classList.remove('visible');
  masterOverlay.dataset.mode = mode;
  const isSetup = mode === 'setup';
  $('master-title').textContent = isSetup ? 'Master-Passwort festlegen' : 'Dashboard entsperren';
  $('master-hint').textContent  = isSetup
    ? 'Wähle ein Master-Passwort, das alle deine Zugangsdaten verschlüsselt. Es wird nie gespeichert — bei Verlust sind deine Daten nicht mehr zugänglich.'
    : 'Gib dein Master-Passwort ein, um deine verschlüsselten Zugangsdaten zu entschlüsseln. Es verlässt niemals dieses Gerät.';
  $('master-btn').textContent   = isSetup ? 'Festlegen' : 'Entsperren';
  $('master-pw2-field').classList.toggle('hidden', !isSetup);
  $('master-lock-icon').classList.toggle('hidden', isSetup);
  $('master-reset-btn').classList.toggle('hidden', isSetup); // only show on unlock
  clearErr(masterError);
  setTimeout(() => $('master-pw')?.focus(), 50);
}

async function showDashboard() {
  const user  = getCurrentUser();
  const email = user?.email ?? '';
  authOverlay.classList.add('hidden');
  masterOverlay.classList.add('hidden');
  dashboard.classList.add('visible');
  sidebarEmail.textContent  = email;
  topbarEmail.textContent   = email;
  settingsEmail.textContent = email;
  updateThemeIcon();
  $('home-date').textContent = new Date().toLocaleDateString('de-DE',
    { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
  await loadAndApplyPrefs();
  await checkFirstSetup();
  loadTimetableForHome();
}

// ── Prefs ─────────────────────────────────────────────
async function loadAndApplyPrefs() {
  const uid = getCurrentUser()?.uid;
  if (!uid) return;
  try {
    const prefs = await loadPrefs(uid);
    if (prefs.accentColor) applyAccent(prefs.accentColor);
  } catch { /* non-fatal */ }
}

function applyAccent(color) {
  document.documentElement.style.setProperty('--accent', color);
  const picker = $('accent-picker');
  if (picker) picker.value = color;
}

// ── First-setup check ─────────────────────────────────
async function checkFirstSetup() {
  const uid = getCurrentUser()?.uid;
  if (!uid) return;
  try {
    const hasAny = await hasAnyService(uid);
    if (!hasAny) {
      startWizard(0);
      toast('Willkommen! Richte deine Dienste ein.', 'info', 5000);
    }
  } catch { /* non-fatal */ }
}

// ── Auth state ────────────────────────────────────────
// _googleInProgress: prevents onAuthStateChanged from racing with the popup handler.
let _googleInProgress = false;

onAuthStateChanged(async user => {
  if (isSetupInProgress() || _googleInProgress) return;
  if (!user) {
    showAuth();
  } else {
    const restored = await tryRestoreSession();
    if (restored) {
      await showDashboard();
    } else {
      const hasDoc = await checkHasUserDoc();
      showMaster(hasDoc ? 'unlock' : 'setup');
    }
  }
});

// ── Auth tabs ─────────────────────────────────────────
document.querySelectorAll('.auth-tab').forEach(tab => {
  tab.addEventListener('click', () => {
    document.querySelectorAll('.auth-tab').forEach(t => t.classList.remove('active'));
    tab.classList.add('active');
    const t = tab.dataset.tab;
    loginForm.classList.toggle('hidden', t !== 'login');
    regForm.classList.toggle('hidden', t !== 'register');
    clearErr(loginError); clearErr(regError);
  });
});

// ── Login ─────────────────────────────────────────────
loginForm.addEventListener('submit', async e => {
  e.preventDefault();
  clearErr(loginError);
  setLoading(loginBtn, true);
  try {
    await signIn($('login-email').value.trim(), $('login-pw').value);
  } catch (err) {
    showErr(loginError, authMsg(err.code));
    setLoading(loginBtn, false);
  }
});

// ── Register ──────────────────────────────────────────
regForm.addEventListener('submit', async e => {
  e.preventDefault();
  clearErr(regError);
  const email   = $('reg-email').value.trim();
  const pw      = $('reg-pw').value;
  const master  = $('reg-master').value;
  const master2 = $('reg-master2').value;
  if (master !== master2) { showErr(regError, 'Master-Passwörter stimmen nicht überein.'); return; }
  if (master.length < 8)  { showErr(regError, 'Master-Passwort muss mind. 8 Zeichen lang sein.'); return; }
  setLoading(regBtn, true);
  try {
    await register(email, pw, master);
    await showDashboard();
    toast('Konto erstellt. Willkommen!', 'success');
  } catch (err) {
    showErr(regError, err.code ? authMsg(err.code) : err.message);
    setLoading(regBtn, false);
  }
});

// ── Google sign-in ────────────────────────────────────
$('google-btn').addEventListener('click', async () => {
  clearErr(loginError);
  setLoading($('google-btn'), true);
  _googleInProgress = true;
  try {
    const result = await signInWithGoogle();
    _googleInProgress = false;
    showMaster(result.isNewUser ? 'setup' : 'unlock');
  } catch (err) {
    _googleInProgress = false;
    // auth/popup-closed-by-user: user just closed the popup — no error message needed
    if (err.code !== 'auth/popup-closed-by-user' && err.code !== 'auth/cancelled-popup-request') {
      showErr(loginError, authMsg(err.code) ?? err.message);
    }
    setLoading($('google-btn'), false);
  }
});

// ── Master password ───────────────────────────────────
masterForm.addEventListener('submit', async e => {
  e.preventDefault();
  clearErr(masterError);
  const mode = masterOverlay.dataset.mode ?? 'unlock';
  const pw   = $('master-pw').value;
  if (mode === 'setup') {
    const pw2 = $('master-pw2').value;
    if (pw !== pw2)    { showErr(masterError, 'Passwörter stimmen nicht überein.'); return; }
    if (pw.length < 8) { showErr(masterError, 'Mind. 8 Zeichen erforderlich.'); return; }
  }
  setLoading(masterBtn, true);
  try {
    if (mode === 'setup') await setupMasterPassword(pw);
    else                  await submitMasterPassword(pw);
    $('master-pw').value  = '';
    $('master-pw2').value = '';
    await showDashboard();
    if (mode === 'setup') toast('Master-Passwort festgelegt.', 'success');
  } catch (err) {
    showErr(masterError, err.message);
    setLoading(masterBtn, false);
  }
});

$('master-logout-btn').addEventListener('click', async () => {
  await signOut(); showAuth();
});

$('master-reset-btn').addEventListener('click', async () => {
  if (!confirm('Alle gespeicherten Zugangsdaten gehen verloren. Wirklich neu einrichten?')) return;
  try {
    await resetMasterPassword();
    showMaster('setup');
    toast('Zurückgesetzt. Lege jetzt ein neues Master-Passwort fest.', 'info', 5000);
  } catch (err) {
    showErr(masterError, err.message);
  }
});

// ── Logout ────────────────────────────────────────────
async function doLogout() {
  await cloudTeardown().catch(() => {});
  await signOut(); showAuth();
  toast('Abgemeldet.', 'info');
}
$('logout-btn').addEventListener('click', doLogout);
$('settings-logout-btn').addEventListener('click', doLogout);

$('settings-delete-btn').addEventListener('click', async () => {
  if (!confirm('Konto und alle gespeicherten Daten unwiderruflich löschen?')) return;
  try {
    await deleteAccount();
    showAuth();
    toast('Konto gelöscht.', 'info');
  } catch (err) {
    // Firebase requires recent login for deleteUser — reauthenticate if needed
    if (err.code === 'auth/requires-recent-login') {
      toast('Bitte erst ab- und wieder anmelden, dann erneut versuchen.', 'error', 6000);
    } else {
      toast(err.message, 'error');
    }
  }
});

// ── Timetable state ───────────────────────────────────
let _todayPeriods = null;
let _weekPeriods  = null;
let _weekLoaded   = false;
let _cacheDate    = 0;     // YYYYMMDD when cache was last loaded

function todayInt() {
  const d = new Date();
  return d.getFullYear() * 10000 + (d.getMonth() + 1) * 100 + d.getDate();
}

function isTodayWeekend() {
  const d = new Date().getDay();
  return d === 0 || d === 6;
}

function invalidateCacheIfStale() {
  if (_cacheDate && _cacheDate !== todayInt()) {
    _todayPeriods = null;
    _weekPeriods  = null;
    _weekLoaded   = false;
    _cacheDate    = 0;
  }
}

async function loadWebUntisCreds() {
  if (MOCK_MODE) return { serverUrl: 'mock://', school: '', username: '', password: '' };
  const uid = getCurrentUser()?.uid;
  const key = getKey();
  if (!uid || !key) return null;
  return loadCredential(uid, key, 'webuntis').catch(() => null);
}

async function loadTimetableForHome() {
  const el = $('home-timetable');
  if (!el) return;

  invalidateCacheIfStale();

  if (isTodayWeekend()) {
    el.innerHTML = '<div class="sp-empty">Wochenende — kein Unterricht heute.</div>';
    return;
  }

  if (_todayPeriods) { renderTodayWidget(el, _todayPeriods); return; }

  el.innerHTML = '<div class="sp-loading">Laden…</div>';

  const creds = await loadWebUntisCreds();
  if (!creds) {
    el.innerHTML = `<div class="sp-empty">
      WebUntis nicht eingerichtet.
      <button class="btn btn-primary btn-sm" id="home-setup-wu">Einrichten</button>
    </div>`;
    $('home-setup-wu')?.addEventListener('click', () => startWizard(0));
    return;
  }

  try {
    _todayPeriods = await fetchTodayTimetable(creds);
    _cacheDate    = todayInt();
    renderTodayWidget(el, _todayPeriods);
  } catch (err) {
    const isFetchFail = err.message === 'Failed to fetch';
    const msg = isFetchFail ? 'Proxy nicht erreichbar — Worker deployed?' : err.message;
    el.innerHTML = `<div class="sp-error">Fehler: ${msg}</div>`;
    if (!isFetchFail) toast(`WebUntis: ${err.message}`, 'error');
  }
}

async function renderStundenplanPage() {
  // Always land on Heute tab when navigating to this view
  $('sp-tab-heute')?.classList.add('active');
  $('sp-tab-woche')?.classList.remove('active');
  $('sp-panel-heute')?.classList.remove('hidden');
  $('sp-panel-woche')?.classList.add('hidden');

  const panel = $('sp-panel-heute');
  if (!panel) return;

  invalidateCacheIfStale();

  if (isTodayWeekend()) {
    panel.innerHTML = '<div class="sp-empty">Wochenende — kein Unterricht heute.</div>';
    return;
  }

  if (_todayPeriods) { renderTodayWidget(panel, _todayPeriods); return; }

  panel.innerHTML = '<div class="sp-loading">Laden…</div>';
  const creds = await loadWebUntisCreds();
  if (!creds) { panel.innerHTML = '<div class="sp-empty">WebUntis nicht konfiguriert.</div>'; return; }
  try {
    _todayPeriods = await fetchTodayTimetable(creds);
    _cacheDate    = todayInt();
    renderTodayWidget(panel, _todayPeriods);
  } catch (err) {
    const isFetchFail = err.message === 'Failed to fetch';
    panel.innerHTML = `<div class="sp-error">Fehler: ${isFetchFail ? 'Proxy nicht erreichbar' : err.message}</div>`;
  }
}

async function loadWeekForStundenplan() {
  const panel = $('sp-panel-woche');
  if (!panel) return;
  invalidateCacheIfStale();
  if (_weekLoaded && _weekPeriods && _cacheDate === todayInt()) { renderWeekView(panel, _weekPeriods); return; }
  panel.innerHTML = '<div class="sp-loading">Woche wird geladen…</div>';
  const creds = await loadWebUntisCreds();
  if (!creds) { panel.innerHTML = '<div class="sp-empty">WebUntis nicht konfiguriert.</div>'; return; }
  try {
    _weekPeriods = await fetchWeekTimetable(creds);
    _weekLoaded  = true;
    _cacheDate   = todayInt();
    renderWeekView(panel, _weekPeriods);
  } catch (err) {
    panel.innerHTML = `<div class="sp-error">Fehler: ${err.message}</div>`;
  }
}

// ── Cloud Gelb ────────────────────────────────────────
async function renderCloudView() {
  const container = $('cloud-gelb-container');
  if (!container) return;

  if (hasSession()) {
    await renderCloudGelb(container);
    return;
  }

  const uid = getCurrentUser()?.uid;
  const key = getKey();
  if (!uid || !key) { container.innerHTML = '<div class="sp-error">Nicht eingeloggt.</div>'; return; }

  const creds = await loadCredential(uid, key, 'cloud_gelb').catch(() => null);
  if (!creds?.email || !creds?.password) {
    container.innerHTML = `<div class="sp-empty">
      Gelbe Cloud nicht eingerichtet.
      <button class="btn btn-primary btn-sm" id="cloud-setup-btn" style="margin-top:12px">Einrichten</button>
    </div>`;
    $('cloud-setup-btn')?.addEventListener('click', () => {
      const idx = SERVICES.findIndex(s => s.id === 'cloud_gelb');
      startWizard(idx);
    });
    return;
  }

  container.innerHTML = '<div class="sp-loading" style="padding:2rem">Verbinde mit Gelber Cloud…</div>';
  try {
    await initCloud(creds);
    await renderCloudGelb(container);
  } catch (err) {
    container.innerHTML = `<div class="sp-error" style="padding:2rem">
      Login fehlgeschlagen: ${err.message}
      <br><button class="btn btn-ghost btn-sm" id="cloud-retry-btn" style="margin-top:12px">Erneut versuchen</button>
    </div>`;
    $('cloud-retry-btn')?.addEventListener('click', renderCloudView);
  }
}

// ── View routing ──────────────────────────────────────
const VIEWS = {
  home:        { el: $('view-home'),         title: 'Übersicht'         },
  stundenplan: { el: $('view-stundenplan'),   title: 'Stundenplan'       },
  'cloud-gelb':{ el: $('view-cloud-gelb'),   title: 'Gelbe Cloud'       },
  settings:    { el: $('view-settings'),      title: 'Einstellungen'     },
  onboarding:  { el: $('view-onboarding'),    title: 'Dienste einrichten'},
};

function closeMobileSidebar() {
  document.querySelector('.sidebar')?.classList.remove('open');
  $('sidebar-backdrop')?.classList.remove('visible');
}

function navigate(key) {
  closeMobileSidebar();
  Object.entries(VIEWS).forEach(([k, v]) => {
    v.el.classList.toggle('hidden', k !== key);
    document.querySelector(`[data-view="${k}"]`)?.classList.toggle('active', k === key);
  });
  topbarTitle.textContent = VIEWS[key]?.title ?? '';
  if (key === 'settings')    renderSettingsServices();
  if (key === 'stundenplan') renderStundenplanPage();
  if (key === 'cloud-gelb')  renderCloudView();
}

document.querySelectorAll('[data-view]').forEach(btn => {
  btn.addEventListener('click', () => navigate(btn.dataset.view));
});

// ── Settings — services list ──────────────────────────
async function renderSettingsServices() {
  const uid  = getCurrentUser()?.uid;
  const list = $('services-list');
  if (!uid || !list) return;

  list.innerHTML = SERVICES.map(s =>
    `<div class="service-card" id="svc-${s.id}">
      <div class="service-card-top">
        <div>
          <div class="service-name">${s.label}</div>
          <div class="service-desc">${s.desc}</div>
        </div>
        <span class="service-badge missing" id="badge-${s.id}">Lädt…</span>
      </div>
      <div class="service-actions">
        <button class="btn btn-ghost" id="svc-edit-${s.id}">Einrichten</button>
        <button class="btn btn-danger hidden" id="svc-del-${s.id}">Löschen</button>
      </div>
    </div>`
  ).join('');

  for (const s of SERVICES) {
    const configured = await hasCredential(uid, s.id).catch(() => false);
    const badge   = $(`badge-${s.id}`);
    const editBtn = $(`svc-edit-${s.id}`);
    const delBtn  = $(`svc-del-${s.id}`);
    if (configured) {
      badge.textContent = 'Konfiguriert';
      badge.className   = 'service-badge ok';
      editBtn.textContent = 'Bearbeiten';
      delBtn.classList.remove('hidden');
    } else {
      badge.textContent = 'Nicht konfiguriert';
    }

    editBtn.addEventListener('click', () => {
      const idx = SERVICES.findIndex(x => x.id === s.id);
      startWizard(idx);
    });

    delBtn.addEventListener('click', async () => {
      if (!confirm(`${s.label}-Zugangsdaten löschen?`)) return;
      await deleteCredential(uid, s.id);
      toast(`${s.label} entfernt.`, 'info');
      renderSettingsServices();
    });
  }
}

$('settings-setup-btn').addEventListener('click', () => startWizard(0));

// ── Wizard ────────────────────────────────────────────
let _wizard = null;

function startWizard(startStep = 0) {
  const uid = getCurrentUser()?.uid;
  const key = getKey();
  if (!uid || !key) return;

  navigate('onboarding');

  _wizard = createWizard({
    uid, key,
    bodyEl:     $('wizard-body'),
    titleEl:    $('wizard-title'),
    subtitleEl: $('wizard-subtitle'),
    progressEl: $('wizard-progress'),
    nextBtn:    $('wizard-next'),
    prevBtn:    $('wizard-prev'),
    skipBtn:    $('wizard-skip'),
    onComplete: () => {
      toast('Zugangsdaten gespeichert.', 'success');
      _todayPeriods = null; _weekPeriods = null; _weekLoaded = false; _cacheDate = 0;
      navigate('settings');
      loadTimetableForHome();
    },
  });
  _wizard.start(startStep);
}

// ── Accent color ──────────────────────────────────────
$('accent-picker').addEventListener('input', async e => {
  const color = e.target.value;
  applyAccent(color);
  const uid = getCurrentUser()?.uid;
  if (uid) await savePrefs(uid, { accentColor: color }).catch(() => {});
});

// ── Theme ─────────────────────────────────────────────
const ICON_SUN  = `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="5"/><line x1="12" y1="1" x2="12" y2="3"/><line x1="12" y1="21" x2="12" y2="23"/><line x1="4.22" y1="4.22" x2="5.64" y2="5.64"/><line x1="18.36" y1="18.36" x2="19.78" y2="19.78"/><line x1="1" y1="12" x2="3" y2="12"/><line x1="21" y1="12" x2="23" y2="12"/><line x1="4.22" y1="19.78" x2="5.64" y2="18.36"/><line x1="18.36" y1="5.64" x2="19.78" y2="4.22"/></svg>`;
const ICON_MOON = `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/></svg>`;

function updateThemeIcon() {
  const dark = document.documentElement.dataset.theme !== 'light';
  themeToggle.innerHTML = dark ? ICON_SUN : ICON_MOON;
  themeToggle.title = dark ? 'Zum hellen Modus wechseln' : 'Zum dunklen Modus wechseln';
}

themeToggle.addEventListener('click', () => {
  const next = document.documentElement.dataset.theme === 'light' ? 'dark' : 'light';
  document.documentElement.dataset.theme = next;
  localStorage.setItem('sd-theme', next);
  updateThemeIcon();
});

const saved = localStorage.getItem('sd-theme');
if (saved) document.documentElement.dataset.theme = saved;
updateThemeIcon();

// ── Stundenplan tabs ──────────────────────────────────
$('sp-tab-heute')?.addEventListener('click', () => {
  $('sp-tab-heute').classList.add('active');
  $('sp-tab-woche').classList.remove('active');
  $('sp-panel-heute').classList.remove('hidden');
  $('sp-panel-woche').classList.add('hidden');
  if (_todayPeriods) renderTodayWidget($('sp-panel-heute'), _todayPeriods);
});

$('sp-tab-woche')?.addEventListener('click', () => {
  $('sp-tab-woche').classList.add('active');
  $('sp-tab-heute').classList.remove('active');
  $('sp-panel-woche').classList.remove('hidden');
  $('sp-panel-heute').classList.add('hidden');
  loadWeekForStundenplan();
});

$('sp-refresh')?.addEventListener('click', async () => {
  _weekLoaded = false; _weekPeriods = null; _todayPeriods = null;
  await renderStundenplanPage();
  if (!$('sp-panel-woche').classList.contains('hidden')) await loadWeekForStundenplan();
});

$('home-refresh')?.addEventListener('click', async () => {
  _todayPeriods = null;
  await loadTimetableForHome();
});

// ── Mobile sidebar ────────────────────────────────────
$('mobile-menu-btn')?.addEventListener('click', () => {
  document.querySelector('.sidebar').classList.toggle('open');
  $('sidebar-backdrop').classList.toggle('visible');
});
$('sidebar-backdrop')?.addEventListener('click', closeMobileSidebar);
