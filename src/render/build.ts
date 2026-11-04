import { writeFile } from "node:fs/promises";
import path from "node:path";
import { siteDir } from "../paths.ts";
import { publishBuild } from "./publish.ts";

/**
 * Phase 1 placeholder. Phase 2 replaces this with the real templates rendered from content/.
 */
export async function buildSite(): Promise<void> {
  const started = Date.now();
  await publishBuild(siteDir(), async (dir) => {
    await writeFile(path.join(dir, "index.html"), placeholder());
    await writeFile(path.join(dir, "404.html"), placeholder("Seite nicht gefunden"));
    await writeFile(path.join(dir, "robots.txt"), "User-agent: *\nDisallow: /\n");
  });
  console.log(`Site: built in ${Date.now() - started} ms`);
}

function placeholder(title = "Neue Website im Aufbau"): string {
  return `<!doctype html>
<html lang="de-CH">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex">
<title>Hofchilbi Wil</title>
</head>
<body>
<main>
<h1>Hofchilbi Wil</h1>
<p>${title}</p>
</main>
</body>
</html>
`;
}
