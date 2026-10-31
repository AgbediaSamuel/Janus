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

test("startup adds four scoped cases once and preserves existing and resolved records", async () => {
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
    assert.equal(seeded.length, 5);
    assert.deepEqual(await store.getCase(original.id), original);
    assert.deepEqual(
      (await store.organizations()).map((item) => item.id),
      ["notion", "ramp", "aws", "google"],
    );
    assert.equal((await store.getCase("JAN-1042"))?.status, "investigating");
    assert.equal(
      (await store.getCase("JAN-1041"))?.status,
      "awaiting_approval",
    );
    const connections = await store.listConnections();
    assert.equal(connections.length, 14);
    assert(connections.every((item) => item.mode === "simulation" && item.status === "connected"));
    for (const item of seeded.filter(
      (entry) => ["notion", "ramp"].includes(entry.customerId),
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
    assert.equal((await reopened.listCases()).length, 5);
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
      2,
    );
    assert.equal(
      (await request("/api/state?organizationId=google")).data.cases.length,
      2,
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

test("migration enriches existing resolved seeds without resetting progress and filters linked evidence", async () => {
  const local = await workspace();
  try {
    const store = new Store();
    await store.initialize();
    await store.updateCase("JAN-1041", (item) => {
      item.events = item.events.filter((entry) => !entry.id.startsWith("seed:"));
      item.status = "resolved";
      item.outcome = "Preserve the operator's completed work";
      item.step = 5;
    });
    const reopened = new Store();
    await reopened.initialize();
    const migrated = (await reopened.getCase("JAN-1041"))!;
    assert.equal(migrated.status, "resolved");
    assert.equal(migrated.step, 5);
    assert.equal(migrated.outcome, "Preserve the operator's completed work");
    assert.equal(migrated.events.filter((entry) => entry.id.startsWith("seed:")).length, 7);
    const again = new Store();
    await again.initialize();
    assert.deepEqual(await again.getCase(migrated.id), migrated);
    const customerEvidence = migrated.evidence.find((entry) => entry.organizationId === "notion")!;
    const vendorEvidence = migrated.evidence.find((entry) => entry.organizationId === "google")!;
    migrated.events.push({ id: "mixed-links", createdAt: migrated.updatedAt, type: "message", actor: "Agent", body: "Sanitized summary", title: "Summary", organizationId: "google", visibility: "shared", evidenceIds: [customerEvidence.id, vendorEvidence.id, "missing"] });
    for (const org of ["notion", "google"]) {
      const projected = projectCase(migrated, org);
      const visibleIds = new Set(projected.evidence.map((entry) => entry.id));
      assert(projected.events.every((entry) => (entry.evidenceIds || []).every((id) => visibleIds.has(id))));
      assert(projected.events.filter((entry) => entry.actorType === "human").every((entry) => entry.organizationId === org));
      assert.equal(projected.events.find((entry) => entry.id === "mixed-links")!.evidenceIds!.length, 1);
    }
    assert.throws(() => projectCase(migrated, "ramp"), /Case access denied/);
  } finally { await local.close(); }
});

test("sample connections stay connected, read scoped messages, and cannot call providers", async () => {
  const local = await workspace();
  const originalFetch = globalThis.fetch;
  try {
    const { executeFixtureConnection } = await import("../server/fixture-connections");
    const store = new Store();
    await store.initialize();
    let providerCalls = 0;
    globalThis.fetch = async () => { providerCalls++; throw new Error("Unexpected provider call"); };
    const slack = (await store.listConnections()).find((entry) => entry.id === "notion:slack")!;
    const read = await executeFixtureConnection(store, slack, "search", { query: "attachments" });
    assert.equal(read.fixture, true);
    assert(read.messages.some((entry) => entry.actor.includes("Felipe Sanchez")));
    assert(read.messages.every((entry) => entry.organizationId === "notion" && ["JAN-1041", "JAN-1042"].includes(entry.caseId)));
    await assert.rejects(store.getCredentials(slack), /local workspace records/);
    await assert.rejects(executeFixtureConnection(store, slack, "post", {}), /read-only/);
    assert.equal(providerCalls, 0);
    await store.setConnection({ ...slack, mode: "live", status: "connected" }, { token: "local-test-token" });
    const reopened = new Store();
    await reopened.initialize();
    const connections = await reopened.listConnections();
    assert.equal(connections.find((entry) => entry.id === slack.id)!.mode, "live");
    assert.equal(connections.find((entry) => entry.id === slack.id)!.status, "not_configured");
    assert(connections.filter((entry) => entry.id !== slack.id).every((entry) => entry.mode === "simulation" && entry.status === "connected"));
  } finally { globalThis.fetch = originalFetch; await local.close(); }
});

test("Ramp recovery stays scoped and requires the scenario's owner approval", async () => {
  const local = await workspace();
  const store = new Store();
  const app = await createApp(store);
  const server = app.listen(0, "127.0.0.1");
  await new Promise<void>((resolve) => server.once("listening", resolve));
  const address = server.address();
  assert(address && typeof address !== "string");
  const request = async (route: string, body?: unknown) => {
    const response = await fetch(`http://127.0.0.1:${address.port}${route}`, body === undefined ? {} : { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    return { status: response.status, data: await response.json() as any };
  };
  try {
    for (const org of ["notion", "ramp"]) {
      const state = (await request(`/api/state?organizationId=${org}`)).data;
      assert.equal(state.cases.length, 2);
      assert(state.cases.every((item: any) => item.customerId === org));
    }
    for (const org of ["aws", "google"]) {
      const state = (await request(`/api/state?organizationId=${org}`)).data;
      assert.deepEqual(state.cases.map((item: any) => item.customerId).sort(), ["notion", "ramp"]);
    }
    for (const id of ["JAN-1043", "JAN-1044"]) {
      let item = (await store.getCase(id))!;
      while (item.step < 4) {
        assert.equal((await request(`/api/cases/${id}/advance`, {})).status, 200);
        item = (await store.getCase(id))!;
      }
      const approval = item.approvals[0];
      assert.equal(approval.organizationId, item.vendorId === "google" ? "ramp" : "aws");
      assert.equal((await request(`/api/cases/${id}/advance`, {})).status, 409);
      assert.equal((await request(`/api/cases/${id}/approvals/${approval.id}`, { decision: "approved" })).status, 200);
      const result = await request(`/api/cases/${id}/advance`, {});
      assert.equal(result.data.status, "resolved");
      const evidence = result.data.evidence.at(-1);
      assert.equal(evidence.data.status, 200);
      assert.equal(evidence.simulated, true);
      assert.equal(evidence.data[item.vendorId === "google" ? "watermarkMatched" : "attachmentAvailable"], true);
    }
  } finally {
    app.locals.investigations.close();
    await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
    await local.close();
  }
});


test("vendor diagnostics backfill once without changing case progress or customer visibility", async () => {
  const local = await workspace();
  try {
    const store = new Store();
    await store.initialize();
    for (const id of ["JAN-1042", "JAN-1044"]) {
      await store.updateCase(id, (item) => {
        item.evidence = item.evidence.filter((entry) => !entry.id.endsWith(":aws-route-diagnostic"));
        item.events.forEach((entry) => { entry.evidenceIds = entry.evidenceIds?.filter((evidenceId) => !evidenceId.endsWith(":aws-route-diagnostic")); });
      });
    }
    const before = await store.listCases();
    const migrated = new Store();
    await migrated.initialize();
    for (const original of before) {
      const item = (await migrated.getCase(original.id))!;
      assert.equal(item.step, original.step);
      assert.equal(item.status, original.status);
      assert.deepEqual(item.approvals, original.approvals);
      const privateEvidence = item.evidence.filter((entry) => entry.organizationId === item.vendorId && entry.visibility === "private");
      assert(privateEvidence.length > 0);
      assert(privateEvidence.every((entry) => entry.simulated));
      const customer = projectCase(item, item.customerId);
      const privateIds = new Set(privateEvidence.map((entry) => entry.id));
      assert(customer.evidence.every((entry) => !privateIds.has(entry.id)));
      assert(customer.events.every((entry) => (entry.evidenceIds || []).every((id) => !privateIds.has(id))));
      if (item.vendorId === "aws") {
        const diagnosticId = `seed:${item.id}:aws-route-diagnostic`;
        assert.equal(item.evidence.filter((entry) => entry.id === diagnosticId).length, 1);
        assert(item.events.filter((entry) => entry.id.startsWith("seed:") && entry.organizationId === "aws" && entry.visibility === "private").every((entry) => entry.evidenceIds?.includes(diagnosticId)));
      }
    }
    const once = await migrated.listCases();
    const reopened = new Store();
    await reopened.initialize();
    assert.deepEqual(await reopened.listCases(), once);
  } finally { await local.close(); }
});
