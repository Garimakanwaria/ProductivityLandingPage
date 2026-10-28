// Pure functions: no DOM, no storage. Safe to unit-test in Node.

export const MAX_MINUTES = 240;

const sum = (xs) => xs.reduce((a, b) => a + b, 0);

/** Local calendar day as YYYY-MM-DD (not UTC, so sessions land on the right day). */
export function dateKey(date = new Date()) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

export function parseKey(key) {
  const [y, m, d] = key.split('-').map(Number);
  return new Date(y, m - 1, d);
}

export function addDays(key, n) {
  const [y, m, d] = key.split('-').map(Number);
  return dateKey(new Date(y, m - 1, d + n));
}

/** 3725 -> "1h 2m", 1500 -> "25m", 42 -> "42s" */
export function formatDuration(totalSec) {
  const sec = Math.max(0, Math.round(totalSec));
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  if (h > 0) return `${h}h ${String(m).padStart(2, '0')}m`;
  if (m > 0) return `${m}m`;
  return `${sec}s`;
}

/** Countdown clock, rounds up so the display never shows 00:00 early. */
export function formatClock(totalSec) {
  const sec = Math.max(0, Math.ceil(totalSec));
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

export function timeOf(ms) {
  return new Date(ms).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
}

export function weekdayLabel(key) {
  return parseKey(key).toLocaleDateString(undefined, { weekday: 'short' });
}

export function dayTitle(key, now = new Date()) {
  const today = dateKey(now);
  if (key === today) return 'Today';
  if (key === addDays(today, -1)) return 'Yesterday';
  return parseKey(key).toLocaleDateString(undefined, { weekday: 'long', month: 'short', day: 'numeric' });
}

// ---------- Session lifecycle ----------
// A session's focus time is wall-clock time minus paused time. We store timestamps,
// not a ticking counter, so reloading or closing the tab never loses progress.

export function startSession({ id, task, plannedMinutes, now }) {
  return {
    id,
    task: (task || '').trim().slice(0, 80) || 'Untitled focus',
    plannedSec: plannedMinutes * 60,
    startedAt: now,
    pausedMs: 0,
    pausedAt: null,
    distractions: 0,
  };
}

export function elapsedFocusSec(active, now) {
  const currentPause = active.pausedAt ? now - active.pausedAt : 0;
  const ms = now - active.startedAt - active.pausedMs - currentPause;
  return Math.min(active.plannedSec, Math.max(0, ms / 1000));
}

export function remainingSec(active, now) {
  return Math.max(0, active.plannedSec - elapsedFocusSec(active, now));
}

export function pauseSession(active, now) {
  return active.pausedAt ? active : { ...active, pausedAt: now };
}

export function resumeSession(active, now) {
  if (!active.pausedAt) return active;
  return { ...active, pausedMs: active.pausedMs + (now - active.pausedAt), pausedAt: null };
}

/** Turns an active session into a stored record. */
export function finishSession(active, { now, status }) {
  const completed = status === 'completed';
  const { startedAt } = active;
  return {
    id: active.id,
    task: active.task,
    date: dateKey(new Date(startedAt)),
    startedAt,
    endedAt: completed ? startedAt + active.pausedMs + active.plannedSec * 1000 : now,
    plannedSec: active.plannedSec,
    focusedSec: Math.round(completed ? active.plannedSec : elapsedFocusSec(active, now)),
    status: completed ? 'completed' : 'stopped',
    distractions: active.distractions,
  };
}

// ---------- Analytics ----------

/** Focus seconds and completed counts for each of the last `days` days, oldest first. */
export function daySeries(sessions, endKey, days = 7) {
  const out = [];
  for (let i = days - 1; i >= 0; i--) {
    const date = addDays(endKey, -i);
    const day = sessions.filter((s) => s.date === date);
    out.push({
      date,
      seconds: sum(day.map((s) => s.focusedSec)),
      completed: day.filter((s) => s.status === 'completed').length,
    });
  }
  return out;
}

/** Consecutive days with at least one finished session. Today counts if it has one, otherwise the streak runs from yesterday. */
export function currentStreak(sessions, todayKey) {
  const done = new Set(sessions.filter((s) => s.status === 'completed').map((s) => s.date));
  let cursor = done.has(todayKey) ? todayKey : addDays(todayKey, -1);
  let streak = 0;
  while (done.has(cursor)) {
    streak++;
    cursor = addDays(cursor, -1);
  }
  return streak;
}

export function summarize(sessions, todayKey, goalMinutes) {
  const today = sessions.filter((s) => s.date === todayKey);
  const completed = sessions.filter((s) => s.status === 'completed');
  const goalSec = goalMinutes * 60;
  const todaySec = sum(today.map((s) => s.focusedSec));
  return {
    todaySec,
    todaySessions: today.length,
    todayCompleted: today.filter((s) => s.status === 'completed').length,
    todayDistractions: sum(today.map((s) => s.distractions || 0)),
    goalSec,
    goalPct: goalSec > 0 ? todaySec / goalSec : 0,
    streak: currentStreak(sessions, todayKey),
    totalSessions: sessions.length,
    completedTotal: completed.length,
    completionRate: sessions.length ? completed.length / sessions.length : null,
  };
}

/** Most-focused tasks since `sinceKey` (inclusive), grouped case-insensitively. */
export function topTasks(sessions, sinceKey, limit = 5) {
  const byTask = new Map();
  for (const s of sessions) {
    if (s.date < sinceKey) continue;
    const key = s.task.toLowerCase();
    const cur = byTask.get(key) || { task: s.task, seconds: 0 };
    cur.seconds += s.focusedSec;
    byTask.set(key, cur);
  }
  return [...byTask.values()].sort((a, b) => b.seconds - a.seconds).slice(0, limit);
}
