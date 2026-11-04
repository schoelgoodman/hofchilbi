# Hofchilbi Wil: the public website. The editor is the separate service hofchilbi-redaktion.
{withSystem, ...}: {
  flake.modules.nixos.hofchilbi-option = {
    config,
    lib,
    pkgs,
    ...
  }:
    with lib;
    with {inherit (lib.neo) mkOption mkEnableOption;}; let
      image = withSystem pkgs.stdenv.hostPlatform.system ({config, ...}: config.packages.hofchilbi-image);
    in {
      options.neo.services.hofchilbi = mkOption {
        type = types.submodule {
          options =
            {
              enabled = mkEnableOption "Hofchilbi Wil website" {rank = 0;};
              siteUrl = mkOption {
                type = types.str;
                default = "https://www.hofchilbi.ch";
                rank = 5;
                description = ''
                  The address Google should list. Used for canonical links, the sitemap and
                  social previews, even while the site runs on hofchilbi.<domain>. No trailing slash.
                '';
              };
            }
            // neo.mkReverseProxyOptions {
              subdomain = "hofchilbi";
              # Public site. The login belongs to hofchilbi-redaktion.
              auth.available = false;
              # Set customDomains = ["www.hofchilbi.ch" "hofchilbi.ch"] in settings.toml only
              # once DNS points here (go-live), or certificate requests fail.
            }
            // lib.neo.mkContainerDefinitions {
              # Built by this flake, loaded by hofchilbi-image.service. No content inside.
              hofchilbi = image.imageRefUnsafe;
              extraUnits = ["hofchilbi-image"];
            }
            // lib.neo.mkAppdata "${config.neo.core.volumes.appdata}/hofchilbi"
            // lib.neo.mkServiceMeta {
              category = "Other";
              icon = ./icon.svg;
              tagline = "Website of the Hofchilbi Wil festival";
              description = ''
                The public website of Hofchilbi Wil. Editors change content in the
                Hofchilbi Redaktion service, behind tinyauth. Content and images live on
                the appdata volume, not in the image.
              '';
              projectUrl = "https://www.hofchilbi.ch/";
              githubUrl = "https://github.com/schoelgoodman/hofchilbi";
            }
            // lib.neo.mkSkillOptions {};
        };
        default = {};
        description = "Hofchilbi Wil: public website";
      };
    };
}
