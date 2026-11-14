import { sql } from "drizzle-orm";
import { getDb } from "@/server/db/client";
import { json } from "@/server/http";

export const dynamic = "force-dynamic";
export async function GET() {
  try {
    await (await getDb()).execute(sql`select 1`);
    return json({ ok: true, service: "metabolic-ai", database: "ready" });
  } catch {
    return json({ ok: false, service: "metabolic-ai", database: "unavailable" }, { status: 503 });
  }
}
