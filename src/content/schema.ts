import { z } from "zod";

/**
 * Messages editors see next to a field. Plain German for the common cases, zod's German locale
 * for the rest.
 */
z.config(z.locales.de());
const deLocale = z.config().localeError;
z.config({
  customError: (iss) => {
    if (iss.code === "invalid_type" && iss.input === undefined) return "Bitte ausfüllen.";
    if (iss.code === "too_small" && iss.origin === "string" && iss.minimum === 1) return "Bitte ausfüllen.";
    if (iss.code === "too_small" && iss.origin === "array") return "Mindestens ein Eintrag nötig.";
    if (iss.code === "too_big" && iss.origin === "string") return `Höchstens ${iss.maximum} Zeichen.`;
    if (iss.code === "invalid_format" && iss.format === "email") return "Keine gültige E-Mail-Adresse.";
    if (iss.code === "invalid_format" && iss.format === "date") return "Kein gültiges Datum.";
    if (iss.code === "invalid_format" && iss.format === "url") return "Keine gültige Webadresse (https://…).";
    if (iss.code === "invalid_union") return "Bitte eine Webadresse (https://…) oder eine hochgeladene Datei angeben.";
    return deLocale?.(iss);
  },
});

/**
 * The content model. Everything an editor can change lives in CONTENT_DIR:
 *
 *   site.yaml        event dates, hero, links, contact, SEO defaults
 *   sponsors.yaml    presenting partner, sponsor tiers, Gönner
 *   anzapfer.yaml    all Anzapfer by year (the newest is shown on Start)
 *   timeline.yaml    milestones on the page Geschichte (optional file)
 *   team.yaml        group photo and team members
 *   galleries.yaml   photo galleries by year (written by the Immich sync, not by editors)
 *   news/*.md        news posts (frontmatter + Markdown)
 *   pages/*.md       free-text pages (Geschichte)
 *   media/           uploaded files, referenced as "media/<file>"
 *
 * The editor writes these files; the site renders them. Both validate with these schemas.
 */

/** Path of an uploaded file inside CONTENT_DIR, always under media/. */
export const MediaPath = z
  .string()
  .regex(/^media\/(?:[A-Za-z0-9._-]+\/)*[A-Za-z0-9._-]+$/, "Datei muss unter media/ liegen")
  .refine((p) => !p.split("/").includes(".."), "Ungültiger Pfad");

const OptionalMedia = MediaPath.optional();

/** External link or a file under media/. */
export const Link = z.union([z.url({ protocol: /^https?$/ }), MediaPath, z.string().regex(/^mailto:[^\s]+$/)]);

const IsoDate = z.iso.date();

export const SiteSchema = z.object({
  title: z.string().min(1).default("Hofchilbi Wil"),
  event: z.object({
    /** Every festival day, ISO dates. The label "23. & 24. Juli 2027" is derived from them. */
    days: z.array(IsoDate).min(1),
    /** Optional override for the label, e.g. when the date is not fixed yet. */
    label: z.string().optional(),
    location: z.string().optional(),
  }),
  hero: z.object({ image: MediaPath }),
  links: z.object({
    goenner: Link,
    helfer: Link,
  }),
  helperCta: z.object({
    title: z.string().min(1),
    image: MediaPath,
  }),
  contact: z.object({
    email: z.email(),
    /** Old place of the link: only used while pages/datenschutz.md does not exist (see oldDatenschutzLink). */
    datenschutz: Link.optional(),
    ktv: Link,
  }),
  social: z.object({
    instagram: Link.optional(),
    facebook: Link.optional(),
  }),
  pageImages: z.object({
    geschichte: MediaPath,
    impressionen: MediaPath,
    kontakt: MediaPath,
  }),
  seo: z.object({
    description: z.string().max(200),
    /** Social preview image (1200×630 is generated from it). Defaults to the hero image. */
    image: OptionalMedia,
  }),
  /** Only used by the Redaktion itself, never shown on the website. */
  editor: z.object({ feedbackEmail: z.email().optional() }).optional(),
});
export type Site = z.infer<typeof SiteSchema>;

