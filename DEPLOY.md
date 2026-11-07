# Deploy on Neo

Instructions for Hermes on the home server. Two parts: the plugin and the content.
Content is **never** in the GitHub repo. Only touch it when the operator explicitly asks.

Repo: `github.com/schoelgoodman/hofchilbi` (public, no token needed).

## 1. Install the plugin (first time)

1. Neo web → **Settings → System → Plugins** → add `github:schoelgoodman/hofchilbi`. Save.
2. **Services → Hofchilbi Wil**: enable. Leave `customDomains` empty for now.
3. **Services → Hofchilbi Redaktion**: enable, press **Generate** for `accessKey`.
4. Make sure **tinyauth** is enabled and has at least one user. If the operator names an editor
   user, limit it: `[services.tinyauth.access.<user>] allow = ["hofchilbi-redaktion"]`.
5. Save → **Activate**. The first activate builds the image with Nix (a few minutes, no `docker build`).

On first start the services create:

```
<appdata>/hofchilbi/content   ← content, uploads, own git history (empty for now)
<appdata>/hofchilbi/site      ← generated HTML (build-* folders + symlink current)
```

`<appdata>` is `neo.core.volumes.appdata` (default `/var/neo/DATA/AppData`). Look it up, don't guess.

## 2. Verify (report every result to the operator)

```sh
systemctl is-active hofchilbi-image docker-hofchilbi docker-hofchilbi-redaktion
docker logs hofchilbi --tail 20            # expect "Site: built" and "site: listening on :4330"
docker logs hofchilbi-redaktion --tail 20  # expect "editor: listening on :4330"
docker exec swag curl -s http://hofchilbi:4330/health                                        # ok
docker exec swag curl -s -o /dev/null -w '%{http_code}\n' http://hofchilbi-redaktion:4330/   # 403
docker logs swag 2>&1 | grep emerg                                                           # empty
```

From a browser:
- `https://hofchilbi.<domain>/` → placeholder page "Hofchilbi Wil – Neue Website im Aufbau", no login.
- `https://chilbiredaktion.<domain>/` → tinyauth login, then the Redaktion (menu: Allgemein, then Start,
  Geschichte, Impressionen, Kontakt with their subcategories, Impressum, Datenschutz, Medien, Verlauf).

If something fails: send the operator the failing command, its output and
`journalctl -u hofchilbi-image -u docker-hofchilbi -u docker-hofchilbi-redaktion -n 80`.
Do not change code, delete appdata or edit nginx confs by hand.

Shortcut to the login: `curl -sI https://hofchilbi.<domain>/redaktion` → `302`, `location:` the
Redaktion address. No Neo setting needed, the address comes from the service settings.

Redaktion health (after content is installed):
- `docker logs hofchilbi-redaktion --tail 20` → `editor: listening on :4330`, no errors.
- `git -C <appdata>/hofchilbi/content log --oneline | head -3` → at least one entry.
  This git is the only version history of the content. Never delete `content/.git`. The editor removes
  entries older than 3 months by itself (the newest 30 always stay), that is expected.

Security headers:

```sh
curl -sI https://hofchilbi.<domain>/ | grep -i content-security            # one CSP line, frame-ancestors with neo.<domain>
SVG=$(curl -s https://hofchilbi.<domain>/ | grep -o '/_assets/skyline-white-[a-f0-9]*\.svg' | head -1)
curl -sI "https://hofchilbi.<domain>$SVG" | grep -i content-security       # must contain "sandbox"
```

## 3. Code updates

Neo → **Update** (or update only the plugin input) → **Activate**. Nothing else.

## 4. Content

Only when the operator says that new content was uploaded to `<appdata>/hofchilbi/content.incoming`
(they run `scripts/push-content.sh` from their Mac; content never comes from GitHub).

### First install (live `content/` is empty or has no `site.yaml`)

```sh
A=<appdata>/hofchilbi
ls "$A/content.incoming/site.yaml"                 # must exist, else stop and tell the operator
systemctl stop docker-hofchilbi-redaktion docker-hofchilbi
[ -z "$(ls -A "$A/content")" ] || mv "$A/content" "$A/content.old-$(date +%F-%H%M)"
mkdir -p "$A/content"
cp -a "$A/content.incoming/." "$A/content/"
chown -R --reference="$A/site" "$A/content"
chmod -R u+rwX,go-w "$A/content"
rm -rf "$A/content.incoming"
systemctl start docker-hofchilbi docker-hofchilbi-redaktion
docker logs hofchilbi --tail 20     # expect "Site: built in … ms" (first build ~15 s: images are encoded)
```

Then check `https://hofchilbi.<domain>/`, `/geschichte`, `/impressionen`, `/kontakt` all show the
real site (not "Neue Website im Aufbau") and report to the operator.

If the log says `content invalid`: the old site stays online. Send the operator the log lines.

### Content already exists (editors have worked in the Redaktion)

Do **not** replace it. Stop and ask the operator: the editors' changes would be lost.
`content.incoming` stays untouched until the operator decides.

