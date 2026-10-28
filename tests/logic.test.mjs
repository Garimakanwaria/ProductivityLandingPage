import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as L from '../js/logic.js';
import {
  loadState,
  saveState,
  normalizeSettings,
  sanitizeImport,
  mergeSessions,
  STORAGE_KEY,
} from '../js/storage.js';

const SEC = 1000;
const TODAY = '2026-10-28';

// ---------- Timing ----------

test('elapsed focus time excludes paused periods', () => {
  // Start at t=0, pause at 60s, resume at 120s. At 180s only 120s of focus has happened.
  let a = L.startSession({ id: 'x', task: 'Read', plannedMinutes: 25, now: 0 });
  a = L.pauseSession(a, 60 * SEC);
  a = L.resumeSession(a, 120 * SEC);
  assert.equal(L.elapsedFocusSec(a, 180 * SEC), 120);
});

test('time spent paused right now does not count as focus', () => {
  let a = L.startSession({ id: 'x', task: '', plannedMinutes: 25, now: 0 });
  a = L.pauseSession(a, 60 * SEC);
  assert.equal(L.elapsedFocusSec(a, 300 * SEC), 60);
  assert.equal(a.task, 'Untitled focus');
});

test('remaining time never goes below zero', () => {
  const a = L.startSession({ id: 'x', task: 't', plannedMinutes: 1, now: 0 });
  assert.equal(L.remainingSec(a, 10_000 * SEC), 0);
});

test('pausing twice and resuming twice is idempotent', () => {
  let a = L.startSession({ id: 'x', task: 't', plannedMinutes: 25, now: 0 });
  a = L.pauseSession(a, 10 * SEC);
  const again = L.pauseSession(a, 20 * SEC);
  assert.equal(again.pausedAt, 10 * SEC);
  const r1 = L.resumeSession(a, 30 * SEC);
  assert.equal(L.resumeSession(r1, 40 * SEC).pausedMs, 20 * SEC);
});

test('completed session is recorded at full planned length', () => {
  const a = L.startSession({ id: 'c', task: 'Essay', plannedMinutes: 25, now: 0 });
  const rec = L.finishSession(a, { now: 26 * 60 * SEC, status: 'completed' });
  assert.equal(rec.status, 'completed');
  assert.equal(rec.focusedSec, 25 * 60);
  assert.equal(rec.endedAt, 25 * 60 * SEC);
});

test('completed session with a pause ends after planned focus plus pause', () => {
  let a = L.startSession({ id: 'c', task: 'Essay', plannedMinutes: 1, now: 0 });
  a = L.pauseSession(a, 10 * SEC);
  a = L.resumeSession(a, 40 * SEC); // 30s paused
  const rec = L.finishSession(a, { now: 200 * SEC, status: 'completed' });
  assert.equal(rec.endedAt, (30 + 60) * SEC);
});

test('stopped session records only the focus time actually done', () => {
  const a = L.startSession({ id: 's', task: 'Problem set', plannedMinutes: 50, now: 0 });
  const rec = L.finishSession(a, { now: 600 * SEC, status: 'stopped' });
  assert.equal(rec.status, 'stopped');
  assert.equal(rec.focusedSec, 600);
  assert.equal(rec.plannedSec, 50 * 60);
});

test('distractions are carried into the record', () => {
  let a = L.startSession({ id: 'd', task: 't', plannedMinutes: 25, now: 0 });
  a = { ...a, distractions: 3 };
  assert.equal(L.finishSession(a, { now: 60 * SEC, status: 'stopped' }).distractions, 3);
});

// ---------- Dates & formatting ----------

test('addDays crosses month and year boundaries', () => {
  assert.equal(L.addDays('2026-10-01', -1), '2026-09-30');
  assert.equal(L.addDays('2026-12-31', 1), '2027-01-01');
  assert.equal(L.addDays('2026-02-28', 1), '2026-03-01');
});

