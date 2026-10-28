import {
  loadState,
  saveState,
  defaultState,
  normalizeSettings,
  sanitizeImport,
  mergeSessions,
} from './storage.js';
import * as L from './logic.js';

const RING_CIRCUMFERENCE = 2 * Math.PI * 100;
const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => [...document.querySelectorAll(sel)];
const esc = (v) =>
  String(v).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const newId = () =>
  globalThis.crypto?.randomUUID?.() ?? `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;

let state = loadState();
let awaySince = null;
let toastTimer = null;
let audioCtx = null;

// ---------- Helpers ----------

function persist() {
  if (!saveState(state)) toast('Could not save. Browser storage may be full or blocked.', 6000);
}

function toast(message, ms = 3200) {
  const el = $('#toast');
  el.textContent = message;
  el.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => (el.hidden = true), ms);
}

function chime() {
  try {
    audioCtx = audioCtx || new (window.AudioContext || window.webkitAudioContext)();
    const osc = audioCtx.createOscillator();
    const gain = audioCtx.createGain();
    const t = audioCtx.currentTime;
    osc.frequency.value = 660;
    osc.connect(gain);
    gain.connect(audioCtx.destination);
    gain.gain.setValueAtTime(0.0001, t);
    gain.gain.exponentialRampToValueAtTime(0.2, t + 0.05);
    gain.gain.exponentialRampToValueAtTime(0.0001, t + 1.2);
    osc.start(t);
    osc.stop(t + 1.3);
  } catch {
    /* audio is optional */
  }
}

function clampMinutes(value) {
  const n = Math.round(Number(value));
  return Number.isFinite(n) && n >= 1 && n <= L.MAX_MINUTES ? n : null;
}

// ---------- Timer ----------

let tickTimerId = null;

function startTicking() {
  stopTicking();
  tick();
  tickTimerId = setInterval(tick, 250);
}

function stopTicking() {
  clearInterval(tickTimerId);
  tickTimerId = null;
}

function tick() {
  if (!state.active) return stopTicking();
  if (L.remainingSec(state.active, Date.now()) <= 0) return completeSession();
  renderRunning();
}

function finish(status) {
  const record = L.finishSession(state.active, { now: Date.now(), status });
  state.sessions.push(record);
  state.active = null;
  persist();
  stopTicking();
  document.title = 'FocusFlow';
  renderAll();
  return record;
}

function completeSession() {
  const record = finish('completed');
  chime();
  toast(`Session complete. ${L.formatDuration(record.focusedSec)} of focus logged.`, 6000);
}

function logDistraction(message) {
  if (!state.active) return;
  state.active.distractions++;
  persist();
  renderRunning();
  toast(message);
}

function renderRunning() {
  const a = state.active;
  if (!a) return;
  const now = Date.now();
  const remaining = L.remainingSec(a, now);
  const progress = 1 - remaining / a.plannedSec;

  $('#clock').textContent = L.formatClock(remaining);
  $('#run-task').textContent = a.task;
  $('#run-state').textContent = a.pausedAt ? 'Paused' : 'Focusing';
  $('#pause-btn').textContent = a.pausedAt ? 'Resume' : 'Pause';
  $('#ring-progress').style.strokeDashoffset = String(RING_CIRCUMFERENCE * (1 - progress));
  $('#run-distractions').textContent = a.distractions
    ? `${a.distractions} distraction${a.distractions === 1 ? '' : 's'} logged this session`
    : 'No distractions logged this session';
  document.title = `${L.formatClock(remaining)} · FocusFlow`;
}

function renderTimer() {
  const running = !!state.active;
  $('#start-form').hidden = running;
  $('#running').hidden = !running;
  if (running) renderRunning();
  renderSide();
}

function renderSide() {
  const { blockList, goalMinutes } = state.settings;
  $('#block-chips').innerHTML = blockList.length
    ? blockList.map((x) => `<li>${esc(x)}</li>`).join('')
    : '<li class="muted">Nothing listed yet. Add apps and sites in Settings.</li>';
  const { todaySec, todaySessions } = L.summarize(state.sessions, L.dateKey(), goalMinutes);
  $('#today-mini').textContent = `${L.formatDuration(todaySec)} focused, ${todaySessions} session${todaySessions === 1 ? '' : 's'}`;
}

function syncPresets() {
  const value = String($('#custom-minutes').value);
  $$('.preset').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.minutes === value)));
}

// ---------- Insights ----------

function renderInsights() {
  const today = L.dateKey();
  const { goalMinutes } = state.settings;
  const s = L.summarize(state.sessions, today, goalMinutes);
  const week = L.daySeries(state.sessions, today, 7);
  const weekSec = week.reduce((a, d) => a + d.seconds, 0);

  $('#s-today').textContent = L.formatDuration(s.todaySec);
  $('#s-today-sub').textContent = `${s.todayCompleted} finished of ${s.todaySessions} started`;

  if (s.goalSec > 0) {
    $('#s-goal').textContent = `${Math.min(100, Math.round(s.goalPct * 100))}%`;
    $('#s-goal-bar').style.width = `${Math.min(100, s.goalPct * 100)}%`;
    $('#s-goal-sub').textContent = `${L.formatDuration(s.todaySec)} of ${L.formatDuration(s.goalSec)}`;
  } else {
    $('#s-goal').textContent = 'Not set';
    $('#s-goal-bar').style.width = '0%';
    $('#s-goal-sub').textContent = 'Set a goal in Settings';
  }

  $('#s-streak').textContent = s.streak;
  $('#s-rate').textContent = s.completionRate === null ? '—' : `${Math.round(s.completionRate * 100)}%`;
  $('#s-rate-sub').textContent = `${s.completedTotal} of ${s.totalSessions} sessions, all time`;

  const scale = Math.max(30 * 60, ...week.map((d) => d.seconds));
  $('#week-chart').innerHTML = week
    .map((d) => {
      const h = Math.round((d.seconds / scale) * 100);
      const cls = d.date === today ? 'bar-fill is-today' : 'bar-fill';
      return `<div class="bar-col">
        <div class="bar-track"><div class="${cls}" style="height:${h}%" title="${esc(L.formatDuration(d.seconds))}"></div></div>
        <span class="bar-label">${L.weekdayLabel(d.date)}</span>
      </div>`;
    })
    .join('');
  $('#week-total').textContent = `${L.formatDuration(weekSec)} in the last 7 days`;

  const top = L.topTasks(state.sessions, L.addDays(today, -6), 5);
  $('#top-tasks').innerHTML = top.length
    ? top.map((t) => `<li><span>${esc(t.task)}</span><span class="muted">${L.formatDuration(t.seconds)}</span></li>`).join('')
    : '<li class="muted">No focus sessions in the last 7 days.</li>';
}

// ---------- History ----------

function renderHistory() {
  const list = $('#history-list');
  if (!state.sessions.length) {
    list.innerHTML = '<p class="empty">No sessions yet. Finish one and it will show up here.</p>';
    return;
  }
  const byDay = new Map();
  [...state.sessions]
    .sort((a, b) => b.startedAt - a.startedAt)
    .forEach((s) => {
      if (!byDay.has(s.date)) byDay.set(s.date, []);
      byDay.get(s.date).push(s);
    });

  list.innerHTML = [...byDay]
    .map(([date, items]) => {
      const total = items.reduce((a, s) => a + s.focusedSec, 0);
      const rows = items
        .map((s) => {
          const d = s.distractions ? ` · ${s.distractions} distraction${s.distractions === 1 ? '' : 's'}` : '';
          const status = s.status === 'completed' ? 'Finished' : 'Stopped early';
          return `<li class="session">
            <div>
              <strong>${esc(s.task)}</strong>
              <div class="muted small">${L.timeOf(s.startedAt)}–${L.timeOf(s.endedAt)} · ${L.formatDuration(s.focusedSec)} of ${L.formatDuration(s.plannedSec)}${d}</div>
            </div>
            <div class="session-actions">
              <span class="badge ${s.status}">${status}</span>
              <button class="icon-btn" type="button" data-delete="${esc(s.id)}" aria-label="Delete session: ${esc(s.task)}">Delete</button>
            </div>
          </li>`;
        })
        .join('');
      return `<section class="day">
        <header class="day-head"><h3>${L.dayTitle(date)}</h3><span class="muted">${L.formatDuration(total)}</span></header>
        <ul class="sessions">${rows}</ul>
      </section>`;
    })
    .join('');
}

// ---------- Settings ----------

function fillSettings() {
  $('#goal-input').value = state.settings.goalMinutes;
  $('#default-input').value = state.settings.defaultMinutes;
  $('#block-input').value = state.settings.blockList.join('\n');
}

// ---------- Views ----------

function renderAll() {
  renderTimer();
  renderInsights();
  renderHistory();
  fillSettings();
}

function showView(name) {
  $$('.view').forEach((v) => (v.hidden = v.dataset.view !== name));
  $$('.tab').forEach((b) =>
    b.dataset.view === name ? b.setAttribute('aria-current', 'page') : b.removeAttribute('aria-current')
  );
  renderAll();
}

// ---------- Event wiring ----------

$$('.tab').forEach((b) => b.addEventListener('click', () => showView(b.dataset.view)));

$$('.preset').forEach((b) =>
  b.addEventListener('click', () => {
    $('#custom-minutes').value = b.dataset.minutes;
    syncPresets();
  })
);
$('#custom-minutes').addEventListener('input', syncPresets);

$('#start-form').addEventListener('submit', (e) => {
  e.preventDefault();
  if (state.active) return;
  const minutes = clampMinutes($('#custom-minutes').value);
  if (!minutes) {
    toast(`Enter a length from 1 to ${L.MAX_MINUTES} minutes.`);
    return;
  }
  state.active = L.startSession({
    id: newId(),
    task: $('#task-input').value,
    plannedMinutes: minutes,
    now: Date.now(),
  });
  persist();
  renderTimer();
  startTicking();
});

$('#pause-btn').addEventListener('click', () => {
  const a = state.active;
  if (!a) return;
  const now = Date.now();
  state.active = a.pausedAt ? L.resumeSession(a, now) : L.pauseSession(a, now);
  persist();
  renderRunning();
});

$('#tempt-btn').addEventListener('click', () => logDistraction('Logged. Take one breath, then back to the task.'));

$('#end-btn').addEventListener('click', () => {
  if (!state.active) return;
  if (!window.confirm('End this session early? It will be saved as stopped.')) return;
  const record = finish('stopped');
  toast(`Saved. ${L.formatDuration(record.focusedSec)} of focus logged.`);
});

// Leaving the tab during a running (unpaused) session counts as a distraction.
document.addEventListener('visibilitychange', () => {
  if (document.hidden) {
    awaySince = state.active && !state.active.pausedAt ? Date.now() : null;
    return;
  }
  const since = awaySince;
  awaySince = null;
  if (!state.active) return;
  if (L.remainingSec(state.active, Date.now()) <= 0) return completeSession();
  if (since && Date.now() - since >= 3000) {
    const secs = Math.round((Date.now() - since) / 1000);
    logDistraction(`You left this tab for ${secs}s. Logged as a distraction.`);
  }
});

$('#settings-form').addEventListener('submit', (e) => {
  e.preventDefault();
  const goal = Number($('#goal-input').value);
  const def = Number($('#default-input').value);
  if (!Number.isInteger(goal) || goal < 0 || goal > 1440) return toast('Daily goal must be between 0 and 1440 minutes.');
  if (!Number.isInteger(def) || def < 1 || def > L.MAX_MINUTES) {
    return toast(`Default length must be between 1 and ${L.MAX_MINUTES} minutes.`);
  }
  state.settings = normalizeSettings({
    goalMinutes: goal,
    defaultMinutes: def,
    blockList: $('#block-input').value.split('\n'),
  });
  persist();
  if (!state.active) {
    $('#custom-minutes').value = state.settings.defaultMinutes;
    syncPresets();
  }
  renderAll();
  toast('Settings saved.');
});

$('#history-list').addEventListener('click', (e) => {
  const id = e.target.closest('[data-delete]')?.dataset.delete;
  if (!id) return;
  if (!window.confirm('Delete this session? This cannot be undone.')) return;
  state.sessions = state.sessions.filter((s) => s.id !== id);
  persist();
  renderAll();
  toast('Session deleted.');
});

$('#export-btn').addEventListener('click', () => {
  const data = { app: 'focusflow', exportedAt: new Date().toISOString(), settings: state.settings, sessions: state.sessions };
  const url = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = `focusflow-backup-${L.dateKey()}.json`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
});

$('#import-input').addEventListener('change', async (e) => {
  const input = e.target;
  const file = input.files[0];
  input.value = '';
  if (!file) return;
  try {
    const incoming = sanitizeImport(JSON.parse(await file.text()));
    if (!incoming) return toast('That file is not a FocusFlow backup.', 5000);
    const before = state.sessions.length;
    state.sessions = mergeSessions(state.sessions, incoming.sessions);
    if (incoming.settings) state.settings = incoming.settings;
    persist();
    renderAll();
    toast(`Imported ${state.sessions.length - before} new session(s).`, 5000);
  } catch {
    toast('Could not read that file. Check that it is a valid backup.', 5000);
  }
});

$('#clear-btn').addEventListener('click', () => {
  if (!window.confirm('Erase all FocusFlow data in this browser? Export a backup first if you want to keep it.')) return;
  stopTicking();
  state = defaultState();
  persist();
  $('#custom-minutes').value = state.settings.defaultMinutes;
  syncPresets();
  renderAll();
  toast('All data erased.');
});

// ---------- Start ----------

function init() {
  // A session may have finished while the app was closed. Log it instead of leaving it dangling.
  if (state.active && L.remainingSec(state.active, Date.now()) <= 0) {
    finish('completed');
    toast('Your last session finished while the app was closed. It has been logged.', 6000);
  }
  $('#custom-minutes').value = state.settings.defaultMinutes;
  syncPresets();
  showView('focus');
  if (state.active) startTicking();
}

init();
