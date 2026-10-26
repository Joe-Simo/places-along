import { createHash } from "node:crypto";
import { neon } from "@neondatabase/serverless";

/**
 * Daily counters for the public demo: Geoapify requests made today, and live runs per visitor.
 *
 * With DATABASE_URL set (the hosted demo uses a free Neon Postgres database), the counters are
 * shared by every server instance and survive restarts. Without it, or whenever the database is
 * slow or unreachable, they fall back to memory in the current instance, so the demo keeps
 * working with the same limits it had before. Days are UTC dates. Visitors are stored as a
 * short hash, never as a raw IP address.
 */
export interface UsageStore {
  readonly kind: "postgres" | "memory";
  /** Geoapify requests counted so far on this day. */
  requests(day: string): Promise<number>;
  /** Counts one live run for the visitor and returns true, or returns false if they are out of runs. */
  takeVisitorRun(day: string, visitor: string, limit: number): Promise<boolean>;
  /** Adds the Geoapify requests a finished run made. */
  addRequests(day: string, n: number): Promise<void>;
}

export const today = (now = new Date()) => now.toISOString().slice(0, 10);
export const visitorKey = (visitor: string) => "visitor:" + createHash("sha256").update("places-along:" + visitor).digest("hex").slice(0, 16);
const REQUESTS = "requests";

export function memoryStore(): UsageStore {
  let day = "";
  let counts = new Map<string, number>();
  const roll = (d: string) => {
    if (d !== day) [day, counts] = [d, new Map()];
  };
  return {
    kind: "memory",
    async requests(d) {
      roll(d);
      return counts.get(REQUESTS) ?? 0;
    },
    async takeVisitorRun(d, visitor, limit) {
      roll(d);
      const k = visitorKey(visitor);
      const runs = counts.get(k) ?? 0;
      if (runs >= limit) return false;
      counts.set(k, runs + 1);
      return true;
    },
    async addRequests(d, n) {
      roll(d);
      counts.set(REQUESTS, (counts.get(REQUESTS) ?? 0) + n);
    },
  };
}

/** The few queries the Postgres store runs. Tests pass a fake; production passes Neon's HTTP driver. */
export type Query = (text: string, params: unknown[]) => Promise<Record<string, unknown>[]>;

export const neonQuery = (url: string): Query => {
  const sql = neon(url);
  return (text, params) => sql.query(text, params) as Promise<Record<string, unknown>[]>;
};

export function postgresStore(query: Query): UsageStore {
  let ready: Promise<void> | null = null;
  const setup = () =>
    (ready ??= (async () => {
      await query("CREATE TABLE IF NOT EXISTS demo_usage (day date NOT NULL, key text NOT NULL, n integer NOT NULL DEFAULT 0, PRIMARY KEY (day, key))", []);
      await query("DELETE FROM demo_usage WHERE day < CURRENT_DATE - 30", []);
    })().catch((e) => {
      ready = null;
      throw e;
    }));
  return {
    kind: "postgres",
    async requests(d) {
      await setup();
      const rows = await query("SELECT n FROM demo_usage WHERE day = $1 AND key = $2", [d, REQUESTS]);
      return Number(rows[0]?.n ?? 0);
    },
    async takeVisitorRun(d, visitor, limit) {
      if (limit <= 0) return false;
      await setup();
      // One atomic statement: the increment only happens while the visitor is under the limit.
      const rows = await query(
        "INSERT INTO demo_usage (day, key, n) VALUES ($1, $2, 1) ON CONFLICT (day, key) DO UPDATE SET n = demo_usage.n + 1 WHERE demo_usage.n < $3 RETURNING n",
        [d, visitorKey(visitor), limit],
      );
      return rows.length > 0;
    },
    async addRequests(d, n) {
      if (n <= 0) return;
      await setup();
      await query("INSERT INTO demo_usage (day, key, n) VALUES ($1, $2, $3) ON CONFLICT (day, key) DO UPDATE SET n = demo_usage.n + EXCLUDED.n", [d, REQUESTS, n]);
    },
  };
}

function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error(`usage store timed out after ${ms} ms`)), ms);
    p.then(
      (v) => (clearTimeout(t), resolve(v)),
      (e) => (clearTimeout(t), reject(e)),
    );
  });
}

/**
 * Tries the shared store first and falls back to memory on any error or timeout, so a database
 * outage never takes the demo down. `last` reports which store answered the most recent call.
 */
export function resilientStore(primary: UsageStore, fallback: UsageStore = memoryStore(), timeoutMs = 2500, log: (msg: string) => void = console.warn) {
  let last: "postgres" | "memory" = primary.kind;
  const attempt = async <T>(op: (s: UsageStore) => Promise<T>): Promise<T> => {
    try {
      const v = await withTimeout(op(primary), timeoutMs);
      last = primary.kind;
      return v;
    } catch (e) {
      log(`places-along: shared usage counters unavailable, using memory for this call (${e instanceof Error ? e.message : String(e)})`);
      last = fallback.kind;
      return op(fallback);
    }
  };
  const store: UsageStore & { last(): "postgres" | "memory" } = {
    kind: primary.kind,
    last: () => last,
    requests: (d) => attempt((s) => s.requests(d)),
    takeVisitorRun: (d, v, l) => attempt((s) => s.takeVisitorRun(d, v, l)),
    addRequests: (d, n) => attempt((s) => s.addRequests(d, n)),
  };
  return store;
}

let shared: ReturnType<typeof resilientStore> | null = null;
/** The store the app uses: Postgres when DATABASE_URL is set, otherwise memory. */
export function usageStore() {
  if (!shared) {
    const url = process.env.DATABASE_URL?.trim();
    shared = url ? resilientStore(postgresStore(neonQuery(url))) : resilientStore(memoryStore());
  }
  return shared;
}
