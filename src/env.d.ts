/// <reference types="astro/client" />
type D1Database = import("@cloudflare/workers-types").D1Database;
type KVNamespace = import("@cloudflare/workers-types").KVNamespace;

type Runtime = import("@astrojs/cloudflare").Runtime<Env>;

declare namespace App {
  interface Locals extends Runtime {
    user?: {
      id: string;
      email: string;
      name?: string | null;
      image?: string | null;
      role?: string;
    } | null;
    session?: { id: string; userId: string; token: string } | null;
  }
}

interface Env {
  DB: D1Database;
  SESSION: KVNamespace;
  ASSETS: Fetcher;
  BETTER_AUTH_SECRET: string;
  BETTER_AUTH_URL: string;
  GITHUB_CLIENT_ID: string;
  GITHUB_CLIENT_SECRET: string;
}
