import logoUrl from "../design/assets/hofchilbi-logo-white.svg";
import skylineUrl from "../design/assets/skyline-white.svg";
import "./editor.css";
import { api, type State } from "./api.ts";
import { h, toast } from "./dom.ts";
import type { Ctx } from "./screens/doc.ts";
import { galleriesScreen } from "./screens/galleries.ts";
import { historyScreen } from "./screens/history.ts";
import { anzapferScreen, teamScreen, timelineScreen } from "./screens/people.ts";
import { allgemeinScreen, impressionenScreen, kontaktScreen, startScreen } from "./screens/site.ts";
import { sponsorsScreen } from "./screens/sponsors.ts";
import { disposeEditor, impressumScreen, newsScreen, pageScreen } from "./screens/texts.ts";

interface Route {
  hash: string;
  label: string;
  /** Subcategory of this main entry. */
  parent?: string;
  /** Where «Seite ansehen» leads; null: the page does not exist right now. */
  site?: (s: State) => string | null;
  render: (ctx: Ctx, arg?: string) => HTMLElement;
}

const at = (path: string) => () => path;

/** Mirrors the website: every page is a main entry, what appears on it sits underneath. */
const GENERAL: Route = { hash: "allgemein", label: "Allgemein", render: allgemeinScreen };
const PAGES: Route[] = [
  { hash: "start", label: "Start", site: at("/"), render: startScreen },
  { hash: "news", label: "News", parent: "start", site: at("/"), render: newsScreen },
  { hash: "sponsoren", label: "Sponsoren & Gönner", parent: "start", site: at("/#sponsoren"), render: sponsorsScreen },
  {
    hash: "geschichte",
    label: "Geschichte",
    site: at("/geschichte"),
    render: (c) => pageScreen(c, "geschichte", "Geschichte", "Titelbild und Text der Seite. Darunter folgen automatisch der Zeitstrahl und die Anzapfer.", { titleImage: "geschichte" }),
  },
  { hash: "zeitstrahl", label: "Zeitstrahl", parent: "geschichte", site: at("/geschichte"), render: timelineScreen },
  { hash: "anzapfer", label: "Anzapfer", parent: "geschichte", site: at("/geschichte#anzapfer"), render: anzapferScreen },
  { hash: "impressionen", label: "Impressionen", site: at("/impressionen"), render: impressionenScreen },
  { hash: "galerien", label: "Galerien", parent: "impressionen", site: at("/impressionen"), render: galleriesScreen },
  { hash: "kontakt", label: "Kontakt", site: at("/kontakt"), render: kontaktScreen },
  { hash: "team", label: "Team", parent: "kontakt", site: at("/kontakt"), render: teamScreen },
  {
    hash: "impressum",
    label: "Impressum",
    site: (s) => {
      const p = s.pages.impressum;
      return p?.body.trim() || (p?.meta as { redirect?: string } | undefined)?.redirect ? "/impressum" : null;
    },
    render: impressumScreen,
  },
];
const HISTORY: Route = { hash: "verlauf", label: "Verlauf", render: historyScreen };
const ROUTES = [GENERAL, ...PAGES, HISTORY];

let state: State;
let isDirty: () => boolean = () => false;
let lastHash = location.hash;
/** A save happened and the site has not reported a newer build yet. */
let updating = false;

const main = h("main", { class: "main", id: "main", tabindex: -1 });
const nav = h("nav", { class: "nav", "aria-label": "Bereiche" });
const status = h("p", { class: "status", role: "status" });
const feedback = h("div", {});
const side = h("aside", { class: "side" });

