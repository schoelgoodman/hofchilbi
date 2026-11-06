import { api, type HistoryPage } from "../api.ts";
import { announceSaved, confirmDialog, h, toast } from "../dom.ts";
import { handleSaveError } from "../form.ts";
import type { Ctx } from "./doc.ts";

const when = (iso: string) => new Date(iso).toLocaleString("de-CH", { dateStyle: "medium", timeStyle: "short" });

async function restored(ctx: Ctx, message: string): Promise<void> {
  toast(message);
  announceSaved();
  await ctx.reload();
}

/** Brings back one content file; the rest of the website stays as it is. */
async function restoreOne(ctx: Ctx, hash: string, file: string, question: string): Promise<void> {
  if (!(await confirmDialog(question, "Zurückholen", false))) return;
  try {
    await api.restoreFile(hash, file);
    await restored(ctx, "Zurückgeholt. Die Website ist in wenigen Sekunden aktualisiert.");
  } catch (err) {
    handleSaveError(err);
  }
}

function deletedBlock(ctx: Ctx, heading: string, what: string, deleted: HistoryPage["deleted"]): HTMLElement | null {
  if (!deleted.length) return null;
  return h(
    "section",
    { class: "history-block" },
    h("h2", {}, heading),
    h(
      "ul",
      { class: "history" },
      deleted.map((d) =>
        h(
          "li",
          {},
          h("div", {}, h("strong", {}, d.title), h("small", {}, `Gelöscht am ${when(d.date)}`)),
          h(
            "div",
            { class: "history__tools" },
            h("button", { type: "button", class: "btn", onclick: () => restoreOne(ctx, d.hash, d.file, `${what} «${d.title}» zurückholen?`) }, "Zurückholen"),
          ),
        ),
      ),
    ),
  );
}

function entryRow(ctx: Ctx, e: HistoryPage["entries"][number], current: boolean): HTMLElement {
  const area = e.area;
  const name = area?.file.startsWith("news/") ? "diese News" : `«${area?.label}»`;
  return h(
    "li",
    {},
    h("div", {}, h("strong", {}, e.message), h("small", {}, when(e.date))),
    current
      ? h("span", { class: "muted" }, "aktueller Stand")
      : h(
          "div",
          { class: "history__tools" },
          area
            ? h(
                "button",
                {
                  type: "button",
                  class: "btn",
                  onclick: () =>
                    restoreOne(ctx, e.hash, area.file, `Nur ${name} auf den Stand vom ${when(e.date)} zurückholen? Der Rest der Website bleibt, wie er ist.`),
                },
                `Nur ${name} zurückholen`,
              )
            : null,
          h(
            "button",
            {
              type: "button",
              class: "btn btn--ghost",
              onclick: async () => {
                if (!(await confirmDialog("Die ganze Website auf diesen Stand zurücksetzen? Alles danach bleibt im Verlauf und lässt sich wieder zurückholen.", "Ganze Website zurückholen"))) return;
                try {
                  await api.restore(e.hash);
                  await restored(ctx, "Zurückgeholt. Die Website ist in wenigen Sekunden aktualisiert.");
                } catch (err) {
                  handleSaveError(err);
                }
              },
            },
            "Ganze Website zurückholen",
          ),
        ),
  );
}

export function historyScreen(ctx: Ctx): HTMLElement {
  const listEl = h("ol", { class: "history" }, h("li", { class: "muted" }, "Lade …"));
  const deletedEl = h("div", {});
  const moreEl = h("div", { class: "history__more" });
  let shown = 0;
  // Pure uploads are not listed, so the server's skip counts listed entries as well.
  const load = async () => {
    const page = await api.history(shown);
    if (shown === 0) {
      listEl.replaceChildren();
      deletedEl.replaceChildren(
        deletedBlock(ctx, "Gelöschte News", "News", page.deleted) ?? "",
        deletedBlock(ctx, "Gelöschte Dateien", "Datei", page.deletedFiles) ?? "",
      );
    }
    listEl.append(...page.entries.map((e, i) => entryRow(ctx, e, shown === 0 && i === 0)));
    shown += page.entries.length;
    moreEl.replaceChildren(page.more ? h("button", { type: "button", class: "btn", onclick: () => load().catch(handleSaveError) }, "Ältere anzeigen") : "");
  };
  load().catch((err) => handleSaveError(err));
  return h(
    "div",
    { class: "screen" },
    h("h1", {}, "Verlauf"),
    h("p", { class: "intro" }, "Jede Speicherung bleibt hier drei Monate. Ältere werden automatisch gelöscht, die letzten paar bleiben aber immer. Ein einzelner Bereich oder die ganze Website lässt sich zurückholen."),
    deletedEl,
    h("section", { class: "history-block" }, h("h2", {}, "Speicherungen"), listEl, moreEl),
  );
}
