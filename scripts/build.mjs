import { readFile, mkdir, writeFile, copyFile } from "node:fs/promises";
const acp = (await readFile(new URL("../src/acp.js", import.meta.url), "utf8")).replace(/^export /gm, "");
const plugin = (await readFile(new URL("../src/plugin.js", import.meta.url), "utf8")).replace(/^import .*;\n/gm, "");
const license = (await readFile(new URL("../LICENSE", import.meta.url), "utf8")).trim();
const dist = new URL("../dist/", import.meta.url);
await mkdir(dist, { recursive: true });
await writeFile(new URL("plugin.js", dist), "// Maple Buzz plugin; built for Buzz 1.0.0.\n/*\n" + license + "\n*/\n" + acp + "\n" + plugin);
await copyFile(new URL("../manifest.json", import.meta.url), new URL("manifest.json", dist));
console.log("Built dist/manifest.json and dist/plugin.js; no dependency installation");
