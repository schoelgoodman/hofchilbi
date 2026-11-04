/**
 * One-time migration: reads the live Webflow site and writes content files + media into
 * CONTENT_DIR (default dev-content/). Known content bugs of the old site are fixed on the way
 * and listed at the end. Run: node scripts/import-webflow.ts [targetDir]
 *
 * The output is content, not code: it must never be committed to this repo.
 */
import { createHash } from "node:crypto";
import { mkdir, writeFile, access } from "node:fs/promises";
import path from "node:path";
import { parse, type HTMLElement } from "node-html-parser";
import YAML from "yaml";
import { stringifyFrontmatter } from "../src/content/load.ts";
import { AnzapferSchema, GalleriesSchema, SiteSchema, SponsorsSchema, TeamSchema } from "../src/content/schema.ts";

const BASE = "https://www.hofchilbi.ch";
const CDN = "https://cdn.prod.website-files.com/6626d269cdb7984611fc90dc/";
const target = path.resolve(process.argv[2] ?? process.env.CONTENT_DIR ?? "dev-content");
const notes: string[] = [];

async function page(p: string): Promise<HTMLElement> {
  const res = await fetch(BASE + p);
  if (!res.ok) throw new Error(`${p}: HTTP ${res.status}`);
  return parse(await res.text());
}

function slug(s: string): string {
  return s
    .toLowerCase()
    .replace(/ä/g, "ae").replace(/ö/g, "oe").replace(/ü/g, "ue")
    .normalize("NFKD").replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "")
    .slice(0, 60);
}

const downloaded = new Map<string, string>();

/** Downloads a CDN file once and returns its media path ("media/<dir>/<name>.<ext>"). */
async function media(url: string, dir: string, name: string): Promise<string> {
  const abs = new URL(url, BASE).href;
  const hit = downloaded.get(abs);
  if (hit) return hit;
  let ext = path.extname(decodeURIComponent(new URL(abs).pathname)).toLowerCase();
  if (ext === ".jpeg") ext = ".jpg";
  if (!/^\.(jpg|png|gif|webp|avif|svg|pdf)$/.test(ext)) throw new Error(`unexpected file type: ${abs}`);
  const rel = `media/${dir}/${slug(name)}${ext}`;
  const file = path.join(target, rel);
  try {
    await access(file);
  } catch {
    const res = await fetch(abs);
    if (!res.ok) throw new Error(`${abs}: HTTP ${res.status}`);
    await mkdir(path.dirname(file), { recursive: true });
    await writeFile(file, Buffer.from(await res.arrayBuffer()));
  }
  downloaded.set(abs, rel);
  return rel;
}

function text(el: HTMLElement | null | undefined): string {
  return (el?.text ?? "").replace(/\s+/g, " ").trim();
}

function hostOf(url: string | undefined): string {
  try {
    return new URL(url ?? "").host.replace(/^www\./, "");
  } catch {
    return "";
  }
}

/**
 * Sponsor names. The old alt texts were partly wrong (copy-paste), so names are keyed by the
 * sponsor's website and only fall back to the cleaned alt text.
 */
const SPONSOR_NAMES: Record<string, string> = {
  "raiffeisen.ch": "Raiffeisenbank Wil und Umgebung",
  "feldschloesschen.ch": "Feldschlösschen",
  "stadtwil.ch": "Stadt Wil",
  "tb-wil.ch": "Technische Betriebe Wil",
  "tullaparkett.ch": "Tulla Parkett",
  "trevida.ch": "Trevida",
  "ralphs-bar.ch": "Ralph's Bar",
  "bauwiwo.ch": "Bauwiwo",
  "burtscher.com": "Beni Burtscher Immobilien AG",
  "mobiliar.ch": "Die Mobiliar, Generalagentur Wil",
  "weber-malen-gipsen.ch": "Weber Malen Gipsen",
  "kolic.ch": "Kolic Haustechnik GmbH",
  "eduacademy.ch": "Edu Care",
  "huerlimannbau.ch": "Hürlimann Bau",
  "mader-festzelte.ch": "Mader Festinventar AG",
  "faessler-garage.ch": "Sepp Fässler AG",
  "gehrig-bau.ch": "Gehrig AG",
  "topcc.ch": "TopCC Zuzwil",
  "planerwerk.ch": "Planerwerk",
  "pizzeriavalentino.ch": "Pizzeria Valentino",
};

