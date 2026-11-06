import { eventLabel, eventYear } from "../content/load.ts";
import type { Anzapfer, Sponsor } from "../content/schema.ts";
import { html, type Raw } from "./html.ts";
import { hero, heroPreload, type Ctx, type PageDef } from "./layout.ts";
import { markdown, markdownText } from "./markdown.ts";

const LONG_DATE = new Intl.DateTimeFormat("de-CH", { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" });

function external(url: string | undefined): Raw {
  return url && /^https?:/.test(url) ? html` rel="noopener" target="_blank"` : html``;
}

/**
 * Size class for a logo of aspect ratio w/h: every logo covers about the same AREA of its tile, so
 * a wide wordmark and a square emblem look equally heavy. Classes are steps of √2 in ratio
 * (CSS in site.css, .logo-s-2 … .logo-s6); inline styles are not allowed by the CSP.
 */
export function logoSize(ratio: number): number {
  return Math.max(-2, Math.min(6, Math.round(2 * Math.log2(ratio))));
}

async function logoTiles(ctx: Ctx, list: Sponsor[], tier: "main" | "small"): Promise<Raw> {
  const sizes = tier === "main" ? "(min-width: 768px) 260px, 60vw" : "(min-width: 768px) 140px, 34vw";
  const items = await Promise.all(
    list.map(async (s) => {
      const { img, ratio, light } = await ctx.images.logo(s.logo, { alt: s.name, sizes, widths: [200, 300, 400, 600] });
      const inner = html`<span class="tile__logo logo-s${logoSize(ratio)}">${img}</span>${tier === "main" ? html`<span class="tile__name">${s.name}</span>` : ""}`;
      return s.url
        ? html`<li><a class="tile${light ? " tile--dark" : ""}" href="${await ctx.images.href(s.url)}"${external(s.url)} title="${s.name}">${inner}</a></li>`
        : html`<li><span class="tile${light ? " tile--dark" : ""}" title="${s.name}">${inner}</span></li>`;
    }),
  );
  return html`<ul class="tiles tiles--${tier}">${items}</ul>`;
}

/** "Firma, Kontaktperson, Ort" → name (first part), detail (middle parts), place (last part). */
export function splitGoenner(entry: string): { name: string; detail?: string; place?: string } {
  const parts = entry.split(",").map((p) => p.trim()).filter(Boolean);
  if (parts.length < 2) return { name: entry.trim() };
  const detail = parts.slice(1, -1).join(", ");
  return { name: parts[0]!, ...(detail ? { detail } : {}), place: parts.at(-1)! };
}

// ---------------------------------------------------------------- Start
export async function startPage(ctx: Ctx): Promise<PageDef> {
  const { site, news, anzapfer, sponsors } = ctx.content;
  const label = site.event.label ?? eventLabel(site.event.days);
  const year = eventYear(site);

  const heroInner = html`<h1>${site.title}</h1>
    <p class="hero__date">${label}</p>
    <div class="buttons">
      <a class="button button--lg" href="${await ctx.images.href(site.links.goenner)}"${external(site.links.goenner)}${site.links.goenner.endsWith(".pdf") ? html` target="_blank"` : ""}>Gönner werden</a>
      <a class="button button--lg" href="${await ctx.images.href(site.links.helfer)}"${external(site.links.helfer)}>Helfer werden</a>
    </div>`;

  // Newest item large, the next ones as cards (on phones a row to swipe through).
  const shown = news.slice(0, 7);
  const newsCard = async (n: (typeof news)[number], featured: boolean) => {
    const img = n.image
      ? await ctx.images.img(n.image, {
          alt: n.imageAlt ?? "",
          sizes: featured ? "(min-width: 992px) 600px, 92vw" : "(min-width: 992px) 380px, 80vw",
          widths: featured ? [400, 600, 800, 1200] : [400, 600, 800],
          aspect: featured ? undefined : 4 / 3,
        })
      : "";
    return html`<article class="${featured ? "news__featured" : "news__card"}">
        ${img ? html`<div class="news__media">${img}</div>` : ""}
        <div class="news__body">
          <p class="news__date"><time datetime="${n.date}">${LONG_DATE.format(new Date(n.date))}</time></p>
          <h3>${n.title}</h3>
          ${markdown(n.body)}
          ${n.ctaLabel && n.ctaUrl
            ? html`<p class="news__cta"><a class="button button--dark" href="${await ctx.images.href(n.ctaUrl)}"${external(n.ctaUrl)}${n.ctaUrl.endsWith(".pdf") ? html` target="_blank"` : ""}>${n.ctaLabel}</a></p>`
            : ""}
        </div>
      </article>`;
  };
  const [newest, ...older] = shown;
  const newsSection = newest
    ? html`<section class="section news" aria-labelledby="news-title">
    <h2 id="news-title">Hofchilbi-News</h2>
    ${await newsCard(newest, true)}
    ${older.length ? html`<div class="news__list">${await Promise.all(older.map((n) => newsCard(n, false)))}</div>` : ""}
  </section>`
    : "";

  const helper = html`<section class="banner" aria-labelledby="helfer-title">
    ${await ctx.images.img(site.helperCta.image, { alt: "", sizes: "100vw", cls: "banner__bg" })}
    <h2 id="helfer-title">${site.helperCta.title}</h2>
    <a class="button button--lg" href="${await ctx.images.href(site.links.helfer)}"${external(site.links.helfer)}>Helfer werden</a>
  </section>`;

  const current = anzapfer.list.find((a) => a.name);
  const anz = current
    ? html`<section class="split" aria-labelledby="anzapfer-title">
    ${current.photo ? await ctx.images.img(current.photo, { alt: `${current.name}, Anzapfer der Hofchilbi ${current.year}`, sizes: "(min-width: 992px) 46vw, 92vw", widths: [400, 600, 900, 1200] }) : ""}
    <div>
      <h2 id="anzapfer-title">Anzapfer Hofchilbi ${current.year}</h2>
      <p class="split__name">${current.name}</p>
      <a class="button button--dark" href="/geschichte#anzapfer">Ehemalige Anzapfer ansehen</a>
    </div>
  </section>`
    : "";

  const p = sponsors.presenting;
  const presentingLogo = p ? (await ctx.images.logo(p.logoWhite ?? p.logo, { alt: p.name, sizes: "(min-width: 768px) 420px, 70vw", widths: [400, 600, 840] })).img : "";
  const tier = async (title: string, list: Sponsor[], kind: "main" | "small") =>
    list.length ? html`<h3 class="tier">${title}</h3>${await logoTiles(ctx, list, kind)}` : "";
  const sponsorSection = html`<section class="sponsors section--paper" id="sponsoren" aria-labelledby="sponsoren-title">
    <div class="sponsors__inner">
      <h2 id="sponsoren-title">Unsere Partner</h2>
      ${p
        ? html`<${p.url ? "a" : "div"} class="presenting"${p.url ? html` href="${await ctx.images.href(p.url)}"${external(p.url)}` : ""}>
        <span class="presenting__label">Presenting Partner</span>
        <span class="presenting__logo${p.logoWhite ? "" : " presenting__logo--plate"}">${presentingLogo}</span>
      </${p.url ? "a" : "div"}>`
        : ""}
      ${await tier("Hauptsponsoren", sponsors.main, "main")}
      ${await tier("Sponsoren", sponsors.sponsors, "small")}
      ${await tier("Medienpartner", sponsors.media, "small")}
      ${sponsors.goenner.length
        ? html`<h3 class="tier">Gönner</h3>
      <div class="goenner">
        <ul class="goenner__list">${sponsors.goenner.map((g) => {
          const { name, detail, place } = splitGoenner(g);
          const meta = [detail, place].filter(Boolean).join(" · ");
          return html`<li><span class="goenner__name">${name}</span>${meta ? html`<span class="goenner__meta">${meta}</span>` : ""}</li>`;
        })}</ul>
        <p class="goenner__thanks">Herzlichen Dank für die Unterstützung!</p>
      </div>`
        : ""}
    </div>
  </section>`;

  const [first, last] = [[...site.event.days].sort()[0]!, [...site.event.days].sort().at(-1)!];
  const event = {
    "@context": "https://schema.org",
    "@type": "Event",
    name: `${site.title} ${year}`,
    startDate: first,
    endDate: last,
    eventStatus: "https://schema.org/EventScheduled",
    eventAttendanceMode: "https://schema.org/OfflineEventAttendanceMode",
    location: {
      "@type": "Place",
      name: site.event.location ?? "Wil SG",
      address: { "@type": "PostalAddress", postalCode: "9500", addressLocality: "Wil", addressRegion: "SG", addressCountry: "CH" },
    },
    image: [ctx.ogImage],
    description: site.seo.description,
    organizer: { "@id": `${ctx.siteUrl}/#ktv` },
    ...(p ? { sponsor: { "@type": "Organization", name: p.name, ...(p.url ? { url: p.url } : {}) } } : {}),
    url: ctx.siteUrl + "/",
  };

  return {
    path: "/",
    title: `${site.title} | ${label}`,
    description: site.seo.description,
    preload: await heroPreload(ctx, site.hero.image, true),
    hero: await hero(ctx, { image: site.hero.image, full: true, inner: heroInner }),
    main: html`${newsSection}${helper}${anz}${sponsorSection}`,
    jsonLd: {
      "@context": "https://schema.org",
      "@graph": [
        { ...event, "@context": undefined, "@id": `${ctx.siteUrl}/#event-${year}` },
        { "@type": "SportsOrganization", "@id": `${ctx.siteUrl}/#ktv`, name: "KTV Wil Handball", url: site.contact.ktv, email: site.contact.email, sameAs: [site.social.instagram, site.social.facebook].filter(Boolean) },
        { "@type": "WebSite", "@id": `${ctx.siteUrl}/#website`, url: `${ctx.siteUrl}/`, name: site.title, inLanguage: "de-CH", publisher: { "@id": `${ctx.siteUrl}/#ktv` } },
      ],
    },
  };
}

// ---------------------------------------------------------------- Geschichte
/** Anzapfer list rows: consecutive years with the same note are merged ("2020–2021"). */
export function anzapferRows(list: Anzapfer["list"]): { from: number; to: number; name?: string; note?: string; photo?: string }[] {
  const rows: { from: number; to: number; name?: string; note?: string; photo?: string }[] = [];
  for (const a of [...list].sort((x, y) => y.year - x.year)) {
    const prev = rows.at(-1);
    if (a.note && !a.name && prev?.note && !prev.name && prev.note === a.note && prev.from === a.year + 1) {
      prev.from = a.year;
      continue;
    }
    rows.push({ from: a.year, to: a.year, name: a.name, note: a.name ? undefined : a.note, photo: a.photo });
  }
  return rows;
}

export async function geschichtePage(ctx: Ctx): Promise<PageDef> {
  const { site, pages, anzapfer, timeline } = ctx.content;
  const page = pages.geschichte ?? { title: "Geschichte", body: "" };

  const timelineSection = timeline.entries.length
    ? html`<section class="section timeline-section" aria-labelledby="tl-title">
      <h2 id="tl-title">Meilensteine</h2>
      <ol class="timeline">${timeline.entries.map((e) =>
        e.highlight
          ? html`<li class="timeline__item timeline__item--fact"><span class="timeline__year">${e.year}</span><p class="timeline__fact">${e.text}</p></li>`
          : html`<li class="timeline__item"><span class="timeline__year">${e.year}</span><p class="timeline__text">${e.text}</p></li>`,
      )}</ol>
    </section>`
    : "";

  const current = anzapfer.list.find((a) => a.name);
  const featured = current
    ? html`<div class="anz-featured">
        ${current.photo ? await ctx.images.img(current.photo, { alt: `${current.name}, Anzapfer der Hofchilbi ${current.year}`, sizes: "(min-width: 768px) 360px, 92vw", widths: [360, 540, 720], aspect: 4 / 5 }) : ""}
        <div>
          <p class="anz-featured__label">Anzapfer ${current.year}</p>
          <p class="anz-featured__name">${current.name}</p>
        </div>
      </div>`
    : "";
  const rows = anzapferRows(anzapfer.list.filter((a) => a !== current));
  const decades = new Map<number, typeof rows>();
  for (const r of rows) {
    const d = Math.floor(r.from / 10) * 10;
    decades.set(d, [...(decades.get(d) ?? []), r]);
  }
  const decadePanels = await Promise.all(
    [...decades].map(async ([decade, items], index) => {
      const lis = await Promise.all(
        items.map(async (r) => {
          const photo = r.photo ? await ctx.images.img(r.photo, { alt: "", sizes: "44px", widths: [88], aspect: 1, cls: "anz-list__photo" }) : "";
          const years = r.from === r.to ? String(r.from) : `${r.from}–${String(r.to).slice(-2)}`;
          return r.name
            ? html`<li><span class="anz-list__year">${years}</span><span class="anz-list__name">${r.name}</span>${photo}</li>`
            : html`<li class="anz-list__gap"><span class="anz-list__year">${years}</span><span class="anz-list__name">${r.note}</span></li>`;
        }),
      );
      return html`<details class="anz-decade"${index === 0 ? html` open` : ""}><summary><h3 class="tier">${decade}er</h3></summary><ul class="anz-list">${lis}</ul></details>`;
    }),
  );

  return {
    path: "/geschichte",
    title: page.title,
    description: page.description ?? markdownText(page.body).slice(0, 155).replace(/\s\S*$/, "") + " …",
    preload: await heroPreload(ctx, site.pageImages.geschichte),
    hero: await hero(ctx, { image: site.pageImages.geschichte, inner: html`<h1>${page.title}</h1>` }),
    main: html`<section class="section history" aria-labelledby="g-title">
      <h2 id="g-title" class="visually-hidden">${page.title}</h2>
      <div class="prose prose--lead">${markdown(page.body)}</div>
    </section>
    ${timelineSection}
    <section class="section--paper anz" id="anzapfer" aria-labelledby="anz-title">
      <div class="anz__inner">
        <h2 id="anz-title">Unsere Anzapfer</h2>
        ${featured}
        <div class="anz-decades">${decadePanels}</div>
      </div>
    </section>`,
  };
}

// ---------------------------------------------------------------- Impressionen
/** Year chips to switch between galleries. */
function yearNav(years: number[], current?: number): Raw {
  return html`<nav class="year-nav" aria-label="Jahre"><ul>${years.map(
    (y) => html`<li><a href="/impressionen/${y}"${y === current ? html` aria-current="page"` : ""}>${y}</a></li>`,
  )}</ul></nav>`;
}

/** Overview: one card per year (cover photo, year, number of photos). */
export async function impressionenPage(ctx: Ctx): Promise<PageDef> {
  const { site, galleries } = ctx.content;
  const list = galleries.galleries.filter((g) => g.images.length);
  const cards = await Promise.all(
    list.map(async (g, i) => {
      const cover = g.images[Math.min(g.images.length - 1, Math.floor(g.images.length / 3))]!;
      const img = await ctx.images.img(cover.src, { alt: "", sizes: i === 0 ? "(min-width: 768px) 66vw, 92vw" : "(min-width: 768px) 33vw, 92vw", widths: [480, 720, 1080], aspect: 3 / 2 });
      return html`<li${i === 0 ? html` class="year-card--big"` : ""}><a class="year-card" href="/impressionen/${g.year}">
        ${img}
        <span class="year-card__label"><span class="year-card__year">${g.title ?? String(g.year)}</span><span class="year-card__count">${g.images.length} Fotos</span></span>
      </a></li>`;
    }),
  );
  const years = list.map((g) => g.year).join(", ");
  return {
    path: "/impressionen",
    title: "Impressionen",
    description: `Fotos der Hofchilbi Wil${years ? ` ${years}` : ""}: Stimmung, Bars und Festbetrieb im Hof zu Wil.`,
    preload: await heroPreload(ctx, site.pageImages.impressionen),
    hero: await hero(ctx, { image: site.pageImages.impressionen, inner: html`<h1>Impressionen</h1>` }),
    main: list.length
      ? html`<section class="section" aria-labelledby="years-title">
      <h2 id="years-title">Fotos nach Jahr</h2>
      <ul class="year-cards">${cards}</ul>
    </section>`
      : html`<section class="section"><p class="muted">Bald gibt es hier Fotos.</p></section>`,
  };
}

/** One page per year with all photos of its gallery. */
export async function impressionenYearPages(ctx: Ctx): Promise<PageDef[]> {
  const { site, galleries } = ctx.content;
  const list = galleries.galleries.filter((g) => g.images.length);
  const years = list.map((g) => g.year);
  const pages: PageDef[] = [];
  for (const g of list) {
    const items = await Promise.all(
      g.images.map(async (im, i) => {
        const alt = im.alt || `Hofchilbi ${g.year}, Foto ${i + 1}`;
        const thumb = await ctx.images.img(im.src, { alt, sizes: "(min-width: 1100px) 25vw, (min-width: 768px) 33vw, 50vw", widths: [400, 700], aspect: 3 / 2 });
        const large = await ctx.images.single(im.src, 1800);
        return html`<li><a href="${large}" data-lightbox>${thumb}</a></li>`;
      }),
    );
    const title = g.title ?? `Impressionen ${g.year}`;
    pages.push({
      path: `/impressionen/${g.year}`,
      title,
      description: `${g.images.length} Fotos der Hofchilbi Wil ${g.year}: Stimmung, Bars und Festbetrieb im Hof zu Wil.`,
      preload: await heroPreload(ctx, site.pageImages.impressionen),
      hero: await hero(ctx, { image: site.pageImages.impressionen, inner: html`<h1>${title}</h1>` }),
      main: html`<section class="section gallery-section" aria-labelledby="g-title">
        <h2 id="g-title" class="visually-hidden">${title}</h2>
        <div class="gallery-head">
          <a class="back-link" href="/impressionen">Alle Jahre</a>
          ${yearNav(years, g.year)}
          <span class="gallery-count">${g.images.length} Fotos</span>
        </div>
        <ul class="gallery">${items}</ul>
      </section>`,
    });
  }
  return pages;
}

// ---------------------------------------------------------------- Kontakt
/** "Eliane Derungs" → "ED" (placeholder for a missing portrait). */
export function initials(name: string): string {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .map((w) => w[0]!.toUpperCase())
    .filter((c) => /\p{L}/u.test(c))
    .slice(0, 2)
    .join("");
}

export async function kontaktPage(ctx: Ctx): Promise<PageDef> {
  const { site, team } = ctx.content;
  const mail = site.contact.email;
  const goenner = site.links.goenner;
  const tiles: { href: string; title: string; text: string; external: boolean; icon?: string; wide?: boolean }[] = [
    { href: await ctx.images.href(site.links.helfer), title: "Helfer werden", text: "Melde dich für einen Einsatz an der Hofchilbi an.", external: /^https?:/.test(site.links.helfer) },
    { href: await ctx.images.href(goenner), title: "Gönner werden", text: goenner.endsWith(".pdf") ? "Gönnerbrief mit allen Infos (PDF)." : "Unterstütze die Hofchilbi als Gönner.", external: /^https?:/.test(goenner) || goenner.endsWith(".pdf") },
    { href: `mailto:${mail}?subject=${encodeURIComponent("Sponsoring Hofchilbi")}`, title: "Sponsoring anfragen", text: "Werde Partner der Hofchilbi. Wir senden dir gerne unser Angebot.", external: false, wide: true },
  ];
  if (site.social.instagram) tiles.push({ href: site.social.instagram, title: "Instagram", text: "Bilder und News rund um die Hofchilbi.", external: true, icon: ctx.assets.svg["instagram-black"] });
  if (site.social.facebook) tiles.push({ href: site.social.facebook, title: "Facebook", text: "Neuigkeiten vom KTV Wil Handball.", external: true, icon: ctx.assets.svg["facebook-black"] });

  const members = await Promise.all(
    team.members.map(async (m) => {
      const img = m.photo
        ? await ctx.images.img(m.photo, { alt: m.name, sizes: "(min-width: 992px) 280px, 45vw", widths: [280, 420, 560], aspect: 4 / 5 })
        : html`<span class="member__initials" aria-hidden="true">${initials(m.name)}</span>`;
      return html`<li class="member"><div class="member__photo">${img}</div><p class="member__name">${m.name}</p><p class="member__role">${m.role}</p></li>`;
    }),
  );
  const groupPhoto = team.groupPhoto
    ? html`<h2 id="team-title">Das OK der Hofchilbi</h2>
      <figure class="team-banner">
        ${await ctx.images.img(team.groupPhoto, { alt: "Das Organisationskomitee der Hofchilbi Wil", sizes: "(min-width: 1280px) 1280px, 100vw", widths: [720, 1080, 1440, 1920] })}
      </figure>`
    : html`<h2 id="team-title">Das OK der Hofchilbi</h2>`;

  return {
    path: "/kontakt",
    title: "Kontakt",
    description: `Kontakt zur Hofchilbi Wil: E-Mail ${mail} und das Organisationskomitee des KTV Wil Handball.`,
    preload: await heroPreload(ctx, site.pageImages.kontakt),
    hero: await hero(ctx, { image: site.pageImages.kontakt, inner: html`<h1>Kontakt</h1>` }),
    main: html`<section class="section contact" aria-labelledby="contact-title">
      <div class="contact__main">
        <h2 id="contact-title">Schreib uns</h2>
        <p>Fragen zur Hofchilbi, zu Sponsoring oder für Medien: Wir melden uns gerne.</p>
        <p class="contact__mail"><a href="mailto:${mail}?subject=Kontaktaufnahme">${mail}</a></p>
        <a class="button button--dark" href="mailto:${mail}?subject=Kontaktaufnahme">E-Mail schreiben</a>
      </div>
      <ul class="contact__tiles">${tiles.map(
        (t) => html`<li${t.wide ? html` class="contact__wide"` : ""}><a class="contact-tile" href="${t.href}"${t.external ? html` rel="noopener" target="_blank"` : ""}>
          <span class="contact-tile__title">${t.title}${t.icon ? html`<img src="${t.icon}" alt="" width="20" height="20">` : ""}</span>
          <span class="contact-tile__text">${t.text}</span>
        </a></li>`,
      )}</ul>
    </section>
    <section class="team-section" aria-labelledby="team-title">
      ${groupPhoto}
      <ul class="team-grid">${members}</ul>
    </section>`,
  };
}

// ---------------------------------------------------------------- Impressum
/** Rendered only if the page has text and no redirect (see impressumLink). */
export async function impressumPage(ctx: Ctx): Promise<PageDef | null> {
  const page = ctx.content.pages.impressum;
  if (!page || page.redirect || !page.body.trim()) return null;
  const image = ctx.content.site.pageImages.kontakt;
  return {
    path: "/impressum",
    title: page.title,
    description: page.description ?? `Impressum der Website ${ctx.content.site.title}.`,
    preload: await heroPreload(ctx, image),
    hero: await hero(ctx, { image, inner: html`<h1>${page.title}</h1>` }),
    main: html`<section class="section" aria-labelledby="i-title">
      <h2 id="i-title" class="visually-hidden">${page.title}</h2>
      <div class="prose">${markdown(page.body)}</div>
    </section>`,
  };
}

// ---------------------------------------------------------------- 404
export async function notFoundPage(ctx: Ctx): Promise<PageDef> {
  return {
    path: "/404",
    title: "Seite nicht gefunden",
    description: "Diese Seite gibt es nicht.",
    noindex: true,
    preload: await heroPreload(ctx, ctx.content.site.pageImages.kontakt),
    hero: await hero(ctx, { image: ctx.content.site.pageImages.kontakt, inner: html`<h1>Nicht gefunden</h1>` }),
    main: html`<section class="section notfound"><h2>Diese Seite gibt es nicht (mehr).</h2><p><a class="button button--dark" href="/">Zur Startseite</a></p></section>`,
  };
}
