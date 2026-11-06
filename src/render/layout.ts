import { eventLabel, eventYear, type Content } from "../content/load.ts";
import type { Assets } from "../design/assets.ts";
import { html, jsonLd, type Raw } from "./html.ts";
import type { Images } from "./images.ts";

export interface Ctx {
  content: Content;
  assets: Assets;
  images: Images;
  /** Canonical origin without trailing slash, e.g. https://www.hofchilbi.ch */
  siteUrl: string;
  /** Social preview image URL (absolute). */
  ogImage: string;
}

/** Web addresses and PDFs open in a new tab. */
export function linkAttrs(url: string): Raw | "" {
  return /^https?:/.test(url) || url.endsWith(".pdf") ? html` rel="noopener" target="_blank"` : "";
}

export const NAV = [
  { href: "/", label: "Start" },
  { href: "/geschichte", label: "Geschichte" },
  { href: "/impressionen", label: "Impressionen" },
  { href: "/kontakt", label: "Kontakt" },
] as const;

export interface PageDef {
  path: string;
  title: string;
  description: string;
  hero: Raw;
  main: Raw;
  jsonLd?: unknown;
  noindex?: boolean;
  /** Hero image to preload with high priority (it is the LCP element). */
  preload?: { srcset: string; sizes: string };
}

/**
 * Rendered width of a hero photo. It is cropped to cover the hero (object-fit), so on a portrait
 * phone the height decides: height × 1.5 for a 3:2 photo (see .hero and .hero--sub in site.css).
 */
const heroSizes = (full: boolean | undefined): string =>
  full ? "max(100vw, 150vh)" : "(max-width: 599px) max(100vw, 68vh), max(100vw, 105vh)";

export async function heroPreload(ctx: Ctx, image: string, full?: boolean): Promise<{ srcset: string; sizes: string }> {
  return { srcset: (await ctx.images.responsive(image, {})).srcset, sizes: heroSizes(full) };
}

/** "Presenting Partner" + logo; label and logo share their left edge. */
async function partnerBlock(ctx: Ctx, cls: string): Promise<Raw | ""> {
  const p = ctx.content.sponsors.presenting;
  if (!p) return "";
  const { img } = await ctx.images.logo(p.logoWhite ?? p.logo, { alt: p.name, sizes: "200px", widths: [400] });
  const attrs = p.url ? html` href="${await ctx.images.href(p.url)}" rel="noopener" target="_blank"` : html` href="/#sponsoren"`;
  return html`<a class="partner ${cls}"${attrs}><span>Presenting Partner</span>${img}</a>`;
}

/** Hero with background photo and skyline. `full` = start page height. */
export async function hero(ctx: Ctx, o: { image: string; full?: boolean; inner: Raw }): Promise<Raw> {
  const bg = await ctx.images.img(o.image, { alt: "", sizes: heroSizes(o.full), cls: "hero__bg", eager: true });
  return html`<div class="hero${o.full ? "" : " hero--sub"}">
  ${bg}
  <div class="hero__content">${o.inner}</div>
  <img class="hero__skyline" src="${ctx.assets.svg["skyline-white"]}" alt="" width="1935" height="210" fetchpriority="high">
</div>`;
}

/** "präsentiert von" + partner logo, next to the Hofchilbi logo (one lockup). */
async function headerPartner(ctx: Ctx): Promise<Raw | ""> {
  const p = ctx.content.sponsors.presenting;
  if (!p) return "";
  const { img } = await ctx.images.logo(p.logoWhite ?? p.logo, { alt: p.name, sizes: "160px", widths: [320] });
  const attrs = p.url ? html` href="${await ctx.images.href(p.url)}" rel="noopener" target="_blank"` : html` href="/#sponsoren"`;
  return html`<a class="header__partner"${attrs}><span>präsentiert von</span>${img}</a>`;
}

const navLinks = (current: string): Raw[] =>
  NAV.map((n) => html`<li><a href="${n.href}"${n.href === current || (n.href !== "/" && current.startsWith(`${n.href}/`)) ? html` aria-current="page"` : ""}>${n.label}</a></li>`);

