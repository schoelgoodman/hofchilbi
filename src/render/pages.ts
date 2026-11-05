import { eventLabel, eventYear } from "../content/load.ts";
import type { Sponsor } from "../content/schema.ts";
import { html, type Raw } from "./html.ts";
import { hero, heroPreload, type Ctx, type PageDef } from "./layout.ts";
import { markdown, markdownText } from "./markdown.ts";

const LONG_DATE = new Intl.DateTimeFormat("de-CH", { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" });

function external(url: string | undefined): Raw {
  return url && /^https?:/.test(url) ? html` rel="noopener" target="_blank"` : html``;
}

async function logoList(ctx: Ctx, list: Sponsor[], cls: string, sizes: string): Promise<Raw> {
  const items = await Promise.all(
    list.map(async (s) => {
      const img = await ctx.images.img(s.logo, { alt: s.name, sizes, widths: [200, 300, 400, 600] });
      return s.url
        ? html`<li><a href="${await ctx.images.href(s.url)}"${external(s.url)}>${img}</a></li>`
        : html`<li><span>${img}</span></li>`;
    }),
  );
  return html`<ul class="logos ${cls}">${items}</ul>`;
}

// ---------------------------------------------------------------- Start
export async function startPage(ctx: Ctx): Promise<PageDef> {
  const { site, news, anzapfer, sponsors } = ctx.content;
  const label = site.event.label ?? eventLabel(site.event.days);
  const year = eventYear(site);

  const heroInner = html`<h1>${site.title}</h1>
    <p class="hero__date">${label}</p>
    <div class="buttons">
      <a class="button" href="${await ctx.images.href(site.links.goenner)}"${external(site.links.goenner)}${site.links.goenner.endsWith(".pdf") ? html` target="_blank"` : ""}>Gönner werden</a>
      <a class="button" href="${await ctx.images.href(site.links.helfer)}"${external(site.links.helfer)}>Helfer werden</a>
    </div>`;

  const newsItems = await Promise.all(
    news.map(async (n) => {
      const img = n.image ? await ctx.images.img(n.image, { alt: n.imageAlt ?? "", sizes: "(min-width: 768px) 400px, 92vw", widths: [400, 600, 800] }) : "";
      return html`<article class="news__item" aria-roledescription="Beitrag">
        <div>
          <h3>${n.title}</h3>
          <p class="news__date"><time datetime="${n.date}">${LONG_DATE.format(new Date(n.date))}</time></p>
          ${markdown(n.body)}
        </div>
        ${img}
      </article>`;
    }),
  );
  const newsSection = news.length
    ? html`<section class="section section--rule news" data-news aria-labelledby="news-title">
    <h2 id="news-title">Hofchilbi-News</h2>
    <div class="news__track">${newsItems}</div>
    ${news.length > 1
      ? html`<div class="news__controls" hidden><button type="button" data-prev aria-label="Vorherige News">‹</button><button type="button" data-next aria-label="Nächste News">›</button></div>`
      : ""}
  </section>`
    : "";

  const helper = html`<section class="banner" aria-labelledby="helfer-title">
    ${await ctx.images.img(site.helperCta.image, { alt: "", sizes: "100vw", cls: "banner__bg" })}
    <h2 id="helfer-title">${site.helperCta.title}</h2>
    <a class="button" href="${await ctx.images.href(site.links.helfer)}"${external(site.links.helfer)}>Helfer werden</a>
  </section>`;

  const current = anzapfer.list[0];
  const anz = current
    ? html`<section class="split" aria-labelledby="anzapfer-title">
    ${current.photo ? await ctx.images.img(current.photo, { alt: `${current.name}, Anzapfer der Hofchilbi ${current.year}`, sizes: "(min-width: 992px) 46vw, 92vw", widths: [400, 600, 900, 1200] }) : ""}
    <div>
      <h2 id="anzapfer-title">Anzapfer Hofchilbi ${current.year}</h2>
      <p class="split__name">${current.name}</p>
      <a class="button button--solid" href="/geschichte#anzapfer">Ehemalige Anzapfer ansehen</a>
    </div>
  </section>`
    : "";

  const p = sponsors.presenting;
  const sponsorSection = html`<section class="sponsors" id="sponsoren" aria-label="Sponsoren und Gönner">
    ${p ? html`<h2>Presenting-Partner</h2>${await logoList(ctx, [p], "logos--presenting", "295px")}` : ""}
    ${sponsors.main.length ? html`<h2>Hauptsponsoren</h2>${await logoList(ctx, sponsors.main, "logos--main", "220px")}` : ""}
    ${sponsors.sponsors.length ? html`<h2>Sponsoren</h2>${await logoList(ctx, sponsors.sponsors, "", "200px")}` : ""}
    ${sponsors.media.length ? html`<h2>Medienpartner</h2>${await logoList(ctx, sponsors.media, "", "200px")}` : ""}
    ${sponsors.goenner.length ? html`<h2>Gönner</h2><ul class="goenner">${sponsors.goenner.map((g) => html`<li>${g}</li>`)}</ul>` : ""}
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
    preload: await heroPreload(ctx, site.hero.image),
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
export async function geschichtePage(ctx: Ctx): Promise<PageDef> {
  const { site, pages, anzapfer } = ctx.content;
  const page = pages.geschichte ?? { title: "Geschichte", body: "" };
  const list = anzapfer.list;
  const half = Math.ceil(list.length / 2);
  const column = (items: typeof list) =>
    html`<dl>${items.map((a) => html`<dt>${a.year}</dt><dd>${a.name}</dd>`)}</dl>`;
  return {
    path: "/geschichte",
    title: page.title,
    description: page.description ?? markdownText(page.body).slice(0, 155).replace(/\s\S*$/, "") + " …",
    preload: await heroPreload(ctx, site.pageImages.geschichte),
    hero: await hero(ctx, { image: site.pageImages.geschichte, inner: html`<h1>${page.title}</h1>` }),
    main: html`<section class="section" aria-labelledby="g-title">
      <h2 id="g-title" class="visually-hidden">${page.title}</h2>
      <div class="prose">${markdown(page.body)}</div>
    </section>
    <section class="section" id="anzapfer" aria-labelledby="anz-title">
      <h2 id="anz-title">Ehemalige Anzapfer</h2>
      <div class="years">${column(list.slice(0, half))}${column(list.slice(half))}</div>
    </section>`,
  };
}

// ---------------------------------------------------------------- Impressionen
export async function impressionenPage(ctx: Ctx): Promise<PageDef> {
  const { site, galleries } = ctx.content;
  const sections = [];
  for (const g of galleries.galleries) {
    const items = await Promise.all(
      g.images.map(async (im, i) => {
        const alt = im.alt || `Hofchilbi ${g.year}, Bild ${i + 1}`;
        const thumb = await ctx.images.img(im.src, { alt, sizes: "(min-width: 768px) 31vw, 47vw", widths: [400, 700], aspect: 3 / 2 });
        const large = await ctx.images.single(im.src, 1800);
        return html`<li><a href="${large}" data-lightbox>${thumb}</a></li>`;
      }),
    );
    sections.push(html`<section class="section" aria-labelledby="g-${g.year}">
      <h2 id="g-${g.year}">${g.title ?? String(g.year)}</h2>
      <ul class="gallery">${items}</ul>
    </section>`);
  }
  const years = galleries.galleries.map((g) => g.year).join(", ");
  return {
    path: "/impressionen",
    title: "Impressionen",
    description: `Fotos der Hofchilbi Wil${years ? ` ${years}` : ""}: Stimmung, Bars und Festbetrieb im Hof zu Wil.`,
    preload: await heroPreload(ctx, site.pageImages.impressionen),
    hero: await hero(ctx, { image: site.pageImages.impressionen, inner: html`<h1>Impressionen</h1>` }),
    main: html`${sections}`,
  };
}

// ---------------------------------------------------------------- Kontakt
export async function kontaktPage(ctx: Ctx): Promise<PageDef> {
  const { site, team } = ctx.content;
  const members = await Promise.all(
    team.members.map(async (m) => {
      const img = m.photo
        ? await ctx.images.img(m.photo, { alt: m.name, sizes: "220px", widths: [220, 440], aspect: 1 })
        : html`<img class="placeholder" src="${ctx.assets.svg["ktv-black-color"]}" alt="" width="220" height="220" loading="lazy">`;
      return html`<li>${img}<div class="team__name">${m.name}</div><div class="team__role">${m.role}</div></li>`;
    }),
  );
  return {
    path: "/kontakt",
    title: "Kontakt",
    description: `Kontakt zur Hofchilbi Wil: E-Mail ${site.contact.email} und das Organisationskomitee des KTV Wil Handball.`,
    preload: await heroPreload(ctx, site.pageImages.kontakt),
    hero: await hero(ctx, { image: site.pageImages.kontakt, inner: html`<h1>Kontakt</h1>` }),
    main: html`<section class="section" aria-labelledby="mail-title">
      <h2 id="mail-title">E-Mail-Adresse</h2>
      <p class="contact-mail"><a href="mailto:${site.contact.email}?subject=Kontaktaufnahme">${site.contact.email}</a></p>
      <h2>Das Team</h2>
      ${team.groupPhoto ? await ctx.images.img(team.groupPhoto, { alt: "Das Organisationskomitee der Hofchilbi Wil", sizes: "(min-width: 1280px) 1200px, 92vw", cls: "team-photo" }) : ""}
      <ul class="team">${members}</ul>
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
    main: html`<section class="section notfound"><h2>Diese Seite gibt es nicht (mehr).</h2><p><a class="button button--solid" href="/">Zur Startseite</a></p></section>`,
  };
}
