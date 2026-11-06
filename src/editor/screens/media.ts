import { api, type MediaFile } from "../api.ts";
import { confirmDialog, h, toast } from "../dom.ts";
import { handleSaveError } from "../form.ts";
import { matches, mediaGroups, mediaPreview } from "../mediaBrowser.ts";
import type { Ctx } from "./doc.ts";

type Filter = "alle" | "bilder" | "pdf" | "frei";
const FILTERS: [Filter, string][] = [["alle", "Alle"], ["bilder", "Bilder"], ["pdf", "PDFs"], ["frei", "Nicht verwendet"]];

function size(bytes: number): string {
  return bytes < 1024 * 1024 ? `${Math.max(1, Math.round(bytes / 1024))} KB` : `${(bytes / 1024 / 1024).toFixed(1).replace(".0", "")} MB`;
}

export function mediaScreen(_ctx: Ctx): HTMLElement {
  let files: MediaFile[] = [];
  let filter: Filter = "alle";
  const body = h("div", {}, h("p", { class: "muted" }, "Lade …"));
  const search = h("input", { type: "search", placeholder: "Dateiname suchen", "aria-label": "Dateiname suchen" });
  const chips = h("div", { class: "chips", role: "group", "aria-label": "Filter" });

  const load = async () => {
    files = await api.media();
    render();
  };

  const remove = async (f: MediaFile) => {
    if (!(await confirmDialog(`«${f.name}» löschen? Sie lässt sich im Verlauf zurückholen.`))) return;
    try {
      const { hash } = await api.deleteMedia(f.path);
      await load();
      toast("Gelöscht.", "ok", {
        label: "Rückgängig",
        run: () => {
          api.restoreFile(hash, f.path).then(load).catch(handleSaveError);
        },
      });
    } catch (err) {
      handleSaveError(err);
      await load().catch(() => undefined);
    }
  };

  const card = (f: MediaFile) =>
    h(
      "li",
      { class: "media__card" },
      h("a", { href: `/${f.path}`, target: "_blank", rel: "noopener", "aria-label": `${f.name} ansehen` }, mediaPreview(f)),
      h("span", { class: "media__name" }, f.name),
      h("small", { class: "muted" }, size(f.size)),
      f.used.length
        ? h("small", { class: "media__used" }, "Verwendet in: ", f.used.flatMap((u, i) => [i ? ", " : "", h("a", { href: `#/${u.route}` }, u.label)]))
        : h("div", { class: "media__free" }, h("small", { class: "muted" }, "Nicht verwendet"), h("button", { type: "button", class: "btn btn--danger-ghost btn--sm", onclick: () => remove(f) }, "Löschen")),
    );

  const render = () => {
    chips.replaceChildren(
      ...FILTERS.map(([key, label]) =>
        h(
          "button",
          {
            type: "button",
            class: `btn btn--sm${filter === key ? " btn--primary" : " btn--ghost"}`,
            "aria-pressed": String(filter === key),
            onclick: () => {
              filter = key;
              render();
            },
          },
          label,
        ),
      ),
    );
    const shown = files.filter(
      (f) => matches(f, search.value) && (filter === "alle" || (filter === "bilder" && f.kind === "image") || (filter === "pdf" && f.kind === "pdf") || (filter === "frei" && !f.used.length)),
    );
    body.replaceChildren(...(shown.length ? mediaGroups(shown, card) : [h("p", { class: "muted" }, "Keine passende Datei.")]));
  };

  search.addEventListener("input", render);
  load().catch(handleSaveError);

  return h(
    "div",
    { class: "screen" },
    h("h1", {}, "Medien"),
    h(
      "p",
      { class: "intro" },
      "Alle hochgeladenen Bilder und PDFs und wo sie verwendet werden. Hochladen geht direkt beim jeweiligen Feld, dort lässt sich auch eine Datei von hier auswählen. Löschen geht nur, wenn eine Datei nirgends verwendet wird.",
    ),
    h("div", { class: "media__tools" }, chips, search),
    body,
  );
}
