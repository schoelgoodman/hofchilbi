import "./editor.css";
import { api, type State } from "./api.ts";
import { h, toast } from "./dom.ts";
import type { Ctx } from "./screens/doc.ts";
import { eventScreen } from "./screens/event.ts";
import { galleriesScreen } from "./screens/galleries.ts";
import { anzapferScreen, teamScreen, timelineScreen } from "./screens/people.ts";
import { sponsorsScreen } from "./screens/sponsors.ts";
import { disposeEditor, historyScreen, impressumScreen, newsScreen, pageScreen } from "./screens/texts.ts";

const ROUTES: { hash: string; label: string; render: (ctx: Ctx, arg?: string) => HTMLElement }[] = [
  { hash: "event", label: "Event & Allgemein", render: eventScreen },
  { hash: "news", label: "News", render: newsScreen },
  { hash: "sponsoren", label: "Sponsoren & Gönner", render: sponsorsScreen },
  { hash: "anzapfer", label: "Anzapfer", render: anzapferScreen },
  { hash: "team", label: "Team", render: teamScreen },
  { hash: "galerien", label: "Galerien", render: galleriesScreen },
  { hash: "geschichte", label: "Geschichte", render: (c) => pageScreen(c, "geschichte", "Geschichte", "Der Text auf der Seite Geschichte. Darunter folgen automatisch der Zeitstrahl und die Anzapfer.") },
  { hash: "zeitstrahl", label: "Zeitstrahl", render: timelineScreen },
  { hash: "impressum", label: "Impressum", render: impressumScreen },
  { hash: "verlauf", label: "Verlauf", render: historyScreen },
];

let state: State;
let isDirty: () => boolean = () => false;
let lastHash = location.hash;

const main = h("main", { class: "main", id: "main", tabindex: -1 });
const nav = h("nav", { class: "nav", "aria-label": "Bereiche" });
const siteLink = h("a", { class: "btn btn--ghost", target: "_blank", rel: "noopener" }, "Website ansehen ↗");

function route(): { name: string; arg?: string } {
  const [, name = "event", arg] = location.hash.replace(/^#\/?/, "#/").split("/");
  return { name: name || "event", arg };
}

const ctx: Ctx = {
  get state() {
    return state;
  },
  async reload() {
    state = await api.state();
    isDirty = () => false;
    await render();
  },
  guard(fn) {
    isDirty = fn;
  },
};

async function render(): Promise<void> {
  const { name, arg } = route();
  const r = ROUTES.find((x) => x.hash === name) ?? ROUTES[0]!;
  nav.replaceChildren(
    h("ul", {}, ROUTES.map((x) => h("li", {}, h("a", { href: `#/${x.hash}`, "aria-current": x === r ? "page" : null }, x.label)))),
  );
  await disposeEditor();
  isDirty = () => false;
  main.replaceChildren(buildWarning(), r.render(ctx, arg));
  document.title = `${r.label} · Hofchilbi Redaktion`;
}

/** Shown when the website could not be updated with the last save (old version stays online). */
function buildWarning(): HTMLElement | string {
  const b = state.build;
  if (!b || b.ok) return "";
  return h(
    "div",
    { class: "alert", role: "alert" },
    h("strong", {}, "Die Website konnte nicht aktualisiert werden. "),
    "Online ist noch der vorherige Stand. Meist hilft es, das genannte Bild neu hochzuladen oder den letzten Stand unter «Verlauf» wiederherzustellen.",
    h("pre", {}, b.error ?? ""),
  );
}

/** Checks the build result a few seconds after each save. */
async function refreshBuildStatus(): Promise<void> {
  await new Promise((r) => setTimeout(r, 4000));
  try {
    const fresh = await api.state();
    const changed = JSON.stringify(fresh.build?.ok) !== JSON.stringify(state.build?.ok) || fresh.build?.error !== state.build?.error;
    state.build = fresh.build;
    if (changed) {
      const old = main.querySelector(".alert");
      const next = buildWarning();
      if (old) old.replaceWith(next);
      else if (next) main.prepend(next);
      if (fresh.build && !fresh.build.ok) toast("Gespeichert, aber die Website konnte nicht aktualisiert werden. Details oben.", "error");
    }
  } catch {
    // Offline for a moment: the next save checks again.
  }
}

window.addEventListener("hofchilbi:saved", () => void refreshBuildStatus());

window.addEventListener("hashchange", () => {
  if (isDirty() && !confirm("Es gibt ungespeicherte Änderungen. Trotzdem wechseln? Die Änderungen gehen verloren.")) {
    history.replaceState(null, "", lastHash);
    return;
  }
  lastHash = location.hash;
  render().then(() => main.focus({ preventScroll: true }));
  window.scrollTo(0, 0);
});

window.addEventListener("beforeunload", (e) => {
  if (isDirty()) e.preventDefault();
});

async function start(): Promise<void> {
  const app = document.getElementById("app")!;
  try {
    state = await api.state();
  } catch (err) {
    app.replaceChildren(h("div", { class: "screen" }, h("h1", {}, "Redaktion nicht erreichbar"), h("p", {}, (err as Error).message)));
    return;
  }
  siteLink.setAttribute("href", state.publicUrl);
  app.replaceChildren(
    h(
      "header",
      { class: "top" },
      h("a", { class: "skip", href: "#main" }, "Zum Inhalt"),
      h("strong", { class: "brand" }, "Hofchilbi Redaktion"),
      siteLink,
    ),
    h("div", { class: "layout" }, nav, main),
  );
  if (!location.hash) history.replaceState(null, "", "#/event");
  lastHash = location.hash;
  await render();
}

start().catch((err) => {
  console.error(err);
  toast("Die Redaktion konnte nicht starten. Bitte Seite neu laden.", "error");
});
