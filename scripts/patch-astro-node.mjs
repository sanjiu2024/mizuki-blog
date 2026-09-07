import { readFileSync, writeFileSync, existsSync, readdirSync } from "node:fs";
import { join } from "node:path";

const pnpmDir = "node_modules/.pnpm";
if (!existsSync(pnpmDir)) process.exit(0);

for (const entry of readdirSync(pnpmDir)) {
  if (!entry.startsWith("@astrojs+node@")) continue;
  const file = join(pnpmDir, entry, "node_modules/@astrojs/node/dist/server.js");
  if (!existsSync(file)) continue;
  let src = readFileSync(file, "utf8");
  const before = src;
  src = src.replace(
    'import { NodeApp, applyPolyfills } from "astro/app/node";',
    'import { NodeApp } from "astro/app/node";',
  );
  src = src.replace(
    "import { NodeApp, applyPolyfills } from 'astro/app/node';",
    "import { NodeApp } from 'astro/app/node';",
  );
  src = src.replace(/\napplyPolyfills\(\);\n/, "\n");
  src = src.replace(/\napplyPolyfills\(\);\r\n/, "\n");
  if (src !== before) {
    writeFileSync(file, src);
    console.log(`[patch] ${file}`);
  }
}