/**
 * Most logo files are named "3_Sponsor_<Name>.<ext>", which is more reliable than the alt texts
 * (Suisse Sockelleisten had alt "Promrisk Logo"; Ammannfen linked to tb-wil.ch). Order: file name,
 * then the host map (only if the file name has no name), then the cleaned alt text.
 */
function sponsorName(href: string | undefined, alt: string, src: string): string {
  const file = decodeURIComponent(src.split("/").pop() ?? "").normalize("NFC");
  const fromFile = /_Sponsor_(.+?)(?:cropped)?(?:\.[A-Za-z]{3,4})+$/.exec(file)?.[1]?.trim();
  const known = SPONSOR_NAMES[hostOf(href)];
  if (fromFile) {
    // Keep the curated spelling when file and website agree on the same sponsor.
    const looseEq = (a: string, b: string) => a.toLowerCase().replace(/[^a-z]/g, "").slice(0, 5) === b.toLowerCase().replace(/[^a-z]/g, "").slice(0, 5);
    return known && looseEq(known, fromFile.replace(/ä/g, "a")) ? known : fromFile;
  }
  if (known) return known;
  return alt.replace(/\s+/g, " ").replace(/\s*-?\s*Logo\b.*$/i, "").replace(/^Logo\s+/i, "").trim() || alt;
}

async function sponsorsFrom(block: HTMLElement | null, seenHosts: Map<string, string>) {
  const out: { name: string; logo: string; url?: string }[] = [];
  for (const a of block?.querySelectorAll("a") ?? []) {
    const img = a.querySelector("img");
    if (!img) continue;
    let href = a.getAttribute("href");
    const alt = img.getAttribute("alt") ?? "";
    const name = sponsorName(href, alt, img.getAttribute("src") ?? "");
    if (!href || href === "#") {
      notes.push(`Sponsor «${name}»: hatte keinen Link (href="#"). Bitte in der Redaktion ergänzen.`);
      href = undefined;
    } else {
      // Ammannfen GmbH linked to tb-wil.ch (copy-paste from Technische Betriebe Wil).
      const prev = seenHosts.get(hostOf(href));
      if (prev && prev !== name) {
        notes.push(`Sponsor «${name}»: verlinkte auf ${href} (gehört zu «${prev}»). Link entfernt, bitte richtigen ergänzen.`);
        href = undefined;
      } else seenHosts.set(hostOf(href), name);
    }
    out.push({ name, logo: await media(img.getAttribute("src")!, "logos", name), ...(href ? { url: href } : {}) });
  }
  return out;
}

