// Router and the bank, review and progress pages.
import * as S from "./store.js";
import { loadBank, filterItems, order, skillProgress } from "./bank.js";
import { h, diffBars, pct, icon, statusIcon } from "./render.js";
import { practiceView, newSet } from "./practice.js";

const root = document.getElementById("app");

// Look: cream is the default (set on <html> so there's no flash). ?theme=blue shows the earlier blue look,
// ?theme=cream goes back; the choice is remembered in this browser.
{
  const asked = new URLSearchParams(location.search).get("theme");
  try { if (asked) localStorage.setItem("sat-theme", asked); } catch { /* private mode */ }
  let t = asked;
  try { t ??= localStorage.getItem("sat-theme"); } catch { /* private mode */ }
  if (t === "blue") delete document.documentElement.dataset.theme;
}
const state = S.load();
let bank = null;
let cleanup = null;
const filters = { section: "math", skills: [], difficulty: [], completed: "all", result: "all", marked: false, order: "random" };
let openMenu = null; // which filter menu stays open across re-renders
let pillY = null;     // where the sidebar's selected pill sat before this render, so it can glide
let lastPath = null;  // page-level path; content animates in only when it changes

addEventListener("storage", e => { // another tab saved: merge so neither overwrites the other
  if (e.key === S.KEY) Object.assign(state, S.mergeStored(state, e.newValue));
});

const ctx = {
  state,
  get items() { return bank.items; },
  save: () => S.save(state),
  go: hash => { location.hash = hash; },
  warn: msg => { console.warn(msg); },
  skillName: id => bank.skills.find(s => s.skill === id)?.skillName ?? id,
  // shortcut: the current set lives in sessionStorage, so it survives a reload but not a closed tab
  saveSet: set => { try { sessionStorage.setItem("sat-set", JSON.stringify(set)); } catch { /* private mode */ } },
};

function loadSet() {
  try { return JSON.parse(sessionStorage.getItem("sat-set")); } catch { return null; }
}

function startSet(ids, index = 0) {
  if (!ids.length) return;
  const set = newSet(ids);
  set.index = index;
  set.from = location.hash || "#/"; // Back returns here
  ctx.saveSet(set);
  ctx.go("#/practice");
}

const SECTIONS = { rw: { title: "Reading and Writing", icon: "book" }, math: { title: "Math", icon: "calc" } };

// App frame: a sidebar of icon links beside the content panel (practice is full-screen instead).
function page(current, ...kids) {
  const link = (href, label, key, ic) => h("a", { href, "aria-current": current === key ? "page" : false, "data-rail-tip": label }, icon(ic), h("span", { class: "lbl" }, label));
  // not built yet: grey, and the label turns into "Coming soon" on hover or focus
  const soon = (label, ic) => h("span", { class: "side-soon", role: "link", "aria-disabled": "true", tabindex: "0", "aria-label": `${label}, coming soon`, "data-rail-tip": `${label} · Coming soon` },
    icon(ic), h("span", { class: "lbl", "aria-hidden": "true" }, label), h("span", { class: "soon-lbl", "aria-hidden": "true" }, "Coming soon"));
  const exam = (label, on) => on
    ? h("button", { class: "exam", "aria-pressed": "true" }, label)
    : h("button", { class: "exam", "aria-disabled": "true", "aria-label": `${label}, coming soon`, "data-tip": "Coming soon" }, h("span", { "aria-hidden": "true" }, label));
  return h("div", { class: "shell" },
    h("nav", { class: "side", "aria-label": "Main" },
      h("span", { class: "side-pill", "aria-hidden": "true" }),
      h("span", { class: "logo", "aria-hidden": "true" }),
      h("div", { class: "exams", role: "group", "aria-label": "Test" }, exam("SAT", true), exam("ACT"), exam("AP")),
      soon("Home", "home"),
      soon("Study Planner", "planner"),
      link("#/progress", "Analytics", "progress", "progress"),
      link("#/review", "Saved & Mistakes", "review", "marked"),
      h("p", { class: "side-head" }, "Practice"),
      link("#/", "Question Bank", "bank", "bank"),
      soon("Question Rush", "bolt"),
      soon("Challenge Questions", "flag"),
      soon("Full-Length Tests", "clock")),
    h("div", { class: "site" }, h("main", { id: "main" }, ...kids)));
}

// Page title with a coloured icon tile, as on OnePrep.
const title = (text, ic, tone = "") => h("h1", { class: "title" }, h("span", { class: `tile${tone ? ` tile-${tone}` : ""}`, "aria-hidden": "true" }, icon(ic)), text);
const subhead = (text, ic) => h("h2", { class: "subhead" }, icon(ic), text);

function totals(pred) {
  let total = 0, answered = 0, correct = 0;
  for (const it of bank.items.filter(pred)) {
    total++;
    const st = S.status(state, it.id);
    if (st !== "unanswered") answered++;
    if (st === "correct") correct++;
  }
  return { total, answered, correct };
}

