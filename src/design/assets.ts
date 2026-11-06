import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";
import { repoRoot } from "../paths.ts";

/**
 * Theme files (CSS, JS, fonts, skyline/logo SVGs) shipped with the code, not content.
 * Written to /_assets/ with a content hash in the name so they can be cached for a year.
 */
const designDir = path.dirname(fileURLToPath(import.meta.url));
const fontDir = path.join(repoRoot, "node_modules/@fontsource-variable/archivo/files");

export const SVGS = [
  "skyline-white",
  "skyline-outline",
  "skyline-black",
  "ktv-white",
  "ktv-black",
  "ktv-black-color",
  "instagram-black",
  "facebook-black",
  "instagram-white",
  "facebook-white",
  "hofchilbi-logo",
  "hofchilbi-logo-white",
] as const;
export type SvgName = (typeof SVGS)[number];

export interface Assets {
  css: string;
  js: string;
  fontLatin: string;
  svg: Record<SvgName, string>;
  favicon: string;
}

function hashed(name: string, data: Buffer | string): string {
  const h = createHash("sha1").update(data).digest("hex").slice(0, 10);
  const ext = path.extname(name);
  return `${path.basename(name, ext)}-${h}${ext}`;
}

export async function writeAssets(outDir: string): Promise<Assets> {
  const dir = path.join(outDir, "_assets");
  await mkdir(dir, { recursive: true });
  const put = async (name: string, data: Buffer | string) => {
    const file = hashed(name, data);
    await writeFile(path.join(dir, file), data);
    return `/_assets/${file}`;
  };

  const fontLatin = await put("archivo-latin.woff2", await readFile(path.join(fontDir, "archivo-latin-standard-normal.woff2")));
  const fontLatinExt = await put("archivo-latin-ext.woff2", await readFile(path.join(fontDir, "archivo-latin-ext-standard-normal.woff2")));

  const svg = {} as Record<SvgName, string>;
  for (const name of SVGS) svg[name] = await put(`${name}.svg`, await readFile(path.join(designDir, "assets", `${name}.svg`)));

  const css = minifyCss(await readFile(path.join(designDir, "site.css"), "utf8"))
    .replaceAll("__FONT_LATIN__", fontLatin)
    .replaceAll("__FONT_LATIN_EXT__", fontLatinExt)
    .replaceAll("__SKYLINE_BLACK__", svg["skyline-black"]);
  const js = await readFile(path.join(designDir, "site.js"), "utf8");
  const favicon = await readFile(path.join(designDir, "assets", "favicon.svg"));
  await writeFile(path.join(outDir, "favicon.svg"), favicon);
  // Home-screen icon for iOS/Android (they don't use SVG favicons). Opaque: iOS would fill transparency itself.
  await sharp(favicon).resize(148, 148).extend({ top: 16, bottom: 16, left: 16, right: 16, background: "#000" }).flatten({ background: "#000" }).png().toFile(path.join(outDir, "apple-touch-icon.png"));

  return { css: await put("site.css", css), js: await put("site.js", js), fontLatin, svg, favicon: "/favicon.svg" };
}

/** Conservative CSS minifier: comments and whitespace only (no rewriting of values). */
export function minifyCss(css: string): string {
  return css
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/\s+/g, " ")
    .replace(/\s*([{};,>])\s*/g, "$1")
    // Only "prop: value" → "prop:value"; a space before ":" can be a descendant selector.
    .replace(/:\s+/g, ":")
    .replace(/;}/g, "}")
    .trim();
}
