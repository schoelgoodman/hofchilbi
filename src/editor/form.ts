import { ApiError, api, thumb } from "./api.ts";
import { clone, h, toast } from "./dom.ts";

/**
 * A working copy of one content file. Fields are bound to a path ("links.helfer",
 * "sponsors.3.url"); typing updates the copy, «Speichern» sends it with the version it was
 * loaded at. Validation errors from the server come back per path and are shown at the field.
 */
type Path = (string | number)[];

export function parsePath(p: string): Path {
  return p.split(".").map((s) => (/^\d+$/.test(s) ? Number(s) : s));
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
    this.original = JSON.stringify(data);
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
    return JSON.stringify(this.draft) !== this.original;
  }

  markSaved(): void {
    this.original = JSON.stringify(this.draft);
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
    const input = h("input", { type: "file", accept, multiple });
    input.addEventListener("change", async () => {
      const files = [...(input.files ?? [])];
      const paths: string[] = [];
      for (const [i, f] of files.entries()) {
        toast(files.length > 1 ? `Lade hoch: ${i + 1} von ${files.length} …` : "Lade hoch …");
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
      o.optional && value
        ? h("button", { type: "button", class: "btn btn--ghost", onclick: () => form.set(path, undefined, true) }, "Entfernen")
        : null,
    ),
    o.hint ? h("small", { class: "hint" }, o.hint) : null,
    err ? h("small", { class: "error" }, err) : null,
  );
}

/** A link that can also be an uploaded PDF (e.g. the Gönner letter). */
export function linkOrFile(form: Form, path: string, label: string, dir: string, hint?: string): HTMLElement {
  const value = String(form.get(path) ?? "");
  const isFile = value.startsWith("media/");
  const field = text(form, path, label, { type: "text", hint: hint ?? "Webadresse (https://…) oder eine hochgeladene PDF-Datei." });
  field.append(
    h(
      "div",
      { class: "row" },
      isFile ? h("a", { href: `/${value}`, target: "_blank", rel: "noopener", class: "btn btn--ghost" }, "Aktuelle Datei ansehen") : null,
      h(
        "button",
        {
          type: "button",
          class: "btn",
          onclick: async () => {
            const [p] = await pickAndUpload(dir, "application/pdf");
            if (p) form.set(path, p, true);
          },
        },
        "PDF hochladen",
      ),
    ),
  );
  return field;
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
}

export function list<I>(form: Form, path: string, label: string, render: (itemPath: string, item: I, i: number) => HTMLElement[], o: ListOpts<I>): HTMLElement {
  const items = (form.get(path) as I[] | undefined) ?? [];
  const setItems = (next: I[]) => form.set(path, next, true);
  const move = (i: number, d: number) => {
    const next = [...items];
    const [x] = next.splice(i, 1);
    next.splice(i + d, 0, x!);
    setItems(next);
  };
  const rows = items.map((item, i) => {
    const err = Object.keys(form.errors).some((k) => k.startsWith(`${path}.${i}.`) || k === `${path}.${i}`);
    const details = h(
      "details",
      { class: `item${err ? " item--error" : ""}`, open: err || (openItems.get(`${path}.${i}`) ?? (!o.collapsed && items.length <= 6)) },
      h(
        "summary",
        {},
        h("span", { class: "item__title" }, o.itemTitle(item, i) || "(neu)"),
        h(
          "span",
          { class: "item__tools" },
          h("button", { type: "button", class: "icon", title: "Nach oben", "aria-label": "Nach oben", disabled: i === 0, onclick: (e: Event) => (e.preventDefault(), move(i, -1)) }, "↑"),
          h("button", { type: "button", class: "icon", title: "Nach unten", "aria-label": "Nach unten", disabled: i === items.length - 1, onclick: (e: Event) => (e.preventDefault(), move(i, 1)) }, "↓"),
          h(
            "button",
            {
              type: "button",
              class: "icon icon--danger",
              title: "Löschen",
              "aria-label": "Löschen",
              onclick: (e: Event) => {
                e.preventDefault();
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
              },
            },
            "✕",
          ),
        ),
      ),
      h("div", { class: "item__body" }, render(`${path}.${i}`, item, i)),
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
        openItems.set(`${path}.${o.addAtTop ? 0 : items.length}`, true);
        setItems(o.addAtTop ? [o.newItem(), ...items] : [...items, o.newItem()]);
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

export function saveBar(onSave: () => Promise<void>, extra: HTMLElement[] = []): SaveBar {
  const status = h("span", { class: "savebar__status" }, "Alles gespeichert");
  const button = h("button", { type: "button", class: "btn btn--primary", disabled: true }, "Speichern & veröffentlichen");
  const el = h("div", { class: "savebar" }, status, h("div", { class: "row" }, extra, button));
  let busy = false;
  button.addEventListener("click", async () => {
    if (busy) return;
    busy = true;
    button.disabled = true;
    status.textContent = "Speichere …";
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
