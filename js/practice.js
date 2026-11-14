// Practice screen: timer, navigator, mark, cross-out, highlighter,
// try-until-right with per-choice explanations, calculator, reference sheet.
import * as S from "./store.js";
import { createIdle } from "./idle.js";
import { isCorrect } from "./bank.js";
import { h, mathText, typeset, diffBars, pct, icon, statusIcon, STATUS } from "./render.js";
import { selectionRange, paint, addRange } from "./highlight.js";
import { calculatorPanel, resizeCalculators } from "./calculator.js";

const LETTERS = ["A", "B", "C", "D"];

export function newSet(ids) {
  return { ids, index: 0, session: `s${Date.now().toString(36)}`, elapsed: 0, running: true, crossed: {}, ui: {} };
}

const fmt = ms => {
  const s = Math.floor(ms / 1000);
  const hh = Math.floor(s / 3600), mm = Math.floor((s % 3600) / 60), ss = s % 60;
  return (hh ? `${hh}:${String(mm).padStart(2, "0")}` : String(mm).padStart(2, "0")) + `:${String(ss).padStart(2, "0")}`;
};

export function practiceView(root, ctx, set) {
  const { state, items } = ctx;
  const byId = Object.fromEntries(items.map(i => [i.id, i]));
  const settings = state.settings;
  let tick = null;
  let ticks = 0;
  let last = performance.now();
  const idle = createIdle();
  const wake = () => idle.touch(performance.now());
  for (const ev of ["mousemove", "mousedown", "keydown", "touchstart", "scroll"]) addEventListener(ev, wake, { passive: true });

  const item = () => byId[set.ids[set.index]];
  const ui = () => (set.ui[item().id] ||= { selected: null, hints: 0, panel: false, steps: 1, confirmGiveUp: false, sprMsg: null });
  const attempt = () => (state.attempts[item().id] || []).find(a => a.session === set.session);
  const persist = () => { if (!ctx.save()) ctx.warn("Progress could not be saved in this browser."); };

  function startTimer() {
    clearInterval(tick);
    tick = setInterval(() => {
      const now = performance.now();
      const dt = now - last;
      if (set.running) set.elapsed += dt;
      last = now;
      // time on this question: only while it's on screen, the timer runs, the tab is visible, and it isn't finished
      const a = attempt();
      if (set.running && !document.hidden && idle.active(now) && !a?.solved && !a?.gaveUp) { const u = ui(); u.ms = (u.ms || 0) + dt; }
      if (++ticks % 10 === 0) ctx.saveSet(set); // keep elapsed time across reloads
      const out = root.querySelector(".timer output");
      if (out) out.textContent = fmt(set.elapsed);
    }, 500);
  }

  // ---------- top bar ----------
  function topbar() {
    const it = item();
    const answered = set.ids.filter(id => (state.attempts[id] || []).some(a => a.session === set.session && a.firstCorrect !== null));
    const right = answered.filter(id => state.attempts[id].find(a => a.session === set.session).firstCorrect);
    const tools = [];
    if (it.section === "math") {
      tools.push(
        h("button", { "data-k": "calc", class: "icon-btn tip-left", "aria-label": settings.calcOpen ? "Hide calculator" : "Calculator", "data-tip": settings.calcOpen ? "Hide calculator" : "Calculator", "aria-pressed": String(!!settings.calcOpen), onclick: () => { settings.calcOpen = !settings.calcOpen; persist(); render(); } }, icon("calc")),
        h("button", { "data-k": "ref", class: "icon-btn tip-left", "aria-label": "Reference sheet", "data-tip": "Reference sheet", onclick: openReference }, icon("formula")));
    }
    return h("header", { class: "topbar" },
      h("div", { class: "left" },
        h("button", { "data-k": "back", class: "btn quiet", onclick: () => ctx.go(set.from || "#/") }, "Back"),
        h("span", { class: "acc-chip", role: "img", tabindex: "0", "data-tip": "First-try accuracy in this set", "aria-label": `First-try accuracy in this set: ${answered.length ? pct(right.length, answered.length) : "none yet"}` },
          icon("progress"), answered.length ? pct(right.length, answered.length) : "–")),
      h("div", { class: "timer" },
        h("output", { "aria-live": "off", hidden: !!settings.timerHidden }, fmt(set.elapsed)),
        settings.timerHidden ? h("span", { class: "qtags" }, "Timer hidden") : null,
        h("div", { class: "row" },
          h("button", { "data-k": "pause", onclick: () => { set.running = !set.running; render(); } }, set.running ? "Pause" : "Resume"),
          h("button", { "data-k": "hide", onclick: () => { settings.timerHidden = !settings.timerHidden; persist(); render(); } }, settings.timerHidden ? "Show" : "Hide"))),
      h("div", { class: "right" }, tools));
  }

  // ---------- left pane ----------
  function leftPane() {
    const it = item();
    if (it.section === "math") {
      if (!settings.calcOpen) return null;
      return calculatorPanel(settings, {
        onClose: () => { settings.calcOpen = false; persist(); render(); },
        onResize: d => setLeft((settings.calcWidth || 45) + d),
        onChange: persist,
      });
    }
    return [
      it.figure ? h("img", { class: "figure", src: it.figure.src, alt: it.figure.alt }) : null, // graphs sit with the passage, as on the real test
      hlZone(mathText("p", it.passage, { class: "passage" }), "passage"),
      it.passage2 ? hlZone(mathText("p", it.passage2, { class: "passage" }), "passage2") : null,
    ];
  }

  function setLeft(p) {
    const v = Math.min(75, Math.max(25, p));
    if (item().section === "math") settings.calcWidth = v; else settings.splitWidth = v;
    persist();
    root.querySelector(".split")?.style.setProperty("--left", `${v}%`);
    root.querySelector(".divider")?.setAttribute("aria-valuenow", String(Math.round(v)));
    resizeCalculators();
  }

  // ---------- highlighting ----------
  // Select text in a passage or question: on a mouse it turns yellow at once and a toolbar offers
  // colours, underline, a note and delete; on touch nothing is applied until a toolbar button is tapped.
  const fresh = new Set(); // one-shot: things that just appeared animate in once, not on every re-render
  let bar = null; // { part, idx } for a saved highlight, or { part, pending: {start, end} }; plus rect, noteOpen
  let pointer = "mouse";
  const mine = part => (state.highlights[item().id] || []).filter(r => r.part === part);
  const savePart = (part, list) => {
    const id = item().id;
    S.setHighlights(state, id, [...(state.highlights[id] || []).filter(r => r.part !== part), ...list]);
    persist();
  };

  function hlZone(el, part) {
    el.classList.add("hl-zone");
    el.dataset.part = part;
    el.addEventListener("pointerdown", e => { pointer = e.pointerType; });
    el.addEventListener("mouseup", () => {
      if (pointer !== "mouse") return;
      const r = selectionRange(el);
      if (!r) return;
      const rect = getSelection().getRangeAt(0).getBoundingClientRect();
      const { list, index } = addRange(mine(part), { part, ...r, color: "yellow" });
      savePart(part, list);
      getSelection().removeAllRanges();
      bar = { part, idx: index, rect };
      render();
    });
    queueMicrotask(() => paint(el, mine(part), (idx, m) => { bar = { part, idx, rect: m.getBoundingClientRect() }; render(); }));
    return el;
  }

  // touch: wait for the selection to settle, then offer the toolbar without applying anything yet
  let selTimer = null;
  const onSelection = () => {
    if (pointer === "mouse") return;
    clearTimeout(selTimer);
    selTimer = setTimeout(() => {
      const sel = getSelection();
      if (!sel || sel.isCollapsed || !sel.rangeCount) return;
      const zone = sel.getRangeAt(0).commonAncestorContainer.parentElement?.closest(".hl-zone");
      const r = zone && selectionRange(zone);
      if (!r) return;
      bar = { part: zone.dataset.part, pending: r, rect: sel.getRangeAt(0).getBoundingClientRect() };
      root.querySelector(".hl-bar")?.remove();
      root.append(toolbar());
    }, 350);
  };
  const closeBar = () => { if (!bar) return; const wasNote = bar.noteOpen; bar = null; if (wasNote) render(); else root.querySelector(".hl-bar")?.remove(); };
  const onKey = e => {
    if (e.key !== "Escape") return;
    if (bar) return closeBar();
    const u = ui();
    if (u.pop || u.confirmGiveUp) { u.pop = null; u.confirmGiveUp = false; render(); }
  };
  const onDown = e => {
    if (bar && !e.target.closest(".hl-bar, mark.hl")) closeBar();
    const u = ui();
    if (u.pop && !e.target.closest(".pop-card, .explain-pill, .why-btn")) { u.pop = null; root.querySelector(".pop-card")?.remove(); }
  };
  const onScroll = e => { if (bar && !e.target.closest?.(".hl-bar")) closeBar(); }; // the page scrolls on phones, a pane on desktop
  document.addEventListener("selectionchange", onSelection);
  document.addEventListener("keydown", onKey);
  document.addEventListener("pointerdown", onDown);
  document.addEventListener("scroll", onScroll, true);
  const onHide = () => { saveTime(); persist(); }; // closing the tab keeps the time so far
  addEventListener("pagehide", onHide);

  function toolbar() {
    if (!bar) return null;
    const cur = bar.pending ? null : mine(bar.part)[bar.idx];
    if (!bar.pending && !cur) { bar = null; return null; }
    // apply a change: a pending (touch) selection becomes a highlight first
    const apply = patch => {
      const list = mine(bar.part);
      if (bar.pending) {
        const { list: out, index } = addRange(list, { part: bar.part, ...bar.pending, color: "yellow", ...patch });
        savePart(bar.part, out);
        bar = { part: bar.part, idx: index, rect: bar.rect, noteOpen: bar.noteOpen };
      } else {
        const next = { ...list[bar.idx], ...patch };
        if (!next.underline) delete next.underline;
        list[bar.idx] = next;
        savePart(bar.part, list);
      }
      getSelection().removeAllRanges();
      render();
    };
    const colour = (c, label) => h("button", { class: `swatch c-${c}`, "aria-label": `${label} highlight`, "aria-pressed": String(cur?.color === c || (!cur?.color && c === "yellow" && !!cur)), onclick: () => apply({ color: c }) });
    const r = bar.rect;
    const el = h("div", { class: "hl-bar", role: "toolbar", "aria-label": "Highlight", style: `left:${Math.max(8, Math.min(innerWidth - 248, r.left + r.width / 2 - 120))}px;top:${Math.max(8, r.top - 52)}px` },
      h("div", { class: "hl-tools" },
        colour("yellow", "Yellow"), colour("blue", "Blue"), colour("pink", "Pink"),
        h("button", { class: "tool", "aria-label": "Underline", "aria-pressed": String(!!cur?.underline), onclick: () => apply({ underline: !cur?.underline }) }, h("u", {}, "U")),
        h("button", { class: "tool", "aria-label": cur?.note ? "Edit note" : "Add a note", "aria-pressed": String(!!bar.noteOpen), onclick: () => { bar.noteOpen = !bar.noteOpen; if (bar.pending) apply({}); else render(); } }, icon("note")),
        cur ? h("button", { class: "tool", "aria-label": "Remove highlight", onclick: () => { const list = mine(bar.part); list.splice(bar.idx, 1); savePart(bar.part, list); bar = null; render(); } }, icon("trash")) : null),
      bar.noteOpen && cur ? h("textarea", { class: "hl-note", "data-k": "hlnote", rows: "3", maxlength: "1000", placeholder: "Add a note…", "aria-label": "Note",
        oninput: e => { const list = mine(bar.part); const v = e.target.value.trim(); list[bar.idx] = { ...list[bar.idx], note: v }; if (!v) delete list[bar.idx].note; savePart(bar.part, list); } }, cur.note || "") : null);
    if (bar.noteOpen && cur) queueMicrotask(() => { const t = el.querySelector("textarea"); t.focus(); t.setSelectionRange(t.value.length, t.value.length); });
    return el;
  }

  // ---------- question ----------
  function question() {
    const it = item();
    const u = ui();
    const a = attempt();
    const solved = !!a?.solved;
    const struck = (set.crossed[it.id] ||= []);
    const marked = S.isMarked(state, it.id);
    const domain = ctx.skillName(it.skill);

    const head = h("div", { class: "qhead" },
      h("span", { class: "qnum", "aria-label": `Question ${set.index + 1}` }, String(set.index + 1)),
      h("button", { "data-k": "mark", class: "btn quiet", "aria-pressed": String(marked), onclick: () => { S.toggleMark(state, it.id); persist(); render(); } },
        marked ? "Marked for review" : "Mark for review"),
      h("span", { class: "spacer" }),
      h("span", { class: "qtags" }, domain, diffBars(it.difficulty, it.challenge)),
      it.format === "mcq" ? h("button", { "data-k": "cross", class: "btn quiet", "aria-pressed": String(!!set.crossMode), title: "Cross out answer choices", onclick: () => { set.crossMode = !set.crossMode; render(); } }, h("s", {}, "ABC")) : null);

    const prompt = it.section === "math" ? it.stem : it.question;
    const body = [
      it.figure && it.section === "math" ? h("img", { class: "figure", src: it.figure.src, alt: it.figure.alt }) : null,
      hlZone(mathText("p", prompt, { class: "stem" }), it.section === "math" ? "stem" : "question"),
    ];

    if (it.format === "spr") {
      const input = h("input", { "data-k": "spr", id: "spr", inputmode: "decimal", autocomplete: "off", "aria-describedby": "spr-hint", disabled: solved, value: solved ? a.picks[a.picks.length - 1] : "" });
      const check = () => {
        const v = input.value.trim();
        if (!v) return;
        const ok = isCorrect(it, v);
        S.recordPick(state, it.id, set.session, v, ok);
        saveTime();
        persist();
        u.sprMsg = ok ? null : `Not quite: ${v} is not correct. Try again.`;
        if (ok) { u.panel = true; u.steps = 1; fresh.add("panel"); } // slide the panel in, as for multiple choice
        render();
      };
      input.addEventListener("keydown", e => { if (e.key === "Enter") check(); });
      body.push(h("div", { class: "spr" },
        h("label", { for: "spr" }, "Your answer"),
        input,
        solved ? null : h("button", { "data-k": "spr-check", class: "btn primary", onclick: check }, "Check"),
        h("span", { class: "hint", id: "spr-hint" }, "Enter a whole number, a decimal or a fraction such as 3/4.")),
      h("p", { class: `feedback ${solved ? "ok" : "no"}`, role: "status", tabindex: "-1" }, solved ? "Correct." : u.sprMsg || ""),
      !solved && u.sprMsg ? h("button", { "data-k": "show", class: "btn", onclick: () => { S.giveUp(state, it.id, set.session); saveTime(); persist(); u.panel = true; u.steps = 99; render(); } }, "Show answer") : null);
    } else {
      const wrongList = (a?.picks || []).filter(p => p !== it.answer);
      const wrongPicks = new Set(wrongList);
      const done = solved || !!a?.gaveUp;
      const list = h("ol", { class: `choices${set.crossMode && !done ? "" : " no-strike"}`, "aria-label": "Answer choices" });
      it.choices.forEach((c, i) => {
        const L = LETTERS[i];
        const isRight = solved && L === it.answer;
        const isWrong = wrongPicks.has(L);
        const isStruck = struck.includes(L) && !isRight;
        const pick = h("button", {
          "data-k": `pick-${L}`, class: "pick", "aria-pressed": String(u.selected === L && !isWrong && !solved),
          disabled: solved || isWrong || isStruck,
          onclick: () => { u.selected = L; u.pop = null; render(); },
        }, h("span", { class: "sr" }, `Choice ${L}${isRight ? ", correct" : isWrong ? ", incorrect" : ""}: `),
          h("span", { class: "bubble", "aria-hidden": "true" }, isRight ? "✓" : isWrong ? "✕" : L), typeset(h("span", { class: "ctext" }, c.text)));
        if (u.selected === L && !solved && !isWrong) {
          pick.append(h("span", { class: "check btn primary" }, "Check"));
          pick.onclick = () => checkMcq(L);
        }
        const why = L === it.answer ? ex().why : c.slip;
        const toggle = () => { u.pop = u.pop === L ? null : L; if (u.pop) fresh.add(`pop-${L}`); render(); };
        // right-hand slot: cross-out while answering; a small "?" for every choice once the question is done
        const slot = done
          ? h("button", { "data-k": `why-${L}`, class: "why-btn tip-left", "aria-expanded": String(u.pop === L), "aria-label": `Why ${L} is ${L === it.answer ? "right" : "wrong"}`, "data-tip": `Why ${L} is ${L === it.answer ? "right" : "wrong"}`, onclick: toggle }, "?")
          : h("button", { "data-k": `strike-${L}`, class: "strike", "aria-pressed": String(isStruck), "aria-label": `Cross out choice ${L}`, disabled: isWrong, onclick: () => { set.crossed[it.id] = struck.includes(L) ? struck.filter(x => x !== L) : [...struck, L]; if (u.selected === L) u.selected = null; render(); } }, L);
        const row = h("li", { class: `choice${isRight ? " right" : ""}${isWrong ? " wrong" : ""}${isStruck ? " struck" : ""}`, "data-anim": `ch-${L}` },
          pick,
          isWrong && !done ? h("button", { "data-k": `explain-${L}`, class: "explain-pill", "aria-expanded": String(u.pop === L), onclick: toggle }, "Explain") : null,
          slot,
          u.pop === L ? typeset(h("div", { class: `pop-card${L === it.answer ? " is-right" : ""}`, "data-anim": `pop-${L}`, role: "status" },
            h("p", { class: "pop-title" }, icon(L === it.answer ? "check" : "hint"), L === it.answer ? `Why ${L} is right` : `Why ${L} is wrong`,
              h("button", { class: "pop-x", "aria-label": "Close", onclick: () => { u.pop = null; render(); } }, icon("x"))),
            h("p", { class: "pop-text" }, why))) : null);
        list.append(row);
      });
      body.push(list, h("p", { class: `feedback ${solved ? "ok" : wrongPicks.size ? "no" : ""}`, role: "status", tabindex: "-1" },
        solved ? (wrongPicks.size ? `Got it: the answer is ${it.answer}.` : `Correct: the answer is ${it.answer}.`) : wrongPicks.size ? "Not quite. Pick another answer." : ""));
    }
    if (u.hints && !solved && !a?.gaveUp) {
      const steps = it.explanation.steps.slice(0, u.hints);
      body.push(typeset(h("div", { class: "hint-box", "data-k": "hintbox", tabindex: "-1", "data-anim": "hintbox" },
        h("p", { class: "hint-title" }, icon("hint"), `Hint ${u.hints} of ${maxHints(it)}`),
        stepper(steps, steps.length, "hint"))));
    }
    const after = it.format === "mcq" && solved && (a?.picks || []).some(p => p !== it.answer);
    return h("div", { class: `qwrap${solved ? " solved" : ""}${after ? " after-wrong" : ""}` }, head, body);
  }

  function checkMcq(L) {
    const it = item();
    const u = ui();
    const ok = isCorrect(it, L);
    S.recordPick(state, it.id, set.session, L, ok);
    saveTime();
    persist();
    u.selected = null;
    fresh.add(`ch-${L}`);
    if (ok) { u.pop = null; u.panel = true; u.steps = 1; fresh.add("panel"); }
    else { u.pop = L; fresh.add(`pop-${L}`); }
    render();
  }

  // ---------- explanation panel ----------
  const ex = () => item().explanation;

  // A vertical walkthrough: a dot per step joined by a line; the newest step is blue.
  function stepper(steps, shown, prefix) {
    return h("ol", { class: "stepper" }, steps.slice(0, shown).map((t, i) =>
      h("li", { class: i === shown - 1 ? "now" : "", "data-anim": `${prefix}-${i + 1}` }, h("span", { class: "dot", "aria-hidden": "true" }),
        h("p", { class: "step-name" }, `Step ${i + 1}`), h("p", { class: "step-text" }, t))));
  }

  function panel() {
    const it = item();
    const u = ui();
    if (!u.panel) return null;
    const e = ex();
    const shown = Math.min(u.steps, e.steps.length);
    const correct = it.format === "mcq"
      ? h("div", { class: "ans-row" }, h("span", { class: "ans-badge" }, it.answer), h("span", {}, it.choices[LETTERS.indexOf(it.answer)].text))
      : h("div", { class: "ans-row" }, h("span", { class: "ans-badge" }, icon("check")), h("span", {}, it.answer,
          it.accept.filter(x => x !== it.answer).length ? h("small", {}, ` (also accepted: ${it.accept.filter(x => x !== it.answer).join(", ")})`) : null));
    const rest = shown < e.steps.length;
    return h("aside", { class: "xpanel", "aria-label": "Explanation", "data-anim": "panel" },
      h("div", { class: "x-head" }, h("h2", {}, "Step-by-step explanation"),
        h("button", { "data-k": "xclose", class: "icon-btn", "aria-label": "Close explanation", onclick: () => { u.panel = false; render(); } }, icon("x"))),
      typeset(h("div", { class: "ans-card" }, h("p", { class: "ans-label" }, "Correct Answer"), correct, h("p", { class: "ans-why" }, e.why))),
      h("h3", { class: "walk" }, "Step-by-step walkthrough"),
      typeset(stepper(e.steps, shown, "step")),
      rest
        ? h("div", { class: "step-more" },
            h("span", { class: "dot ghost", "aria-hidden": "true" }), h("span", { class: "ghost-name" }, `Step ${shown + 1}`),
            h("button", { "data-k": "nextstep", class: "btn primary sm", onclick: () => { u.steps++; fresh.add(`step-${u.steps}`); render(); } }, "Next step"),
            h("button", { "data-k": "allsteps", class: "btn quiet sm", onclick: () => { for (let n = u.steps + 1; n <= e.steps.length; n++) fresh.add(`step-${n}`); u.steps = 99; fresh.add("pattern"); render(); } }, "Show all"))
        : typeset(h("p", { class: "pattern", "data-anim": "pattern" }, h("b", {}, "Pattern to remember"), e.pattern)));
  }

  // ---------- bottom bar + navigator ----------
  function bottombar() {
    const it = item();
    const u = ui();
    const a = attempt();
    const free = a?.solved || a?.gaveUp;
    const ibtn = (k, label, ic, attrs, onclick) => h("button", { "data-k": k, class: "icon-btn tip-up", "aria-label": label, "data-tip": label, ...attrs, onclick }, icon(ic));
    const explain = h("span", { class: "rel" },
      ibtn("explain", u.panel ? "Hide explanation" : "Explanation", "steps", { "aria-pressed": String(!!u.panel) }, () => {
        if (u.panel) u.panel = false;
        else if (free) { u.panel = true; fresh.add("panel"); }
        else { u.confirmGiveUp = !u.confirmGiveUp; if (u.confirmGiveUp) fresh.add("confirm"); }
        render();
      }),
      u.confirmGiveUp ? h("div", { class: "confirm-pop", role: "dialog", "aria-label": "Show the explanation?", "data-anim": "confirm" },
        h("p", {}, "Seeing the explanation now counts this question as incorrect."),
        h("div", { class: "row" },
          h("button", { "data-k": "giveup-no", class: "btn quiet sm", onclick: () => { u.confirmGiveUp = false; render(); } }, "Keep trying"),
          h("button", { "data-k": "giveup-yes", class: "btn primary sm", onclick: () => { S.giveUp(state, it.id, set.session); saveTime(); persist(); u.confirmGiveUp = false; u.panel = true; u.steps = 1; fresh.add("panel"); render(); } }, "Show it"))) : null);
    const hintLabel = u.hints ? (u.hints >= maxHints(it) ? "No more hints" : `Next hint (${u.hints} of ${maxHints(it)} shown)`) : "Hint";
    const hintBtn = !free && maxHints(it) > 0
      ? ibtn("hint", hintLabel, "hint", { disabled: u.hints >= maxHints(it) }, () => { u.hints = (u.hints || 0) + 1; fresh.add(u.hints === 1 ? "hintbox" : `hint-${u.hints}`); render(); root.querySelector(".hint-box")?.scrollIntoView({ block: "nearest", behavior: "smooth" }); })
      : null;
    return h("footer", { class: "bottombar" },
      h("button", { "data-k": "nav", class: "btn", "aria-expanded": String(!!set.navOpen), "aria-controls": "navpop", onclick: () => { set.navOpen = !set.navOpen; if (set.navOpen) fresh.add("nav"); render(); } },
        `${set.index + 1} of ${set.ids.length}`, h("span", { class: "chev", "aria-hidden": "true" }, set.navOpen ? "▾" : "▴")),
      h("span", { style: "flex:1" }),
      hintBtn,
      explain,
      ibtn("prev", "Previous question", "left", { disabled: set.index === 0 }, () => go(set.index - 1)),
      h("button", { "data-k": "next", class: "btn primary next", disabled: set.index === set.ids.length - 1, onclick: () => go(set.index + 1) }, "Next", icon("right")));
  }

  function navigator() {
    if (!set.navOpen) return null;
    const badge = (st, marked) => [
      st !== "unanswered" ? statusIcon(st, { labelled: false }) : null,
      marked ? statusIcon("marked", { labelled: false }) : null];
    return h("div", { class: "nav-pop", "data-anim": "nav", id: "navpop", role: "dialog", "aria-label": "Questions in this set", onkeydown: e => { if (e.key === "Escape") { set.navOpen = false; render(); } } },
      h("div", { class: "nav-head" }, h("strong", {}, "Questions"),
        h("button", { "data-k": "navclose", class: "btn quiet", onclick: () => { set.navOpen = false; render(); } }, "Close")),
      h("div", { class: "legend" },
        ["correct", "incorrect", "changed", "marked"].map(k => statusIcon(k)),
        h("span", { class: "legend-gap" }),
        ["easy", "medium", "hard"].map(d => h("span", { class: "dkey", "data-d": d, role: "img", "aria-label": `${d} question`, "data-tip": `${d[0].toUpperCase() + d.slice(1)} question`, tabindex: "0" }))),
      h("div", { class: "grid" }, set.ids.map((id, i) => {
        const st = statusInSet(id);
        const d = byId[id].difficulty;
        const mk = S.isMarked(state, id);
        return h("button", {
          "data-k": `q-${i}`, "data-d": d, "aria-current": String(i === set.index),
          "aria-label": `Question ${i + 1}, ${d}: ${STATUS[st].tip}${mk ? ", marked for review" : ""}`,
          onclick: () => { set.navOpen = false; go(i); },
        }, String(i + 1), badge(st, mk));
      })));
  }

  // Hints reveal steps one at a time but stop two short of the end, since the last steps state the answer.
  function maxHints(it) {
    const n = it.explanation.steps.length;
    return n < 2 ? 0 : Math.max(1, n - 2);
  }

  function statusInSet(id) {
    const a = (state.attempts[id] || []).find(x => x.session === set.session);
    if (!a || a.firstCorrect === null) return "unanswered";
    return a.firstCorrect ? "correct" : a.solved ? "changed" : "incorrect";
  }

  // copy this question's time onto its attempt (no attempt yet = not answered = not counted)
  function saveTime() {
    const u = set.ui[item().id];
    if (u?.ms) S.setTime(state, item().id, set.session, u.ms);
  }

  function go(i) {
    saveTime();
    persist();
    bar = null;
    ui().pop = null;
    set.index = i;
    ctx.saveSet(set);
    render();
    root.querySelector(".pane.right")?.scrollTo(0, 0);
  }

  // ---------- reference sheet ----------
  function openReference() {
    const f = (cap, tex) => h("figure", {}, h("figcaption", {}, cap), typeset(h("div", {}, tex)));
    const d = h("dialog", { class: "ref", "aria-label": "Reference sheet" },
      h("header", {}, h("h2", {}, "Reference sheet"), h("button", { class: "btn quiet", onclick: () => d.close() }, "Close")),
      h("div", { class: "body" },
        f("Circle", "\\(A = \\pi r^2\\), \\(C = 2\\pi r\\)"),
        f("Rectangle", "\\(A = \\ell w\\)"),
        f("Triangle", "\\(A = \\tfrac{1}{2}bh\\)"),
        f("Pythagorean theorem", "\\(c^2 = a^2 + b^2\\)"),
        f("Special right triangles", "\\(45^\\circ\\!-\\!45^\\circ\\!-\\!90^\\circ\\): sides \\(s, s, s\\sqrt{2}\\). \\(30^\\circ\\!-\\!60^\\circ\\!-\\!90^\\circ\\): sides \\(x, x\\sqrt{3}, 2x\\)"),
        f("Rectangular prism", "\\(V = \\ell w h\\)"),
        f("Cylinder", "\\(V = \\pi r^2 h\\)"),
        f("Sphere", "\\(V = \\tfrac{4}{3}\\pi r^3\\)"),
        f("Cone", "\\(V = \\tfrac{1}{3}\\pi r^2 h\\)"),
        f("Pyramid", "\\(V = \\tfrac{1}{3}\\ell w h\\)"),
        typeset(h("p", { class: "notes" }, "A circle measures \\(360^\\circ\\), or \\(2\\pi\\) radians. The angles of a triangle add up to \\(180^\\circ\\)."))));
    d.addEventListener("close", () => d.remove());
    document.body.append(d);
    d.showModal();
  }

  // ---------- layout ----------
  function divider() {
    const left = item().section === "math" ? settings.calcWidth || 45 : settings.splitWidth || 50;
    const el = h("button", { class: "divider", role: "separator", "aria-orientation": "vertical", "aria-label": "Resize panes (use arrow keys)", "aria-valuenow": String(left), "aria-valuemin": "25", "aria-valuemax": "75" });
    el.addEventListener("keydown", e => {
      if (e.key === "ArrowLeft") setLeft((parseFloat(el.getAttribute("aria-valuenow")) || 50) - 4);
      if (e.key === "ArrowRight") setLeft((parseFloat(el.getAttribute("aria-valuenow")) || 50) + 4);
    });
    el.addEventListener("pointerdown", e => {
      const split = el.parentElement;
      el.setPointerCapture(e.pointerId);
      const move = ev => {
        const r = split.getBoundingClientRect();
        setLeft(((ev.clientX - r.left) / r.width) * 100);
      };
      el.addEventListener("pointermove", move);
      el.addEventListener("pointerup", () => el.removeEventListener("pointermove", move), { once: true });
    });
    return el;
  }

  function render() {
    const it = item();
    const left = leftPane();
    const p = panel();
    const leftPct = it.section === "math" ? settings.calcWidth || 45 : settings.splitWidth || 50;
    const split = h("main", { id: "main", class: `split${left ? "" : " single"}${p ? " with-panel" : ""}`, style: `--left:${leftPct}%` },
      h("div", { class: "pane left" }, left),
      divider(),
      h("div", { class: "pane right" }, question()),
      p);
    const key = document.activeElement?.dataset?.k;
    root.replaceChildren(h("div", { class: "practice" }, topbar(), split, bottombar()), navigator() || "", toolbar() || "");
    for (const el of root.querySelectorAll("[data-anim]")) if (fresh.has(el.dataset.anim)) el.classList.add("in");
    fresh.clear();
    if (key) {
      // keep keyboard focus on the same control; if it is now disabled, move to the feedback line
      const find = k => { const el = root.querySelector(`[data-k="${CSS.escape(k)}"]`); return el && !el.disabled ? el : null; };
      (find(key) || find(key.replace("pick-", "explain-")) || root.querySelector(".feedback"))?.focus({ preventScroll: true });
    }
    document.title = `Question ${set.index + 1} of ${set.ids.length} – SAT Practice`;
  }

  render();
  startTimer();
  return () => { // no set save here: a newer set may already be stored
    clearInterval(tick);
    saveTime();
    persist();
    clearTimeout(selTimer);
    document.removeEventListener("selectionchange", onSelection);
    document.removeEventListener("keydown", onKey);
    document.removeEventListener("pointerdown", onDown);
    document.removeEventListener("scroll", onScroll, true);
    removeEventListener("pagehide", onHide);
  };
}