// ---------- bank landing ----------
function landingView() {
  const card = v => {
    const t = totals(i => i.section === v);
    const p = t.total ? Math.round((100 * t.answered) / t.total) : 0;
    return h("a", { class: `sect sect-${v}`, href: `#/bank/${v}` },
      h("span", { class: "sect-art", "aria-hidden": "true" }, icon(SECTIONS[v].icon)),
      h("strong", {}, SECTIONS[v].title),
      h("span", { class: "sect-meta" }, h("span", {}, `${t.answered} of ${t.total} solved`), h("span", {}, `${p}%`)),
      h("span", { class: "sect-bar" }, h("i", { style: `width:${p}%` })),
      h("span", { class: "sect-open" }, "Open ", h("span", { "aria-hidden": "true" }, "›")));
  };
  const t = totals(() => true);
  const stat = (label, value) => h("div", { class: "stat" }, h("span", {}, label), h("strong", {}, value));
  return page("bank",
    title("Question Bank", "bank"),
    h("div", { class: "sects" }, card("rw"), card("math")),
    subhead("Question Analytics", "progress"),
    h("div", { class: "stats-row" },
      stat("Questions answered", String(t.answered)), stat("First-try accuracy", pct(t.correct, t.answered)),
      stat("Marked", String(state.marked.length)), stat("Mistakes", String(S.mistakes(state).length))),
    ...activity());
}

// Activity trend: first tries per local day for the last DAYS days, correct (bottom) and wrong (top).
const dayKey = d => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
function activity(DAYS = 14) {
  const days = [];
  for (let i = DAYS - 1; i >= 0; i--) {
    const d = new Date();
    d.setHours(12, 0, 0, 0);
    d.setDate(d.getDate() - i);
    days.push({ key: dayKey(d), label: d.toLocaleDateString(undefined, { month: "short", day: "numeric" }), right: 0, changed: 0, wrong: 0 });
  }
  const byKey = Object.fromEntries(days.map(d => [d.key, d]));
  for (const list of Object.values(state.attempts)) {
    for (const a of list) {
      if (a.firstCorrect === null || !a.at) continue;
      const d = byKey[dayKey(new Date(a.at))];
      if (d) d[a.firstCorrect ? "right" : a.solved ? "changed" : "wrong"]++;
    }
  }
  const sum = k => days.reduce((n, d) => n + d[k], 0);
  const right = sum("right"), changed = sum("changed"), wrong = sum("wrong");
  const tot = d => d.right + d.changed + d.wrong;
  const head = [subhead("Activity Trend", "progress"),
    h("p", { class: "chart-note" }, `First tries per day over the last ${DAYS === 14 ? "two weeks" : `${DAYS} days`}.`)];
  if (!right && !changed && !wrong) return [...head, h("p", { class: "empty-state" }, "Answer a few questions and your daily activity will show up here.")];

  const peak = Math.max(...days.map(tot));
  const step = Math.max(1, Math.ceil(peak / 4));
  const top = step * 4;
  const active = days.filter(tot).length;
  const avg = (right + changed + wrong) / active;
  const pctH = n => `${(100 * n) / top}%`;
  return [...head,
    h("figure", { class: "chart" },
      h("div", { class: "chart-legend" },
        h("span", {}, h("span", { class: "tb ok" }, icon("check")), h("strong", {}, String(right)), " Correct"),
        h("span", {}, h("span", { class: "tb ch" }, icon("check")), h("strong", {}, String(changed)), " After retries"),
        h("span", {}, h("span", { class: "tb no" }, icon("x")), h("strong", {}, String(wrong)), " Wrong")),
      h("div", { class: "plot", "aria-hidden": "true" },
        [0, 1, 2, 3, 4].map(i => h("span", { class: "grid-line", style: `bottom:${i * 25}%` }, h("em", {}, String(i * step)))),
        h("span", { class: "avg-line", style: `bottom:${pctH(avg)}` }, h("em", {}, `Average ${Math.round(avg * 10) / 10} per active day`)),
        h("div", { class: "cols", style: `grid-template-columns:repeat(${DAYS},1fr)` }, days.map(d => h("div", { class: "col" },
          tot(d) ? h("span", { class: "tip" }, h("b", {}, d.label), `${d.right} correct, ${d.changed} after retries, ${d.wrong} wrong`) : null,
          d.wrong ? h("i", { class: "bar-seg wrong", style: `height:${pctH(d.wrong)}` }) : null,
          d.changed ? h("i", { class: "bar-seg changed", style: `height:${pctH(d.changed)}` }) : null,
          d.right ? h("i", { class: "bar-seg right", style: `height:${pctH(d.right)}` }) : null)))),
      h("div", { class: "xlabels", "aria-hidden": "true", style: `grid-template-columns:repeat(${DAYS},1fr)` }, days.map((d, i) => h("span", {}, (DAYS - 1 - i) % Math.ceil(DAYS / 7) === 0 ? d.label : ""))),
      h("table", { class: "sr" },
        h("caption", {}, "First tries per day"),
        h("thead", {}, h("tr", {}, h("th", {}, "Day"), h("th", {}, "Correct"), h("th", {}, "Correct after retries"), h("th", {}, "Wrong"))),
        h("tbody", {}, days.filter(tot).map(d => h("tr", {}, h("td", {}, d.label), h("td", {}, String(d.right)), h("td", {}, String(d.changed)), h("td", {}, String(d.wrong)))))))];
}

