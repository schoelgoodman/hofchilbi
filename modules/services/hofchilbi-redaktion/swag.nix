# Editor vhost: everything behind tinyauth, then the shared key header.
{...}: {
  flake.modules.nixos.hofchilbi-redaktion-swag = {
    config,
    lib,
    ...
  }: let
    cfg = config.neo.services.hofchilbi-redaktion;
    # Neo strips container CSP/X-Frame-Options; without this any site could frame the
    # editor invisibly and trick clicks on «Veröffentlichen» or «Löschen».
    domain = config.neo.services.swag.domain or null;
    neoHost = "${config.neo.services.neo.subdomain or "neo"}.${domain}";
    frames = "frame-ancestors 'self'" + lib.optionalString (domain != null) " https://${neoHost}";
    # Inline styles: Milkdown sets style tags/attributes. blob: for upload previews.
    csp = lib.concatStringsSep "; " [
      "default-src 'self'"
      "script-src 'self'"
      "style-src 'self' 'unsafe-inline'"
      "img-src 'self' data: blob:"
      "font-src 'self' data:"
      "connect-src 'self'"
      "frame-src 'self'"
      "object-src 'none'"
      "base-uri 'self'"
      "form-action 'self'"
      frames
    ];
    svgCsp = "sandbox; default-src 'none'; img-src data:; style-src 'unsafe-inline'; ${frames}";
    # The key lives in a rendered file next to the proxy confs, not in the Nix store.
    withKey = cfg.accessKey != "";
    key = lib.neo.secrets.swagSnippet config "hofchilbi-redaktion-key" ''
      proxy_set_header X-Hofchilbi-Key "${cfg.accessKey}";
    '';
  in {
    config.neo.core.secrets.templates = lib.mkIf (cfg.enabled && withKey) key.templates;

    config.neo.services.hofchilbi-redaktion.proxyConf = lib.mkDefault ''
      map $uri $hofchilbi_redaktion_csp {
        default "${csp}";
        "~*\.svg$" "${svgCsp}";
      }

      server {
        include /config/nginx/listen-https.conf;
        http2 on;
        server_name ${cfg.subdomain}.*;
        include /config/nginx/ssl.conf;
        include /config/nginx/geo-access.conf;
        client_max_body_size 32m;
        add_header Content-Security-Policy $hofchilbi_redaktion_csp always;

        location / {
          ${lib.optionalString (!(cfg.auth.enabled && config.neo.services.tinyauth.enabled)) "return 403;"}
          include /config/nginx/proxy.conf;
          include /config/nginx/resolver.conf;
          # After proxy.conf, same location: a browser cannot supply it, nginx overwrites it.
          ${lib.optionalString withKey key.include}
          set $upstream_app hofchilbi-redaktion;
          set $upstream_port 4330;
          set $upstream_proto http;
          proxy_pass $upstream_proto://$upstream_app:$upstream_port;
          ${lib.neo.authBlock config cfg}
        }
        ${lib.neo.authLocations config cfg}
      }
    '';
  };
}
