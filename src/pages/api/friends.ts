import type { APIRoute } from "astro";
import { db } from "../../db/client";

export const prerender = false;

type FriendRow = {
  id: string;
  name: string;
  url: string;
  description: string | null;
  avatar: string | null;
  sort: number;
};

export const GET: APIRoute = async () => {
  let friends: FriendRow[] = [];
  try {
    const rs = await db.$client.execute({
      sql: "SELECT id, name, url, description, avatar, sort FROM friends ORDER BY sort ASC, created_at ASC",
      args: [],
    });
    friends = (rs.rows as unknown as Array<Record<string, unknown>>).map(
      (r) => ({
        id: String(r.id ?? ""),
        name: String(r.name ?? ""),
        url: String(r.url ?? ""),
        description: (r.description as string | null) ?? null,
        avatar: (r.avatar as string | null) ?? null,
        sort: Number(r.sort ?? 0),
      }),
    );
  } catch {
    friends = [];
  }
  return new Response(JSON.stringify({ friends }), {
    status: 200,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
    },
  });
};