async function main() {
  console.log(`Import into ${target}`);
  const [start, geschichte, impressionen, kontakt] = await Promise.all(
    ["/", "/geschichte", "/impressionen", "/kontakt"].map(page),
  );

  // --- Hero and section background images (set in Webflow CSS, not HTML)
  const cssUrl = start.querySelector('link[rel="stylesheet"]')?.getAttribute("href");
  const css = cssUrl ? await (await fetch(cssUrl)).text() : "";
  const bg = (cls: string) => new RegExp(`\\.${cls}\\{[^}]*background-image:url\\(([^)]+)\\)`).exec(css)?.[1];
  const heroImage = await media(bg("hero")!, "bilder", "hero-start");
  const helperImage = await media(bg("section")!, "bilder", "helfer");
  const pageImages = {
    geschichte: await media(bg("hero_subpage_geschichte")!, "bilder", "hero-geschichte"),
    impressionen: await media(bg("hero_subpage")!, "bilder", "hero-impressionen"),
    kontakt: await media(bg("hero_subpage_kontakt")!, "bilder", "hero-kontakt"),
  };

  // --- Links
  const buttons = start.querySelectorAll(".container-7 a");
  const goennerHref = buttons.find((a) => /Gönner/.test(text(a)))?.getAttribute("href");
  const helferHref = buttons.find((a) => /Helfer/.test(text(a)))?.getAttribute("href");
  const goenner = goennerHref ? await media(goennerHref, "dokumente", "goenner-brief") : "media/dokumente/goenner-brief.pdf";
  if (/2026/.test(decodeURIComponent(goennerHref ?? ""))) {
    notes.push("Gönner-PDF ist noch der Brief 2026. Neue Version in der Redaktion hochladen.");
  }

  const footerLinks = start.querySelectorAll(".footer-dark a");
  const social = {
    instagram: footerLinks.find((a) => /instagram/.test(a.getAttribute("href") ?? ""))?.getAttribute("href"),
    facebook: footerLinks.find((a) => /facebook/.test(a.getAttribute("href") ?? ""))?.getAttribute("href"),
  };

  const site = SiteSchema.parse({
    title: "Hofchilbi Wil",
    // Confirmed by the organisers: both days. The old site said "Samstag, 24. Juli" in places.
    event: { days: ["2027-07-23", "2027-07-24"], location: "Hof zu Wil" },
    hero: { image: heroImage },
    links: { goenner, helfer: helferHref },
    helperCta: { title: "Werde Hofchilbi-Helfer!", image: helperImage },
    contact: {
      email: "hofchilbi@ktvwil-handball.ch",
      datenschutz: footerLinks.find((a) => /Datenschutz/.test(text(a)))?.getAttribute("href"),
      ktv: "https://ktvwil-handball.ch/",
    },
    social,
    pageImages,
    seo: {
      description:
        "Hofchilbi Wil am 23. & 24. Juli 2027 im Hof zu Wil, organisiert vom KTV Wil Handball. Geschichte, Impressionen, Sponsoren und Kontakt.",
    },
  });
  notes.push("Festort «Hof zu Wil» angenommen (stand nirgends auf der alten Seite). Bitte prüfen.");

  // --- Sponsors
  const seenHosts = new Map<string, string>();
  const presentingA = start.querySelector(".section-goenner .div-block-3 a");
  const presentingImg = presentingA?.querySelector("img");
  const headerLogo = start.querySelector(".presenting_sponsor img")?.getAttribute("src");
  const presentingHref = presentingA?.getAttribute("href");
  const presenting = presentingImg
    ? {
        name: sponsorName(presentingHref, presentingImg.getAttribute("alt") ?? "", ""),
        logo: await media(presentingImg.getAttribute("src")!, "logos", "raiffeisen"),
        ...(headerLogo ? { logoWhite: await media(headerLogo, "logos", "raiffeisen-weiss") } : {}),
        url: presentingHref,
      }
    : undefined;
  if (presentingHref) seenHosts.set(hostOf(presentingHref), presenting!.name);

  const blocks = start.querySelectorAll(".section-goenner h3");
  const blockAfter = (re: RegExp) => blocks.find((h) => re.test(text(h)))?.parentNode as HTMLElement | undefined;
  const sponsors = SponsorsSchema.parse({
    presenting,
    main: await sponsorsFrom(blockAfter(/Hauptsponsoren/) ?? null, seenHosts),
    sponsors: await sponsorsFrom(blockAfter(/^Sponsoren/) ?? null, seenHosts),
    media: await sponsorsFrom(blockAfter(/Medienpartner/) ?? null, seenHosts),
    goenner: (blockAfter(/Gönner/)?.querySelectorAll("p") ?? []).map(text).filter(Boolean),
  });

  // --- Anzapfer: list from Geschichte, photo of the current one from Start
  const cells = geschichte.querySelectorAll(".geschichte_wrapper_ehemalige p").map(text);
  const list: { year: number; name: string; photo?: string }[] = [];
  for (let i = 0; i + 1 < cells.length; i += 2) list.push({ year: Number(cells[i]), name: cells[i + 1]! });
  const anzImg = start.querySelector(".hero-split img");
  const current = list.sort((a, b) => b.year - a.year)[0];
  if (current && anzImg) current.photo = await media(anzImg.getAttribute("src")!, "anzapfer", `${current.year}-${current.name}`);
  const anzapfer = AnzapferSchema.parse({ list });

  // --- Team
  const groupSrc = kontakt.querySelector(".container-23 img")?.getAttribute("src");
  const members = [];
  for (const card of kontakt.querySelectorAll(".team-card")) {
    const img = card.querySelector("img");
    const name = text(card.querySelector(".team-member-name"));
    const placeholder = img?.classList.contains("placeholder") || /Logo/.test(img?.getAttribute("alt") ?? "");
    if (placeholder) notes.push(`Team «${name}»: kein Foto (KTV-Logo als Platzhalter). Foto in der Redaktion hochladen.`);
    members.push({
      name,
      role: text(card.querySelector(".team-member-position")),
      ...(img && !placeholder ? { photo: await media(img.getAttribute("src")!, "team", name) } : {}),
    });
  }
  const team = TeamSchema.parse({
    ...(groupSrc ? { groupPhoto: await media(groupSrc, "team", "gruppenfoto") } : {}),
    members,
  });

  // --- Galleries: <h1>year</h1> followed by an image grid
  const galleries = [];
  for (const h of impressionen.querySelectorAll("h1")) {
    const year = Number(text(h));
    if (!year) continue;
    const grid = h.parentNode.querySelectorAll("img");
    const images = [];
    for (const img of grid) {
      const src = img.getAttribute("src")!;
      const base = decodeURIComponent(src.split("/").pop()!).replace(/^[0-9a-f]{24}_/, "").replace(/\.[a-z]+$/i, "");
      images.push({ src: await media(src, `galerie/${year}`, base) });
    }
    galleries.push({ year, images });
    console.log(`  Galerie ${year}: ${images.length} Bilder`);
  }

  // --- News
  const slide = start.querySelector(".testimonial-slide");
  const newsTitle = text(slide?.querySelector(".testimonial-quote"));
  const newsImg = slide?.querySelector("img");
  const newsBody = [
    "Danke an alle Besucher, Helfer und Sponsoren für eine tolle Hofchilbi 2026!",
    // Typo "freuen und" fixed; date corrected to both festival days.
    "Wir freuen uns auf nächstes Jahr – **23. & 24. Juli 2027**!",
  ].join("\n\n");
  notes.push("News: «freuen und» → «freuen uns», Datum auf 23. & 24. Juli 2027 korrigiert.");

  // --- Geschichte text: paragraphs from <br><br>, missing space after "eingeweiht." fixed
  const gText = geschichte.querySelector(".geschichte_wrapper_1 p")!.innerHTML
    .split(/<br\s*\/?>\s*<br\s*\/?>/)
    .map((p) => parse(p).text.replace(/\s+/g, " ").trim())
    .map((p) => p.replace(/eingeweiht\.Diese/, "eingeweiht. Diese").replace(/Wartensee, die Grosse,/, "Wartensee, die grosse,"))
    .join("\n\n");

  // --- Write
  const write = async (rel: string, body: string) => {
    const file = path.join(target, rel);
    await mkdir(path.dirname(file), { recursive: true });
    await writeFile(file, body);
  };
  const y = (data: unknown) => YAML.stringify(data, { lineWidth: 0 });
  await write("site.yaml", y(site));
  await write("sponsors.yaml", y(sponsors));
  await write("anzapfer.yaml", y(anzapfer));
  await write("team.yaml", y(team));
  await write("galleries.yaml", y(GalleriesSchema.parse({ galleries })));
  await write(
    "news/2026-07-27-danke.md",
    stringifyFrontmatter(
      {
        title: newsTitle || "Wir sagen DANKE!",
        date: "2026-07-27",
        image: newsImg ? await media(newsImg.getAttribute("src")!, "news", "2026-dreh-bar") : undefined,
        imageAlt: "Die Dräh-Bar an der Hofchilbi 2026",
        draft: false,
      },
      newsBody,
    ),
  );
  await write("pages/geschichte.md", stringifyFrontmatter({ title: "Geschichte" }, gText));

  const hash = createHash("sha1").update([...downloaded.keys()].join()).digest("hex").slice(0, 8);
  console.log(`\n${downloaded.size} Dateien (${hash}), Inhalt geschrieben.\n\nHinweise:`);
  for (const n of notes) console.log(`  - ${n}`);
}

await main();
