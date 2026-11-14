// Desmos calculator panel. Key kept for a friends-only, non-commercial site (SPEC open question 1).
import { h } from "./render.js";

const SRC = "https://www.desmos.com/api/v1.12/calculator.js?apiKey=7e3fda0aa8c94378b94384d9ee597678";
let loading = null;
const instances = {}; // kept alive so each mode keeps its work

function loadDesmos() {
  if (globalThis.Desmos) return Promise.resolve();
  loading ||= new Promise((ok, fail) => {
    const s = document.createElement("script");
    s.src = SRC;
    s.onload = ok;
    s.onerror = () => { loading = null; fail(new Error("The calculator could not load. Check your connection and try again.")); };
    document.head.append(s);
  });
  return loading;
}

// Builds the panel. `settings` is mutated and saved through onChange.
export function calculatorPanel(settings, { onClose, onResize, onChange }) {
  const body = h("div", { class: "calc-body" });
  const mode = () => settings.calcMode || "graphing";
  const modeBtns = ["graphing", "scientific"].map(m =>
    h("button", { "data-k": `calc-${m}`, class: "btn", "aria-pressed": String(mode() === m), onclick: () => { settings.calcMode = m; onChange(); show(); sync(); } },
      m === "graphing" ? "Graphing" : "Scientific"));
  const sync = () => modeBtns.forEach((b, i) => b.setAttribute("aria-pressed", String(mode() === ["graphing", "scientific"][i])));

  const panel = h("section", { class: "calc", "aria-label": "Calculator" },
    h("div", { class: "calc-head" },
      h("div", { class: "seg", role: "group", "aria-label": "Calculator type" }, modeBtns),
      h("span", { class: "spacer" }),
      h("button", { "data-k": "calc-minus", class: "btn quiet", "aria-label": "Make calculator narrower", onclick: () => onResize(-8) }, "−"),
      h("button", { "data-k": "calc-plus", class: "btn quiet", "aria-label": "Make calculator wider", onclick: () => onResize(8) }, "+"),
      h("button", { "data-k": "calc-close", class: "btn quiet", onclick: onClose }, "Close")),
    body);

  async function show() {
    try {
      await loadDesmos();
    } catch (e) {
      body.replaceChildren(h("p", { class: "calc-error", role: "alert" }, e.message));
      return;
    }
    for (const m of ["graphing", "scientific"]) {
      if (!instances[m]) {
        const host = h("div");
        instances[m] = { host, calc: m === "graphing" ? Desmos.GraphingCalculator(host) : Desmos.ScientificCalculator(host) };
      }
    }
    body.replaceChildren(...Object.values(instances).map(i => i.host));
    for (const [m, i] of Object.entries(instances)) i.host.hidden = m !== mode();
    instances[mode()].calc.resize?.();
  }
  show();
  return panel;
}

export function resizeCalculators() {
  for (const i of Object.values(instances)) i.calc.resize?.();
}
