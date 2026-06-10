import { saveCredential, loadCredential, hasCredential } from './credentials.js';

export const SERVICES = [
  {
    id: 'webuntis',
    label: 'WebUntis',
    desc: 'Stundenplan & Vertretungen',
    fields: [
      { key: 'serverUrl', label: 'Server-URL',   type: 'url',      placeholder: 'https://bertolt-brecht.webuntis.com', default: 'https://bertolt-brecht.webuntis.com' },
      { key: 'school',    label: 'Schule',        type: 'text',     placeholder: 'bertolt-brecht', default: 'bertolt-brecht' },
      { key: 'username',  label: 'Benutzername',  type: 'text',     placeholder: '' },
      { key: 'password',  label: 'Passwort',      type: 'password', placeholder: '••••••••' },
    ],
  },
  {
    id: 'cloud_gelb',
    label: 'Gelbe Cloud',
    desc: 'Schul-Cloud (Nachrichten & Dateien)',
    fields: [
      { key: 'url',      label: 'URL',           type: 'url',      placeholder: 'https://...' },
      { key: 'username', label: 'Benutzername',   type: 'text',     placeholder: '' },
      { key: 'password', label: 'Passwort',       type: 'password', placeholder: '••••••••' },
    ],
  },
  {
    id: 'cloud_rot',
    label: 'Rote Cloud',
    desc: 'Schul-Cloud (Nachrichten & Dateien)',
    fields: [
      { key: 'url',      label: 'URL',           type: 'url',      placeholder: 'https://...' },
      { key: 'username', label: 'Benutzername',   type: 'text',     placeholder: '' },
      { key: 'password', label: 'Passwort',       type: 'password', placeholder: '••••••••' },
    ],
  },
  {
    id: 'gemini',
    label: 'Google Gemini',
    desc: 'KI-Analyse (optional)',
    hint: 'Key erstellen: aistudio.google.com → API Keys → Create API key',
    fields: [
      { key: 'apiKey', label: 'API Key', type: 'password', placeholder: 'AIzaSy...' },
    ],
  },
];

// Returns null if step has no filled required fields (i.e. user left it empty → treat as skip)
function collectValues(step) {
  const data = {};
  for (const f of step.fields) {
    const el = document.getElementById(`wz-${f.key}`);
    data[f.key] = el?.value.trim() ?? '';
  }
  const filled = Object.values(data).some(v => v.length > 0);
  return filled ? data : null;
}

export function createWizard({ uid, key, bodyEl, titleEl, subtitleEl, progressEl,
                                nextBtn, prevBtn, skipBtn, onComplete, onStepChange }) {
  let current = 0;

  async function prefill(step) {
    const existing = await loadCredential(uid, key, step.id).catch(() => null);
    for (const f of step.fields) {
      const el = document.getElementById(`wz-${f.key}`);
      if (!el) continue;
      if (existing) {
        el.value = existing[f.key] ?? '';
      } else if (f.default) {
        el.value = f.default;
      }
    }
  }

  function renderProgress() {
    progressEl.innerHTML = SERVICES.map((_, i) =>
      `<span class="wizard-dot ${i === current ? 'active' : i < current ? 'done' : ''}"></span>`
    ).join('');
  }

  async function render() {
    const step = SERVICES[current];
    const isLast = current === SERVICES.length - 1;

    titleEl.textContent    = step.label;
    subtitleEl.textContent = step.desc;
    nextBtn.textContent    = isLast ? 'Fertigstellen' : 'Weiter';
    prevBtn.classList.toggle('hidden', current === 0);
    renderProgress();

    bodyEl.innerHTML = `
      ${step.hint ? `<div class="wizard-hint">${step.hint}</div>` : ''}
      <div class="wizard-form">
        ${step.fields.map(f => `
          <div class="field">
            <label for="wz-${f.key}">${f.label}</label>
            <input id="wz-${f.key}" type="${f.type}" placeholder="${f.placeholder}" autocomplete="off" />
          </div>
        `).join('')}
      </div>
    `;

    await prefill(step);
    onStepChange?.(current);
  }

  async function saveCurrentStep() {
    const step = SERVICES[current];
    const data = collectValues(step);
    if (data) {
      await saveCredential(uid, key, step.id, data);
      return true;
    }
    return false;
  }

  nextBtn.onclick = async () => {
    nextBtn.disabled = true;
    await saveCurrentStep();
    if (current < SERVICES.length - 1) {
      current++;
      await render();
    } else {
      onComplete?.();
    }
    nextBtn.disabled = false;
  };

  prevBtn.onclick = async () => {
    if (current > 0) { current--; await render(); }
  };

  skipBtn.onclick = async () => {
    if (current < SERVICES.length - 1) {
      current++;
      await render();
    } else {
      onComplete?.();
    }
  };

  return {
    start: (index = 0) => { current = index; render(); },
  };
}
