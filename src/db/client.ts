import { createClient } from "@libsql/client";
import { drizzle } from "drizzle-orm/libsql";
import * as schema from "./schema";

const url = process.env.DB_FILE_NAME
  ? process.env.DB_FILE_NAME.startsWith("file:")
    ? process.env.DB_FILE_NAME
    : `file:${process.env.DB_FILE_NAME}`
  : "file:./data/mizuki.db";

const client = createClient({ url });
export const db = drizzle(client, { schema });
export const createDb = () => db;
export type Db = typeof db;