## 4b. Immich galleries (only when the operator asks)

1. The operator creates the API key in Immich (Account settings → API keys, permissions
   `album.read`, `asset.read`, `asset.view`) and enters it in Neo: **Services → Hofchilbi
   Redaktion → immichApiKey**. Never ask for the key in chat or write it into a file.
2. Save → **Activate**.
3. Verify:

```sh
docker exec hofchilbi-redaktion node -e "fetch('http://immich-server:2283/api/server/ping').then(r=>r.text()).then(console.log)"   # {"res":"pong"}
sleep 60; docker logs hofchilbi-redaktion 2>&1 | grep -i immich     # no "Immich sync:" errors
ls <appdata>/hofchilbi/content/media/immich/                          # one folder per year
docker logs hofchilbi --tail 5                                        # "Site: built in …" (first build with all photos can take several minutes)
```

Then `https://hofchilbi.<domain>/impressionen` shows one card per year. Report the years and photo
counts (editor → Galerien) to the operator.

## 5. Go-live (only on explicit instruction)

Checklist for moving `hofchilbi.ch` from Webflow to Neo. Work from top to bottom. Hermes only does
the steps marked **Hermes**, and only when the operator says so. Everything else is for the operator.

**Do not forget** (details below):
1. Search Console: know who owns the property, and add DNS verification before the switch (5.2).
2. Webflow links: replace the old Gönner PDF link wherever it was shared, before cancelling (5.2).
3. Do not cancel Webflow until every point of the gate in 5.7 is met.

DNS as of 2026-11-07, at Hostpoint. These are also the values for going back:

| Name | Type | TTL | Value | At the switch |
|---|---|---|---|---|
| `hofchilbi.ch` | A | 300 | `198.202.211.1` (Webflow) | **change** |
| `www.hofchilbi.ch` | CNAME | 300 | `cdn.webflow.com` | **change** |
| `hofchilbi.ch` | MX | 3600 | `mx1.mail.hostpoint.ch`, `mx2.mail.hostpoint.ch` | keep |
| `autodiscover.hofchilbi.ch` | CNAME | 300 | `autoconfig-nonssl.mail.hostpoint.ch` | keep |

### 5.1 Before the switch: blockers

- [ ] **Real host reaches the app (Hermes).** A custom domain goes through two nginx hops, and the
  second one overwrites `X-Forwarded-Host`. The vhost hands the original on as `X-Original-Host`;
  without it `www.hofchilbi.ch` tells Google `noindex` and `Disallow: /`, and the bare domain does not
  redirect. After Update and Activate with the latest code, this must print `Allow: /` and the
  `Sitemap:` line:
  ```sh
  docker exec swag curl -sk --resolve hofchilbi.<domain>:443:127.0.0.1 -H 'X-Forwarded-Host: www.hofchilbi.ch' https://hofchilbi.<domain>/robots.txt
  ```
- [ ] **Googlebot is not geo-blocked (Hermes).** No country whitelist; the US and North America are
  not blocked. Blocked visitors get a 404.
- [ ] **Public access (Hermes).** The service's "Reachable from" includes Internet. Report the public
  address from `dig @1.1.1.1 hofchilbi.<domain>`, whether it is fixed, and whether traffic comes
  through a remote streamproxy/rathole.

### 5.2 Before the switch: content and accounts

- [ ] Latest code is deployed and `https://hofchilbi.<domain>/` is checked on a phone, every page.
- [ ] No test news. Impressionen has photos. Impressum and Datenschutz are final. Website-Check is empty.
- [ ] Gönner link and Helfer link work, and the Gönner letter is the current one.
- [ ] **Google Search Console:** the new start page keeps the same `google-site-verification` tag as
  Webflow, so the existing property stays verified (checked in 5.4). Still to do by hand:
  - Find out who owns that property and get access. If nobody can, the tag alone does not help.
  - Add a Domain property for `hofchilbi.ch`, verified with a TXT record at Hostpoint. It keeps working
    whatever happens to the page, and also covers `hofchilbi.ch` without `www`.
- [ ] **Webflow settings:** note any 301 redirects and form settings, and export or save what you want
  to keep. Do not cancel anything yet.
- [ ] **Webflow links:** the only document the live site links on Webflow's CDN is the Gönner letter:
  `https://cdn.prod.website-files.com/6626d269cdb7984611fc90dc/69e90f18f623d1ef99044afb_Brief%20Hofchilbi_Go%CC%88nner_2026.pdf`
  It may stop working once Webflow is cancelled. Look for it in the Instagram bio and posts, Facebook, the
  KTV website, sponsor and Gönner mails, QR codes and print. Replacement, working from the switch on:
  `https://www.hofchilbi.ch/media/dokumente/goenner-brief.pdf`
  Note here what cannot be changed, such as printed QR codes, and tell the operator before 5.7.
- [ ] **Webflow links in the content (Hermes):** `grep -rIl website-files <appdata>/hofchilbi/content --exclude-dir=.git --exclude-dir=media`
  prints nothing. If it prints files, tell the operator: those links must be replaced in the Redaktion.
