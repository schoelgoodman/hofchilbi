# The editor runs as its own container from the hofchilbi image. It writes content/ and its
# git history only; the site container renders site/. So only one process writes site/.
{...}: {
  flake.modules.nixos.hofchilbi-redaktion = {
    config,
    lib,
    ...
  }:
    with lib; let
      cfg = config.neo.services.hofchilbi-redaktion;
      site = config.neo.services.hofchilbi;
      appdata = "${config.neo.core.volumes.appdata}/hofchilbi";
      domain = config.neo.services.swag.domain or null;
    in {
      config = mkIf cfg.enabled {
        assertions = [
          {
            assertion = site.enabled;
            message = "neo.services.hofchilbi-redaktion needs neo.services.hofchilbi. Enable the Hofchilbi Wil service.";
          }
          {
            # It sits inside quotes in an nginx line. «Generate» yields hex.
            assertion = lib.neo.secrets.isPlaceholder cfg.accessKey || builtins.match "[A-Za-z0-9_-]*" cfg.accessKey != null;
            message = "neo.services.hofchilbi-redaktion.accessKey: letters, digits, - and _ only. Easiest: «Generate».";
          }
        ];

        # The key reaches the container via a file, not the unit (Nix store). Only the editor
        # needs it; the site notices saves via content/.version and needs no secret.
        neo.core.secrets.containerEnv.hofchilbi-redaktion = mkIf (cfg.accessKey != "") {
          HOFCHILBI_KEY = cfg.accessKey;
        };

        # Wants instead of Requires: restarting hofchilbi-image does not restart the editor.
        systemd.services.docker-hofchilbi-redaktion = {
          wants = ["hofchilbi-image.service"];
          after = ["hofchilbi-image.service"];
          preStart = lib.neo.mkEnsureDirs config [
            appdata
            "${appdata}/content"
            "${appdata}/site"
          ];
        };

        virtualisation.oci-containers.containers.hofchilbi-redaktion = {
          image = cfg.containers.hofchilbi-redaktion;
          environment = {
            TZ = config.neo.core.timeZone;
            NODE_ENV = "production";
            ROLE = "editor";
            CONTENT_DIR = "/content";
            SITE_DIR = "/site";
            SITE_URL = site.siteUrl;
            # «Website ansehen» in the editor.
            PUBLIC_URL = optionalString (domain != null) "https://${site.subdomain}.${domain}";
            PORT = "4330";
          };
          user = "${toString config.neo.core.uid}:${toString config.neo.core.gid}";
          autoStart = true;
          volumes = [
            "${appdata}/content:/content"
            # Read only: rendered images and fonts for the preview.
            "${appdata}/site:/site:ro"
          ];
          networks = ["internal"];
        };
      };
    };
}
