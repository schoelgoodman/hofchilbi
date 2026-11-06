import { checkbox, image, list, text } from "../form.ts";
import { docScreen, group, type Ctx } from "./doc.ts";

export function anzapferScreen(ctx: Ctx): HTMLElement {
  return docScreen(
    ctx,
    "anzapfer",
    "Anzapfer",
    "Der neueste Eintrag mit Name erscheint mit Foto auf der Startseite und oben auf der Seite Geschichte. Fotos älterer Anzapfer erscheinen klein in der Liste. Für Jahre ohne Hofchilbi statt eines Namens einen Hinweis eintragen. Die Website sortiert die Liste selbst nach Jahr.",
    (f) => [
      list<{ year: number; name?: string; note?: string; photo?: string }>(
        f,
        "list",
        "Anzapfer",
        (p) => [
          text(f, `${p}.year`, "Jahr", { type: "number" }),
          text(f, `${p}.name`, "Name(n)"),
          text(f, `${p}.note`, "Hinweis statt Name (optional)", { placeholder: "z. B. Keine Hofchilbi (Corona)", hint: "Nur für Jahre ohne Anzapfer." }),
          image(f, `${p}.photo`, "Foto (optional)", { dir: "anzapfer", optional: true }),
        ],
        {
          addLabel: "Anzapfer",
          addAtTop: true,
          newItem: () => ({ year: Number(f.get("list.0.year") ?? new Date().getFullYear() - 1) + 1, name: "" }),
          itemTitle: (a) => `${a.year ?? "?"} – ${a.name || a.note || ""}`,
          collapsed: true,
          fixedOrder: true,
        },
      ),
    ],
  );
}

export function timelineScreen(ctx: Ctx): HTMLElement {
  return docScreen(
    ctx,
    "timeline",
    "Zeitstrahl",
    "Meilensteine auf der Seite Geschichte, unter dem Text. Reihenfolge wie hier (zum Sortieren am Griff ⋮⋮ ziehen). «Hervorheben» zeigt einen Eintrag als grosse Kennzahl, z. B. den Bierzins.",
    (f) => [
      list<{ year: string; text: string; highlight?: boolean }>(
        f,
        "entries",
        "Einträge",
        (p) => [
          text(f, `${p}.year`, "Jahr", { placeholder: "z. B. 1540 oder Heute" }),
          text(f, `${p}.text`, "Text", { multiline: true }),
          checkbox(f, `${p}.highlight`, "Hervorheben (grosse Kennzahl)"),
        ],
        {
          addLabel: "Eintrag",
          newItem: () => ({ year: "", text: "", highlight: false }),
          itemTitle: (e) => `${e.year || "?"} – ${(e.text ?? "").slice(0, 50)}`,
        },
      ),
    ],
  );
}

export function teamScreen(ctx: Ctx): HTMLElement {
  return docScreen(ctx, "team", "Team", "Das OK auf der Seite Kontakt.", (f) => [
    group("Gruppenfoto", image(f, "groupPhoto", "Gruppenfoto", { dir: "team", optional: true })),
    list<{ name: string; role: string; photo?: string }>(
      f,
      "members",
      "Mitglieder",
      (p) => [
        text(f, `${p}.name`, "Name"),
        text(f, `${p}.role`, "Aufgabe", { placeholder: "z. B. Finanzen" }),
        image(f, `${p}.photo`, "Porträt", { dir: "team", optional: true, hint: "Wird hochformatig (4:5) zugeschnitten. Ohne Foto erscheinen die Initialen." }),
      ],
      { addLabel: "Mitglied", newItem: () => ({ name: "", role: "" }), itemTitle: (m) => [m.name, m.role].filter(Boolean).join(" – "), collapsed: true },
    ),
  ]);
}
