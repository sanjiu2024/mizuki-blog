import { readFileSync, writeFileSync, existsSync, readdirSync } from "node:fs";
import { join } from "node:path";

const pnpmDir = "node_modules/.pnpm";
if (!existsSync(pnpmDir)) process.exit(0);

for (const entry of readdirSync(pnpmDir)) {
  if (!entry.startsWith("@astrojs+node@")) continue;
  for (const sub of ["server.js", "standalone.js", "nodeMiddleware.js"]) {
    const file = join(pnpmDir, entry, `node_modules/@astrojs/node/dist/${sub}`);
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
    src = src.replace(
      "const logger = app.getAdapterLogger();",
      "const logger = { info: (...a) => console.log(...a), warn: (...a) => console.warn(...a), error: (...a) => console.error(...a) };",
    );
    if (src !== before) {
      writeFileSync(file, src);
      console.log(`[patch] ${file}`);
    }
  }
}
