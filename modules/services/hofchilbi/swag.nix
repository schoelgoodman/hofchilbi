# Public site vhost. The editor has its own name (hofchilbi-redaktion/swag.nix).
{...}: {
  flake.modules.nixos.hofchilbi-swag = {
    config,
    lib,
    ...
  }: let
    cfg = config.neo.services.hofchilbi;
    # Neo strips container CSP (iframe support for its UI), so nginx sets it.
    # The Neo UI may embed the site, other sites may not.
    domain = config.neo.services.swag.domain or null;
    neoHost = "${config.neo.services.neo.subdomain or "neo"}.${domain}";
    frames = "frame-ancestors 'self'" + lib.optionalString (domain != null) " https://${neoHost}";
    csp = lib.concatStringsSep "; " [
      "default-src 'self'"
      "script-src 'self'"
      "style-src 'self'"
      "img-src 'self' data:"
      "font-src 'self'"
      "connect-src 'self'"
      "frame-src https://www.google.com https://www.openstreetmap.org"
      "object-src 'none'"
      "base-uri 'self'"
      "form-action 'self'"
      frames
    ];
    svgCsp = "sandbox; default-src 'none'; img-src data:; style-src 'unsafe-inline'; ${frames}";
  in {
    config.neo.services.hofchilbi.proxyConf = lib.mkDefault ''
      map $uri $hofchilbi_csp {
        default "${csp}";
        "~*\.svg$" "${svgCsp}";
      }

      server {
        include /config/nginx/listen-https.conf;
        http2 on;
        server_name ${cfg.subdomain}.*;
        include /config/nginx/ssl.conf;
        include /config/nginx/geo-access.conf;
        client_max_body_size 1m;
        # At server level so it adds to the headers from ssl.conf (HSTS) instead of replacing them.
        add_header Content-Security-Policy $hofchilbi_csp always;

        location /api/ { return 404; }

        location / {
          include /config/nginx/proxy.conf;
          include /config/nginx/resolver.conf;
          set $upstream_app hofchilbi;
          set $upstream_port 4330;
          set $upstream_proto http;
          proxy_pass $upstream_proto://$upstream_app:$upstream_port;
        }
      }
    '';
  };
}
