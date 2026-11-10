import { createHash } from "node:crypto";
import { cp, readFile, writeFile } from "node:fs/promises";

const moduleBytes = await readFile(new URL("../dist/module.js", import.meta.url));
const hash = createHash("sha256").update(moduleBytes).digest("hex");
const manifest = JSON.parse(
  await readFile(new URL("../src/plugin.json", import.meta.url), "utf8"),
);

// Grafana uses info.version as the browser cache key for filesystem plugins.
// Keep local builds distinct even before the next published release.
manifest.info.version = `${manifest.info.version.split("+")[0]}+${hash.slice(0, 16)}`;
manifest.info.build = { ...manifest.info.build, hash };
await writeFile(
  new URL("../dist/plugin.json", import.meta.url),
  `${JSON.stringify(manifest, null, 2)}\n`,
);
await cp(new URL("../src/img", import.meta.url), new URL("../dist/img", import.meta.url), {
  recursive: true,
});
