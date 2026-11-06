import { randomBytes } from "node:crypto";
import path from "node:path";
import sharp, { type Sharp } from "sharp";
import { HttpError, atomicWrite, slugify } from "./store.ts";

/**
 * Upload handling. The file type is decided by the file's first bytes, never by its name.
 * Images are decoded and re-encoded through sharp: that strips metadata (GPS!) and anything
 * hidden after the image data. SVG logos are rasterised to PNG (an SVG can carry script).
 * PDFs are only accepted for documents (Gönner letter).
 */

export const UPLOAD_DIRS = ["logos", "team", "anzapfer", "news", "bilder", "dokumente"] as const;
export type UploadDir = (typeof UPLOAD_DIRS)[number];

export const MAX_UPLOAD = 25 * 1024 * 1024;
const MAX_EDGE = 2560;

type Kind = "jpeg" | "png" | "gif" | "webp" | "avif" | "heic" | "pdf" | "svg";

export function sniff(buf: Buffer): Kind | null {
  const b = buf;
  if (b.length < 12) return null;
  if (b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return "jpeg";
  if (b.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return "png";
  if (b.subarray(0, 4).toString("latin1") === "GIF8") return "gif";
  if (b.subarray(0, 4).toString("latin1") === "RIFF" && b.subarray(8, 12).toString("latin1") === "WEBP") return "webp";
  if (b.subarray(4, 8).toString("latin1") === "ftyp") {
    const brand = b.subarray(8, 12).toString("latin1");
    if (brand === "avif" || brand === "avis") return "avif";
    if (["heic", "heix", "mif1", "msf1", "hevc"].includes(brand)) return "heic";
  }
  if (b.subarray(0, 5).toString("latin1") === "%PDF-") return "pdf";
  const head = b.subarray(0, 512).toString("utf8").replace(/^﻿/, "").trimStart();
  if (/^(<\?xml[^>]*>\s*)?(<!--[\s\S]*?-->\s*)*(<!DOCTYPE svg[^>]*>\s*)?<svg[\s>]/i.test(head)) return "svg";
  return null;
}

/** Must be one of the upload dirs. Gallery photos come from Immich, never from uploads. */
export function uploadDir(raw: string | null): string {
  const dir = String(raw ?? "");
  if ((UPLOAD_DIRS as readonly string[]).includes(dir)) return dir;
  throw new HttpError(400, "Ungültiger Ordner");
}

export interface Uploaded {
  path: string;
  width?: number;
  height?: number;
}

export async function processUpload(contentDir: string, dirRaw: string | null, filename: string, buf: Buffer): Promise<Uploaded> {
  const dir = uploadDir(dirRaw);
  if (buf.length === 0) throw new HttpError(400, "Die Datei ist leer.");
  const kind = sniff(buf);
  if (!kind) throw new HttpError(415, "Dieses Dateiformat wird nicht unterstützt. Bitte JPG, PNG oder PDF verwenden.");
  const base = slugify(path.basename(filename).replace(/\.[^.]+$/, "")).slice(0, 40);
  const unique = `${base}-${randomBytes(3).toString("hex")}`;

  if (kind === "pdf") {
    if (dir !== "dokumente") throw new HttpError(415, "PDF-Dateien gehen nur bei Dokumenten.");
    const rel = `media/${dir}/${unique}.pdf`;
    await atomicWrite(path.join(contentDir, rel), buf);
    return { path: rel };
  }
  if (kind === "heic") {
    throw new HttpError(415, "HEIC-Fotos (iPhone) bitte als JPG exportieren oder in den Kamera-Einstellungen «Maximale Kompatibilität» wählen.");
  }

  let img: Sharp;
  try {
    img =
      kind === "svg"
        ? sharp(buf, { density: 300, limitInputPixels: 50e6 }).resize({ width: 1600, height: 1600, fit: "inside", withoutEnlargement: false })
        : sharp(buf, { failOn: "error", limitInputPixels: 50e6, animated: false })
            .rotate()
            .resize({ width: MAX_EDGE, height: MAX_EDGE, fit: "inside", withoutEnlargement: true });
    const meta = await sharp(buf, { limitInputPixels: 50e6 }).metadata();
    const alpha = kind === "svg" || kind === "png" || ((kind === "webp" || kind === "avif" || kind === "gif") && meta.hasAlpha);
    const out = alpha
      ? await img.png({ compressionLevel: 9, palette: false }).toBuffer({ resolveWithObject: true })
      : await img.jpeg({ quality: 86, mozjpeg: true }).toBuffer({ resolveWithObject: true });
    const rel = `media/${dir}/${unique}.${alpha ? "png" : "jpg"}`;
    await atomicWrite(path.join(contentDir, rel), out.data);
    return { path: rel, width: out.info.width, height: out.info.height };
  } catch (err) {
    if (err instanceof HttpError) throw err;
    throw new HttpError(415, "Das Bild konnte nicht gelesen werden. Ist die Datei beschädigt?");
  }
}
