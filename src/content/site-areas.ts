/** site.yaml feeds several screens of the Redaktion: which one shows a field. */
export function siteArea(path: string): string {
  if (path.startsWith("pageImages.geschichte")) return "Geschichte";
  if (path.startsWith("pageImages.impressionen")) return "Impressionen";
  if (path.startsWith("pageImages.kontakt")) return "Kontakt";
  if (/^(hero|links|helperCta)(\.|$)/.test(path)) return "Start";
  return "Allgemein";
}
