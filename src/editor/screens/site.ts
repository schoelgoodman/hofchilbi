import { h } from "../dom.ts";
import { image, linkOrFile, text, type Form } from "../form.ts";
import { siteArea } from "../../content/site-areas.ts";
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

export { siteArea };

const siteScreen = (ctx: Ctx, title: string, intro: string, build: (f: Form) => (HTMLElement | null)[]) =>
  docScreen(ctx, "site", title, intro, build, siteArea);

export function allgemeinScreen(ctx: Ctx): HTMLElement {
  return siteScreen(ctx, "Allgemein", "Was für die ganze Website gilt. Das Datum erscheint gross auf der Startseite und bei Google.", (f) => [
    group(
      "Das Fest",
      days(f),
      text(f, "event.label", "Datum anders schreiben (optional)", { hint: "Nur ausfüllen, wenn der Text oben nicht passt, z. B. «Juli 2028 – Datum folgt». Sonst leer lassen." }),
      text(f, "event.location", "Festort", { placeholder: "Hof zu Wil" }),
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
      image(f, "seo.image", "Vorschaubild beim Teilen (optional)", { dir: "bilder", optional: true, hint: "Für die Startseite, leer: das Startbild. Die anderen Seiten zeigen ihr eigenes Titelbild." }),
    ),
    group(
      "Redaktion",
      text(f, "editor.feedbackEmail", "E-Mail für Feedback", { type: "email", hint: "Der Link «Feedback» im Menü öffnet eine E-Mail an diese Adresse. Leer: kein Link. Erscheint nicht auf der Website." }),
    ),
  ]);
}

export function startScreen(ctx: Ctx): HTMLElement {
  return siteScreen(ctx, "Start", "Das Startbild, die beiden Buttons und das Helfer-Band. News und Sponsoren haben eigene Bereiche, die Anzapfer stehen unter Geschichte.", (f) => [
    group(
      "Startbild",
      image(f, "hero.image", "Grosses Startbild", { dir: "bilder", hint: "Querformat, mindestens 2000 Pixel breit. Wird abgedunkelt, damit die weisse Schrift lesbar bleibt." }),
    ),
    group(
      "Buttons «Gönner werden» und «Helfer werden»",
      h("p", { class: "group__note" }, "Hier einmal festlegen, wohin sie führen. Das gilt auf der ganzen Website: Kopfzeile, Menü, Startbild, Helfer-Band, Kontakt und alle News, die einen dieser Buttons verwenden."),
      linkOrFile(f, "links.goenner", "«Gönner werden» führt zu", "dokumente"),
      linkOrFile(f, "links.helfer", "«Helfer werden» führt zu", "dokumente", "z. B. der Link zum Anmeldeformular (Microsoft Forms)."),
    ),
    group(
      "Helfer-Band",
      text(f, "helperCta.title", "Titel im Helfer-Band"),
      image(f, "helperCta.image", "Bild im Helfer-Band", { dir: "bilder" }),
    ),
  ]);
}

/** Pages whose only own content is the title image; the rest lives in their subcategories. */
export const titleImageField = (f: Form, key: string): HTMLElement =>
  group("Titelbild", image(f, `pageImages.${key}`, "Bild oben auf der Seite", { dir: "bilder", hint: "Querformat. Wird abgedunkelt, darüber steht der Seitentitel." }));

export function impressionenScreen(ctx: Ctx): HTMLElement {
  return siteScreen(ctx, "Impressionen", "Das Titelbild der Seite. Die Fotos stehen unter Galerien.", (f) => [titleImageField(f, "impressionen")]);
}

export function kontaktScreen(ctx: Ctx): HTMLElement {
  return siteScreen(ctx, "Kontakt", "Das Titelbild der Seite. Das OK steht unter Team, die E-Mail-Adresse unter Allgemein.", (f) => [titleImageField(f, "kontakt")]);
}
