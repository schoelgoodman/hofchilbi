# Hermes skill for the Hofchilbi website and editor.
{...}: {
  flake.modules.nixos.hofchilbi-skills = {
    config,
    lib,
    ...
  }: let
    cfg = config.neo.services.hofchilbi;
    domain = config.neo.services.swag.domain or null;
    appdata = "${config.neo.core.volumes.appdata}/hofchilbi";
    redaktion = config.neo.services.hofchilbi-redaktion;
  in {
    config.neo.services.hofchilbi.skill.conf = lib.neo.mkServiceSkill {
      service = "hofchilbi";
      inherit cfg domain;
      description = "Hofchilbi Wil website, Redaktion editor, content";
      tags = ["neo" "hofchilbi" "website"];
      title = "Neo · Hofchilbi Wil";
      body = ''
        ## When to Use
        The Hofchilbi Wil website, its editor (Redaktion), installing or updating the plugin, rebuilding the site.
        Deploy instructions: https://github.com/schoelgoodman/hofchilbi/blob/main/DEPLOY.md

        ## Architecture notes
        - Two containers from one image (`hofchilbi:<nix-hash>`, built by the plugin flake with nix2container, port 4330). Code: https://github.com/schoelgoodman/hofchilbi
          - `hofchilbi` (`ROLE=site`): builds and serves the public site. Content mounted read-only. The only writer of `site/`
          - `hofchilbi-redaktion` (`ROLE=editor`, service `hofchilbi-redaktion`): editor and API, behind tinyauth. Writes `content/` only
        - The image holds code only. Content is never baked in and is not in the GitHub repo
        - `${appdata}/content` → `/content`: content files, uploads and its own `.git` (the only version history)
        - `${appdata}/site` → `/site`: generated HTML, one `build-*` folder per build and the symlink `current` (swapped atomically). Rebuilt on every start
        - Public site: `${cfg.subdomain}.<domain>`${lib.optionalString (cfg.customDomains != []) " and ${lib.concatStringsSep ", " cfg.customDomains}"}
        - Redaktion: `${redaktion.subdomain}.<domain>` (currently ${if redaktion.enabled then "enabled" else "disabled"}). nginx adds the header `X-Hofchilbi-Key` (option `hofchilbi-redaktion.accessKey`) after tinyauth; without it the editor answers 403, without a configured key 503
        - Containers run as `neo.core.uid:gid`; files under appdata must stay owned by that user

        ## Procedures
        1. Health: units `hofchilbi-image`, `docker-hofchilbi`, `docker-hofchilbi-redaktion`; logs via `docker logs hofchilbi --tail 100` / `docker logs hofchilbi-redaktion --tail 100`
        2. Code update: update the plugin input in Neo and Activate. `hofchilbi-image.service` loads the new image, then the containers restart
        3. Full rebuild of the site: restart `docker-hofchilbi`
        4. Content history: `git -C ${appdata}/content log --oneline`

        ## Pitfalls
        - The image comes from Nix, not a registry. If `docker-hofchilbi` fails with a missing image, check `systemctl status hofchilbi-image` first
        - Never add `${redaktion.subdomain}.<domain>` as a custom domain
        - Add `www.hofchilbi.ch` / `hofchilbi.ch` as custom domains only after DNS points to this server, otherwise certificate requests fail
        - Go-live follows the checklist in DEPLOY.md section 5, step by step. Never cancel or disconnect Webflow unless the operator says the gate in 5.7 is met
        - Never delete `content/.git` and never clear appdata without explicit confirmation from the operator
        - Do not hand-edit content while the Redaktion is in use

        ## Verification
        - `GET https://${cfg.subdomain}.<domain>/` returns 200 without login; `/health` returns `ok`
        - `https://${redaktion.subdomain}.<domain>/` redirects to tinyauth
        - `docker exec swag curl -s -o /dev/null -w '%{http_code}' http://hofchilbi-redaktion:4330/` returns 403
        - `docker logs swag 2>&1 | grep emerg` is empty
      '';
    };
  };
}
