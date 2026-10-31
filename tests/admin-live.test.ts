import { test } from "node:test";
import assert from "node:assert/strict";
import type { Store } from "../server/store";

test("live reset is rejected for an authenticated user without touching stored data", async () => {
  const originalFetch = globalThis.fetch;
  const previous = { JANUS_MODE: process.env.JANUS_MODE, OPENAI_MODEL: process.env.OPENAI_MODEL, SUPABASE_URL: process.env.SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY: process.env.SUPABASE_SERVICE_ROLE_KEY };
  process.env.JANUS_MODE = "live";
  process.env.OPENAI_MODEL = "";
  process.env.SUPABASE_URL = "https://admin-test.supabase.co";
  process.env.SUPABASE_SERVICE_ROLE_KEY = "test-service-role";
  const { createApp } = await import("../server/app");
  let resetCalls = 0;
  let readCalls = 0;
  const store = {
    initialize: async () => {},
    reset: async () => { resetCalls++; },
    listCases: async () => { readCalls++; return []; },
  } as unknown as Store;
  const app = await createApp(store);
  const server = app.listen(0, "127.0.0.1");
  await new Promise<void>((resolve) => server.once("listening", resolve));
  const address = server.address();
  assert(address && typeof address !== "string");
  globalThis.fetch = async (input) => {
    const url = new URL(input instanceof Request ? input.url : String(input));
    assert.equal(url.origin, "https://admin-test.supabase.co");
    if (url.pathname === "/auth/v1/user") return Response.json({ id: "local-demo", aud: "authenticated", role: "authenticated" });
    assert.equal(url.pathname, "/rest/v1/organization_members");
    return Response.json([{ organization_id: "notion" }]);
  };
  try {
    const response = await originalFetch(`http://127.0.0.1:${address.port}/api/reset`, { method: "POST", headers: { Authorization: "Bearer test-token", "Content-Type": "application/json" }, body: JSON.stringify({ confirm: true }) });
    assert.equal(response.status, 403);
    assert.equal(resetCalls, 0);
    assert.equal(readCalls, 0);
  } finally {
    globalThis.fetch = originalFetch;
    await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[key]; else process.env[key] = value;
    }
  }
});
