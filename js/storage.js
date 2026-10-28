// Persistence for FocusFlow. Everything lives in this browser's localStorage.

export const STORAGE_KEY = 'focusflow:v1';

export const DEFAULT_SETTINGS = Object.freeze({
  defaultMinutes: 25,
  goalMinutes: 180,
  blockList: ['Instagram', 'YouTube', 'TikTok', 'Reddit'],
});

export function defaultState() {
  return {
    version: 1,
    settings: { ...DEFAULT_SETTINGS, blockList: [...DEFAULT_SETTINGS.blockList] },
    sessions: [],
    active: null,
  };
}

const isDateKey = (v) => typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v);

export function isValidSession(s) {
  return (
    !!s &&
    typeof s === 'object' &&
    typeof s.id === 'string' &&
    isDateKey(s.date) &&
    Number.isFinite(s.startedAt) &&
    Number.isFinite(s.focusedSec) &&
    Number.isFinite(s.plannedSec) &&
    (s.status === 'completed' || s.status === 'stopped')
  );
}

export function normalizeSession(s) {
  return {
    id: s.id,
    task: String(s.task || 'Untitled focus').slice(0, 80),
    date: s.date,
    startedAt: s.startedAt,
    endedAt: Number.isFinite(s.endedAt) ? s.endedAt : s.startedAt,
    plannedSec: s.plannedSec,
    focusedSec: Math.max(0, s.focusedSec),
    status: s.status,
    distractions: Number.isFinite(s.distractions) ? Math.max(0, s.distractions) : 0,
  };
}

function isValidActive(a) {
  return !!a && typeof a === 'object' && Number.isFinite(a.startedAt) && Number.isFinite(a.plannedSec) && a.plannedSec > 0;
}

function normalizeActive(a) {
  return {
    id: String(a.id ?? 'active'),
    task: String(a.task || 'Untitled focus').slice(0, 80),
    plannedSec: a.plannedSec,
    startedAt: a.startedAt,
    pausedMs: Number.isFinite(a.pausedMs) ? a.pausedMs : 0,
    pausedAt: Number.isFinite(a.pausedAt) ? a.pausedAt : null,
    distractions: Number.isFinite(a.distractions) ? a.distractions : 0,
  };
}

/** Clamps every setting to a safe range, falling back to defaults for anything invalid. */
export function normalizeSettings(s) {
  const src = s && typeof s === 'object' ? s : {};
  const int = (v, min, max, fallback) => {
    const n = Math.round(Number(v));
    return Number.isFinite(n) && n >= min && n <= max ? n : fallback;
  };
  const list = Array.isArray(src.blockList) ? src.blockList : DEFAULT_SETTINGS.blockList;
  return {
    defaultMinutes: int(src.defaultMinutes, 1, 240, DEFAULT_SETTINGS.defaultMinutes),
    goalMinutes: int(src.goalMinutes, 0, 1440, DEFAULT_SETTINGS.goalMinutes),
    blockList: list
      .filter((x) => typeof x === 'string')
      .map((x) => x.trim().slice(0, 40))
      .filter(Boolean)
      .slice(0, 30),
  };
}

/**
 * Loads saved state. If the stored JSON is unreadable, the raw text is kept under a
 * separate key before returning defaults, so a bad write never silently destroys data.
 */
export function loadState(storage = globalThis.localStorage) {
  let raw;
  try {
    raw = storage.getItem(STORAGE_KEY);
  } catch {
    return defaultState();
  }
  if (!raw) return defaultState();

  try {
    const d = JSON.parse(raw);
    return {
      ...defaultState(),
      settings: normalizeSettings(d.settings),
      sessions: Array.isArray(d.sessions) ? d.sessions.filter(isValidSession).map(normalizeSession) : [],
      active: isValidActive(d.active) ? normalizeActive(d.active) : null,
    };
  } catch {
    try {
      storage.setItem(`${STORAGE_KEY}:corrupt-backup`, raw);
    } catch {
      /* nothing more we can do */
    }
    return defaultState();
  }
}

/** Returns true if the write succeeded. */
export function saveState(state, storage = globalThis.localStorage) {
  try {
    storage.setItem(STORAGE_KEY, JSON.stringify(state));
    return true;
  } catch {
    return false;
  }
}

/** Validates a backup file. Returns null if it isn't a FocusFlow backup. */
export function sanitizeImport(data) {
  if (!data || typeof data !== 'object' || !Array.isArray(data.sessions)) return null;
  return {
    sessions: data.sessions.filter(isValidSession).map(normalizeSession),
    settings: data.settings ? normalizeSettings(data.settings) : null,
  };
}

/** Adds incoming sessions whose ids aren't already present. Sorted oldest first. */
export function mergeSessions(existing, incoming) {
  const ids = new Set(existing.map((s) => s.id));
  const merged = [...existing];
  for (const s of incoming) {
    if (!ids.has(s.id)) {
      merged.push(s);
      ids.add(s.id);
    }
  }
  return merged.sort((a, b) => a.startedAt - b.startedAt);
}