function route(): { name: string; arg?: string } {
  const [, name = GENERAL.hash, arg] = location.hash.replace(/^#\/?/, "#/").split("/");
  return { name: name || GENERAL.hash, arg };
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

function renderNav(current: Route): void {
  const link = (r: Route) => h("a", { href: `#/${r.hash}`, "aria-current": r === current ? "page" : null }, r.label);
  nav.replaceChildren(
    h("ul", {}, h("li", {}, link(GENERAL))),
    h("p", { class: "nav__label" }, "Seiten"),
    h(
      "ul",
      {},
      PAGES.filter((r) => !r.parent).map((r) => {
        const children = PAGES.filter((c) => c.parent === r.hash);
        return h("li", {}, link(r), children.length ? h("ul", { class: "nav__sub" }, children.map((c) => h("li", {}, link(c)))) : null);
      }),
    ),
    h("ul", { class: "nav__tools" }, h("li", {}, link(HISTORY))),
  );
}

function renderFeedback(): void {
  const email = (state.docs.site.data as { editor?: { feedbackEmail?: string } } | null)?.editor?.feedbackEmail;
  feedback.replaceChildren(
    email ? h("a", { class: "side__link", href: `mailto:${email}?subject=${encodeURIComponent("Feedback zur Redaktion")}` }, "Feedback") : "",
  );
}

function renderStatus(): void {
  const b = state.build;
  const stand = b?.at ? new Date(b.at).toLocaleString("de-CH", { day: "numeric", month: "numeric", hour: "2-digit", minute: "2-digit" }) : "";
  const [text, kind] = updating ? ["Website wird aktualisiert …", "busy"] : !b ? ["Website noch nicht erstellt", "busy"] : b.ok ? ["Website aktuell", "ok"] : ["Website nicht aktualisiert", "error"];
  status.className = `status status--${kind}`;
  status.replaceChildren(h("span", {}, text), !updating && stand ? h("small", {}, `Stand ${stand}`) : "");
}

/** Breadcrumb for subcategories, link to the live page on every screen. */
function crumbs(r: Route): HTMLElement {
  const parent = PAGES.find((p) => p.hash === r.parent);
  const path = r.site?.(state) ?? null;
  const base = state.publicUrl.replace(/\/$/, "");
  return h(
    "div",
    { class: "crumbs" },
    parent ? h("span", {}, h("a", { href: `#/${parent.hash}` }, parent.label), " / ", r.label) : h("span", {}),
    h("a", { href: `${base}${path ?? "/"}`, target: "_blank", rel: "noopener" }, path ? "Seite ansehen ↗" : "Website ansehen ↗"),
  );
}

async function render(): Promise<void> {
  const { name, arg } = route();
  const r = ROUTES.find((x) => x.hash === name) ?? GENERAL;
  renderNav(r);
  renderFeedback();
  renderStatus();
  await disposeEditor();
  isDirty = () => false;
  main.replaceChildren(crumbs(r), buildWarning(), r.render(ctx, arg));
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
    "Online ist noch der vorherige Stand. Meist hilft es, das genannte Bild neu hochzuladen oder den letzten Stand unter «Verlauf» zurückzuholen.",
    h("pre", {}, b.error ?? ""),
  );
}

let watching = 0;
/** After a save: watches until the site reports a newer build (at most a minute). */
async function watchBuild(): Promise<void> {
  const mine = ++watching;
  const before = state.build?.at;
  const wasOk = state.build?.ok;
  updating = true;
  renderStatus();
  for (let i = 0; i < 30 && mine === watching; i++) {
    await new Promise((r) => setTimeout(r, 2000));
    if (mine !== watching) return;
    try {
      const fresh = await api.state();
      if (fresh.build?.at === before) continue;
      state.build = fresh.build;
      const old = main.querySelector(".alert");
      const next = buildWarning();
      if (old) old.replaceWith(next);
      else if (next) main.querySelector(".crumbs")?.after(next);
      if (fresh.build && !fresh.build.ok && wasOk !== false) toast("Gespeichert, aber die Website konnte nicht aktualisiert werden. Details oben.", "error");
      break;
    } catch {
      // Offline for a moment: keep trying.
    }
  }
  if (mine !== watching) return;
  updating = false;
  renderStatus();
}

window.addEventListener("hofchilbi:saved", () => {
  renderFeedback();
  void watchBuild();
});

window.addEventListener("hashchange", () => {
  if (isDirty() && !confirm("Es gibt ungespeicherte Änderungen. Trotzdem wechseln? Die Änderungen gehen verloren.")) {
    history.replaceState(null, "", lastHash);
    return;
  }
  lastHash = location.hash;
  side.classList.remove("side--open");
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
  const menu = h(
    "button",
    {
      type: "button",
      class: "side__menu",
      "aria-expanded": "false",
      onclick: () => menu.setAttribute("aria-expanded", String(side.classList.toggle("side--open"))),
    },
    "Menü",
  );
  side.replaceChildren(
    h(
      "div",
      { class: "side__head" },
      h(
        "a",
        { class: "side__brand", href: `#/${GENERAL.hash}` },
        h("img", { src: logoUrl, alt: "Hofchilbi", width: 2652, height: 1324 }),
        h("span", {}, "Redaktion"),
      ),
      menu,
    ),
    h(
      "div",
      { class: "side__body" },
      nav,
      h("div", { class: "side__foot" }, feedback, status),
      h("img", { class: "side__skyline", src: skylineUrl, alt: "", width: 1935, height: 210 }),
    ),
  );
  app.replaceChildren(h("a", { class: "skip", href: "#main" }, "Zum Inhalt"), h("div", { class: "layout" }, side, main));
  if (!location.hash) history.replaceState(null, "", `#/${GENERAL.hash}`);
  lastHash = location.hash;
  await render();
}

start().catch((err) => {
  console.error(err);
  toast("Die Redaktion konnte nicht starten. Bitte Seite neu laden.", "error");
});
