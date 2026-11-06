import { api, thumb, type MediaFile } from "./api.ts";
import { h } from "./dom.ts";

/** Grid of uploaded files with a search field. Used by the screen «Medien» and the picker in form fields. */

const FOLDERS: Record<string, string> = { bilder: "Bilder", logos: "Logos", team: "Team", news: "News", anzapfer: "Anzapfer", dokumente: "Dokumente" };

export const folderLabel = (f: string) => FOLDERS[f] ?? f;

export function mediaPreview(f: MediaFile): HTMLElement {
  return f.kind === "image"
    ? h("img", { class: "media__thumb", src: thumb(f.path, 320), alt: "", loading: "lazy" })
    : h("span", { class: "media__thumb media__thumb--file" }, f.kind === "pdf" ? "PDF" : "Datei");
}

/** Files grouped by folder, `card` builds each entry. */
export function mediaGroups(files: MediaFile[], card: (f: MediaFile) => HTMLElement, first?: string): HTMLElement[] {
  const folders = [...new Set(files.map((f) => f.folder))].sort((a, b) => Number(b === first) - Number(a === first) || folderLabel(a).localeCompare(folderLabel(b)));
  return folders.map((folder) => {
    const inFolder = files.filter((f) => f.folder === folder);
    return h("section", { class: "media__group" }, h("h2", {}, `${folderLabel(folder)} (${inFolder.length})`), h("ul", { class: "media" }, inFolder.map(card)));
  });
}

export const matches = (f: MediaFile, query: string) => f.name.toLowerCase().includes(query.trim().toLowerCase());

/** Lets the editor choose an existing file instead of uploading it again. Null: cancelled. */
export function pickMedia(kind: "image" | "pdf", prefer?: string): Promise<string | null> {
  return new Promise((resolve) => {
    const body = h("div", { class: "picker__body" }, h("p", { class: "muted" }, "Lade …"));
    const search = h("input", { type: "search", placeholder: "Dateiname suchen", "aria-label": "Dateiname suchen" });
    const dialog = h(
      "dialog",
      { class: "picker" },
      h("div", { class: "picker__head" }, h("h2", {}, kind === "pdf" ? "PDF auswählen" : "Bild auswählen"), search, h("button", { type: "button", class: "btn btn--ghost", onclick: () => close(null) }, "Abbrechen")),
      body,
    );
    const close = (v: string | null) => {
      dialog.close();
      dialog.remove();
      resolve(v);
    };
    dialog.addEventListener("cancel", (e) => {
      e.preventDefault();
      close(null);
    });
    let files: MediaFile[] = [];
    const render = () => {
      const shown = files.filter((f) => matches(f, search.value));
      body.replaceChildren(
        ...(shown.length
          ? mediaGroups(shown, (f) => h("li", {}, h("button", { type: "button", class: "media__pick", onclick: () => close(f.path) }, mediaPreview(f), h("span", { class: "media__name" }, f.name))), prefer)
          : [h("p", { class: "muted" }, "Keine passende Datei.")]),
      );
    };
    search.addEventListener("input", render);
    document.body.append(dialog);
    dialog.showModal();
    // Not the search field: on phones that would open the keyboard over the pictures.
    dialog.tabIndex = -1;
    dialog.focus();
    api
      .media()
      .then((all) => {
        files = all.filter((f) => f.kind === kind);
        render();
      })
      .catch((err: Error) => body.replaceChildren(h("p", { class: "error" }, err.message)));
  });
}
