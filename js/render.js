// Small DOM helpers. Item text is always inserted as text; only KaTeX writes HTML.

export function h(tag, attrs = {}, ...kids) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v === false || v == null) continue;
    if (k === "class") el.className = v;
    else if (k.startsWith("on")) el.addEventListener(k.slice(2), v);
    else if (k === "text") el.textContent = v;
    else el.setAttribute(k, v === true ? "" : v);
  }
  for (const kid of kids.flat()) {
    if (kid == null || kid === false) continue;
    el.append(kid instanceof Node ? kid : document.createTextNode(String(kid)));
  }
  return el;
}

export function typeset(el) {
  if (globalThis.renderMathInElement) {
    globalThis.renderMathInElement(el, {
      delimiters: [{ left: "\\(", right: "\\)", display: false }],
      throwOnError: false,
    });
  }
  return el;
}

// Text that may contain \( math \).
export function mathText(tag, text, attrs = {}) {
  return typeset(h(tag, attrs, text));
}

export function diffBars(difficulty, challenge) {
  const n = { easy: 1, medium: 2, hard: 3 }[difficulty] || 0;
  return h("span", { class: "diff", role: "img", "aria-label": `Difficulty: ${challenge ? "challenge" : difficulty}` },
    [1, 2, 3].map(i => h("i", { class: i <= n ? "on" : "" })), challenge ? h("b", { class: "chal" }, "Challenge") : null);
}

export function pct(n, d) {
  return d ? `${Math.round((100 * n) / d)}%` : "–";
}

// Line icons (24px grid, drawn with currentColor). Decorative: always aria-hidden.
const ICONS = {
  bank: "M12 3 3 8l9 5 9-5-9-5zM3 12.5l9 5 9-5M3 17l9 5 9-5",
  mistakes: "M12 3a9 9 0 1 0 0 18 9 9 0 1 0 0-18zM9 9l6 6M15 9l-6 6",
  marked: "M6 3h12v18l-6-4.5L6 21z",
  progress: "M5 20v-8M12 20V4M19 20v-5",
  book: "M12 6.5C10 5 7.5 4.5 4 4.5v14c3.5 0 6 .5 8 2 2-1.5 4.5-2 8-2v-14c-3.5 0-6 .5-8 2zM12 6.5v14",
  math: "M5 7h6M8 4v6M14 7h5M5 17h6M14.5 14.5l4 4M18.5 14.5l-4 4",
  check: "M5 12.5l4.5 4.5L19 7",
  x: "M7 7l10 10M17 7 7 17",
  calc: "M7 3h10a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2zM8.5 6.5h7v3h-7zM9 13h.01M12 13h.01M15 13h.01M9 16.5h.01M12 16.5h.01M15 16.5h.01",
  shuffle: "M4 7h3.5c4 0 5 10 9 10H20M4 17h3.5c1.6 0 2.6-1.6 3.4-3.5M13.1 9.5C14 7.6 15 7 16.5 7H20M17 4l3 3-3 3M17 14l3 3-3 3",
  note: "M5 4h14v11l-5 5H5zM14 20v-5h5M8.5 9h7M8.5 12.5h4",
  trash: "M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3",
  home: "M3.5 11 12 4l8.5 7M6 9.5V20h4.5v-5.5h3V20H18V9.5",
  planner: "M5 5.5h14V20H5zM5 9.5h14M9 3.5v4M15 3.5v4M8.5 13h2M13.5 13h2M8.5 16.5h2",
  bolt: "M13 3 5 13.5h6L10 21l8-10.5h-6z",
  flag: "M6 21V4M6 4.5h11l-2.5 4 2.5 4H6",
  clock: "M12 4a8 8 0 1 0 0 16 8 8 0 0 0 0-16zM12 8v4.2l3 1.8",
  steps: "M5 6h.01M5 12h.01M5 18h.01M9 6h10M9 12h10M9 18h6",
  left: "M15 5l-7 7 7 7",
  right: "M9 5l7 7-7 7",
  formula: "M6 3h9l4 4v14H6zM15 3v4h4M9 11.5h2.5M10.25 10.25v2.5M13.5 11.5H16M9 16.5l2.5 2.5M11.5 16.5 9 19M13.5 17h2.5M13.5 18.5h2.5",
  hint: "M9 18h6M10 21h4M12 3a6 6 0 0 0-3.6 10.8c.7.6 1.1 1.3 1.1 2.2h5c0-.9.4-1.6 1.1-2.2A6 6 0 0 0 12 3z",
};
export function icon(name) {
  const NS = "http://www.w3.org/2000/svg";
  const svg = document.createElementNS(NS, "svg");
  for (const [k, v] of Object.entries({ viewBox: "0 0 24 24", width: "18", height: "18", fill: "none", stroke: "currentColor", "stroke-width": "1.8", "stroke-linecap": "round", "stroke-linejoin": "round", "aria-hidden": "true", class: "ico" })) svg.setAttribute(k, v);
  const p = document.createElementNS(NS, "path");
  p.setAttribute("d", ICONS[name]);
  svg.append(p);
  return svg;
}

// Status as a small round icon; the meaning shows in a tooltip on hover or focus.
export const STATUS = {
  correct: { cls: "ok", ic: "check", tip: "Correct" },
  incorrect: { cls: "no", ic: "x", tip: "Incorrect" },
  changed: { cls: "ch", ic: "check", tip: "Correct after wrong tries" },
  marked: { cls: "mk", ic: "marked", tip: "Marked for review" },
  unanswered: { cls: "un", ic: null, tip: "Unanswered" },
};
export function statusIcon(key, { labelled = true } = {}) {
  const s = STATUS[key];
  return labelled
    ? h("span", { class: `tb ${s.cls}`, role: "img", "aria-label": s.tip, "data-tip": s.tip, tabindex: "0" }, s.ic ? icon(s.ic) : null)
    : h("span", { class: `tb ${s.cls}`, "aria-hidden": "true" }, s.ic ? icon(s.ic) : null);
}
