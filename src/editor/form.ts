import { ApiError, api, thumb } from "./api.ts";
import { clone, h, isPhone, toast } from "./dom.ts";
import { moveItem, startDrag } from "./dragSort.ts";
import { pickMedia } from "./mediaBrowser.ts";

/**
 * A working copy of one content file. Fields are bound to a path ("links.helfer",
 * "sponsors.3.url"); typing updates the copy, «Speichern» sends it with the version it was
 * loaded at. Validation errors from the server come back per path and are shown at the field.
 */
type Path = (string | number)[];

export function parsePath(p: string): Path {
  return p.split(".").map((s) => (/^\d+$/.test(s) ? Number(s) : s));
}

/** Same content = same text, whatever order the keys were set in. */
function canonical(v: unknown): string {
  return JSON.stringify(v, (_k, x) =>
    x && typeof x === "object" && !Array.isArray(x) ? Object.fromEntries(Object.entries(x).sort(([a], [b]) => a.localeCompare(b))) : x,
  );
}

export class Form<T = any> {
  draft: T;
  private original: string;
  errors: Record<string, string> = {};
  onStructure: () => void = () => {};
  onDirty: (dirty: boolean) => void = () => {};
  /** Set when the content file is spread over several screens. */
  where?: (path: string) => string;

  constructor(data: T) {
    this.draft = clone(data);
    this.original = canonical(data);
  }

  get(path: string): any {
    let v: any = this.draft;
    for (const k of parsePath(path)) v = v?.[k];
    return v;
  }

  set(path: string, value: unknown, structural = false): void {
    const keys = parsePath(path);
    let o: any = this.draft;
    for (const [i, k] of keys.slice(0, -1).entries()) {
      if (o[k] === undefined || o[k] === null) o[k] = typeof keys[i + 1] === "number" ? [] : {};
      o = o[k];
    }
    const last = keys.at(-1)!;
    if (value === undefined || value === "") {
      if (Array.isArray(o)) o[last as number] = value;
      else delete o[last];
    } else o[last] = value;
    delete this.errors[path];
    this.onDirty(this.dirty());
    if (structural) this.onStructure();
  }

  dirty(): boolean {
    return canonical(this.draft) !== this.original;
  }

  markSaved(): void {
    this.original = canonical(this.draft);
    this.errors = {};
    this.onDirty(false);
  }
}

// ------------------------------------------------------------------ fields

function fieldWrap(form: Form, path: string, label: string, control: HTMLElement, hint?: string): HTMLElement {
  const err = form.errors[path];
  const id = `f-${path.replace(/\./g, "-")}`;
  control.id = id;
  if (err) {
    control.setAttribute("aria-invalid", "true");
    control.setAttribute("aria-describedby", `${id}-err`);
  }
  return h(
    "div",
    { class: `field${err ? " field--error" : ""}`, "data-path": path },
    h("label", { for: id }, label),
    control,
    hint ? h("small", { class: "hint" }, hint) : null,
    err ? h("small", { class: "error", id: `${id}-err` }, err) : null,
  );
}

export interface TextOpts {
  type?: "text" | "url" | "email" | "date" | "number";
  hint?: string;
  placeholder?: string;
  multiline?: boolean;
  required?: boolean;
}

export function text(form: Form, path: string, label: string, o: TextOpts = {}): HTMLElement {
  const value = form.get(path);
  const input = o.multiline
    ? h("textarea", { rows: 3, placeholder: o.placeholder, required: o.required })
    : h("input", { type: o.type ?? "text", placeholder: o.placeholder, required: o.required, inputmode: o.type === "number" ? "numeric" : undefined });
  input.value = value === undefined || value === null ? "" : String(value);
  input.addEventListener("input", () => {
    const v = input.value;
    form.set(path, o.type === "number" ? (v.trim() === "" ? undefined : Number(v)) : v.trim() === "" ? undefined : v);
  });
  return fieldWrap(form, path, label, input, o.hint);
}

