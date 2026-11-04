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
- `https://chilbiredaktion.<domain>/` → tinyauth login, then "Hofchilbi Redaktion".

If something fails: send the operator the failing command, its output and
`journalctl -u hofchilbi-image -u docker-hofchilbi -u docker-hofchilbi-redaktion -n 80`.
Do not change code, delete appdata or edit nginx confs by hand.

## 3. Code updates

Neo → **Update** (or update only the plugin input) → **Activate**. Nothing else.

## 4. Content

Not yet. Instructions follow when the first content import is ready.

## 5. Go-live (only on explicit instruction)

When the operator confirms DNS for `hofchilbi.ch` points to this server:
`[services.hofchilbi] customDomains = ["www.hofchilbi.ch", "hofchilbi.ch"]`, Activate, then
check that `https://www.hofchilbi.ch/` serves the site and `http://hofchilbi.ch` redirects to https.
