import { groupByTimeSlot, groupByDay } from './webuntis.js';

// ── Today widget (used on home view + Stundenplan/Heute tab) ─
export function renderTodayWidget(containerEl, periods) {
  if (!periods || periods.length === 0) {
    containerEl.innerHTML = '<div class="sp-empty">Heute kein Unterricht</div>';
    return;
  }

  const slots  = groupByTimeSlot(periods);
  const now    = new Date();
  const nowMin = now.getHours() * 60 + now.getMinutes();

  containerEl.innerHTML = slots.map(slot => {
    const [sh, sm] = slot.start.split(':').map(Number);
    const [eh, em] = slot.end.split(':').map(Number);
    const startMin = sh * 60 + sm;
    const endMin   = eh * 60 + em;
    const isNow  = nowMin >= startMin && nowMin < endMin;
    const isPast = nowMin >= endMin;

    return `
      <div class="sp-slot${isNow ? ' sp-now' : isPast ? ' sp-past' : ''}">
        <div class="sp-time">
          <span>${slot.start}</span>
          <span class="sp-time-dash">–</span>
          <span>${slot.end}</span>
        </div>
        <div class="sp-rows">
          ${slot.periods.map(periodRow).join('')}
        </div>
      </div>`;
  }).join('');
}

// ── Week view ─────────────────────────────────────────
export function renderWeekView(containerEl, periods) {
  const days = groupByDay(periods);

  if (days.length === 0) {
    containerEl.innerHTML = '<div class="sp-empty">Keine Stunden in dieser Woche</div>';
    return;
  }

  containerEl.innerHTML = days.map(day => `
    <div class="sp-day">
      <div class="sp-day-header">${day.label}</div>
      <div class="sp-day-slots">
        ${day.slots.map(slot => `
          <div class="sp-slot">
            <div class="sp-time">
              <span>${slot.start}</span>
              <span class="sp-time-dash">–</span>
              <span>${slot.end}</span>
            </div>
            <div class="sp-rows">
              ${slot.periods.map(periodRow).join('')}
            </div>
          </div>`).join('')}
      </div>
    </div>`).join('');
}

function periodRow(p) {
  const cls   = p.status === 'cancelled' ? ' sp-cancelled'
              : p.status === 'irregular' ? ' sp-irregular' : '';
  const badge = p.status === 'cancelled'
    ? '<span class="sp-badge sp-badge-cancel">Ausfall</span>'
    : p.status === 'irregular'
    ? '<span class="sp-badge sp-badge-irr">Vertr.</span>' : '';
  return `
    <div class="sp-row${cls}">
      <span class="sp-subject">${esc(p.subject)}</span>
      <span class="sp-room">${esc(p.room)}</span>
      <span class="sp-teacher">${esc(p.teacher)}</span>
      ${badge}
    </div>`;
}

function esc(s) {
  return String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
}
