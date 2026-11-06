/** Minimal DOM builder. Text is always set via textContent, never innerHTML. */
type Child = Node | string | number | null | undefined | false | Child[];
type Attrs = Record<string, string | number | boolean | null | undefined | EventListener>;

export function h<K extends keyof HTMLElementTagNameMap>(tag: K, attrs: Attrs = {}, ...children: Child[]): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v === null || v === undefined || v === false) continue;
    if (k.startsWith("on") && typeof v === "function") el.addEventListener(k.slice(2), v as EventListener);
    else if (k === "class") el.className = String(v);
    else if (v === true) el.setAttribute(k, "");
    else el.setAttribute(k, String(v));
  }
  append(el, children);
  return el;
}

function append(el: Element, children: Child[]): void {
  for (const c of children) {
    if (c === null || c === undefined || c === false) continue;
    if (Array.isArray(c)) append(el, c);
    else el.append(c instanceof Node ? c : document.createTextNode(String(c)));
  }
}

/** Phone layout: same breakpoint as the stylesheet. */
export const isPhone = () => matchMedia("(max-width: 860px)").matches;

let toastTimer: number | undefined;
/** `stay`: visible until the next message (e.g. while an upload runs). */
export function toast(message: string, kind: "ok" | "error" = "ok", action?: { label: string; run: () => void }, stay = false): void {
  let el = document.getElementById("toast");
  if (!el) {
    el = h("div", { id: "toast", role: "status", "aria-live": "polite" });
    document.body.append(el);
  }
  el.textContent = message;
  if (action) {
    el.append(
      " ",
      h(
        "button",
        {
          type: "button",
          class: "toast__action",
          onclick: () => {
            el!.classList.remove("is-visible");
            action.run();
          },
        },
        action.label,
      ),
    );
  }
  el.className = `toast toast--${kind} is-visible`;
  clearTimeout(toastTimer);
  if (stay) return;
  toastTimer = window.setTimeout(() => el!.classList.remove("is-visible"), action ? 10000 : kind === "error" ? 8000 : 3500);
}

export function confirmDialog(message: string, okLabel = "Löschen", danger = true, details?: Node): Promise<boolean> {
  return new Promise((resolve) => {
    const dialog = h(
      "dialog",
      { class: "confirm" },
      h("p", {}, message),
      details,
      h(
        "div",
        { class: "row row--end" },
        h("button", { type: "button", class: "btn", onclick: () => close(false) }, "Abbrechen"),
        h("button", { type: "button", class: danger ? "btn btn--danger" : "btn btn--primary", onclick: () => close(true) }, okLabel),
      ),
    );
    const close = (v: boolean) => {
      dialog.close();
      dialog.remove();
      resolve(v);
    };
    dialog.addEventListener("cancel", () => close(false));
    document.body.append(dialog);
    dialog.showModal();
  });
}

export function clone<T>(v: T): T {
  return structuredClone(v);
}

/** Tells the app shell that content was saved (it then checks whether the website build worked). */
export function announceSaved(): void {
  window.dispatchEvent(new Event("hofchilbi:saved"));
}
