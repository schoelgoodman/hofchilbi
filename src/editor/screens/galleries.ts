import { thumb } from "../api.ts";
import { confirmDialog, h, toast } from "../dom.ts";
import { pickAndUpload, text, type Form } from "../form.ts";
import { docScreen, type Ctx } from "./doc.ts";

interface Gallery {
  year: number;
  title?: string;
  images: { src: string; alt?: string }[];
}

const IMAGES = "image/jpeg,image/png,image/webp,image/avif";

function galleryBlock(f: Form, gi: number, g: Gallery, all: Gallery[]): HTMLElement {
  const path = `galleries.${gi}`;
  const setImages = (images: Gallery["images"]) => f.set(`${path}.images`, images, true);
  const grid = h(
    "ul",
    { class: "thumbs" },
    g.images.map((im, i) =>
      h(
        "li",
        {},
        h("img", { src: thumb(im.src, 240), alt: im.alt ?? "", loading: "lazy" }),
        h(
          "div",
          { class: "thumbs__tools" },
          h("button", { type: "button", class: "icon", "aria-label": "Nach vorne", disabled: i === 0, onclick: () => setImages(swap(g.images, i, i - 1)) }, "←"),
          h("button", { type: "button", class: "icon", "aria-label": "Nach hinten", disabled: i === g.images.length - 1, onclick: () => setImages(swap(g.images, i, i + 1)) }, "→"),
          h(
            "button",
            {
              type: "button",
              class: "icon icon--danger",
              "aria-label": "Bild entfernen",
              onclick: async () => {
                if (await confirmDialog("Dieses Bild aus der Galerie entfernen?", "Entfernen")) setImages(g.images.filter((_, j) => j !== i));
              },
            },
            "✕",
          ),
        ),
      ),
    ),
  );
  return h(
    "details",
    { class: "item", open: gi === 0 },
    h(
      "summary",
      {},
      h("span", { class: "item__title" }, `${g.title || g.year} (${g.images.length} Bilder)`),
      h(
        "span",
        { class: "item__tools" },
        h(
          "button",
          {
            type: "button",
            class: "icon icon--danger",
            "aria-label": "Galerie löschen",
            onclick: async (e: Event) => {
              e.preventDefault();
              if (await confirmDialog(`Die ganze Galerie ${g.year} mit ${g.images.length} Bildern entfernen?`, "Galerie entfernen")) {
                f.set("galleries", all.filter((_, j) => j !== gi), true);
              }
            },
          },
          "✕",
        ),
      ),
    ),
    h(
      "div",
      { class: "item__body" },
      h("div", { class: "row row--wrap" }, text(f, `${path}.year`, "Jahr", { type: "number" }), text(f, `${path}.title`, "Titel (optional)", { placeholder: String(g.year) })),
      h(
        "button",
        {
          type: "button",
          class: "btn btn--primary-outline",
          onclick: async () => {
            const year = Number(f.get(`${path}.year`));
            if (!year) return toast("Bitte zuerst das Jahr eintragen.", "error");
            const paths = await pickAndUpload(`galerie/${year}`, IMAGES, true);
            if (paths.length) setImages([...g.images, ...paths.map((src) => ({ src }))]);
          },
        },
        "+ Bilder hinzufügen",
      ),
      h("small", { class: "hint" }, "Mehrere Bilder auf einmal auswählen geht. Danach «Speichern» nicht vergessen."),
      grid,
    ),
  );
}

function swap<T>(arr: T[], a: number, b: number): T[] {
  const next = [...arr];
  [next[a], next[b]] = [next[b]!, next[a]!];
  return next;
}

export function galleriesScreen(ctx: Ctx): HTMLElement {
  return docScreen(ctx, "galleries", "Galerien", "Fotos auf der Seite Impressionen, pro Jahr. Die neueste Galerie steht oben.", (f) => {
    const all = (f.get("galleries") as Gallery[] | undefined) ?? [];
    return [
      h(
        "div",
        { class: "row" },
        h(
          "button",
          {
            type: "button",
            class: "btn",
            onclick: () => {
              const year = Math.max(new Date().getFullYear(), ...all.map((g) => g.year + 1));
              f.set("galleries", [{ year, images: [] }, ...all], true);
            },
          },
          "+ Neue Galerie",
        ),
      ),
      ...all.map((g, i) => galleryBlock(f, i, g, all)),
    ];
  });
}
