import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { createDb } from "./db/client";
import * as schema from "./db/schema";

export const createAuth = (env: any) =>
  betterAuth({
    database: drizzleAdapter(createDb(env.DB), { provider: "sqlite", schema }),
    emailAndPassword: { enabled: true, minPasswordLength: 8 },
    session: { cookieCache: { enabled: true } },
    secret: env.BETTER_AUTH_SECRET ?? "dev-secret-please-change-32-chars-min",
    baseURL: env.BETTER_AUTH_URL ?? env.CF_PAGES_URL ?? "http://localhost:4321",
    trustedOrigins: ["http://localhost:4321", "http://127.0.0.1:4321"],
  });
