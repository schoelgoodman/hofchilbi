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
- Editor menu mirrors the website: pages are main entries, what appears on them sits underneath
  (`ROUTES` in `src/editor/main.ts`). `site.yaml` is spread over several screens (`siteArea`).
- Editor writes require header `X-Hofchilbi-Editor: 1` and a matching Origin (`src/server/access.ts`).

## Security model (Phase 4)
- Editor: TinyAuth → nginx adds `X-Hofchilbi-Key` → app checks it (timing-safe). Writes need
  `X-Hofchilbi-Editor: 1` + same-origin. Saves are validated (zod, German messages) and every
  `media/` reference must exist; image fields must be images.
- Uploads: type sniffed from bytes, re-encoded by sharp (metadata stripped, ≤50 MP), SVG → PNG,
  PDF only for documents, one at a time, 25 MB max.
- Site: content mounted read-only; build failures keep the previous build online and are shown
  in the editor (site/status.json). Restarts serve the previous build immediately.
- Containers: read-only root, tmpfs /tmp, cap-drop ALL, no-new-privileges, 1 GB, 256 pids.
- Known/accepted: PDFs are published as uploaded (trusted uploaders); KaTeX low-severity advisory
  in Milkdown (math disabled, editor only).

## Verify
`npm run typecheck && npm test`. Nix: `nix flake show --all-systems`; full Neo evaluation with a
scratch host flake importing neo + this repo as `plugin0` (see git history of phase 1).
