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

## 5. Go-live (only on explicit instruction)

When the operator confirms DNS for `hofchilbi.ch` points to this server:
`[services.hofchilbi] customDomains = ["www.hofchilbi.ch", "hofchilbi.ch"]`, Activate, then
check that `https://www.hofchilbi.ch/` serves the site and `http://hofchilbi.ch` redirects to https.
