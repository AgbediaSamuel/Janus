import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { Store } from "../server/store";
import { createApp } from "../server/app";
import { newCase, projectCase } from "../server/cases";
import { executeDemo } from "../server/demo-service";

async function workspace() {
  const directory = await mkdtemp(path.join(tmpdir(), "janus-fixtures-"));
  const previous = process.env.JANUS_DATA_DIR;
  process.env.JANUS_DATA_DIR = directory;
  return {
    directory,
    async close() {
      if (previous === undefined) delete process.env.JANUS_DATA_DIR;
      else process.env.JANUS_DATA_DIR = previous;
      await rm(directory, { recursive: true, force: true });
    },
  };
}

test("startup adds two distinct Notion cases once and preserves existing and resolved records", async () => {
  const local = await workspace();
  try {
    const original = newCase({
      title: "Operator's existing case",
      customerId: "legacy-customer",
      vendorId: "legacy-vendor",
      live: true,
    });
    await writeFile(
      path.join(local.directory, "state.json"),
      JSON.stringify({ cases: [original], connections: [] }),
    );
    const store = new Store();
    await store.initialize();
    const seeded = await store.listCases();
    assert.equal(seeded.length, 3);
    assert.deepEqual(await store.getCase(original.id), original);
    assert.deepEqual(
      (await store.organizations()).map((item) => item.id),
      ["notion", "aws", "google"],
    );
    assert.equal((await store.getCase("JAN-1042"))?.status, "investigating");
    assert.equal(
      (await store.getCase("JAN-1041"))?.status,
      "awaiting_approval",
    );
    assert.deepEqual(await store.listConnections(), []);
    for (const item of seeded.filter(
      (entry) => entry.customerId === "notion",
    )) {
      assert.equal(item.mode, "simulation");
      assert(item.evidence.every((entry) => entry.simulated));
      const copy = [
        item.title,
        item.summary,
        ...item.events.flatMap((entry) => [entry.title, entry.body]),
        ...item.evidence.flatMap((entry) => [
          entry.title,
          entry.summary,
          entry.source,
        ]),
      ].join(" ");
      assert.doesNotMatch(copy, /demo|simulation|fixture/i);
      assert(
        item.events
          .filter((entry) => entry.type === "message")
          .some((entry) => entry.organizationId === item.customerId),
      );
      assert(
        item.events
          .filter((entry) => entry.type === "message")
          .some((entry) => entry.organizationId === item.vendorId),
      );
    }
    await store.updateCase("JAN-1042", (item) => {
      item.status = "resolved";
      item.outcome = "Retain operator progress";
    });
    const before = await readFile(
      path.join(local.directory, "state.json"),
      "utf8",
    );
    const reopened = new Store();
    await reopened.initialize();
    assert.equal((await reopened.getCase("JAN-1042"))?.status, "resolved");
    assert.equal(
      (await reopened.getCase("JAN-1042"))?.outcome,
      "Retain operator progress",
    );
    assert.equal((await reopened.listCases()).length, 3);
    assert.equal(
      await readFile(path.join(local.directory, "state.json"), "utf8"),
      before,
    );
  } finally {
    await local.close();
  }
});

test("seeded AWS and Google cases apply their own approved recovery and preserve organization privacy", async () => {
  const local = await workspace();
  const store = new Store();
  const app = await createApp(store);
  const server = app.listen(0, "127.0.0.1");
  await new Promise<void>((resolve) => server.once("listening", resolve));
  const address = server.address();
  assert(address && typeof address !== "string");
  const request = async (route: string, body?: unknown) => {
    const response = await fetch(
      `http://127.0.0.1:${address.port}${route}`,
      body === undefined
        ? {}
        : {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(body),
          },
    );
    return { status: response.status, data: (await response.json()) as any };
  };
  try {
    const initial = await request("/api/state");
    assert.equal(initial.data.activeOrganizationId, "notion");
    assert.equal(initial.data.cases.length, 2);
    const google = (await store.getCase("JAN-1041"))!;
    assert.equal(google.approvals[0].organizationId, "notion");
    assert.equal(projectCase(google, "google").approvals.length, 0);
    assert(
      projectCase(google, "notion").evidence.every(
        (entry) =>
          entry.organizationId === "notion" || entry.visibility === "shared",
      ),
    );
    assert(
      projectCase(google, "google").evidence.every(
        (entry) =>
          entry.organizationId === "google" || entry.visibility === "shared",
      ),
    );
    await assert.rejects(
      executeDemo(store, google.id, "google", "demo-customer", "reindex", {}),
      /other organization/,
    );
    assert.equal(
      (await request(`/api/cases/${google.id}/advance`, {})).status,
      409,
    );
    assert.equal(
      (
        await request(
          `/api/cases/${google.id}/approvals/${google.approvals[0].id}`,
          { decision: "approved" },
        )
      ).status,
      200,
    );
    assert.equal(
      (await store.getCase(google.id))?.demoService?.route,
      "stable",
    );
    const indexed = await request(`/api/cases/${google.id}/advance`, {});
    assert.equal(indexed.data.status, "resolved");
    assert.match(indexed.data.outcome, /indexing backlog has drained/);
    assert.equal(indexed.data.evidence.at(-1).data.backlog, 0);

    const awsId = "JAN-1042";
    await request(`/api/cases/${awsId}/advance`, {});
    await request(`/api/cases/${awsId}/advance`, {});
    const aws = (await store.getCase(awsId))!;
    assert.equal(aws.approvals[0].organizationId, "aws");
    assert.equal(projectCase(aws, "notion").approvals.length, 0);
    const failedProbe = await executeDemo(
      store,
      awsId,
      "notion",
      "demo-customer",
      "probe",
      {},
    );
    assert("status" in failedProbe);
    assert.equal(failedProbe.status, 503);
    assert.equal(
      (
        await request(`/api/cases/${awsId}/approvals/${aws.approvals[0].id}`, {
          decision: "approved",
        })
      ).status,
      200,
    );
    const uploaded = await request(`/api/cases/${awsId}/advance`, {});
    assert.equal(uploaded.data.status, "resolved");
    assert.match(uploaded.data.outcome, /upload probe returned HTTP 200/);
    assert.equal(uploaded.data.evidence.at(-1).data.status, 200);
    assert.equal(
      (await request("/api/state?organizationId=aws")).data.cases.length,
      1,
    );
    assert.equal(
      (await request("/api/state?organizationId=google")).data.cases.length,
      1,
    );
    assert.equal(
      (await request(`/api/cases/${awsId}/advance`, {})).status,
      409,
    );
    const reloaded = new Store();
    await reloaded.initialize();
    assert.equal((await reloaded.getCase(awsId))?.status, "resolved");
    assert.equal((await reloaded.getCase(google.id))?.status, "resolved");
  } finally {
    app.locals.investigations.close();
    await new Promise<void>((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve())),
    );
    await local.close();
  }
});
