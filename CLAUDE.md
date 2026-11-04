# hofchilbi: notes for Claude

Website + editor for Hofchilbi Wil, replacing Webflow. Neo plugin (NixOS flake). Blueprint was
github.com/schoelgoodman/advocat-heft: same architecture, with its known weak spots fixed.

## Rules
- **No content in this repo.** Content lives in `CONTENT_DIR` (`dev-content/` locally, gitignored).
  Never commit real content, uploads or content bundles; never attach them to GitHub releases.
- UI and site text: German (Swiss, no ß). Code, comments, commits: English.
- TypeScript with erasable syntax only (no enums/namespaces): dev runs `.ts` directly on Node 24,
  production runs `tsc` output on Node 22. Relative imports use `.ts` extensions.
- Every secret: `lib.neo.mkSecretOption` + `neo.core.secrets.containerEnv` / `swagSnippet`.
  Never a plain option or `environment`.
- CSP is set in `modules/services/*/swag.nix` (Neo strips container CSP).
- After changing `package-lock.json`, update `npmDepsHash` (see README).
- Neo subdomains: lowercase `a-z` only, unique (`hofchilbi`, `chilbiredaktion`).

## Architecture
- One image, two containers: `hofchilbi` (`ROLE=site`, builds + serves, content mounted read-only)
  and `hofchilbi-redaktion` (`ROLE=editor`, behind TinyAuth + `X-Hofchilbi-Key` header from nginx).
- Site builds go to `site/build-*`, then `site/current` is swapped atomically (`src/render/publish.ts`).
- Editor writes require header `X-Hofchilbi-Editor: 1` and a matching Origin (`src/server/access.ts`).

## Verify
`npm run typecheck && npm test`. Nix: `nix flake show --all-systems`; full Neo evaluation with a
scratch host flake importing neo + this repo as `plugin0` (see git history of phase 1).
