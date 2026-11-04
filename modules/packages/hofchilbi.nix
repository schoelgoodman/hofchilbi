# The server (site + editor) as a package and as an OCI image built with nix2container.
# The image tag is the Nix hash of the image: every change gets a new tag.
{inputs, ...}: {
  perSystem = {
    pkgs,
    system,
    ...
  }: let
    n2c = inputs.nix2container.packages.${system}.nix2container;
    nodejs = pkgs.nodejs_22;

    # Only source goes in. Content (dev-content/) is never part of the build.
    app = pkgs.buildNpmPackage {
      pname = "hofchilbi";
      version = "0.1.0";
      inherit nodejs;
      src = pkgs.lib.fileset.toSource {
        root = ../..;
        fileset = pkgs.lib.fileset.unions [
          ../../package.json
          ../../package-lock.json
          ../../tsconfig.json
          ../../src
        ];
      };
      # After every change to package-lock.json: nix run nixpkgs#prefetch-npm-deps -- package-lock.json
      npmDepsHash = "sha256-nnzHPaZ+xLmZ2DTiuOfDfVYMTpE8ZBchatLxwEP5+3s=";
      npmBuildScript = "build";
      installPhase = ''
        runHook preInstall
        npm prune --omit=dev --no-audit --no-fund
        mkdir -p $out
        cp -r package.json dist $out/
        # Present once there are runtime dependencies (sharp etc.).
        if [ -d node_modules ]; then cp -r node_modules $out/; fi
        runHook postInstall
      '';
    };

    # Runtime tools: node, git (content history), CA certs, libstdc++ for prebuilt sharp.
    tools = pkgs.buildEnv {
      name = "hofchilbi-tools";
      paths = with pkgs; [nodejs git cacert coreutils stdenv.cc.cc.lib];
      pathsToLink = ["/bin" "/etc" "/lib"];
    };

    root = pkgs.runCommand "hofchilbi-root" {} ''
      mkdir -p $out/tmp
      ln -s ${app} $out/app
    '';

    image = n2c.buildImage {
      name = "hofchilbi";
      copyToRoot = [tools root];
      # Tools change rarely: own layer, separate from the code.
      layers = [(n2c.buildLayer {deps = [tools];})];
      perms = [
        {
          path = root;
          regex = "/tmp";
          mode = "1777";
        }
      ];
      config = {
        Cmd = ["node" "dist/server/index.js"];
        WorkingDir = "/app";
        Env = [
          "PATH=/bin"
          "HOME=/tmp"
          "LD_LIBRARY_PATH=/lib"
          "SSL_CERT_FILE=/etc/ssl/certs/ca-bundle.crt"
          "NODE_ENV=production"
          "CONTENT_DIR=/content"
          "SITE_DIR=/site"
          "PORT=4330"
        ];
        ExposedPorts = {"4330/tcp" = {};};
      };
    };
  in {
    packages = {
      hofchilbi = app;
      hofchilbi-image = image;
    };
  };
}
