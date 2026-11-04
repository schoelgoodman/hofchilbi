import { api, type State } from "../api.ts";
import { h, toast } from "../dom.ts";
import { Form, handleSaveError, saveBar } from "../form.ts";

export interface Ctx {
  state: State;
  /** Reloads state from the server and re-renders the current screen. */
  reload(): Promise<void>;
  /** Registers whether the screen has unsaved changes (navigation guard). */
  guard(isDirty: () => boolean): void;
}

type DocName = keyof State["docs"];

/**
 * Screen for one YAML document: intro, form built by `build`, save bar. The form re-renders
 * itself on structural changes (add/remove/move, uploads) and keeps typing focus otherwise.
 */
export function docScreen(ctx: Ctx, name: DocName, title: string, intro: string, build: (form: Form) => (HTMLElement | null)[]): HTMLElement {
  const doc = ctx.state.docs[name];
  const form = new Form(doc.data ?? {});
  let base = doc.version;
  const body = h("div", { class: "form" });
  const bar = saveBar(async () => {
    try {
      const r = await api.putDoc(name, form.draft, base);
      base = r.version;
      ctx.state.docs[name] = { data: structuredClone(form.draft), version: base };
      form.markSaved();
      render();
      toast("Gespeichert. Die Website ist in wenigen Sekunden aktualisiert.");
    } catch (err) {
      bar.setDirty(true);
      handleSaveError(err, form);
    }
  });
  const render = () => {
    const y = window.scrollY;
    body.replaceChildren(...build(form).filter((x): x is HTMLElement => x !== null));
    window.scrollTo(0, y);
  };
  form.onStructure = render;
  form.onDirty = (d) => bar.setDirty(d);
  ctx.guard(() => form.dirty());
  render();
  return h("div", { class: "screen" }, h("h1", {}, title), h("p", { class: "intro" }, intro), body, bar.el);
}

export function group(title: string, ...children: (HTMLElement | null)[]): HTMLElement {
  return h("fieldset", { class: "group" }, h("legend", {}, title), children);
}