// ---------- one section's skills ----------
function sectionView(sec) {
  if (filters.section !== sec) { filters.section = sec; filters.skills = []; }
  const items = bank.items.filter(i => i.section === sec);
  const prog = skillProgress(items, state);
  const matching = order(filterItems(items, state, filters), filters.order);
  const rerender = () => render();

  // A pill that opens a small menu (details/summary keeps it keyboard-friendly).
  const menu = (key, label, ic, body, active) => h("details", { class: `pill-menu${active ? " active" : ""}`, open: openMenu === key,
      ontoggle: e => { if (e.target.open) openMenu = key; else if (openMenu === key) openMenu = null; } },
    h("summary", { class: "pill", "data-k": `m-${key}` }, icon(ic), label, h("span", { class: "chev", "aria-hidden": "true" }, "▾")),
    h("div", { class: "menu", role: "group", "aria-label": label }, h("p", { class: "menu-title" }, label), body));
  const radio = (key, v, text) => h("label", { class: "opt" },
    h("input", { type: "radio", name: key, "data-k": `${key}-${v}`, checked: filters[key] === v, onchange: () => { filters[key] = v; rerender(); } }), text);
  const diffBox = (v, text) => h("label", { class: "opt" },
    h("input", { type: "checkbox", "data-k": `diff-${v}`, checked: filters.difficulty.includes(v),
      onchange: e => { filters.difficulty = e.target.checked ? [...filters.difficulty, v] : filters.difficulty.filter(x => x !== v); rerender(); } }), text);
  const toggle = (k, label, ic, checked, onchange) => h("label", { class: "pill chk" }, h("input", { type: "checkbox", "data-k": k, checked, onchange }), icon(ic), label);

  const domains = [...new Map(bank.skills.filter(s => s.section === sec).map(s => [s.domain, s.domainName]))];
  const totalSkills = bank.skills.filter(s => s.section === sec).length;
  return page("bank",
    h("a", { class: "back", href: "#/" }, h("span", { "aria-hidden": "true" }, "‹ "), "Back to Question Bank"),
    title(SECTIONS[sec].title, SECTIONS[sec].icon, sec), // icon tile matches the section's card
    h("div", { class: "filters" },
      menu("difficulty", "Difficulty", "progress", [diffBox("easy", "Easy"), diffBox("medium", "Medium"), diffBox("hard", "Hard")], filters.difficulty.length),
      menu("completed", "Completed", "check", [radio("completed", "all", "All"), radio("completed", "answered", "Answered"), radio("completed", "unanswered", "Unanswered")], filters.completed !== "all"),
      menu("result", "Result", "mistakes", [radio("result", "all", "All"), radio("result", "correct", "Correct"), radio("result", "incorrect", "Incorrect")], filters.result !== "all"),
      toggle("random", "Random order", "shuffle", filters.order === "random", e => { filters.order = e.target.checked ? "random" : "order"; rerender(); }),
      toggle("marked", "Marked only", "marked", filters.marked, e => { filters.marked = e.target.checked; rerender(); })),
    h("div", { class: "start-row" },
      h("p", {}, h("strong", {}, filters.skills.length ? `Practice ${filters.skills.length} Selected Skill${filters.skills.length === 1 ? "" : "s"}` : "Practice All Topics"),
        h("span", {}, `${matching.length} question${matching.length === 1 ? "" : "s"}${filters.skills.length ? "" : ` across all ${totalSkills} skills`}`)),
      filters.skills.length ? h("button", { class: "btn quiet", onclick: () => { filters.skills = []; rerender(); } }, "Clear") : null,
      h("button", { class: "btn primary", disabled: !matching.length, onclick: () => startSet(matching.map(i => i.id)) }, "Start practice")),
    h("div", { class: "skill-head", "aria-hidden": "true" }, h("span", {}, "Topic"), h("span", {}, "Progress"), h("span", {}, "Accuracy")),
    domains.map(([d, dn]) => h("section", { class: "domain", "aria-labelledby": `d-${d}` },
      h("h2", { id: `d-${d}` }, dn),
      h("ul", { class: "skills" }, bank.skills.filter(s => s.domain === d).map(s => {
        const p = prog[s.skill] || { total: 0, answered: 0, correct: 0 };
        const id = `sk-${s.skill}`;
        return h("li", { class: `skill${p.total ? "" : " empty"}` },
          h("input", { type: "checkbox", id, "data-k": id, checked: filters.skills.includes(s.skill), disabled: !p.total,
            onchange: e => { filters.skills = e.target.checked ? [...filters.skills, s.skill] : filters.skills.filter(x => x !== s.skill); rerender(); } }),
          h("label", { class: "name", for: id }, s.skillName, p.total ? null : h("small", { class: "soon" }, "Coming soon")),
          h("span", { class: "meter", role: "img", "aria-label": `${p.answered} of ${p.total} answered` }, h("i", { style: `width:${p.total ? (100 * p.answered) / p.total : 0}%` })),
          h("span", { class: "count" }, `${p.answered}/${p.total}`),
          h("span", { class: `acc${p.answered ? (p.correct / p.answered >= 0.7 ? " good" : " low") : ""}`, title: "First-try accuracy" }, p.answered ? pct(p.correct, p.answered) : "–"));
      })))));
}

