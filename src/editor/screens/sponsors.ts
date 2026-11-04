import { h } from "../dom.ts";
import { image, list, text, type Form } from "../form.ts";
import { docScreen, group, type Ctx } from "./doc.ts";

interface Sponsor {
  name: string;
  logo?: string;
  url?: string;
}

function tier(f: Form, path: string, label: string, add: string): HTMLElement {
  return list<Sponsor>(
    f,
    path,
    label,
    (p) => [
      text(f, `${p}.name`, "Name"),
      image(f, `${p}.logo`, "Logo", { dir: "logos", hint: "PNG mit transparentem Hintergrund oder SVG ist ideal. Weisse Logos sind auf der weissen Seite unsichtbar." }),
      text(f, `${p}.url`, "Webseite (optional)", { type: "url", placeholder: "https://…" }),
    ],
    { addLabel: add, newItem: () => ({ name: "" }), itemTitle: (s) => s.name, collapsed: true },
  );
}

export function sponsorsScreen(ctx: Ctx): HTMLElement {
  return docScreen(ctx, "sponsors", "Sponsoren & Gönner", "Logos und Namen auf der Startseite. Die Reihenfolge hier ist die Reihenfolge auf der Website.", (f) => [
    group(
      "Presenting-Partner",
      f.get("presenting")
        ? h(
            "div",
            {},
            text(f, "presenting.name", "Name"),
            image(f, "presenting.logo", "Logo (farbig, für die Sponsorenliste)", { dir: "logos" }),
            image(f, "presenting.logoWhite", "Logo weiss (oben auf dem Startbild)", { dir: "logos", optional: true, dark: true }),
            text(f, "presenting.url", "Webseite", { type: "url" }),
            h("button", { type: "button", class: "btn btn--ghost", onclick: () => f.set("presenting", undefined, true) }, "Presenting-Partner entfernen"),
          )
        : h("button", { type: "button", class: "btn", onclick: () => f.set("presenting", { name: "" }, true) }, "+ Presenting-Partner"),
    ),
    tier(f, "main", "Hauptsponsoren", "Hauptsponsor"),
    tier(f, "sponsors", "Sponsoren", "Sponsor"),
    tier(f, "media", "Medienpartner", "Medienpartner"),
    list<string>(f, "goenner", "Gönner", (p) => [text(f, p, "Name, Ort", { placeholder: "Vorname Name, Ort" })], {
      addLabel: "Gönner",
      newItem: () => "",
      itemTitle: (g) => g,
      collapsed: true,
    }),
  ]);
}