/**
 * Site header over the hero. Without JS it scrolls away with the page; site.js makes it sticky:
 * see-through at the top, black once scrolled, hidden while scrolling down, back on scrolling up.
 */
async function siteHeader(ctx: Ctx, current: string): Promise<Raw> {
  const { site } = ctx.content;
  return html`<header class="header">
  <div class="header__inner">
    <div class="header__brand">
      <a class="header__logo" href="/"${current === "/" ? html` aria-current="page"` : ""}><img src="${ctx.assets.svg["hofchilbi-logo-white"]}" alt="Hofchilbi Wil – zur Startseite" width="2652" height="1324"></a>
      ${await headerPartner(ctx)}
    </div>
    <nav class="header__nav" aria-label="Hauptnavigation"><ul>${navLinks(current)}</ul></nav>
    <a class="button button--sm header__cta" href="${await ctx.images.href(site.links.helfer)}"${linkAttrs(site.links.helfer)}>Helfer werden</a>
    <button class="menu-button" type="button" data-nav-open aria-controls="nav" aria-expanded="false" hidden><span></span><span class="visually-hidden">Navigation öffnen</span></button>
  </div>
</header>`;
}

function socials(ctx: Ctx, color: "black" | "white", labels = false): Raw {
  const { social } = ctx.content.site;
  const items = [
    social.instagram && { href: social.instagram, label: "Instagram", icon: ctx.assets.svg[`instagram-${color}`], w: 29, h: 27 },
    social.facebook && { href: social.facebook, label: "Facebook", icon: ctx.assets.svg[`facebook-${color}`], w: 18, h: 33 },
  ].filter(Boolean) as { href: string; label: string; icon: string; w: number; h: number }[];
  return html`<ul class="socials${labels ? " socials--labels" : ""}">${items.map(
    (s) =>
      html`<li><a href="${s.href}" rel="noopener" target="_blank"><img src="${s.icon}" alt="${labels ? "" : s.label}" width="${s.w}" height="${s.h}">${labels ? html`<span>${s.label}</span>` : ""}</a></li>`,
  )}</ul>`;
}

/** Mobile navigation: full-screen overlay. */
async function navOverlay(ctx: Ctx, current: string): Promise<Raw> {
  const { site } = ctx.content;
  const goenner = site.links.goenner;
  return html`<nav id="nav" class="nav" aria-label="Hauptnavigation" hidden>
  <div class="nav__head">
    <a href="/"><img src="${ctx.assets.svg["hofchilbi-logo"]}" alt="Hofchilbi Wil – zur Startseite" width="2652" height="1324"></a>
    <button class="menu-button menu-button--close" type="button" data-nav-close><span></span><span class="visually-hidden">Navigation schliessen</span></button>
  </div>
  <ul class="nav__links">${navLinks(current)}</ul>
  <div class="nav__cta">
    <a class="button button--dark" href="${await ctx.images.href(site.links.helfer)}"${linkAttrs(site.links.helfer)}>Helfer werden</a>
    <a class="button button--dark" href="${await ctx.images.href(goenner)}"${linkAttrs(goenner)}>Gönner werden</a>
  </div>
  ${socials(ctx, "black")}
  <img class="nav__skyline" src="${ctx.assets.svg["skyline-outline"]}" alt="" width="1935" height="210">
</nav>`;
}

/** Footer link: own page, external page (redirect), or nothing while the page is empty. */
function impressumLink(ctx: Ctx): Raw | "" {
  const p = ctx.content.pages.impressum;
  if (p?.redirect) return html`<li><a href="${p.redirect}" rel="noopener" target="_blank">${p.title || "Impressum"}</a></li>`;
  if (p?.body.trim()) return html`<li><a href="/impressum">${p.title || "Impressum"}</a></li>`;
  return "";
}