export function checkbox(form: Form, path: string, label: string, hint?: string): HTMLElement {
  const input = h("input", { type: "checkbox" });
  input.checked = Boolean(form.get(path));
  input.addEventListener("change", () => form.set(path, input.checked));
  return h("div", { class: "field field--check" }, h("label", {}, input, " ", label), hint ? h("small", { class: "hint" }, hint) : null);
}

const IMAGE_ACCEPT = "image/jpeg,image/png,image/webp,image/avif,image/gif,image/svg+xml";

/** Picks a file, uploads it, returns the media path (or null if cancelled/failed). */
export function pickAndUpload(dir: string, accept: string, multiple = false): Promise<string[]> {
  return new Promise((resolve) => {
    // In the document: iOS Safari may not report the choice of a detached input.
    const input = h("input", { type: "file", accept, multiple, hidden: true });
    document.body.append(input);
    input.addEventListener("cancel", () => input.remove());
    input.addEventListener("change", async () => {
      const files = [...(input.files ?? [])];
      input.remove();
      const paths: string[] = [];
      for (const [i, f] of files.entries()) {
        // Stays until done: on mobile data a photo can take longer than a normal message lasts.
        toast(files.length > 1 ? `Lade hoch: ${i + 1} von ${files.length} …` : "Lade hoch …", "ok", undefined, true);
        try {
          paths.push((await api.upload(dir, f)).path);
        } catch (err) {
          toast(`${f.name}: ${(err as Error).message}`, "error");
        }
      }
      if (paths.length) toast(paths.length > 1 ? `${paths.length} Dateien hochgeladen` : "Hochgeladen");
      resolve(paths);
    });
    input.click();
  });
}

export interface ImageOpts {
  dir: string;
  optional?: boolean;
  hint?: string;
  /** Show on a dark background (white logos). */
  dark?: boolean;
}

export function image(form: Form, path: string, label: string, o: ImageOpts): HTMLElement {
  const value = form.get(path) as string | undefined;
  const preview = value
    ? h("img", { src: thumb(value, 400), alt: "", class: `preview${o.dark ? " preview--dark" : ""}`, loading: "lazy" })
    : h("div", { class: "preview preview--empty" }, "Kein Bild");
  const err = form.errors[path];
  return h(
    "div",
    { class: `field field--image${err ? " field--error" : ""}`, "data-path": path },
    h("span", { class: "label" }, label),
    preview,
    h(
      "div",
      { class: "row" },
      h(
        "button",
        {
          type: "button",
          class: "btn",
          onclick: async () => {
            const [p] = await pickAndUpload(o.dir, IMAGE_ACCEPT);
            if (p) form.set(path, p, true);
          },
        },
        value ? "Bild ersetzen" : "Bild hochladen",
      ),
      h(
        "button",
        {
          type: "button",
          class: "btn btn--ghost",
          onclick: async () => {
            const p = await pickMedia("image", o.dir);
            if (p) form.set(path, p, true);
          },
        },
        "Aus Medien wählen",
      ),
      o.optional && value
        ? h("button", { type: "button", class: "btn btn--ghost", onclick: () => form.set(path, undefined, true) }, "Entfernen")
        : null,
    ),
    o.hint ? h("small", { class: "hint" }, o.hint) : null,
    err ? h("small", { class: "error" }, err) : null,
  );
}

/** Per form + field: which of the two choices is open, and the value of the other one. */
const linkChoices = new WeakMap<Form, Map<string, { mode: "file" | "web"; other?: unknown }>>();

/**
 * A target that is either an uploaded PDF or a web address (e.g. the Gönner letter). Editors see
 * the file's name, never its path. Switching back and forth keeps what was entered.
 */
