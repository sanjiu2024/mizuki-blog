import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { db } from "./db/client";
import * as schema from "./db/schema";

const baseURL = process.env.BETTER_AUTH_URL ?? "http://localhost:4321";

export const auth = betterAuth({
  database: drizzleAdapter(db, { provider: "sqlite", schema }),
  baseURL,
  trustedOrigins: [
    baseURL,
    "http://localhost:4321",
    "http://127.0.0.1:4321",
  ].filter(Boolean),
  secret:
    process.env.BETTER_AUTH_SECRET ?? "dev-secret-please-change-32-chars-min",
  emailAndPassword: { enabled: true },
  ...(process.env.GITHUB_CLIENT_ID && process.env.GITHUB_CLIENT_SECRET
    ? {
        socialProviders: {
          github: {
            clientId: process.env.GITHUB_CLIENT_ID,
            clientSecret: process.env.GITHUB_CLIENT_SECRET,
            scope: ["user:email", "read:user"],
            mapProfileToUser: (profile: any) => ({
              name: profile.name ?? profile.login ?? profile.email,
              email: profile.email,
              image: profile.avatar_url ?? profile.picture ?? null,
              emailVerified: true,
            }),
          },
        },
      }
    : {}),
  user: {
    additionalFields: {
      image: { type: "string", required: false },
      role: {
        type: "string",
        required: false,
        defaultValue: "user",
        input: false,
      },
    },
  },
  account: {
    accountLinking: {
      enabled: true,
      trustedProviders: ["github"],
    },
  },
});

export const createAuth = () => auth;
