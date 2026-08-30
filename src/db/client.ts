import { drizzle } from "drizzle-orm/d1";
import * as schema from "./schema";

export const createDb = (d1: any) => drizzle(d1, { schema });
export type Db = ReturnType<typeof createDb>;
