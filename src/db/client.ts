import { drizzle } from "drizzle-orm/d1";
import * as schema from "./schema";

export const createDb = (d1: any) => {
  if (!d1) throw new Error("D1 binding missing");
  return drizzle(d1, { schema });
};
export type Db = ReturnType<typeof createDb>;