export function linkOrFile(form: Form, path: string, label: string, dir: string, hint?: string): HTMLElement {
  const value = String(form.get(path) ?? "");
  const choices = linkChoices.get(form) ?? new Map<string, { mode: "file" | "web"; other?: unknown }>();
  linkChoices.set(form, choices);
  const choice = choices.get(path) ?? { mode: "web" as const };
  if (value) choice.mode = value.startsWith("media/") ? "file" : "web";
  choices.set(path, choice);
  const isFile = choice.mode === "file";
  const err = form.errors[path];
  const id = `f-${path.replace(/\./g, "-")}`;

  const radio = (mode: "file" | "web", text_: string) => {
    const input = h("input", { type: "radio", name: id, checked: choice.mode === mode });
    input.addEventListener("change", () => {
      const current = form.get(path);
      const other = choice.other;
      choice.other = current;
      choice.mode = mode;
      form.set(path, other, true);
    });
    return h("label", {}, input, ` ${text_}`);
  };

  const pick = h(
    "button",
    {
      type: "button",
      class: "btn btn--ghost",
      onclick: async () => {
        const p = await pickMedia("pdf", dir);
        if (p) form.set(path, p, true);
      },
    },
    "Aus Medien wählen",
  );
  const upload = h(
    "button",
    {
      type: "button",
      class: "btn",
      onclick: async () => {
        const [p] = await pickAndUpload(dir, "application/pdf");
        if (p) form.set(path, p, true);
      },
    },
    value.startsWith("media/") ? "PDF ersetzen" : "PDF hochladen",
  );

  let control: HTMLElement;
  if (isFile) {
    control = h(
      "div",
      { class: "filechoice" },
      value ? h("strong", {}, value.split("/").at(-1)) : h("span", { class: "muted" }, "Noch keine Datei"),
      h("div", { class: "row" }, value ? h("a", { href: `/${value}`, target: "_blank", rel: "noopener", class: "btn btn--ghost" }, "Ansehen") : null, upload, pick),
    );
  } else {
    // type=text because /geschichte is valid too; still no capital «Https» on phone keyboards.
    const input = h("input", { type: "text", id, placeholder: "https://…", "aria-label": `${label}: Webadresse`, inputmode: "url", autocapitalize: "none", autocorrect: "off", spellcheck: "false" });
    input.value = value;
    if (err) input.setAttribute("aria-invalid", "true");
    input.addEventListener("input", () => form.set(path, input.value.trim() === "" ? undefined : input.value));
    control = input;
  }

  return h(
    "div",
    { class: `field${err ? " field--error" : ""}`, "data-path": path },
    h("span", { class: "label" }, label),
    h("div", { class: "choice", role: "radiogroup", "aria-label": label }, radio("file", "Datei (PDF)"), radio("web", "Webadresse")),
    control,
    !isFile && hint ? h("small", { class: "hint" }, hint) : null,
    err ? h("small", { class: "error" }, err) : null,
  );
}

/** Which list items are expanded, by path; survives re-renders after add/move/upload. */
const openItems = new Map<string, boolean>();

function forgetOpen(path: string): void {
  for (const k of [...openItems.keys()]) if (k.startsWith(`${path}.`)) openItems.delete(k);
}

export interface ListOpts<I> {
  addLabel: string;
  newItem: () => I;
  itemTitle: (item: I, index: number) => string;
  /** New items at the top instead of the bottom (e.g. Anzapfer: newest first). */
  addAtTop?: boolean;
  /** Extra buttons in the list header. */
  extra?: HTMLElement[];
  /** Start collapsed (long lists). */
  collapsed?: boolean;
  /** The website sorts these itself (e.g. Anzapfer by year): no way to move items. */
  fixedOrder?: boolean;
}

