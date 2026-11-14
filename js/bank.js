// Question bank: loading, filtering, ordering, answer matching. No DOM here.
import { status, isMarked } from "./store.js";

export async function loadBank(url = "data/bank.json") {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Could not load questions (${res.status})`);
  return res.json();
}

export function filterItems(items, state, f = {}) {
  return items.filter(it => {
    if (f.section && it.section !== f.section) return false;
    if (f.skills?.length && !f.skills.includes(it.skill)) return false;
    if (f.difficulty?.length && !f.difficulty.includes(it.challenge ? "challenge" : it.difficulty)) return false;
    const st = status(state, it.id);
    if (f.completed === "unanswered" && st !== "unanswered") return false;
    if (f.completed === "answered" && st === "unanswered") return false;
    if (f.result === "correct" && st !== "correct") return false;
    if (f.result === "incorrect" && st !== "incorrect" && st !== "changed") return false;
    if (f.marked && !isMarked(state, it.id)) return false;
    return true;
  });
}

export function order(items, how) {
  const out = [...items];
  if (how === "random") {
    for (let i = out.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [out[i], out[j]] = [out[j], out[i]];
    }
  } else {
    out.sort((a, b) => (a.id < b.id ? -1 : 1));
  }
  return out;
}

export function skillProgress(items, state) {
  const out = {};
  for (const it of items) {
    const p = (out[it.skill] ||= { total: 0, answered: 0, correct: 0 });
    p.total++;
    const st = status(state, it.id);
    if (st !== "unanswered") p.answered++;
    if (st === "correct") p.correct++;
  }
  return out;
}

// Typed answers match only the checker-verified accept list (spec: no client math).
export function isCorrect(item, pick) {
  if (item.format === "spr") return item.accept.includes(String(pick).trim());
  return pick === item.answer;
}
