/** Where the site answers with a redirect instead of a page. Pure, so it can be unit tested. */

/**
 * Host as the visitor sent it. A custom domain passes two nginx hops on Neo, and the second one
 * overwrites X-Forwarded-Host with the service's own name, so its swag.nix hands the first value on
 * as X-Original-Host. A forged value is harmless: it only changes what its own sender gets to see.
 */
export function requestHost(headers: Record<string, string | string[] | undefined>): string {
  const value = headers["x-original-host"] ?? headers["x-forwarded-host"] ?? headers.host ?? "";
  return String(value).split(",")[0]!.trim().toLowerCase();
}

/**
 * hofchilbi.ch → www.hofchilbi.ch, as Webflow did. Only the bare form of the canonical host:
 * hofchilbi.<domain> keeps working as the (noindex) address on the server.
 */
export function canonicalRedirect(host: string, siteUrl: string, pathAndQuery: string): string | null {
  const canonical = new URL(siteUrl);
  if (!canonical.host.startsWith("www.") || host.toLowerCase() !== canonical.host.slice(4)) return null;
  return canonical.origin + pathAndQuery;
}

/**
 * /kontakt/?a=1 → /kontakt?a=1, or null if there is nothing to strip. Leading slashes collapse too:
 * "//evil.com/" must never become "Location: //evil.com".
 */
export function withoutTrailingSlash(pathname: string, search: string): string | null {
  if (pathname.length <= 1 || !pathname.endsWith("/")) return null;
  return "/" + pathname.replace(/^[/\\]+|\/+$/g, "") + search;
}