test('formatDuration handles seconds, minutes and hours', () => {
  assert.equal(L.formatDuration(0), '0s');
  assert.equal(L.formatDuration(42), '42s');
  assert.equal(L.formatDuration(25 * 60), '25m');
  assert.equal(L.formatDuration(90 * 60), '1h 30m');
});

test('formatClock rounds up so it never shows 00:00 early', () => {
  assert.equal(L.formatClock(599.2), '10:00');
  assert.equal(L.formatClock(0.4), '00:01');
  assert.equal(L.formatClock(0), '00:00');
});

test('dayTitle labels today and yesterday', () => {
  const now = new Date(2026, 9, 28, 12);
  assert.equal(L.dayTitle('2026-10-28', now), 'Today');
  assert.equal(L.dayTitle('2026-10-27', now), 'Yesterday');
});

// ---------- Analytics ----------

const done = (date, sec = 1500) => ({ date, status: 'completed', focusedSec: sec, task: 'x', distractions: 0 });
const stop = (date, sec = 300) => ({ date, status: 'stopped', focusedSec: sec, task: 'x', distractions: 0 });

test('streak counts consecutive finished days ending today', () => {
  const s = [done('2026-10-26'), done('2026-10-27'), done('2026-10-28')];
  assert.equal(L.currentStreak(s, TODAY), 3);
});

test('streak survives a day with no session yet today', () => {
  const s = [done('2026-10-26'), done('2026-10-27')];
  assert.equal(L.currentStreak(s, TODAY), 2);
});

test('streak breaks on a gap and stopped sessions do not count', () => {
  const s = [done('2026-10-25'), stop('2026-10-27'), stop('2026-10-28'), done('2026-10-26')];
  assert.equal(L.currentStreak(s, TODAY), 0);
});

test('streak is zero with no history', () => {
  assert.equal(L.currentStreak([], TODAY), 0);
});

test('daySeries returns seven days oldest first with correct totals', () => {
  const s = [done('2026-10-28', 600), stop('2026-10-28', 300), done('2026-10-22', 900)];
  const series = L.daySeries(s, TODAY, 7);
  assert.equal(series.length, 7);
  assert.equal(series[0].date, '2026-10-22');
  assert.equal(series[6].date, TODAY);
  assert.equal(series[6].seconds, 900);
  assert.equal(series[6].completed, 1);
  assert.equal(series[0].seconds, 900);
});

test('summarize computes today, goal progress and completion rate', () => {
  const s = [done(TODAY, 1800), stop(TODAY, 600), done('2026-10-27', 1500)];
  const r = L.summarize(s, TODAY, 60); // 60 min goal
  assert.equal(r.todaySec, 2400);
  assert.equal(r.todaySessions, 2);
  assert.equal(r.todayCompleted, 1);
  assert.equal(r.goalPct, 2400 / 3600);
  assert.equal(r.completionRate, 2 / 3);
  assert.equal(r.streak, 2);
});

test('summarize handles no goal and no sessions', () => {
  const r = L.summarize([], TODAY, 0);
  assert.equal(r.goalSec, 0);
  assert.equal(r.goalPct, 0);
  assert.equal(r.completionRate, null);
});

test('topTasks groups case-insensitively and respects the since date', () => {
  const s = [
    { ...done(TODAY, 600), task: 'Chemistry' },
    { ...done('2026-10-27', 900), task: 'chemistry' },
    { ...done('2026-10-01', 9999), task: 'Old task' },
  ];
  const top = L.topTasks(s, '2026-10-22', 5);
  assert.equal(top.length, 1);
  assert.equal(top[0].seconds, 1500);
});

// ---------- Storage ----------

function fakeStorage(initial = {}) {
  const map = new Map(Object.entries(initial));
  return {
    getItem: (k) => (map.has(k) ? map.get(k) : null),
    setItem: (k, v) => map.set(k, String(v)),
    _map: map,
  };
}

