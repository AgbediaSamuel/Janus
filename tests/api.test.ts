import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import type { Server } from "node:http";
import { createApp } from "../server/app";
import { Store } from "../server/store";
import { encryptCredentials, decryptCredentials } from "../server/secrets";

let server: Server;
let base: string;
let directory: string;

before(async () => {
  directory = await mkdtemp(path.join(tmpdir(), "janus-test-"));
  process.env.JANUS_DATA_DIR = directory;
  const app = await createApp();
  server = app.listen(0, "127.0.0.1");
  await new Promise<void>((resolve) => server.once("listening", resolve));
  const address = server.address();
  assert(address && typeof address !== "string");
  base = `http://127.0.0.1:${address.port}`;
});

after(async () => {
  await new Promise<void>((resolve, reject) =>
    server.close((error) => (error ? reject(error) : resolve())),
  );
  await rm(directory, { recursive: true, force: true });
});

async function request(route: string, body?: unknown) {
  const response = await fetch(
    base + route,
    body === undefined
      ? {}
      : {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        },
  );
  return { status: response.status, data: (await response.json()) as any };
}

test("guided incident keeps private evidence separate and requires a single vendor approval", async () => {
  const created = await request("/api/cases", {});
  assert.equal(created.status, 201);
  const id = created.data.id;
  for (let stage = 0; stage < 4; stage++) {
    const result = await request(`/api/cases/${id}/advance`, {});
    assert.equal(result.status, 200);
  }
  const customer = (await request("/api/state?organizationId=notion")).data;
  const vendor = (await request("/api/state?organizationId=aws")).data;
  const customerCase = customer.cases.find((item: any) => item.id === id);
  const vendorCase = vendor.cases.find((item: any) => item.id === id);
  assert.equal(customerCase.approvals.length, 0);
  assert.equal(
    customerCase.evidence.some((item: any) => item.organizationId === "aws"),
    false,
  );
  assert.equal(
    vendorCase.evidence.some(
      (item: any) =>
        item.organizationId === "notion" && item.visibility === "private",
    ),
    false,
  );
  assert.equal((await request(`/api/cases/${id}/advance`, {})).status, 409);
  const approvalId = vendorCase.approvals[0].id;
  const decisions = await Promise.all([
    request(`/api/cases/${id}/approvals/${approvalId}`, {
      decision: "approved",
    }),
    request(`/api/cases/${id}/approvals/${approvalId}`, {
      decision: "approved",
    }),
  ]);
  assert.deepEqual(decisions.map((result) => result.status).sort(), [200, 409]);
  const final = await request(`/api/cases/${id}/advance`, {});
  assert.equal(final.data.status, "resolved");
  assert.match(final.data.outcome, /upload probe returned HTTP 200/);
  const restarted = new Store();
  await restarted.initialize();
  assert.equal((await restarted.getCase(id))?.status, "resolved");
});

test("credentials are never returned in state and connector writes cannot run through access checks", async () => {
  const created = await request("/api/connections", {
    organizationId: "notion",
    connectorId: "slack",
    credentials: { token: "test-secret-never-return" },
  });
  assert.equal(created.status, 201);
  assert.equal(created.data.status, "not_configured");
  const state = await request("/api/state?organizationId=notion");
  assert.equal(
    JSON.stringify(state.data).includes("test-secret-never-return"),
    false,
  );
  const testWrite = await request(`/api/connections/${created.data.id}/test`, {
    operationId: "post",
    input: { channel: "C123", text: "must not send" },
  });
  assert.equal(testWrite.status, 400);
  const vendor = await request("/api/state?organizationId=aws");
  assert.equal(vendor.data.connections.length, 0);
});

test("unknown organizations cannot read state or register credentials", async () => {
  assert.equal(
    (await request("/api/state?organizationId=outsider")).status,
    403,
  );
  assert.equal(
    (
      await request("/api/connections", {
        organizationId: "outsider",
        connectorId: "slack",
        credentials: { token: "secret" },
      })
    ).status,
    403,
  );
});

test("encrypted credentials are bound to their organization", () => {
  const oldKey = process.env.JANUS_ENCRYPTION_KEY;
  process.env.JANUS_ENCRYPTION_KEY = Buffer.alloc(32, 7).toString("base64");
  try {
    const encrypted = encryptCredentials({ token: "private-token" }, "notion");
    assert.equal(encrypted.includes("private-token"), false);
    assert.deepEqual(decryptCredentials(encrypted, "notion"), {
      token: "private-token",
    });
    assert.throws(() => decryptCredentials(encrypted, "aws"));
  } finally {
    if (oldKey === undefined) delete process.env.JANUS_ENCRYPTION_KEY;
    else process.env.JANUS_ENCRYPTION_KEY = oldKey;
  }
});