- [ ] **Backup (Hermes):** copy `<appdata>/hofchilbi/content`, including `.git`, and report where.
- [ ] Pick a quiet time. Have the Hostpoint, Neo and Webflow logins ready.

### 5.3 The switch (in one sitting)

Certificates can only be issued once DNS points here, so the site shows a certificate error for a few
minutes. Browsers cannot click past it, because `www.hofchilbi.ch` already sends HSTS.

1. [ ] **Hostpoint:** set `hofchilbi.ch` A to the public address from 5.1. It must stay an A record
   because of the MX records. Point `www.hofchilbi.ch` to the same place. Leave MX and `autodiscover` alone.
2. [ ] **Wait until both names resolve publicly.** Do not continue before that:
   ```sh
   for r in 1.1.1.1 8.8.8.8; do dig +short @$r hofchilbi.ch; dig +short @$r www.hofchilbi.ch; done
   ```
3. [ ] **Hermes:** set `[services.hofchilbi] customDomains = ["www.hofchilbi.ch", "hofchilbi.ch"]`
   and Activate. With a remote streamproxy, the same two domains are needed on its entry. Never add
   the editor subdomain.
4. [ ] **Hermes:** watch `docker logs swag`. **Activate only once:** all Neo domains share one
   certificate, so a failed request can stop SWAG and every Neo app with it, and repeated failures
   hit Let's Encrypt limits. If it fails, send the log to the operator and go to 5.6.

### 5.4 Right after the switch

Test on mobile data, not home Wi-Fi: Pi-hole answers these names locally, so home tests prove nothing.

```sh
curl -sI https://www.hofchilbi.ch/ | grep -iE '^HTTP|x-robots'      # 200, NO x-robots-tag line
curl -s https://www.hofchilbi.ch/robots.txt                         # Allow: / and the Sitemap line
curl -s https://www.hofchilbi.ch/sitemap.xml | grep -c '<loc>https://www.hofchilbi.ch'   # number of pages, not 0
curl -s https://www.hofchilbi.ch/kontakt | grep -i canonical        # https://www.hofchilbi.ch/kontakt
curl -sI https://hofchilbi.ch/kontakt | grep -iE '^HTTP|location'   # 301, https://www.hofchilbi.ch/kontakt
curl -sI http://hofchilbi.ch/ | grep -iE '^HTTP|location'           # redirect to https
curl -sI https://hofchilbi.<domain>/ | grep -i x-robots             # noindex (the test address stays hidden)
curl -s https://www.hofchilbi.ch/ | grep -c google-site-verification   # 1 (Search Console stays verified)
curl -sI https://www.hofchilbi.ch/media/dokumente/goenner-brief.pdf | grep -i '^HTTP'   # 200, new link for the Gönner letter
dig +short hofchilbi.ch MX                                          # still both Hostpoint servers
```

- [ ] All of the above match.
- [ ] Certificate is valid on `www.hofchilbi.ch` and `hofchilbi.ch`, with no browser warning.
- [ ] **Hermes:** other Neo apps still open, and `docker logs swag 2>&1 | grep emerg` is empty.
- [ ] Every page looks right on a phone. Gönner PDF, Helfer form, sponsor links and images work.
- [ ] Redaktion: login works. Save a small change and it appears on `www`, then undo it.
- [ ] `https://www.hofchilbi.ch/redaktion` forwards to the login.
- [ ] Mail to a `hofchilbi.ch` address still arrives, if any address is in use.

### 5.5 The same day

- [ ] Search Console: the property is still verified. Submit `https://www.hofchilbi.ch/sitemap.xml`,
  inspect `/` and request indexing.
- [ ] Replace the old Gönner PDF link everywhere it was found in 5.2.
- [ ] Google Rich Results Test on `/`: the Event is recognised.
- [ ] PageSpeed Insights on mobile: note the result, now that the site runs from home instead of a CDN.
- [ ] Share `https://www.hofchilbi.ch/` in WhatsApp and Facebook: picture and text are right.

### 5.6 Going back

Keep Webflow paid and connected until 5.7. To go back: restore the A and CNAME values from the table
above, then **Hermes** removes `customDomains` and Activates. If SWAG is down, tell the operator
right away, because all Neo apps are affected. If Webflow no longer serves the domain, reconnect it
in Webflow's domain settings.

### 5.7 Later

- [ ] After a week: Search Console shows the pages indexed from the new site, with no spike in errors.
- [ ] **Gate for cancelling Webflow.** Only when the operator decides, after about two weeks, and only
  if all of these are met:
  - Search Console: access confirmed, Domain property verified, pages indexed.
  - Old Gönner PDF link replaced everywhere, and the operator knows about anything that cannot be changed.
  - Webflow settings and exports from 5.2 saved.
  - The renewal date is checked, so the cancellation does not fall right after a paid renewal.
- [ ] After about 60–90 days: certificate renewal has worked for `hofchilbi.ch` (check its expiry date).
