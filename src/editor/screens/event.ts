import { h } from "../dom.ts";
import { image, linkOrFile, text, type Form } from "../form.ts";
import { docScreen, group, type Ctx } from "./doc.ts";

const MONTHS = ["Januar", "Februar", "März", "April", "Mai", "Juni", "Juli", "August", "September", "Oktober", "November", "Dezember"];

/** Same rule as the site (content/load.ts), for the live preview of the date line. */
function label(days: string[]): string {
  const ds = days.filter((d) => /^\d{4}-\d{2}-\d{2}$/.test(d)).sort().map((d) => d.split("-").map(Number) as [number, number, number]);
  if (!ds.length) return "–";
  const last = ds.at(-1)!;
  if (ds.length === 1) return `${last[2]}. ${MONTHS[last[1] - 1]} ${last[0]}`;
  const same = ds.every((d) => d[1] === last[1] && d[0] === last[0]);
  const parts = ds.map((d, i) => (same && i < ds.length - 1 ? `${d[2]}.` : `${d[2]}. ${MONTHS[d[1] - 1]}`));
  return `${parts.slice(0, -1).join(", ")} & ${parts.at(-1)} ${last[0]}`;
}

function days(form: Form): HTMLElement {
  const list = (form.get("event.days") as string[] | undefined) ?? [];
  const preview = h("strong", {}, form.get("event.label") || label(list));
  const err = Object.entries(form.errors).find(([k]) => k.startsWith("event.days"))?.[1];
  const rows = list.map((d, i) => {
    const input = h("input", { type: "date", value: d, "aria-label": `Festtag ${i + 1}` });
    input.addEventListener("change", () => {
      const next = [...list];
      next[i] = input.value;
      form.set("event.days", next, true);
    });
    return h(
      "div",
      { class: "row" },
      input,
      list.length > 1
        ? h("button", { type: "button", class: "btn btn--ghost", onclick: () => form.set("event.days", list.filter((_, j) => j !== i), true) }, "Entfernen")
        : null,
    );
  });
  return h(
    "div",
    { class: `field${err ? " field--error" : ""}` },
    h("span", { class: "label" }, "Festtage"),
    rows,
    h(
      "button",
      {
        type: "button",
        class: "btn",
        onclick: () => {
          const lastDay = list.at(-1);
          const next = lastDay ? new Date(Date.parse(lastDay) + 864e5).toISOString().slice(0, 10) : "";
          form.set("event.days", [...list, next], true);
        },
      },
      "+ Tag",
    ),
    h("small", { class: "hint" }, "Auf der Website steht: ", preview),
    err ? h("small", { class: "error" }, err) : null,
  );
}

export function eventScreen(ctx: Ctx): HTMLElement {
  return docScreen(ctx, "site", "Event & Allgemein", "Datum, Startbild, Links und Kontakt. Das Datum erscheint gross auf der Startseite und bei Google.", (f) => [
    group(
      "Das Fest",
      days(f),
      text(f, "event.label", "Datum anders schreiben (optional)", { hint: "Nur ausfüllen, wenn der Text oben nicht passt, z. B. «Juli 2028 – Datum folgt». Sonst leer lassen." }),
      text(f, "event.location", "Festort", { placeholder: "Hof zu Wil" }),
    ),
    group(
      "Startseite",
      image(f, "hero.image", "Grosses Startbild", { dir: "bilder", hint: "Querformat, mindestens 2000 Pixel breit. Wird abgedunkelt, damit die weisse Schrift lesbar bleibt." }),
      linkOrFile(f, "links.goenner", "«Gönner werden» führt zu", "dokumente"),
      text(f, "links.helfer", "«Helfer werden» führt zu", { type: "url", hint: "Link zum Anmeldeformular (z. B. Microsoft Forms)." }),
      text(f, "helperCta.title", "Titel im Helfer-Band"),
      image(f, "helperCta.image", "Bild im Helfer-Band", { dir: "bilder" }),
    ),
    group(
      "Titelbilder der Unterseiten",
      image(f, "pageImages.geschichte", "Geschichte", { dir: "bilder" }),
      image(f, "pageImages.impressionen", "Impressionen", { dir: "bilder" }),
      image(f, "pageImages.kontakt", "Kontakt", { dir: "bilder" }),
    ),
    group(
      "Kontakt & Links",
      text(f, "contact.email", "E-Mail-Adresse", { type: "email" }),
      text(f, "contact.datenschutz", "Link zur Datenschutzerklärung", { type: "url" }),
      text(f, "contact.ktv", "Link zum KTV Wil", { type: "url" }),
      text(f, "social.instagram", "Instagram", { type: "url" }),
      text(f, "social.facebook", "Facebook", { type: "url" }),
    ),
    group(
      "Google & Teilen",
      text(f, "seo.description", "Kurzbeschreibung", { multiline: true, hint: "So erscheint die Seite bei Google. 120–160 Zeichen." }),
      image(f, "seo.image", "Vorschaubild beim Teilen (optional)", { dir: "bilder", optional: true, hint: "Leer: das Startbild wird verwendet." }),
    ),
  ]);
}
