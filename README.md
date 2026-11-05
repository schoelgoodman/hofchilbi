# hofchilbi

Website for the legendary Hofchilbi Wil hosted by KTV Wil Handball, plus a simple editor
("Redaktion") for non-technical editors. Runs as a [Neo](https://github.com/madebydamo/neo) plugin.

**Content is not in this repo.** Texts, images and their history live on the server
(`/var/neo/DATA/AppData/hofchilbi/content`, its own git). Locally: the gitignored `dev-content/`.

## Local development

Node 24 locally (`.nvmrc`); production runs compiled JS on Node 22.

```sh
npm install
npm run import     # one-time: copy the live Webflow site into dev-content/ (gitignored)
npm run dev        # site on :4330 (rebuilds on change), editor on :4331 (open locally, no key)
npm test           # unit tests (node --test, native TS)
npm run typecheck
npm run build      # tsc → dist/
```

## Install on Neo

1. In Neo: Settings → System → Plugins → add `github:schoelgoodman/hofchilbi` (or in `settings.toml`):

   ```toml
   [core]
   plugins = ["github:schoelgoodman/hofchilbi"]

   [services.hofchilbi]
   enabled = true

   [services.hofchilbi-redaktion]
   enabled = true
   # accessKey: press «Generate» in the UI (stored as a secret, not in settings.toml)
   ```

2. Make sure TinyAuth is enabled and has the editor user. Optionally limit that user to the editor:
   `[services.tinyauth.access.<user>] allow = ["hofchilbi-redaktion"]`.
3. Save → Activate.

Check:

| URL | Expected |
|---|---|
| `https://hofchilbi.<domain>/` | public site, no login |
| `https://chilbiredaktion.<domain>/` | TinyAuth login, then the editor |
| `docker exec swag curl -s -o /dev/null -w '%{http_code}' http://hofchilbi-redaktion:4330/` | `403` (no key → no bypass of the login) |
| `docker logs swag 2>&1 \| grep emerg` | empty |

Code updates: push to GitHub, then Neo → Update → Activate. The image is built by Nix on the
server (not pulled from a registry).

**Impressionen from Immich (optional):** every Immich album named `Hofchilbi <year>` becomes a
gallery with all its photos. The editor fetches them (never the public site) every 30 minutes and
on «Jetzt abgleichen». Create an Immich API key with the permissions `album.read`, `asset.read`,
`asset.view` and set it as `immichApiKey` («Hofchilbi Redaktion» service; stored as a secret).
`immichUrl` defaults to Neo's Immich (`http://immich-server:2283`, internal network),
`immichSyncMinutes` to 30. Synced photos live in `content/media/immich/` (not in the history);
without a key, galleries are edited by hand as before. Local test: set `IMMICH_URL`,
`IMMICH_API_KEY` (and optionally `IMMICH_SYNC_MINUTES`) for `npm run dev`.

**Content to the server:** `scripts/push-content.sh <ssh-host>` uploads `dev-content/` to
`<appdata>/hofchilbi/content.incoming`; Hermes swaps it in (DEPLOY.md §4). Never via GitHub.

**Custom domain:** only at go-live, once DNS for `hofchilbi.ch` points to the server:
`[services.hofchilbi] customDomains = ["www.hofchilbi.ch", "hofchilbi.ch"]`.
Never add the editor subdomain as a custom domain.

## Layout

```
src/server/      HTTP server (roles: site | editor), access checks, static files
src/content/     content schema (zod) and loader: site/sponsors/anzapfer/team/galleries YAML, news + pages Markdown
src/render/      site generator: pages, layout, images (sharp → WebP, cached), Markdown;
                 builds into site/build-*/ and swaps site/current atomically
src/design/      CSS, JS, SVG theme assets (font: Archivo, OFL, from @fontsource-variable/archivo)
scripts/         import-webflow.ts (one-time migration), push-content.sh
modules/         Neo plugin (Nix): packages/ = image, services/hofchilbi* = containers + nginx
```

After changing `package-lock.json`, update `npmDepsHash` in `modules/packages/hofchilbi.nix`:
`nix run nixpkgs#prefetch-npm-deps -- package-lock.json`.
