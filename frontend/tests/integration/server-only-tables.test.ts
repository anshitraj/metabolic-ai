import { beforeAll, describe, expect, it } from "vitest";
import { sql } from "drizzle-orm";
import { getDb, schema } from "@/server/db/client";

beforeAll(async () => {
  const db = await getDb();
  await db.insert(schema.users).values({ nearAccountId: "server-only.testnet" });
  await db.execute(sql`create role browser_test_role nologin`);
  await db.execute(sql`grant usage on schema public to browser_test_role`);
  await db.execute(sql`grant select, insert, update, delete on all tables in schema public to browser_test_role`);
});

describe("server-owned database tables", () => {
  it("allows the server owner to access its application records", async () => {
    const db = await getDb();
    expect(await db.select().from(schema.users)).toHaveLength(1);
  });

  it("blocks browser-role reads and writes even when table grants exist", async () => {
    const db = await getDb();
    await db.transaction(async (tx) => {
      await tx.execute(sql`set local role browser_test_role`);
      expect(await tx.select().from(schema.users)).toHaveLength(0);
      expect(await tx.select().from(schema.creditBalances)).toHaveLength(0);
    });
    await expect(db.transaction(async (tx) => {
      await tx.execute(sql`set local role browser_test_role`);
      await tx.insert(schema.users).values({ nearAccountId: "unauthorized.testnet" });
    })).rejects.toThrow();
  });
});
