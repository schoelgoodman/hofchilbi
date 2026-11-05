import { eventYear, type Content } from "../content/load.ts";
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

export async function heroPreload(ctx: Ctx, image: string): Promise<{ srcset: string; sizes: string }> {
  return { srcset: (await ctx.images.responsive(image, {})).srcset, sizes: "100vw" };
}

/** Hero with background photo, top bar and skyline. `full` = start page height. */
export async function hero(ctx: Ctx, o: { image: string; full?: boolean; inner: Raw }): Promise<Raw> {
  const { sponsors, site } = ctx.content;
  const p = sponsors.presenting;
  const partnerLogo = p ? await ctx.images.img(p.logoWhite ?? p.logo, { alt: p.name, sizes: "200px", widths: [400] }) : null;
  const bg = await ctx.images.img(o.image, { alt: "", sizes: "100vw", cls: "hero__bg", eager: true });
  return html`<header class="hero${o.full ? "" : " hero--sub"}">
  ${bg}
  <div class="topbar">
    ${p && partnerLogo
      ? html`<a class="topbar__partner" href="${p.url ?? "#sponsoren"}"${p.url ? html` rel="noopener" target="_blank"` : ""}><span>Presenting Partner</span>${partnerLogo}</a>`
      : html`<span></span>`}
    <div class="topbar__right">
      <a class="topbar__ktv" href="${site.contact.ktv}" rel="noopener" target="_blank"><img src="${ctx.assets.svg["ktv-white"]}" alt="KTV Wil Handball" width="150" height="93"></a>
      <button class="menu-button" type="button" data-nav-open aria-controls="nav" aria-expanded="false" hidden><span></span><span class="visually-hidden">Navigation öffnen</span></button>
    </div>
  </div>
  <div class="hero__content">${o.inner}</div>
  <img class="hero__skyline" src="${ctx.assets.svg["skyline-white"]}" alt="" width="1935" height="210" fetchpriority="high">
</header>`;
}

function socials(ctx: Ctx, color: "black" | "white"): Raw {
  const { social } = ctx.content.site;
  const items = [
    social.instagram && { href: social.instagram, label: "Instagram", icon: ctx.assets.svg[`instagram-${color}`], w: 29, h: 27 },
    social.facebook && { href: social.facebook, label: "Facebook", icon: ctx.assets.svg[`facebook-${color}`], w: 18, h: 33 },
  ].filter(Boolean) as { href: string; label: string; icon: string; w: number; h: number }[];
  return html`<ul class="socials">${items.map(
    (s) => html`<li><a href="${s.href}" rel="noopener" target="_blank"><img src="${s.icon}" alt="${s.label}" width="${s.w}" height="${s.h}"></a></li>`,
  )}</ul>`;
}

function navOverlay(ctx: Ctx, current: string): Raw {
  return html`<nav id="nav" class="nav" aria-label="Hauptnavigation" hidden>
  <div class="nav__head">
    <a href="${ctx.content.site.contact.ktv}" rel="noopener" target="_blank"><img src="${ctx.assets.svg["ktv-black"]}" alt="KTV Wil Handball" width="150" height="100"></a>
    <button class="menu-button menu-button--close" type="button" data-nav-close><span></span><span class="visually-hidden">Navigation schliessen</span></button>
  </div>
  <ul class="nav__links">${NAV.map(
    (n) => html`<li><a href="${n.href}"${n.href === current ? html` aria-current="page"` : ""}>${n.label}</a></li>`,
  )}</ul>
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

function footer(ctx: Ctx, current: string): Raw {
  const { site } = ctx.content;
  const year = eventYear(site);
  return html`<footer class="footer">
  <div class="footer__inner">
    <div class="footer__brand">
      <span>Hofchilbi Wil ${year} ©</span>
      <a href="${site.contact.ktv}" rel="noopener" target="_blank"><img src="${ctx.assets.svg["ktv-white"]}" alt="KTV Wil Handball" width="140" height="87" loading="lazy"></a>
    </div>
    <div class="footer__right">
      <nav aria-label="Seiten"><ul class="footer__nav">${NAV.map(
        (n) => html`<li><a href="${n.href}"${n.href === current ? html` aria-current="page"` : ""}>${n.label}</a></li>`,
      )}</ul></nav>
      <ul class="footer__links">
        <li><a href="mailto:${site.contact.email}">${site.contact.email}</a></li>
        ${impressumLink(ctx)}
        <li><a href="${site.contact.datenschutz}" rel="noopener" target="_blank">Datenschutz</a></li>
      </ul>
      ${socials(ctx, "white")}
    </div>
  </div>
</footer>`;
}

export function layout(ctx: Ctx, page: PageDef): string {
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
${page.hero}
${navOverlay(ctx, page.path)}
<main id="main">
${page.main}
</main>
${footer(ctx, page.path)}
</body>
</html>
`.value
  );
}
