import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import type { Server } from "node:http";
import type { Store } from "../server/store";

let store: Store;
let server: Server;
let base: string;
let directory: string;
const original = { JANUS_MODE: process.env.JANUS_MODE, JANUS_DATA_DIR: process.env.JANUS_DATA_DIR, TERSE_ACTOR_URL: process.env.TERSE_ACTOR_URL, OPENAI_MODEL: process.env.OPENAI_MODEL };

before(async () => {
  process.env.JANUS_MODE = "demo";
  process.env.OPENAI_MODEL = "";
  delete process.env.TERSE_ACTOR_URL;
  directory = await mkdtemp(path.join(tmpdir(), "janus-admin-test-"));
  process.env.JANUS_DATA_DIR = directory;
  const [{ createApp }, { Store }] = await Promise.all([import("../server/app"), import("../server/store")]);
  store = new Store();
  const app = await createApp(store);
  server = app.listen(0, "127.0.0.1");
  await new Promise<void>((resolve) => server.once("listening", resolve));
  const address = server.address();
  assert(address && typeof address !== "string");
  base = `http://127.0.0.1:${address.port}`;
});

after(async () => {
  await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  await rm(directory, { recursive: true, force: true });
  for (const [key, value] of Object.entries(original)) {
    if (value === undefined) delete process.env[key]; else process.env[key] = value;
  }
});

async function reset(body: unknown = { confirm: true }, origin = "http://localhost:5173") {
  return fetch(`${base}/api/reset`, { method: "POST", headers: { "Content-Type": "application/json", Origin: origin }, body: JSON.stringify(body) });
}

test("admin reset requires explicit confirmation and a local browser origin", async () => {
  await store.updateCase("JAN-1042", (item) => { item.outcome = "Keep until confirmed"; });
  assert.equal((await reset({})).status, 400);
  assert.equal((await reset({ confirm: false })).status, 400);
  assert.equal((await reset({ confirm: true }, "https://foreign.example")).status, 403);
  assert.equal((await store.getCase("JAN-1042"))?.outcome, "Keep until confirmed");
});

test("pending and running investigations block reset without losing progress", async () => {
  for (const status of ["pending", "running"] as const) {
    await store.updateCase("JAN-1042", (item) => {
      item.runs = [{ id: "active-run", organizationId: "notion", message: "Investigate", status, createdAt: new Date().toISOString() }];
    });
    const response = await reset();
    assert.equal(response.status, 409);
    assert.match((await response.json()).error, /pending investigations/);
    await assert.rejects(store.reset(), /pending investigations/);
    assert.equal((await store.getCase("JAN-1042"))?.runs?.[0].status, status);
  }
  await store.updateCase("JAN-1042", (item) => { item.runs = []; });
});

test("reset immediately restores seeded cases and connections and clears local credentials", async () => {
  const initialCount = (await store.listCases()).length;
  const connection = { id: "temporary-live-connection", organizationId: "notion", connectorId: "slack", status: "connected" as const, mode: "live" as const };
  await store.setConnection(connection, { token: "test-token" });
  await store.updateCase("JAN-1042", (item) => { item.status = "resolved"; item.outcome = "Previous recording"; });
  assert.equal((await reset()).status, 200);
  assert.equal((await store.getCase("JAN-1042"))?.status, "investigating");
  assert.notEqual((await store.getCase("JAN-1042"))?.outcome, "Previous recording");
  assert.equal((await store.listCases()).length, initialCount);
  assert((await store.listConnections()).every((item) => item.mode === "simulation"));
  await assert.rejects(store.getCredentials(connection), /Reconnect this integration/);
  const { Store } = await import("../server/store");
  const reopened = new Store();
  await reopened.initialize();
  assert.equal((await reopened.getCase("JAN-1042"))?.status, "investigating");
  assert.equal((await reopened.listCases()).length, initialCount);
});

test("reset cases absent from the local index cannot reach historical Terse actors", async () => {
  const { newCase } = await import("../server/cases");
  const item = newCase({ title: "Previous recording case", customerId: "notion", vendorId: "aws" });
  await store.createCase(item);
  await store.reset();
  const originalFetch = globalThis.fetch;
  let calls = 0;
  process.env.TERSE_ACTOR_URL = "https://invalid.example/v1/projects/janus/actors";
  globalThis.fetch = async () => { calls++; throw new Error("Historical actor must not be contacted"); };
  try {
    assert.equal(await store.getCase(item.id), null);
    await assert.rejects(store.updateCase(item.id, () => { throw new Error("Old case must not mutate"); }), { status: 404, message: "Case not found" });
    assert.equal(calls, 0);
  } finally {
    globalThis.fetch = originalFetch;
    delete process.env.TERSE_ACTOR_URL;
  }
});
