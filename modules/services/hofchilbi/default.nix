# Runs the public site. Content and generated HTML live on the appdata volume.
{withSystem, ...}: {
  flake.modules.nixos.hofchilbi = {
    config,
    lib,
    pkgs,
    ...
  }:
    with lib; let
      cfg = config.neo.services.hofchilbi;
      appdata = "${config.neo.core.volumes.appdata}/hofchilbi";
      image = withSystem pkgs.stdenv.hostPlatform.system ({config, ...}: config.packages.hofchilbi-image);
      docker = "${config.virtualisation.docker.package}/bin/docker";
    in {
      config = mkIf cfg.enabled {
        # Loads the Nix-built image into Docker before the container starts. A new build
        # changes this unit, so it runs again on switch; an unchanged tag is skipped.
        systemd.services.hofchilbi-image = {
          description = "Load the Hofchilbi image into Docker";
          after = ["docker.service" "docker.socket"];
          requires = ["docker.service"];
          serviceConfig = {
            Type = "oneshot";
            RemainAfterExit = true;
          };
          script = ''
            if ! ${docker} image inspect ${image.imageRefUnsafe} >/dev/null 2>&1; then
              ${image.copyToDockerDaemon}/bin/copy-to-docker-daemon
            fi
            # Remove old builds. Docker refuses the one still in use; it goes next time.
            ${docker} image ls ${image.imageName} --format '{{.Repository}}:{{.Tag}}' \
              | grep -vxF ${image.imageRefUnsafe} \
              | xargs -r ${docker} rmi 2>/dev/null || true
          '';
        };

        systemd.services.docker-hofchilbi = {
          requires = ["hofchilbi-image.service"];
          after = ["hofchilbi-image.service"];
          preStart = lib.neo.mkEnsureDirs config [
            appdata
            "${appdata}/content"
            "${appdata}/site"
          ];
        };

        virtualisation.oci-containers.containers.hofchilbi = {
          image = cfg.containers.hofchilbi;
          environment = {
            TZ = config.neo.core.timeZone;
            NODE_ENV = "production";
            ROLE = "site";
            CONTENT_DIR = "/content";
            SITE_DIR = "/site";
            SITE_URL = cfg.siteUrl;
            PORT = "4330";
          };
          # Same owner as the preStart dirs, otherwise new files belong to root.
          user = "${toString config.neo.core.uid}:${toString config.neo.core.gid}";
          autoStart = true;
          volumes = [
            "${appdata}/content:/content:ro"
            "${appdata}/site:/site"
          ];
          networks = ["internal"];
          # Hardening: nothing in the image is writable (only the mounted volumes and a small
          # /tmp), no Linux capabilities, no privilege escalation, bounded memory and processes.
          extraOptions = [
            "--read-only"
            "--tmpfs=/tmp:rw,noexec,nosuid,size=512m"
            "--cap-drop=ALL"
            "--security-opt=no-new-privileges"
            "--pids-limit=256"
            "--memory=1g"
          ];
        };
      };
    };
}
