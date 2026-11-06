import { eventLabel } from "../content/load.ts";

/**
 * Website-Check: what an editor should look at, mostly because of the time of year. The forms
 * already refuse what is plainly wrong, so this only covers what a save cannot catch. Pure:
 * everything comes in as arguments, including today.
 */

export interface Finding {
  id: string;
  title: string;
  detail: string;
  /** Editor screen that fixes it, e.g. "allgemein" or "news/<slug>". */
  route: string;
  action: string;
}

export interface CheckInput {
  site: unknown;
  anzapfer: unknown;
  news: { slug: string; meta: unknown }[];
  impressum: { meta: unknown; body: string } | undefined;
  immichError: string | undefined;
  /** YYYY-MM-DD */
  today: string;
}

/** Today where the Hofchilbi takes place, whatever the server's time zone is. */
export function swissToday(now = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Zurich" }).format(now);
}

export function siteChecks(input: CheckInput): Finding[] {
  const out: Finding[] = [];
  const site = input.site as { event?: { days?: string[]; label?: string } } | null;
  const days = [...(site?.event?.days ?? [])].sort();
  const lastDay = days.at(-1);

  // Without site.yaml there is no website yet: nothing to check.
  if (!site || !lastDay) return out;

  const over = lastDay < input.today;
  // An own wording like «Juli 2028 – Datum folgt» is the answer to this.
  if (over && !site.event?.label) {
    out.push({
      id: "event-over",
      title: "Das Festdatum ist vorbei",
      detail: `Die Website zeigt noch «${eventLabel(days)}» als nächstes Fest. Das neue Datum eintragen oder, solange es noch nicht feststeht, das Datum anders schreiben.`,
      route: "allgemein",
      action: "Zu Allgemein",
    });
  }

  // Before the festival the Anzapfer of last year should be there, after it the one of this year.
  const year = Number(lastDay.slice(0, 4)) - (over ? 0 : 1);
  const anzapfer = (input.anzapfer as { list?: { year?: number }[] } | null)?.list ?? [];
  if (!anzapfer.some((a) => Number(a.year) === year)) {
    out.push({
      id: "anzapfer-missing",
      title: `Anzapfer ${year} fehlt`,
      detail: `Für ${year} gibt es noch keinen Eintrag. Falls die Hofchilbi ausgefallen ist, einen Hinweis statt eines Namens eintragen.`,
      route: "anzapfer",
      action: "Zu den Anzapfern",
    });
  }

  const impressum = input.impressum;
  if (!impressum?.body.trim() && !(impressum?.meta as { redirect?: string } | undefined)?.redirect) {
    out.push({
      id: "impressum-missing",
      title: "Das Impressum fehlt",
      detail: "Solange es leer ist, gibt es auf der Website weder die Seite noch den Link dazu in der Fusszeile.",
      route: "impressum",
      action: "Zum Impressum",
    });
  }

  for (const { slug, meta } of input.news) {
    const n = meta as { title?: string; image?: string; imageAlt?: string; draft?: boolean };
    if (n.draft || !n.image || n.imageAlt?.trim()) continue;
    out.push({
      id: `news-alt-${slug}`,
      title: `Bild ohne Beschreibung: ${n.title ?? slug}`,
      detail: "Google und blinde Menschen erfahren nicht, was auf dem Bild dieser News zu sehen ist.",
      route: `news/${slug}`,
      action: "Zur News",
    });
  }

  if (input.immichError) {
    out.push({
      id: "immich-error",
      title: "Die Fotos aus Immich wurden nicht aktualisiert",
      detail: `Auf der Website bleiben die zuletzt geholten Fotos. Meldung: ${input.immichError}`,
      route: "galerien",
      action: "Zu den Galerien",
    });
  }
  return out;
}
