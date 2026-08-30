import { defineConfig } from "drizzle-kit";

export default defineConfig({
  dialect: "sqlite",
  schema: "./src/db/schema.ts",
  out: "./migrations",
  // d1-http via wrangler (typed as any to satisfy drizzle-kit version variance)
  driver: "d1-http" as any,
  dbCredentials: {
    wranglerConfigPath: "./wrangler.jsonc",
    dbName: "mizuki-db",
  } as any,
});
