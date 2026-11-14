// Highlighter: offsets are counted over the rendered text of each zone
// (data-part="passage" | "passage2" | "question" | "stem").

function textNodes(root) {
  const out = [];
  const walk = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  while (walk.nextNode()) out.push(walk.currentNode);
  return out;
}

function offsetOf(root, node, offset) {
  let n = 0;
  for (const t of textNodes(root)) {
    if (t === node) return n + offset;
    n += t.length;
  }
  // selection boundary on an element: count text before that child
  const r = document.createRange();
  r.setStart(root, 0);
  r.setEnd(node, offset);
  return r.toString().length;
}

export function selectionRange(zone) {
  const sel = getSelection();
  if (!sel || sel.isCollapsed || !sel.rangeCount) return null;
  const r = sel.getRangeAt(0);
  if (!zone.contains(r.startContainer) || !zone.contains(r.endContainer)) return null;
  const start = offsetOf(zone, r.startContainer, r.startOffset);
  const end = offsetOf(zone, r.endContainer, r.endOffset);
  return end > start ? { start, end } : null;
}

// Wrap [start, end) in <mark>s, splitting text nodes as needed.
export function paint(zone, ranges, onClick) {
  for (const m of zone.querySelectorAll("mark.hl")) m.replaceWith(...m.childNodes);
  zone.normalize();
  ranges.forEach((rg, idx) => {
    let pos = 0;
    for (const t of textNodes(zone)) {
      const a = pos, b = pos + t.length;
      pos = b;
      if (b <= rg.start || a >= rg.end || t.parentElement.closest(".katex-mathml")) continue;
      let node = t;
      if (rg.start > a) node = node.splitText(rg.start - a);
      if (rg.end < b) node.splitText(rg.end - Math.max(a, rg.start));
      const m = document.createElement("mark");
      m.className = `hl c-${rg.color || "yellow"}${rg.underline ? " u" : ""}${rg.note ? " has-note" : ""}`;
      m.dataset.idx = String(idx);
      m.title = rg.note || "Click to change or remove";
      m.addEventListener("click", e => { e.stopPropagation(); onClick(idx, m); });
      node.replaceWith(m);
      m.append(node);
    }
  });
}

// Add a highlight: it absorbs every range it overlaps, takes the new style, and keeps their notes.
export function addRange(list, r) {
  const hit = list.filter(x => x.start < r.end && r.start < x.end);
  const rest = list.filter(x => !hit.includes(x));
  const note = hit.map(x => x.note).filter(Boolean).join("\n");
  const merged = { start: Math.min(r.start, ...hit.map(x => x.start)), end: Math.max(r.end, ...hit.map(x => x.end)) };
  for (const k of ["part", "color", "underline"]) if (r[k] !== undefined) merged[k] = r[k];
  if (note || r.note) merged.note = [note, r.note].filter(Boolean).join("\n");
  const out = [...rest, merged].sort((x, y) => x.start - y.start);
  return { list: out, index: out.indexOf(merged) };
}