export const SponsorSchema = z.object({
  name: z.string().min(1),
  logo: MediaPath,
  url: Link.optional(),
});
export type Sponsor = z.infer<typeof SponsorSchema>;

export const SponsorsSchema = z.object({
  presenting: SponsorSchema.extend({
    /** White version for the dark header over the hero photo. */
    logoWhite: OptionalMedia,
  }).optional(),
  main: z.array(SponsorSchema).default([]),
  sponsors: z.array(SponsorSchema).default([]),
  media: z.array(SponsorSchema).default([]),
  goenner: z.array(z.string().min(1)).default([]),
});
export type Sponsors = z.infer<typeof SponsorsSchema>;

export const AnzapferSchema = z.object({
  list: z.array(
    z
      .object({
        year: z.number().int().min(1900).max(2200),
        name: z.string().trim().optional(),
        /** Instead of a name, e.g. "Keine Hofchilbi (Corona)". */
        note: z.string().trim().optional(),
        photo: OptionalMedia,
      })
      .refine((a) => a.name || a.note, { message: "Name oder Hinweis eingeben", path: ["name"] }),
  ),
});
export type Anzapfer = z.infer<typeof AnzapferSchema>;

/** Milestones on the page Geschichte. `year` is free text ("754", "Heute"). */
export const TimelineSchema = z.object({
  entries: z
    .array(
      z.object({
        year: z.string().trim().min(1).max(12, "Höchstens 12 Zeichen"),
        text: z.string().trim().min(1).max(400, "Höchstens 400 Zeichen"),
        /** Shown as a large highlighted fact instead of a normal entry. */
        highlight: z.boolean().default(false),
      }),
    )
    .default([]),
});
export type Timeline = z.infer<typeof TimelineSchema>;

export const TeamSchema = z.object({
  groupPhoto: OptionalMedia,
  members: z.array(
    z.object({
      name: z.string().min(1),
      role: z.string().min(1),
      photo: OptionalMedia,
    }),
  ),
});
export type Team = z.infer<typeof TeamSchema>;

export const GalleriesSchema = z.object({
  galleries: z.array(
    z.object({
      year: z.number().int(),
      title: z.string().optional(),
      images: z.array(z.object({ src: MediaPath, alt: z.string().optional() })),
    }),
  ),
});
export type Galleries = z.infer<typeof GalleriesSchema>;

/** Button target in a news item: like Link, or a page of this site ("/geschichte", "/#sponsoren"). */
const CtaLink = z.union([Link, z.string().regex(/^\/(?!\/)[A-Za-z0-9/#_-]*$/, "Webadresse (https://…), Seite (/…) oder Datei")]);

export const NewsFrontmatter = z
  .object({
    title: z.string().min(1),
    date: IsoDate,
    image: OptionalMedia,
    imageAlt: z.string().optional(),
    /** Use one of the site-wide buttons (links set on Start) instead of an own label and link. */
    ctaTarget: z.enum(["helfer", "goenner"]).optional(),
    /** Optional call-to-action button below the text. */
    ctaLabel: z.string().trim().max(40, "Höchstens 40 Zeichen").optional(),
    ctaUrl: CtaLink.optional(),
    draft: z.boolean().default(false),
  })
  .refine((n) => !n.ctaLabel || n.ctaUrl, { message: "Wohin soll der Button führen?", path: ["ctaUrl"] })
  .refine((n) => !n.ctaUrl || n.ctaLabel, { message: "Bitte einen Button-Text eingeben.", path: ["ctaLabel"] })
  .refine((n) => !n.ctaTarget || (!n.ctaLabel && !n.ctaUrl), { message: "Entweder ein gemeinsamer oder ein eigener Button.", path: ["ctaTarget"] });
export type NewsMeta = z.infer<typeof NewsFrontmatter>;

export const PageFrontmatter = z.object({
  title: z.string().min(1),
  description: z.string().max(200).optional(),
  /** If set, the page is not rendered: /<page> redirects here (e.g. the KTV Impressum). */
  redirect: z.url({ protocol: /^https?$/ }).optional(),
});
