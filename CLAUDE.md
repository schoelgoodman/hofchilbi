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
- Way to the editor: `/redaktion` on the site forwards to `EDITOR_URL` (set in the Nix module, never
  in public files); `site.js` sends the typed word `chilbi` or five taps on the footer logo there.
- Phones (`isPhone()`, 860 px, same as the `@media` block at the end of `editor.css`): the first screen is
  News instead of Allgemein, list actions sit inside the open item, the save bar only shows with
  unsaved changes, Milkdown uses its top bar instead of hover handle and selection bubble.
- Fonts (`--font`, `--font-condensed` in `site.css`): Apple devices use their built-in Helvetica Neue (no licence for hosting it, never host it);
  elsewhere self-hosted Inter, and Archivo for condensed text since Inter has no condensed cut. The Redaktion stays on Archivo.
- News on Start (`newsLayout` in `src/render/pages.ts`): 2 news are equal cards, otherwise newest big +
  cards filling their rows. Images in fixed frames: 4:3, portrait photos 4:5 only in the big news;
  transparent images and SVGs (logos) are shown whole in the frame instead of cropped.
- Lists (`list()` in `src/editor/form.ts`): drag handle (`dragSort.ts`, pointer events so phones work),
  arrows for keyboards, copy. `fixedOrder` where the site sorts by itself (Anzapfer by year).
- Verlauf: `History.prune` (`git.ts`) permanently rewrites the content git at start and daily: 90 days,
  newest 30 commits always stay. It also runs on `dev-content` with `npm run dev`.
- Icon: the shield from the logo, in three identical copies (`src/design/assets/favicon.svg`, `src/editor/public/favicon.svg`,
  `modules/services/hofchilbi/icon.svg`, used by both Neo services). The site generates its `apple-touch-icon.png`, the editor has a
  checked-in one in `public/`: change them together.
- Verlauf: «Änderungen ansehen» and the restore dialogs come from `src/editor-server/diff.ts`, which turns two states of a
  file into changes in the editor's words. New form fields need a label in its `SPECS`/`*_FIELDS` tables.
- Website-Check (`src/editor-server/check.ts`, sent with `/api/state`): only what a save cannot catch, mostly seasonal (date over,
  Anzapfer of the year, Impressum, news image without description, Immich errors). No outside requests, no dismissing.
- Redirects: bare domain → `SITE_URL` host and trailing slashes in `src/server/urls.ts`, single pages via `redirect` in the page's frontmatter.
- Share images: the Start page uses `seo.image` (else the hero), other pages their title image (`shareImage` in `PageDef`).
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
