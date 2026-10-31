import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { runDemoMonitor } from "../server/demo-monitor";
import { SignalService, signalInput } from "../server/signals";
import { Store } from "../server/store";

async function fixture() {
  const directory = await mkdtemp(path.join(tmpdir(), "janus-monitor-test-"));
  const names = ["JANUS_DATA_DIR", "TERSE_ACTOR_URL", "OPENAI_MODEL"];
  const previous = Object.fromEntries(names.map((name) => [name, process.env[name]]));
  process.env.JANUS_DATA_DIR = directory;
  delete process.env.TERSE_ACTOR_URL;
  process.env.OPENAI_MODEL = "";
  const store = new Store();
  await store.initialize();
  const queued: string[] = [];
  const signals = new SignalService(store, { startPending: async (id) => { queued.push(id); } }, () => true);
  return { store, signals, queued, async close() {
    for (const name of names) {
      if (previous[name] === undefined) delete process.env[name]; else process.env[name] = previous[name];
    }
    await rm(directory, { recursive: true, force: true });
  } };
}

const proposal = { vendorId: "aws", title: "Uploads fail with S3 503 responses", summary: "Notion uploads are returning 503 SlowDown in us-west-2 while existing pages remain readable.", severity: "P1" };

test("monitoring case creation happens only when the runner invokes the scoped open tool after reading", async () => {
  const local = await fixture();
  try {
    const before = (await local.store.listCases()).length;
    const result = await runDemoMonitor(local.signals, { runner: async (tools, threadId) => {
      assert.match(threadId, /^janus:demo-monitor:demo-upload-monitor:/);
      assert.equal((await local.store.listCases()).length, before);
      const read = tools.find((entry) => entry.name === "read_monitoring_signal")!;
      const open = tools.find((entry) => entry.name === "open_support_case")!;
      await assert.rejects(open.invoke(proposal), /Read the monitoring signal/);
      assert.equal((await local.store.listCases()).length, before);
      const trace = await read.invoke({}) as { status: number; simulated: boolean; vendorId: string };
      assert.equal(trace.status, 503);
      assert.equal(trace.simulated, true);
      assert.equal(trace.vendorId, "aws");
      await assert.rejects(open.invoke({ ...proposal, vendorId: "google" }));
      await assert.rejects(open.invoke({ ...proposal, organizationId: "ramp" }));
      await open.invoke(proposal);
    } });
    assert.equal(result.queued, true);
    assert.equal(result.customerId, "notion");
    assert.equal(result.vendorId, "aws");
    assert.ok(result.caseId);
    assert.deepEqual(local.queued, [result.caseId]);
    const item = (await local.store.getCase(result.caseId))!;
    assert.equal(item.title, proposal.title);
    assert.equal(item.summary, proposal.summary);
    assert.equal(item.mode, "simulation");
    assert.equal(item.demoService?.scenario, "aws-uploads");
    assert.equal(item.demoService?.route, "canary");
    assert.equal(item.evidence[0].simulated, true);
    assert.equal(item.evidence[0].visibility, "private");
    assert.equal(item.runs?.[0].status, "pending");
  } finally { await local.close(); }
});

test("a runner that does not open a case cannot fabricate a successful investigation", async () => {
  const local = await fixture();
  try {
    const before = (await local.store.listCases()).length;
    await assert.rejects(runDemoMonitor(local.signals, { runner: async (tools) => {
      await tools.find((entry) => entry.name === "read_monitoring_signal")!.invoke({});
    } }), /did not open a support case/);
    assert.equal((await local.store.listCases()).length, before);
    assert.deepEqual(local.queued, []);
  } finally { await local.close(); }
});

test("each monitor invocation has a fresh signal identity and leaves public ingestion schema unchanged", async () => {
  const local = await fixture();
  try {
    const ids: string[] = [];
    for (let index = 0; index < 2; index++) {
      const result = await runDemoMonitor(local.signals, { runner: async (tools) => {
        await tools.find((entry) => entry.name === "read_monitoring_signal")!.invoke({});
        await tools.find((entry) => entry.name === "open_support_case")!.invoke(proposal);
      } });
      ids.push(result.caseId!);
    }
    assert.notEqual(ids[0], ids[1]);
    assert.equal(local.queued.length, 2);
    assert.equal(signalInput.safeParse({ organizationId: "notion", vendorId: "aws", connectorId: "datadog", externalId: "test", title: "Test", summary: "Test", simulation: true }).success, false);
  } finally { await local.close(); }
});

test("missing runtime is reported without opening a case or claiming the agent started", async () => {
  const local = await fixture();
  try {
    const before = (await local.store.listCases()).length;
    const result = await runDemoMonitor(local.signals);
    assert.equal(result.caseId, null);
    assert.equal(result.queued, false);
    assert.match(result.reason!, /not started/);
    assert.equal((await local.store.listCases()).length, before);
    assert.deepEqual(local.queued, []);
  } finally { await local.close(); }
});
