# Hofchilbi Redaktion: the editor as its own service with its own subdomain (so SWAG gets a
# certificate for it) and its own container from the hofchilbi image.
{withSystem, ...}: {
  flake.modules.nixos.hofchilbi-redaktion-option = {
    config,
    lib,
    pkgs,
    ...
  }:
    with lib;
    with {inherit (lib.neo) mkOption mkEnableOption;}; let
      image = withSystem pkgs.stdenv.hostPlatform.system ({config, ...}: config.packages.hofchilbi-image);
    in {
      options.neo.services.hofchilbi-redaktion = mkOption {
        type = types.submodule {
          options =
            {
              enabled = mkEnableOption "Hofchilbi Redaktion" {rank = 0;};
              # nginx sends it after tinyauth; the editor only accepts requests carrying it.
              # So no other container on `internal` can reach the API around the login.
              accessKey = lib.neo.mkSecretOption {
                default = "";
                rank = 5;
                helper = lib.neo.helpers.randomToken;
                description = ''
                  Secret between SWAG and the editor. Press «Generate» once, then Apply.
                  Empty: the editor stays locked (503); the public site runs normally.
                '';
              };
            }
            // neo.mkReverseProxyOptions {
              # Lowercase a-z only and unique across services (advocat-heft already uses "redaktion").
              subdomain = "chilbiredaktion";
              auth.enabled = true;
            }
            // lib.neo.mkContainerDefinitions {
              # Same image as hofchilbi, loaded by hofchilbi-image.service. That unit belongs to
              # hofchilbi: if it were listed here too, stopping the editor would stop the site.
              hofchilbi-redaktion = image.imageRefUnsafe;
            }
            // lib.neo.mkServiceMeta {
              category = "Other";
              icon = ../hofchilbi/icon.svg;
              tagline = "Editor for the Hofchilbi Wil website";
              description = ''
                Where editors change the Hofchilbi Wil website, behind tinyauth.
                Needs the Hofchilbi Wil service. Own container from the same image:
                stopping the editor leaves the public site online.
              '';
              projectUrl = "https://www.hofchilbi.ch/";
              githubUrl = "https://github.com/schoelgoodman/hofchilbi";
            };
        };
        default = {};
        description = "Hofchilbi Wil: editor";
      };
    };
}