test('loadState returns defaults when nothing is stored', () => {
  const st = loadState(fakeStorage());
  assert.equal(st.settings.defaultMinutes, 25);
  assert.deepEqual(st.sessions, []);
  assert.equal(st.active, null);
});

test('state round-trips through save and load', () => {
  const storage = fakeStorage();
  const st = loadState(storage);
  st.sessions.push({
    id: 'round-trip', task: 'Lab', date: TODAY, startedAt: 1, endedAt: 2,
    plannedSec: 1500, focusedSec: 1500, status: 'completed', distractions: 0,
  });
  st.settings.goalMinutes = 120;
  assert.equal(saveState(st, storage), true);
  const back = loadState(storage);
  assert.equal(back.sessions.length, 1);
  assert.equal(back.settings.goalMinutes, 120);
});

test('an active session survives reload', () => {
  const storage = fakeStorage();
  const st = loadState(storage);
  st.active = L.startSession({ id: 'live', task: 'Lab', plannedMinutes: 50, now: 1000 });
  saveState(st, storage);
  const back = loadState(storage);
  assert.equal(back.active.id, 'live');
  assert.equal(back.active.plannedSec, 3000);
});

test('corrupted storage is preserved in a backup key instead of being lost', () => {
  const storage = fakeStorage({ [STORAGE_KEY]: '{not json' });
  const st = loadState(storage);
  assert.deepEqual(st.sessions, []);
  assert.equal(storage._map.get(`${STORAGE_KEY}:corrupt-backup`), '{not json');
});

test('saveState reports failure instead of throwing when storage is full', () => {
  const storage = { setItem() { throw new Error('QuotaExceeded'); } };
  assert.equal(saveState({ a: 1 }, storage), false);
});

test('normalizeSettings clamps bad values to safe defaults', () => {
  const s = normalizeSettings({ defaultMinutes: 9999, goalMinutes: -5, blockList: ['  Insta  ', '', 42, 'x'.repeat(100)] });
  assert.equal(s.defaultMinutes, 25);
  assert.equal(s.goalMinutes, 180);
  assert.deepEqual(s.blockList.slice(0, 2), ['Insta', 'x'.repeat(40)]);
  assert.equal(s.blockList.length, 2);
});

test('normalizeSettings caps the block list at 30 items', () => {
  const list = Array.from({ length: 50 }, (_, i) => `site${i}`);
  assert.equal(normalizeSettings({ blockList: list }).blockList.length, 30);
});

// ---------- Import ----------

test('sanitizeImport rejects files that are not backups', () => {
  assert.equal(sanitizeImport(null), null);
  assert.equal(sanitizeImport({ hello: 'world' }), null);
  assert.equal(sanitizeImport({ sessions: 'nope' }), null);
});

test('sanitizeImport keeps valid sessions and drops malformed ones', () => {
  const good = { id: 'a', date: TODAY, startedAt: 1, focusedSec: 60, plannedSec: 1500, status: 'completed' };
  const bad = [
    { id: 'b', date: 'yesterday', startedAt: 1, focusedSec: 60, plannedSec: 1500, status: 'completed' },
    { id: 'c', date: TODAY, startedAt: 1, focusedSec: 60, plannedSec: 1500, status: 'deleted' },
    null,
  ];
  const out = sanitizeImport({ sessions: [good, ...bad] });
  assert.equal(out.sessions.length, 1);
  assert.equal(out.sessions[0].id, 'a');
});

test('mergeSessions adds only new ids and keeps chronological order', () => {
  const existing = [{ id: 'a', startedAt: 200 }];
  const incoming = [{ id: 'a', startedAt: 200 }, { id: 'b', startedAt: 100 }];
  const merged = mergeSessions(existing, incoming);
  assert.deepEqual(merged.map((s) => s.id), ['b', 'a']);
});