// ---------- review ----------
function reviewView(tab) {
  const byId = Object.fromEntries(bank.items.map(i => [i.id, i]));
  const ids = (tab === "marked" ? state.marked : S.mistakes(state)).filter(id => byId[id]);
  return page("review",
      title("Saved & Mistakes", "marked"),
      h("div", { class: "seg tabs-seg", role: "group", "aria-label": "Show" },
        h("button", { "aria-pressed": String(tab !== "marked"), onclick: () => ctx.go("#/review") }, "Mistakes"),
        h("button", { "aria-pressed": String(tab === "marked"), onclick: () => ctx.go("#/review/marked") }, "Marked for review")),
      ids.length
        ? [h("div", { class: "start-row" }, h("p", {}, h("strong", {}, `${ids.length} question${ids.length === 1 ? "" : "s"}`),
            h("span", {}, tab === "marked" ? "Marked for review." : "Missed on the first try, newest first.")),
            h("button", { class: "btn primary", onclick: () => startSet(ids) }, "Practice these")),
          h("ul", { class: "list" }, ids.map((id, i) => {
            const it = byId[id];
            const st = S.status(state, id);
            const text = (it.section === "math" ? it.stem : it.passage)
              .replace(/\\\(\\begin\{array\}[\s\S]*?\\end\{array\}\\\)/g, "[table]") // raw array LaTeX is unreadable in a one-line preview
              .replace(/\\\(|\\\)/g, "").replace(/\\([%$])/g, "$1");
            return h("li", {},
              h("span", { class: "what" }, `${text.slice(0, 110)}${text.length > 110 ? "…" : ""}`,
                h("small", {}, ctx.skillName(it.skill), " ", diffBars(it.difficulty, it.challenge))),
              statusIcon(st),
              h("button", { class: "btn", onclick: () => startSet(ids, i) }, "Open"));
          }))]
        : h("p", { class: "empty-state" }, tab === "marked"
          ? "Nothing marked yet. Use Mark for review on any question to save it here."
          : "No mistakes yet. Questions you miss on the first try will appear here."));
}

// ---------- analytics ----------
let range = 30; // days shown on the Analytics page (0 = all time)
const DIFF_COLOR = { easy: "#2e9d5e", medium: "#e0a100", hard: "#5a5fd8" };
const SEC_COLOR = { rw: "var(--sec-rw)", math: "var(--sec-math)" }; // set per theme in site.css
const cap = s => s[0].toUpperCase() + s.slice(1);
const fmtDur = ms => {
  const sec = Math.round(ms / 1000);
  if (sec < 60) return `${sec}s`;
  const m = Math.floor(sec / 60);
  if (m < 60) return sec % 60 && m < 10 ? `${m}m ${sec % 60}s` : `${m}m`;
  return `${Math.floor(m / 60)}h ${m % 60}m`;
};

// A ring chart from [{label, value, color}]; the centre shows `centre`. Drawn with a conic gradient.
function ring(parts, centre, sub, label) {
  const total = parts.reduce((n, p) => n + p.value, 0);
  let at = 0;
  const stops = total ? parts.filter(p => p.value).map(p => {
    const from = (360 * at) / total; at += p.value; const to = (360 * at) / total;
    return `${p.color} ${from + (parts.filter(q => q.value).length > 1 ? 1.2 : 0)}deg ${to}deg`;
  }) : [];
  return h("div", { class: "ring", role: "img", "aria-label": label, style: `--ring:conic-gradient(${stops.length ? `var(--sheet) 0deg, ${stops.join(", ")}` : "var(--rule) 0deg 360deg"})` },
    h("span", { class: "ring-mid" }, h("strong", {}, centre), sub ? h("small", {}, sub) : null));
}