async function footer(ctx: Ctx, current: string): Promise<Raw> {
  const { site } = ctx.content;
  const year = eventYear(site);
  const label = site.event.label ?? eventLabel(site.event.days);
  return html`<footer class="footer">
  <div class="footer__inner">
    <div class="footer__top">
      <a class="footer__logo" href="/"><img src="${ctx.assets.svg["hofchilbi-logo-white"]}" alt="Hofchilbi Wil – zur Startseite" width="2652" height="1324" loading="lazy"></a>
      <div class="footer__event">
        <p class="footer__date">${label}</p>
        ${site.event.location ? html`<p class="footer__place">${site.event.location}</p>` : ""}
      </div>
    </div>
    <div class="footer__cols">
      <nav aria-label="Seiten">
        <p class="footer__h">Seiten</p>
        <ul class="footer__list">${navLinks(current)}</ul>
      </nav>
      <div class="footer__contact">
        <p class="footer__h">Kontakt</p>
        <ul class="footer__list">
          <li><a href="mailto:${site.contact.email}">${site.contact.email}</a></li>
          <li><a href="/kontakt">Team &amp; Kontakt</a></li>
        </ul>
      </div>
      <div>
        <p class="footer__h">Folge uns</p>
        ${socials(ctx, "white", true)}
      </div>
      <div class="footer__orgs">
        <div>
          <p class="footer__h">Ein Anlass von</p>
          <a class="footer__ktv" href="${site.contact.ktv}" rel="noopener" target="_blank"><img src="${ctx.assets.svg["ktv-white"]}" alt="KTV Wil Handball" width="150" height="93" loading="lazy"></a>
        </div>
        ${await partnerBlock(ctx, "footer__partner")}
      </div>
    </div>
    <div class="footer__bottom">
      <span>© ${year} Hofchilbi Wil · KTV Wil Handball</span>
      <ul class="footer__legal">
        ${impressumLink(ctx)}
        <li><a href="${site.contact.datenschutz}" rel="noopener" target="_blank">Datenschutz</a></li>
      </ul>
    </div>
  </div>
</footer>`;
}

export async function layout(ctx: Ctx, page: PageDef): Promise<string> {
  const { site } = ctx.content;
  const url = ctx.siteUrl + page.path;
  const fullTitle = page.path === "/" ? page.title : `${page.title} | ${site.title}`;
  return (
    "<!doctype html>\n" +
    html`<html lang="de-CH">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${fullTitle}</title>
<meta name="description" content="${page.description}">
${page.noindex ? html`<meta name="robots" content="noindex">` : html`<link rel="canonical" href="${url}">`}
${page.preload ? html`<link rel="preload" as="image" imagesrcset="${page.preload.srcset}" imagesizes="${page.preload.sizes}" fetchpriority="high">` : ""}
<link rel="preload" href="${ctx.assets.svg["skyline-white"]}" as="image" type="image/svg+xml" fetchpriority="high">
<link rel="preload" href="${ctx.assets.fontLatin}" as="font" type="font/woff2" crossorigin>
<link rel="stylesheet" href="${ctx.assets.css}">
<link rel="icon" href="${ctx.assets.favicon}" type="image/svg+xml">
<link rel="apple-touch-icon" href="/apple-touch-icon.png">
<meta name="theme-color" content="#000000">
<meta property="og:type" content="website">
<meta property="og:locale" content="de_CH">
<meta property="og:site_name" content="${site.title}">
<meta property="og:title" content="${fullTitle}">
<meta property="og:description" content="${page.description}">
<meta property="og:url" content="${url}">
<meta property="og:image" content="${ctx.ogImage}">
<meta property="og:image:width" content="1200">
<meta property="og:image:height" content="630">
<meta name="twitter:card" content="summary_large_image">
${page.jsonLd ? html`<script type="application/ld+json">${jsonLd(page.jsonLd)}</script>` : ""}
<script src="${ctx.assets.js}" defer></script>
</head>
<body>
<a class="skip" href="#main">Zum Inhalt</a>
${await siteHeader(ctx, page.path)}
${page.hero}
${await navOverlay(ctx, page.path)}
<main id="main">
${page.main}
</main>
${await footer(ctx, page.path)}
</body>
</html>
`.value
  );
}
