import { image, list, text } from "../form.ts";
import { docScreen, group, type Ctx } from "./doc.ts";

export function anzapferScreen(ctx: Ctx): HTMLElement {
  return docScreen(
    ctx,
    "anzapfer",
    "Anzapfer",
    "Der oberste Eintrag (neuestes Jahr) erscheint mit Foto auf der Startseite. Alle stehen auf der Seite Geschichte.",
    (f) => [
      list<{ year: number; name: string; photo?: string }>(
        f,
        "list",
        "Anzapfer",
        (p, _item, i) => [
          text(f, `${p}.year`, "Jahr", { type: "number" }),
          text(f, `${p}.name`, "Name(n)"),
          i === 0 ? image(f, `${p}.photo`, "Foto (für die Startseite)", { dir: "anzapfer", optional: true }) : null,
        ].filter((x): x is HTMLElement => x !== null),
        {
          addLabel: "Anzapfer",
          addAtTop: true,
          newItem: () => ({ year: Number(f.get("list.0.year") ?? new Date().getFullYear() - 1) + 1, name: "" }),
          itemTitle: (a) => `${a.year ?? "?"} – ${a.name ?? ""}`,
          collapsed: true,
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
        image(f, `${p}.photo`, "Porträt", { dir: "team", optional: true, hint: "Wird rund zugeschnitten. Ohne Foto erscheint das KTV-Logo." }),
      ],
      { addLabel: "Mitglied", newItem: () => ({ name: "", role: "" }), itemTitle: (m) => [m.name, m.role].filter(Boolean).join(" – "), collapsed: true },
    ),
  ]);
}
