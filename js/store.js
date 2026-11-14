// Progress store: the ONLY module that touches localStorage.
// Swapping to accounts later means changing load/save here only.
export const KEY = "sat-progress";
const SCHEMA = 1;
const MAX_IMPORT = 5 * 1024 * 1024;
const PARTS = new Set(["passage", "passage2", "question", "stem"]);

export function empty() {
  return { schema: SCHEMA, attempts: {}, marked: [], highlights: {}, settings: {} };
}

export function load(storage = globalThis.localStorage) {
  try {
    const s = JSON.parse(storage.getItem(KEY));
    return s && s.schema === SCHEMA ? { ...empty(), ...s } : empty();
  } catch {
    return empty();
  }
}

export function save(state, storage = globalThis.localStorage) {
  try {
    storage.setItem(KEY, JSON.stringify(state));
    return true;
  } catch {
    return false; // storage full or blocked; caller shows a warning
  }
}

function attemptFor(state, id, session, at) {
  const list = (state.attempts[id] ||= []);
  let a = list.find(x => x.session === session);
  if (!a) {
    a = { session, picks: [], firstCorrect: null, solved: false, at: at ?? new Date().toISOString() };
    list.push(a);
  }
  return a;
}

export function recordPick(state, id, session, pick, correct, at) {
  const a = attemptFor(state, id, session, at);
  if (a.solved) return a;
  a.picks.push(String(pick));
  if (a.picks.length === 1 && a.firstCorrect === null) a.firstCorrect = !!correct;
  if (correct) a.solved = true;
  return a;
}

// Time spent on the question in this session (ms), kept on that session's attempt.
export function setTime(state, id, session, ms) {
  const a = (state.attempts[id] || []).find(x => x.session === session);
  if (a) a.ms = Math.round(ms);
}

// Opening the explanation (or "Show answer") before solving counts as Incorrect.
export function giveUp(state, id, session, at) {
  const a = attemptFor(state, id, session, at);
  if (a.firstCorrect === null) a.firstCorrect = false;
  a.gaveUp = true;
  return a;
}

export function latest(state, id) {
  const list = state.attempts[id];
  return list && list.length ? list[list.length - 1] : null;
}

export function status(state, id) {
  const a = latest(state, id);
  if (!a || a.firstCorrect === null) return "unanswered";
  if (a.firstCorrect) return "correct";
  return a.solved ? "changed" : "incorrect";
}

export function isMarked(state, id) {
  return state.marked.includes(id);
}

export function toggleMark(state, id) {
  state.marked = isMarked(state, id) ? state.marked.filter(x => x !== id) : [...state.marked, id];
}

export function setHighlights(state, id, list) {
  if (list.length) state.highlights[id] = list;
  else delete state.highlights[id];
}

export function mistakes(state) {
  const out = [];
  for (const [id, list] of Object.entries(state.attempts)) {
    const wrong = list.filter(a => a.firstCorrect === false);
    if (wrong.length) out.push([id, wrong[wrong.length - 1].at]);
  }
  return out.sort((a, b) => (a[1] < b[1] ? 1 : -1)).map(x => x[0]);
}

export function exportJSON(state) {
  return JSON.stringify(state, null, 1);
}

export const COLORS = new Set(["yellow", "blue", "pink"]);
export const MAX_NOTE = 1000;
const MAX_MS = 6 * 3600 * 1000; // no single question takes six hours

// Another tab saved: fold its progress into ours (add-only, like a backup import).
// shortcut: erasing or un-marking in one tab does not propagate to the other.
export function mergeStored(state, text) {
  if (!text) return state;
  try { return importJSON(state, text).state; } catch { return state; }
}

function fail(msg) {
  throw new Error(msg);
}

function validAttempt(a) {
  return a && typeof a === "object" && Array.isArray(a.picks) && a.picks.every(p => typeof p === "string") &&
    (a.firstCorrect === null || typeof a.firstCorrect === "boolean") && typeof a.at === "string" &&
    (a.ms === undefined || (Number.isFinite(a.ms) && a.ms >= 0 && a.ms <= MAX_MS));
}

function validate(data) {
  if (!data || typeof data !== "object" || Array.isArray(data)) fail("This file is not a backup from this site (it is not a progress object).");
  if (data.schema !== SCHEMA) fail("This backup is from a different version of the site.");
  const attempts = data.attempts ?? {};
  if (typeof attempts !== "object" || Array.isArray(attempts)) fail("The file looks damaged or edited: the attempt list is invalid.");
  for (const [id, list] of Object.entries(attempts)) {
    if (!Array.isArray(list) || !list.every(validAttempt)) fail(`The file looks damaged or edited: question ${id} has an invalid attempt.`);
  }
  const marked = data.marked ?? [];
  if (!Array.isArray(marked) || !marked.every(m => typeof m === "string")) fail("The file looks damaged or edited: the marked-question list is invalid.");
  const hl = data.highlights ?? {};
  for (const [id, list] of Object.entries(hl)) {
    if (!Array.isArray(list) || !list.every(h => h && PARTS.has(h.part) && Number.isInteger(h.start) && Number.isInteger(h.end) && h.end > h.start && h.start >= 0 &&
        (h.color === undefined || COLORS.has(h.color)) && (h.underline === undefined || typeof h.underline === "boolean") &&
        (h.note === undefined || (typeof h.note === "string" && h.note.length <= MAX_NOTE)))) {
      fail(`The file looks damaged or edited: question ${id} has an invalid highlight.`);
    }
  }
  return { attempts, marked, highlights: hl };
}

// Merge a backup into the current state. Never deletes anything.
export function importJSON(state, text) {
  if (text.length > MAX_IMPORT) fail("Backup file is too large.");
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    fail("This file is damaged or was edited: it cannot be read as JSON.");
  }
  const inc = validate(data);
  const next = structuredClone(state);
  let added = 0;
  for (const [id, list] of Object.entries(inc.attempts)) {
    const mine = (next.attempts[id] ||= []);
    for (const a of list) {
      if (!mine.some(m => m.at === a.at)) {
        mine.push({ session: a.session ?? `import-${a.at}`, picks: a.picks, firstCorrect: a.firstCorrect, solved: !!a.solved, at: a.at, ...(a.gaveUp ? { gaveUp: true } : {}), ...(a.ms !== undefined ? { ms: a.ms } : {}) });
        added++;
      }
    }
    mine.sort((x, y) => (x.at < y.at ? -1 : 1));
  }
  next.marked = [...new Set([...next.marked, ...inc.marked])];
  for (const [id, list] of Object.entries(inc.highlights)) {
    if (!next.highlights[id]) {
      next.highlights[id] = list.map(({ part, start, end, color, underline, note }) =>
        ({ part, start, end, ...(color ? { color } : {}), ...(underline ? { underline } : {}), ...(note ? { note } : {}) }));
    }
  }
  return { state: next, added };
}