export function list<I>(form: Form, path: string, label: string, render: (itemPath: string, item: I, i: number) => HTMLElement[], o: ListOpts<I>): HTMLElement {
  const items = (form.get(path) as I[] | undefined) ?? [];
  const setItems = (next: I[]) => form.set(path, next, true);
  const itemEl = (i: number) => document.querySelector(`.item[data-item="${path}.${i}"]`);
  // The open state moves along with the items.
  const setOpenStates = (states: boolean[]) => {
    forgetOpen(path);
    states.forEach((open, j) => openItems.set(`${path}.${j}`, open));
  };
  const openStates = () => items.map((_, j) => openItems.get(`${path}.${j}`) ?? isOpenByDefault());
  const moveTo = (from: number, to: number) => {
    setOpenStates(moveItem(openStates(), from, to));
    setItems(moveItem(items, from, to));
  };
  const move = (i: number, d: number) => {
    moveTo(i, i + d);
    // Phones: the arrows sit inside the item, keep them under the finger.
    if (isPhone()) itemEl(i + d)?.querySelector(".item__foot")?.scrollIntoView({ block: "nearest" });
  };
  const drop = (from: number, to: number) => {
    moveTo(from, to);
    itemEl(to)?.querySelector("summary")?.scrollIntoView({ block: "nearest" });
  };
  const copy = (item: I, i: number) => {
    const states = openStates();
    states.splice(i + 1, 0, true);
    setOpenStates(states);
    setItems([...items.slice(0, i + 1), clone(item), ...items.slice(i + 1)]);
    const el = itemEl(i + 1);
    el?.scrollIntoView({ block: "nearest" });
    if (!isPhone()) el?.querySelector<HTMLElement>("input, textarea")?.focus();
    toast(`Kopie von «${o.itemTitle(item, i) || "Eintrag"}» eingefügt. Endgültig erst mit «Speichern».`);
  };
  const remove = (item: I, i: number) => {
    forgetOpen(path);
    setItems(items.filter((_, j) => j !== i));
    // Only the working copy so far, so no confirmation: «Rückgängig» or leaving without saving undoes it.
    toast(`«${o.itemTitle(item, i) || "Eintrag"}» entfernt. Endgültig erst mit «Speichern».`, "ok", {
      label: "Rückgängig",
      run: () => {
        const now = (form.get(path) as I[] | undefined) ?? [];
        forgetOpen(path);
        setItems([...now.slice(0, i), item, ...now.slice(i)]);
      },
    });
  };
  // Phones start collapsed: a row of titles is worth more than a few open forms and a long scroll.
  const isOpenByDefault = () => !o.collapsed && !isPhone() && items.length <= 6;
  const arrows = !o.fixedOrder;
  const sortable = arrows && items.length > 1;
  const rows = items.map((item, i) => {
    const err = Object.keys(form.errors).some((k) => k.startsWith(`${path}.${i}.`) || k === `${path}.${i}`);
    const details = h(
      "details",
      { class: `item${err ? " item--error" : ""}`, "data-item": `${path}.${i}`, open: err || (openItems.get(`${path}.${i}`) ?? isOpenByDefault()) },
      h(
        "summary",
        {},
        h("span", { class: "item__title" }, o.itemTitle(item, i) || "(neu)"),
        // Not for keyboards and screen readers: they have the arrows.
        sortable
          ? h(
              "span",
              {
                class: "item__grip",
                title: "Ziehen zum Verschieben",
                "aria-hidden": "true",
                onpointerdown: (e: Event) => startDrag(e as PointerEvent, drop),
                onclick: (e: Event) => e.preventDefault(),
              },
              "⋮⋮",
            )
          : null,
        h(
          "span",
          { class: "item__tools" },
          arrows ? h("button", { type: "button", class: "icon", title: "Nach oben", "aria-label": "Nach oben", disabled: i === 0, onclick: (e: Event) => (e.preventDefault(), move(i, -1)) }, "↑") : null,
          arrows ? h("button", { type: "button", class: "icon", title: "Nach unten", "aria-label": "Nach unten", disabled: i === items.length - 1, onclick: (e: Event) => (e.preventDefault(), move(i, 1)) }, "↓") : null,
          h("button", { type: "button", class: "icon", title: "Kopieren", "aria-label": "Kopieren", onclick: (e: Event) => (e.preventDefault(), copy(item, i)) }, "⧉"),
          h("button", { type: "button", class: "icon icon--danger", title: "Löschen", "aria-label": "Löschen", onclick: (e: Event) => (e.preventDefault(), remove(item, i)) }, "✕"),
        ),
      ),
      h(
        "div",
        { class: "item__body" },
        render(`${path}.${i}`, item, i),
        // Phones: the same actions, here instead of on every row of the list.
        h(
          "div",
          { class: "item__foot" },
          arrows ? h("button", { type: "button", class: "icon", "aria-label": "Nach oben", disabled: i === 0, onclick: () => move(i, -1) }, "↑") : null,
          arrows ? h("button", { type: "button", class: "icon", "aria-label": "Nach unten", disabled: i === items.length - 1, onclick: () => move(i, 1) }, "↓") : null,
          h("button", { type: "button", class: "btn btn--ghost", onclick: () => copy(item, i) }, "Kopieren"),
          h("button", { type: "button", class: "btn btn--danger-ghost", onclick: () => remove(item, i) }, "Löschen"),
        ),
      ),
    );
    details.addEventListener("toggle", () => openItems.set(`${path}.${i}`, details.open));
    return details;
  });
  const add = h(
    "button",
    {
      type: "button",
      class: "btn",
      onclick: () => {
        // Indexes shift: forget open states of this list, open only the new item.
        forgetOpen(path);
        const at = o.addAtTop ? 0 : items.length;
        openItems.set(`${path}.${at}`, true);
        setItems(o.addAtTop ? [o.newItem(), ...items] : [...items, o.newItem()]);
        // In a long list the new item would appear far below the button, out of sight.
        itemEl(at)?.scrollIntoView({ block: "start" });
      },
    },
    `+ ${o.addLabel}`,
  );
  return h(
    "section",
    { class: "list", "data-path": path },
    h("div", { class: "list__head" }, h("h3", {}, `${label} (${items.length})`), h("div", { class: "row" }, o.extra ?? [], add)),
    rows.length ? rows : h("p", { class: "muted" }, "Noch keine Einträge."),
  );
}

