import { api, type Changes, type HistoryPage } from "../api.ts";
import { announceSaved, confirmDialog, h, toast } from "../dom.ts";
import { handleSaveError } from "../form.ts";
import type { Ctx } from "./doc.ts";

function changesList(c: Changes, none: string): HTMLElement {
  if (!c.files.length) return h("p", { class: "muted" }, none);
  return h(
    "div",
    { class: "changes" },
    c.files.map((f) =>
      h(
        "section",
        {},
        h("h3", {}, f.area),
        h(
          "ul",
          {},
          f.changes.map((ch) =>
            h(
              "li",
              {},
              h("span", { class: "changes__label" }, ch.kind === "added" ? h("span", { class: "changes__tag" }, "Neu") : ch.kind === "removed" ? h("span", { class: "changes__tag changes__tag--gone" }, "Entfernt") : null, ch.label),
              ch.words
                ? h("p", { class: "changes__text" }, ch.words.map((w) => [w.t === "add" ? h("ins", {}, w.text) : w.t === "del" ? h("del", {}, w.text) : w.text, " "]))
                : ch.before && ch.after
                  ? h("p", { class: "changes__text" }, h("del", {}, ch.before), " → ", h("ins", {}, ch.after))
                  : ch.before || ch.after
                    ? h("p", { class: "changes__text" }, ch.before ? h("del", {}, ch.before) : h("ins", {}, ch.after!))
                    : null,
            ),
          ),
        ),
      ),
    ),
  );
}

/** What bringing back would change, for the question before it. A failed lookup must not block restoring. */
async function restorePreview(hash: string, file?: string): Promise<HTMLElement | undefined> {
  try {
    const list = changesList(await api.changesToNow(hash, file), "Nichts: Das entspricht dem heutigen Stand.");
    return h("div", { class: "changes-preview" }, h("h2", {}, "Das würde sich ändern"), list);
  } catch {
    return undefined;
  }
}

/** Opens on request: most entries are never looked at. */
function changesDetails(hash: string): HTMLElement {
  const body = h("div", {}, h("p", { class: "muted" }, "Lade …"));
  let loaded = false;
  const details = h("details", { class: "history__changes" }, h("summary", {}, "Änderungen ansehen"), body);
  details.addEventListener("toggle", () => {
    if (!details.open || loaded) return;
    loaded = true;
    api
      .changes(hash)
      .then((c) => body.replaceChildren(c.first ? h("p", { class: "muted" }, "Das ist der älteste Stand im Verlauf, es gibt nichts zum Vergleichen.") : changesList(c, "Am Inhalt hat sich nichts geändert.")))
      .catch((err: Error) => {
        loaded = false;
        body.replaceChildren(h("p", { class: "error" }, err.message));
      });
  });
  return details;
}

const when = (iso: string) => new Date(iso).toLocaleString("de-CH", { dateStyle: "medium", timeStyle: "short" });

async function restored(ctx: Ctx, message: string): Promise<void> {
  toast(message);
  announceSaved();
  await ctx.reload();
}

/** Brings back one content file; the rest of the website stays as it is. */
async function restoreOne(ctx: Ctx, hash: string, file: string, question: string, preview = false): Promise<void> {
  if (!(await confirmDialog(question, "Zurückholen", false, preview ? await restorePreview(hash, file) : undefined))) return;
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
    h("div", {}, h("strong", {}, e.message), h("small", {}, when(e.date)), changesDetails(e.hash)),
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
                    restoreOne(ctx, e.hash, area.file, `Nur ${name} auf den Stand vom ${when(e.date)} zurückholen? Der Rest der Website bleibt, wie er ist.`, true),
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
                if (!(await confirmDialog("Die ganze Website auf diesen Stand zurücksetzen? Alles danach bleibt im Verlauf und lässt sich wieder zurückholen.", "Ganze Website zurückholen", true, await restorePreview(e.hash)))) return;
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
    h("p", { class: "intro" }, "Jede Speicherung bleibt hier drei Monate. Ältere werden automatisch gelöscht, die letzten paar bleiben aber immer. Du siehst, was jeweils geändert wurde, und kannst einen einzelnen Bereich oder die ganze Website zurückholen."),
    deletedEl,
    h("section", { class: "history-block" }, h("h2", {}, "Speicherungen"), listEl, moreEl),
  );
}
