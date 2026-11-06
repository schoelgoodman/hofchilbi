import { api, thumb } from "../api.ts";
import { h, toast } from "../dom.ts";
import type { Ctx } from "./doc.ts";

interface Gallery {
  year: number;
  images: { src: string }[];
}

/** The galleries come from the Immich albums «Hofchilbi <year>»: status + manual sync only. */
export function galleriesScreen(ctx: Ctx): HTMLElement {
  const box = h("div", { class: "form" });
  let poll: number | undefined;
  const fmt = (iso?: string) => (iso ? new Date(iso).toLocaleString("de-CH", { dateStyle: "short", timeStyle: "short" }) : "noch nie");
  const render = () => {
    const st = ctx.state.immich;
    const gal = (ctx.state.docs.galleries.data?.galleries ?? []) as Gallery[];
    box.replaceChildren(
      !st.enabled
        ? h("fieldset", { class: "group" }, h("legend", {}, "Abgleich mit Immich"), h("p", {}, "Immich ist hier noch nicht eingerichtet. Sobald der Schlüssel hinterlegt ist, erscheinen die Fotos automatisch."))
        : h(
        "fieldset",
        { class: "group" },
        h("legend", {}, "Abgleich mit Immich"),
        h("p", {}, st.running ? "Abgleich läuft … (bei vielen neuen Bildern einige Minuten)" : `Letzter Abgleich: ${fmt(st.lastRun)}`),
        st.lastError ? h("p", { class: "error" }, st.lastError) : null,
        h(
          "button",
          {
            type: "button",
            class: "btn btn--primary",
            disabled: st.running,
            onclick: async () => {
              try {
                ctx.state.immich = await api.immichSync();
                render();
                watch();
              } catch (err) {
                toast((err as Error).message, "error");
              }
            },
          },
          "Jetzt abgleichen",
        ),
      ),
      h(
        "fieldset",
        { class: "group" },
        h("legend", {}, "Galerien auf der Website"),
        gal.length
          ? h(
              "ul",
              { class: "plainlist" },
              gal.map((g) => h("li", {}, `${g.year}: ${g.images.length} Bilder`)),
            )
          : h("p", { class: "muted" }, "Noch keine Bilder übernommen."),
        gal[0]?.images.length
          ? h(
              "ul",
              { class: "thumbs" },
              gal[0].images.slice(0, 12).map((im) => h("li", {}, h("img", { src: thumb(im.src, 240), alt: "", loading: "lazy" }))),
            )
          : null,
      ),
    );
  };
  // While a sync runs, reload the state every few seconds.
  const watch = () => {
    if (poll) return;
    poll = window.setInterval(async () => {
      if (!document.body.contains(box)) return window.clearInterval(poll);
      ctx.state.immich = (await api.state()).immich;
      if (!ctx.state.immich.running) {
        window.clearInterval(poll);
        poll = undefined;
        await ctx.reload();
        toast(ctx.state.immich.lastError ? "Abgleich mit Fehlern beendet." : "Abgleich fertig. Die Website ist in wenigen Sekunden aktualisiert.");
      }
      render();
    }, 3000);
  };
  render();
  if (ctx.state.immich.running) watch();
  return h(
    "div",
    { class: "screen" },
    h("h1", {}, "Galerien"),
    h(
      "p",
      { class: "intro" },
      `Die Fotos auf der Seite Impressionen kommen aus Immich und werden auch dort sortiert und gelöscht: jedes Album mit dem Namen «Hofchilbi <Jahr>» wird zu einer Galerie, mit allen Bildern. Neue Bilder in Immich erscheinen automatisch${ctx.state.immich.interval ? ` (alle ${ctx.state.immich.interval} Minuten)` : ""} – oder sofort mit «Jetzt abgleichen». Entfernte Bilder verschwinden auch von der Website.`,
    ),
    box,
  );
}