// ------------------------------------------------------------------ save bar

export interface SaveBar {
  el: HTMLElement;
  setDirty(d: boolean): void;
}

export function saveBar(onSave: () => Promise<void>): SaveBar {
  const status = h("span", { class: "savebar__status" }, "Alles gespeichert");
  const LABEL = "Speichern & veröffentlichen";
  const button = h("button", { type: "button", class: "btn btn--primary", disabled: true }, LABEL);
  const el = h("div", { class: "savebar" }, status, h("div", { class: "row" }, button));
  let busy = false;
  button.addEventListener("click", async () => {
    if (busy) return;
    busy = true;
    button.disabled = true;
    status.textContent = button.textContent = "Speichere …";
    try {
      await onSave();
    } finally {
      busy = false;
    }
  });
  return {
    el,
    setDirty(d: boolean) {
      button.disabled = !d;
      button.textContent = LABEL;
      status.textContent = d ? "Ungespeicherte Änderungen" : "Alles gespeichert";
      el.classList.toggle("savebar--dirty", d);
    },
  };
}

/** Turns an API error into a message; 422 errors are put on the form fields. */
export function handleSaveError(err: unknown, form?: Form): void {
  if (err instanceof ApiError) {
    if (err.status === 422 && form && err.details) {
      form.errors = err.details;
      form.onStructure();
      const marked = document.querySelector(".field--error, .item--error");
      marked?.scrollIntoView({ behavior: "smooth", block: "center" });
      // The field is on another screen of the same content file: say where.
      if (!marked && form.where) {
        const areas = [...new Set(Object.keys(err.details).map(form.where))].join(", ");
        toast(`Speichern geht erst, wenn im Bereich ${areas} alles korrekt ausgefüllt ist.`, "error");
        return;
      }
    }
    toast(err.message, "error");
    return;
  }
  toast("Unerwarteter Fehler. Bitte nochmals versuchen.", "error");
  console.error(err);
}
