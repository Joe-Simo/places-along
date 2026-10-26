import { describe, expect, it } from "vitest";
import { memoryStore, neonQuery, postgresStore, resilientStore, today, visitorKey, type Query, type UsageStore } from "@/lib/usage";

/** A tiny stand-in for Postgres that understands the store's statements, so the logic is tested without a network. */
function fakePostgres() {
  const rows = new Map<string, number>();
  const statements: string[] = [];
  const query: Query = async (text, params) => {
    statements.push(text.split(" ").slice(0, 2).join(" "));
    const [day, key, third] = params as [string, string, number];
    const id = `${day}|${key}`;
    if (text.startsWith("CREATE") || text.startsWith("DELETE")) return [];
    if (text.startsWith("SELECT")) return rows.has(id) ? [{ n: rows.get(id) }] : [];
    if (text.includes("WHERE demo_usage.n < $3")) {
      const n = rows.get(id);
      if (n === undefined) return rows.set(id, 1), [{ n: 1 }];
      if (n >= third) return [];
      return rows.set(id, n + 1), [{ n: n + 1 }];
    }
    if (text.includes("EXCLUDED.n")) return rows.set(id, (rows.get(id) ?? 0) + third), [];
    throw new Error("unexpected statement: " + text);
  };
  return { query, rows, statements };
}

async function behavesLikeACounter(store: UsageStore) {
  const day = "2026-10-26";
  expect(await store.requests(day)).toBe(0);
  await store.addRequests(day, 6);
  await store.addRequests(day, 12);
  expect(await store.requests(day)).toBe(18);
  expect(await store.takeVisitorRun(day, "203.0.113.7", 2)).toBe(true);
  expect(await store.takeVisitorRun(day, "203.0.113.7", 2)).toBe(true);
  expect(await store.takeVisitorRun(day, "203.0.113.7", 2)).toBe(false);
  expect(await store.takeVisitorRun(day, "198.51.100.4", 2)).toBe(true);
  expect(await store.takeVisitorRun(day, "198.51.100.4", 0)).toBe(false);
  // A new day starts from zero.
  expect(await store.requests("2026-10-27")).toBe(0);
  expect(await store.takeVisitorRun("2026-10-27", "203.0.113.7", 2)).toBe(true);
}

describe("usage counters", () => {
  it("memory store counts requests and visitor runs per day", async () => {
    await behavesLikeACounter(memoryStore());
  });

  it("Postgres store counts the same way and creates its table once", async () => {
    const pg = fakePostgres();
    await behavesLikeACounter(postgresStore(pg.query));
    expect(pg.statements.filter((s) => s === "CREATE TABLE")).toHaveLength(1);
  });

  it("stores visitors as a short hash, never the raw address", async () => {
    const pg = fakePostgres();
    await postgresStore(pg.query).takeVisitorRun("2026-10-26", "203.0.113.7", 3);
    const keys = [...pg.rows.keys()].join(" ");
    expect(keys).not.toContain("203.0.113.7");
    expect(keys).toContain(visitorKey("203.0.113.7"));
    expect(visitorKey("203.0.113.7")).toMatch(/^visitor:[0-9a-f]{16}$/);
  });

  it("shares counts across instances that use the same database", async () => {
    const pg = fakePostgres();
    const a = postgresStore(pg.query);
    const b = postgresStore(pg.query);
    await a.addRequests("2026-10-26", 10);
    await b.addRequests("2026-10-26", 5);
    expect(await a.requests("2026-10-26")).toBe(15);
    expect(await a.takeVisitorRun("2026-10-26", "v", 1)).toBe(true);
    expect(await b.takeVisitorRun("2026-10-26", "v", 1)).toBe(false);
  });

  it("falls back to memory when the database fails, and recovers when it is back", async () => {
    const pg = fakePostgres();
    let down = true;
    const flaky: Query = (text, params) => (down ? Promise.reject(new Error("connect ECONNREFUSED")) : pg.query(text, params));
    const logs: string[] = [];
    const store = resilientStore(postgresStore(flaky), memoryStore(), 1000, (m) => logs.push(m));
    expect(await store.takeVisitorRun("2026-10-26", "v", 12)).toBe(true);
    await store.addRequests("2026-10-26", 6);
    expect(await store.requests("2026-10-26")).toBe(6);
    expect(store.last()).toBe("memory");
    expect(logs[0]).toContain("ECONNREFUSED");
    down = false;
    expect(await store.requests("2026-10-26")).toBe(0);
    expect(store.last()).toBe("postgres");
  });

  it("falls back to memory when the database hangs", async () => {
    const hang: Query = () => new Promise(() => {});
    const store = resilientStore(postgresStore(hang), memoryStore(), 50, () => {});
    expect(await store.takeVisitorRun("2026-10-26", "v", 1)).toBe(true);
    expect(await store.takeVisitorRun("2026-10-26", "v", 1)).toBe(false);
    expect(store.last()).toBe("memory");
  });

  it("uses UTC dates for days", () => {
    expect(today(new Date("2026-10-27T02:30:00Z"))).toBe("2026-10-27");
  });
});

// Runs against a real database only when USAGE_TEST_DATABASE_URL is set. It uses a far-future day
// and deletes its rows afterwards, so it never touches the demo's real counts.
const live = process.env.USAGE_TEST_DATABASE_URL;
describe.skipIf(!live)("usage counters against real Postgres", () => {
  it("counts atomically under concurrent requests", async () => {
    const query = neonQuery(live!);
    const store = postgresStore(query);
    const day = "2099-01-01";
    await store.requests(day);
    await query("DELETE FROM demo_usage WHERE day = $1", [day]);
    try {
      const results = await Promise.all(Array.from({ length: 8 }, () => store.takeVisitorRun(day, "concurrency-test", 3)));
      expect(results.filter(Boolean)).toHaveLength(3);
      await Promise.all([store.addRequests(day, 4), store.addRequests(day, 5)]);
      expect(await store.requests(day)).toBe(9);
    } finally {
      await query("DELETE FROM demo_usage WHERE day = $1", [day]);
    }
  });
});