function progressView(msg) {
  const cutoff = range ? Date.now() - range * 864e5 : 0;
  const byId = Object.fromEntries(bank.items.map(i => [i.id, i]));
  const rows = [];
  for (const [id, list] of Object.entries(state.attempts)) {
    const it = byId[id];
    if (!it) continue;
    for (const a of list) if (a.firstCorrect !== null && a.at && Date.parse(a.at) >= cutoff) rows.push({ it, a });
  }
  const acc = rs => rs.length ? Math.round((100 * rs.filter(r => r.a.firstCorrect).length) / rs.length) : null;
  const pctTxt = v => (v === null ? "–" : `${v}%`);

  // streak: consecutive days with practice, ending today (or yesterday if nothing yet today)
  const days = new Set(Object.values(state.attempts).flat().filter(a => a.at).map(a => dayKey(new Date(a.at))));
  const d = new Date();
  if (!days.has(dayKey(d))) d.setDate(d.getDate() - 1);
  let streak = 0;
  while (days.has(dayKey(d))) { streak++; d.setDate(d.getDate() - 1); }

  const stat = (label, value, ic, extra) => h("div", { class: "stat" }, h("span", {}, label), h("strong", {}, value), extra || null, h("span", { class: "stat-art", "aria-hidden": "true" }, icon(ic)));
  const card = (cls, ...kids) => h("section", { class: `a-card ${cls}` }, ...kids);
  const cardHead = (t, note) => [h("h2", {}, t), note ? h("p", { class: "chart-note" }, note) : null];

  // lowest-accuracy skills
  const bySkill = {};
  for (const r of rows) (bySkill[r.it.skill] ||= []).push(r);
  const weakest = Object.entries(bySkill).map(([skill, rs]) => ({ skill, rs, v: acc(rs), section: rs[0].it.section }))
    .sort((x, y) => x.v - y.v || y.rs.length - x.rs.length).slice(0, 5);
  const weakList = weakest.length
    ? h("ol", { class: "weak" }, weakest.map((w, i) => h("li", {},
        h("span", { class: "rank", "aria-hidden": "true" }, String(i + 1).padStart(2, "0")),
        h("span", { class: "weak-main" },
          h("small", {}, w.v < 60 ? "Needs work" : w.v < 85 ? "Getting there" : "Strong", " · ", SECTIONS[w.section].title, " · ", `${w.rs.length} attempt${w.rs.length === 1 ? "" : "s"}`),
          h("strong", {}, ctx.skillName(w.skill))),
        h("span", { class: "weak-score" },
          ring([{ value: w.v, color: w.v < 60 ? "var(--wrong)" : w.v < 85 ? "var(--changed)" : "var(--right)" }, { value: 100 - w.v, color: "var(--rule)" }], "", "", `${w.v}% accuracy`),
          h("strong", {}, `${w.v}`, h("small", {}, "%"))),
        h("button", { class: "btn quiet sm", onclick: () => startSet(bank.items.filter(it => it.skill === w.skill).map(it => it.id)) }, "Practice ›"))))
    : h("p", { class: "empty-state" }, "Answer some questions and your weakest skills will show up here.");

  // per-section cards
  const sectionCards = (kind) => ["rw", "math"].map(sec => {
    const rs = rows.filter(r => r.it.section === sec);
    if (kind === "topics") {
      const doms = [...new Map(bank.skills.filter(s => s.section === sec).map(s => [s.domain, s.domainName]))];
      return card("half", ...cardHead(SECTIONS[sec].title, "Accuracy by topic"),
        h("p", { class: "bands-key", "aria-hidden": "true" }, h("i", { class: "b-good" }), "≥ 85%", h("i", { class: "b-mid" }), "60 – 84%", h("i", { class: "b-low" }), "< 60%"),
        h("ul", { class: "topics" }, doms.map(([dm, name]) => {
          const t = rs.filter(r => r.it.domain === dm);
          const v = acc(t);
          return h("li", {}, h("span", {}, h("strong", {}, name), h("small", {}, `${t.length} attempt${t.length === 1 ? "" : "s"}`)),
            h("span", { class: "band", role: "img", "aria-label": `${name}: ${pctTxt(v)}` }, h("i"), h("i"), h("i"), v === null ? null : h("b", { style: `left:${v}%`, class: v >= 85 ? "good" : v >= 60 ? "mid" : "low" })),
            h("span", { class: "big-pct" }, v === null ? "–" : [String(v), h("small", {}, "%")]));
        })));
    }
    const parts = ["easy", "medium", "hard"].map(df => ({ df, rs: rs.filter(r => r.it.difficulty === df) }));
    const v = acc(rs);
    return card("half", ...cardHead(SECTIONS[sec].title, "Accuracy by difficulty"),
      h("div", { class: "ring-row" },
        ring(parts.map(p => ({ value: p.rs.length, color: DIFF_COLOR[p.df] })), pctTxt(v), "overall", `${SECTIONS[sec].title}: ${pctTxt(v)} overall`),
        h("ul", { class: "ring-legend" }, parts.map(p => h("li", {}, h("i", { style: `background:${DIFF_COLOR[p.df]}` }), cap(p.df),
          h("span", {}, h("strong", {}, pctTxt(acc(p.rs))), h("small", {}, `${p.rs.length} answered`)))))));
  });

  // time (only answers that recorded it)
  const timed = rows.filter(r => r.a.ms);
  const msOf = rs => rs.reduce((n, r) => n + (r.a.ms || 0), 0);
  const timeCards = ["rw", "math"].map(sec => {
    const rs = timed.filter(r => r.it.section === sec);
    const parts = ["easy", "medium", "hard"].map(df => ({ df, rs: rs.filter(r => r.it.difficulty === df) }));
    const avg = rs.length ? fmtDur(msOf(rs) / rs.length) : "–";
    return card("half", ...cardHead(SECTIONS[sec].title, "Time per question, by difficulty"),
      h("div", { class: "ring-row" },
        ring(parts.map(p => ({ value: msOf(p.rs), color: DIFF_COLOR[p.df] })), avg, "average", `${SECTIONS[sec].title}: ${avg} per question on average`),
        h("ul", { class: "ring-legend" }, parts.map(p => h("li", {}, h("i", { style: `background:${DIFF_COLOR[p.df]}` }), cap(p.df),
          h("span", {}, h("strong", {}, p.rs.length ? fmtDur(msOf(p.rs) / p.rs.length) : "–"), h("small", {}, `${p.rs.length} timed`)))))));
  });

  // daily study time, stacked by subject
  const TD = range === 7 ? 7 : 30;
  const tdays = [];
  for (let i = TD - 1; i >= 0; i--) {
    const dd = new Date(); dd.setHours(12, 0, 0, 0); dd.setDate(dd.getDate() - i);
    tdays.push({ key: dayKey(dd), label: dd.toLocaleDateString(undefined, { month: "numeric", day: "numeric" }), rw: 0, math: 0 });
  }
  const tByKey = Object.fromEntries(tdays.map(x => [x.key, x]));
  for (const r of timed) { const x = tByKey[dayKey(new Date(r.a.at))]; if (x) x[r.it.section] += r.a.ms; }
  const tTotal = tdays.reduce((n, x) => n + x.rw + x.math, 0);
  const tPeak = Math.max(1, ...tdays.map(x => x.rw + x.math));
  const studyTime = card("", h("h2", {}, "Daily study time"), h("p", { class: "chart-note" }, "Stacked by subject. The dashed line is your daily average."),
    tTotal
      ? [h("div", { class: "chart-legend" },
          h("span", {}, h("strong", {}, fmtDur(tTotal)), ` last ${TD} days`), h("span", {}, h("strong", {}, fmtDur(tTotal / TD)), " per day"),
          h("span", {}, h("i", { class: "key", style: `background:${SEC_COLOR.rw}` }), "Reading and Writing"), h("span", {}, h("i", { class: "key", style: `background:${SEC_COLOR.math}` }), "Math")),
        h("div", { class: "plot short", "aria-hidden": "true" },
          h("span", { class: "avg-line", style: `bottom:${(100 * tTotal) / TD / tPeak}%` }),
          h("div", { class: "cols", style: `grid-template-columns:repeat(${TD},1fr)` }, tdays.map(x => h("div", { class: "col" },
            x.rw + x.math ? h("span", { class: "tip" }, h("b", {}, x.label), `Reading and Writing ${fmtDur(x.rw)}, Math ${fmtDur(x.math)}`) : null,
            x.math ? h("i", { class: "bar-seg", style: `height:${(100 * x.math) / tPeak}%;background:${SEC_COLOR.math}` }) : null,
            x.rw ? h("i", { class: "bar-seg", style: `height:${(100 * x.rw) / tPeak}%;background:${SEC_COLOR.rw}` }) : null)))),
        h("div", { class: "xlabels", "aria-hidden": "true", style: `grid-template-columns:repeat(${TD},1fr)` }, tdays.map((x, i) => h("span", {}, (TD - 1 - i) % Math.ceil(TD / 7) === 0 ? x.label : ""))),
        h("table", { class: "sr" }, h("caption", {}, "Study time per day"),
          h("thead", {}, h("tr", {}, h("th", {}, "Day"), h("th", {}, "Reading and Writing"), h("th", {}, "Math"))),
          h("tbody", {}, tdays.filter(x => x.rw + x.math).map(x => h("tr", {}, h("td", {}, x.label), h("td", {}, fmtDur(x.rw)), h("td", {}, fmtDur(x.math))))))]
      : h("p", { class: "empty-state" }, "Time starts counting from now on: answer a few questions and your study time shows up here."));

  // study sessions this week (each practice set is one session)
  const weekAgo = Date.now() - 7 * 864e5;
  const sess = {};
  for (const [id, list] of Object.entries(state.attempts)) {
    const it = byId[id];
    if (!it) continue;
    for (const a of list) {
      if (!a.at || Date.parse(a.at) < weekAgo || a.session?.startsWith("import-")) continue;
      const x = (sess[a.session] ||= { start: Infinity, ms: 0, n: 0, secs: new Set() });
      x.start = Math.min(x.start, Date.parse(a.at)); x.ms += a.ms || 0; x.n++; x.secs.add(it.section);
    }
  }
  const sessList = Object.values(sess).sort((x, y) => y.start - x.start);
  const part = hr => hr < 12 ? "Morning" : hr < 17 ? "Afternoon" : hr < 21 ? "Evening" : "Night";
  const sessMax = Math.max(1, ...sessList.map(x => x.ms));
  const byDay = new Map();
  for (const x of sessList) {
    const dd = new Date(x.start);
    const k = dd.toLocaleDateString(undefined, { weekday: "long", month: "short", day: "numeric" });
    if (!byDay.has(k)) byDay.set(k, []);
    byDay.get(k).push(x);
  }
  const weekMs = sessList.reduce((n, x) => n + x.ms, 0);
  const sessions = card("", h("h2", {}, "Study sessions"),
    h("p", { class: "chart-note" }, sessList.length ? `This week: ${fmtDur(weekMs)} · ${sessList.length} session${sessList.length === 1 ? "" : "s"}` : "Your practice sets from the last 7 days show up here."),
    [...byDay].map(([day, list]) => h("div", { class: "sess-day" },
      h("p", { class: "sess-date" }, h("strong", {}, day), h("span", {}, `${fmtDur(list.reduce((n, x) => n + x.ms, 0))} · ${list.length} session${list.length === 1 ? "" : "s"}`)),
      list.map(x => {
        const dd = new Date(x.start);
        const what = x.secs.size > 1 ? "Mixed" : SECTIONS[[...x.secs][0]].title;
        return h("div", { class: "sess" },
          h("span", {}, h("strong", {}, `${dd.toLocaleDateString(undefined, { weekday: "long" })} ${part(dd.getHours())} ${what}`),
            h("small", {}, `Started ${dd.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" })} · ${x.n} question${x.n === 1 ? "" : "s"}`)),
          h("span", { class: "sess-time" }, h("strong", {}, x.ms ? fmtDur(x.ms) : "–"), h("i", { style: `width:${(100 * x.ms) / sessMax}%` })));
      }))));

  // by subject + time of day
  const subj = ["rw", "math"].map(sec => ({ sec, n: rows.filter(r => r.it.section === sec).length }));
  const hours = Array.from({ length: 24 }, () => 0);
  for (const r of rows) hours[new Date(r.a.at).getHours()]++;
  const peakH = hours.indexOf(Math.max(...hours));
  const hr = x => `${(x % 12) || 12} ${x < 12 ? "AM" : "PM"}`;
  const hourMax = Math.max(1, ...hours);

  const rangeBtn = (v, t) => h("button", { "aria-pressed": String(range === v), onclick: () => { range = v; render(); } }, t);
  const head = [
    h("div", { class: "a-head" }, title("Analytics", "progress"),
      h("div", { class: "seg", role: "group", "aria-label": "Date range" }, rangeBtn(7, "7d"), rangeBtn(30, "30d"), rangeBtn(0, "All"))),
    msg ? h("p", { class: `notice${msg.err ? " err" : ""}`, role: "status" }, msg.text) : null,
    h("div", { class: "stats-row" },
      stat("Questions Attempted", String(rows.length), "check"),
      stat("Current Accuracy", pctTxt(acc(rows)), "progress"),
      stat("Marked Questions", String(state.marked.length), "marked", state.marked.length ? h("a", { class: "stat-link", href: "#/review/marked" }, "View") : null),
      stat("Study Streak", `${streak} day${streak === 1 ? "" : "s"}`, "bolt")),
    card("", h("h2", {}, weakest.length === 1 ? "Lowest-accuracy skill" : `${weakest.length || 5} lowest-accuracy skills`), weakList),
    ...activity(range === 7 ? 7 : 30), // "All" still charts the last 30 days
    h("div", { class: "a-grid" }, ...sectionCards("topics")),
    h("div", { class: "a-grid" }, ...sectionCards("difficulty")),
    h("div", { class: "a-grid" }, ...timeCards),
    studyTime,
    h("div", { class: "a-grid" },
      card("half", ...cardHead("By subject", "Questions answered in each section."),
        h("div", { class: "ring-row center" },
          ring(subj.map(s => ({ value: s.n, color: SEC_COLOR[s.sec] })), String(rows.length), "total", `Reading and Writing ${subj[0].n}, Math ${subj[1].n}`),
          h("ul", { class: "ring-legend" }, subj.map(s => h("li", {}, h("i", { style: `background:${SEC_COLOR[s.sec]}` }), SECTIONS[s.sec].title, h("span", {}, h("strong", {}, String(s.n)))))))),
      card("half", h("div", { class: "hours-head" }, h("h2", {}, "Most active time of day"), rows.length ? h("p", { class: "peak" }, "Peak: ", h("b", {}, `${hr(peakH)}–${hr((peakH + 1) % 24)}`)) : null),
        h("p", { class: "chart-note" }, "When you answered questions."),
        h("div", { class: "hours", role: "img", "aria-label": rows.length ? `Most active from ${hr(peakH)} to ${hr((peakH + 1) % 24)}` : "No activity yet" },
          hours.map((n, i) => h("i", { class: i === peakH && n ? "peak" : "", style: `height:${n ? Math.max(6, (100 * n) / hourMax) : 2}%`, title: `${hr(i)}: ${n}` }))),
        h("div", { class: "hours-x", "aria-hidden": "true" }, h("span", {}, "12 AM"), h("span", {}, "6 AM"), h("span", {}, "12 PM"), h("span", {}, "6 PM")))),
    sessions,
  ];

  const file = h("input", { type: "file", accept: "application/json,.json", hidden: true, onchange: async e => {
    const f = e.target.files[0];
    if (!f) return;
    try {
      const { state: next, added } = S.importJSON(state, await f.text());
      Object.assign(state, next);
      S.save(state);
      render(`Backup loaded: ${added} new attempt${added === 1 ? "" : "s"} added. Nothing was removed.`);
    } catch (err) {
      render(`Backup not loaded. ${err.message} Your progress was not changed.`, true);
    }
  } });
  const download = () => {
    const url = URL.createObjectURL(new Blob([S.exportJSON(state)], { type: "application/json" }));
    const a = h("a", { href: url, download: `sat-progress-${new Date().toISOString().slice(0, 10)}.json` });
    document.body.append(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };
  let confirming = false;
  const resetBox = h("div", { class: "backup" });
  const drawReset = () => resetBox.replaceChildren(confirming
    ? h("span", { role: "status" }, "This erases all progress in this browser. Download a backup first if you want to keep it. ",
        h("button", { class: "btn danger", onclick: () => { Object.assign(state, S.empty()); S.save(state); render("All progress erased."); } }, "Erase all progress"),
        " ", h("button", { class: "btn quiet", onclick: () => { confirming = false; drawReset(); } }, "Cancel"))
    : h("button", { class: "btn danger", onclick: () => { confirming = true; drawReset(); } }, "Reset progress"));
  drawReset();

  return page("progress",
      ...head,
      h("h2", { class: "sec" }, "Backup"),
      h("p", { class: "lede" }, "Progress is saved in this browser only. Download a backup to move it to another device or keep it safe. Loading a backup adds to your progress and never deletes anything."),
      h("div", { class: "backup" },
        h("button", { class: "btn primary", onclick: download }, "Download backup"),
        h("button", { class: "btn", onclick: () => file.click() }, "Load backup"), file),
      h("h2", { class: "sec" }, "Reset"),
      resetBox);
}

// ---------- router ----------
let flash = null;
function render(text, err) {
  if (text) flash = { text, err };
  cleanup?.();
  cleanup = null;
  const [path, sub] = location.hash.replace(/^#\/?/, "").split("/");
  document.title = "SAT Practice";
  if (path === "practice") {
    const set = loadSet();
    if (set?.ids?.length && set.ids.every(id => bank.items.some(i => i.id === id))) {
      cleanup = practiceView(root, ctx, set);
      root.querySelector(".practice")?.classList.add("enter");
      loadBar();
      lastPath = "#/practice";
      return;
    }
    ctx.go("#/");
    return;
  }
  if (path === "bank" && !SECTIONS[sub]) { ctx.go("#/"); return; }
  const view = path === "review" ? reviewView(sub) : path === "progress" ? progressView(flash) : path === "bank" ? sectionView(sub) : landingView();
  flash = path === "progress" && text ? flash : null;
  const key = document.activeElement?.dataset?.k; // keep focus on the same control across re-renders
  root.replaceChildren(view);
  if (key) root.querySelector(`[data-k="${CSS.escape(key)}"]`)?.focus({ preventScroll: true });
  const here = location.hash || "#/";
  if (here !== lastPath) {
    if (lastPath !== null) { root.querySelector(".site main")?.classList.add("enter"); loadBar(); }
    lastPath = here;
  }
  placePill();
}

// Move the sidebar's white pill under the current link: start where it was, then glide.
function placePill() {
  const side = root.querySelector(".side"), pill = side?.querySelector(".side-pill"), cur = side?.querySelector('[aria-current="page"]');
  if (!pill || !cur) return;
  side.classList.add("has-pill");
  const y = cur.offsetTop;
  pill.style.height = `${cur.offsetHeight}px`;
  if (pillY === null || pillY === y) { pill.style.transition = "none"; pill.style.transform = `translateY(${y}px)`; }
  else {
    pill.style.transition = "none";
    pill.style.transform = `translateY(${pillY}px)`;
    pill.getBoundingClientRect(); // commit the start position before animating
    pill.style.transition = "";
    pill.style.transform = `translateY(${y}px)`;
  }
  pillY = y;
}

function loadBar() {
  const bar = document.querySelector(".load-bar") || document.body.appendChild(h("div", { class: "load-bar", "aria-hidden": "true" }));
  bar.classList.remove("go");
  bar.getBoundingClientRect();
  bar.classList.add("go");
}

addEventListener("resize", () => { pillY = null; placePill(); });
addEventListener("hashchange", () => { flash = null; openMenu = null; render(); window.scrollTo(0, 0); });
// a click outside an open filter menu closes it
addEventListener("click", e => {
  if (e.target.closest?.(".pill-menu")) return;
  for (const d of document.querySelectorAll("details.pill-menu[open]")) d.open = false;
  openMenu = null;
});

loadBank()
  .then(b => { bank = b; render(); })
  .catch(e => { root.replaceChildren(h("p", { class: "loading", role: "alert" }, `${e.message}. Reload the page to try again.`)); });
