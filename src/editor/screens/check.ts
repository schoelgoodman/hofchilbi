import { h } from "../dom.ts";
import type { Ctx } from "./doc.ts";

export function checkScreen(ctx: Ctx): HTMLElement {
  const findings = ctx.state.checks;
  return h(
    "div",
    { class: "screen" },
    h("h1", {}, "Website-Check"),
    h("p", { class: "intro" }, "Was gerade Aufmerksamkeit braucht, zum Beispiel nach dem Fest. Erledigtes verschwindet von selbst."),
    findings.length
      ? h(
          "ul",
          { class: "checks" },
          findings.map((f) =>
            h(
              "li",
              {},
              h("div", {}, h("strong", {}, f.title), h("p", {}, f.detail)),
              h("a", { class: "btn", href: `#/${f.route}` }, f.action),
            ),
          ),
        )
      : h("p", { class: "checks__ok" }, "Alles in Ordnung, gerade gibt es nichts zu tun."),
  );
}
