import { createHash } from "node:crypto";
import { readFileSync, readdirSync, writeFileSync } from "node:fs";

const publicDir = new URL("./public/", import.meta.url);
const source = readFileSync(new URL("./pwa-sw.js", import.meta.url), "utf8");
const hash = createHash("sha256").update(source);

for (const entry of readdirSync(publicDir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
  if (entry.isFile() && entry.name !== "sw.js") {
    hash.update(entry.name).update(readFileSync(new URL(entry.name, publicDir)));
  }
}

writeFileSync(new URL("sw.js", publicDir), source + "\n// Versión " + hash.digest("hex") + "\n");
