import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { createApp } from "../server/app";
import type { InvestigatorFactory } from "../server/investigations";
import { Store } from "../server/store";
import { SignalService, signalInput } from "../server/signals";

const alert = {
  organizationId: "northstar",
  vendorId: "contoso",
  connectorId: "datadog",
  externalId: "monitor-42:incident-8",
  title: "Checkout API error rate elevated",
  summary: "Customer requests to the vendor checkout API are failing.",
  severity: "P2",
  data: {
    internalHostname: "customer-private-host",
    requestId: "private-request-9",
  },
};

async function fixture(investigatorFactory?: InvestigatorFactory) {
  const directory = await mkdtemp(path.join(tmpdir(), "janus-signals-"));
  const names = [
    "JANUS_DATA_DIR",
    "OPENAI_API_KEY",
    "OPENAI_MODEL",
    "DATABASE_URL",
    "TERSE_ACTOR_URL",
    "RELAY_WORKSPACE_KEY",
  ];
  const previous = Object.fromEntries(
    names.map((name) => [name, process.env[name]]),
  );
  for (const name of names) delete process.env[name];
  process.env.JANUS_DATA_DIR = directory;
  const store = new Store();
  const app = await createApp(store, { investigatorFactory });
  const server = app.listen(0, "127.0.0.1");
  await new Promise<void>((resolve) => server.once("listening", resolve));
  const address = server.address();
  assert(address && typeof address !== "string");
  return {
    store,
    async request(route: string, body?: unknown) {
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
    },
    async close() {
      app.locals.investigations.close();
      await new Promise<void>((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve())),
      );
      for (const name of names) {
        if (previous[name] === undefined) delete process.env[name];
        else process.env[name] = previous[name];
      }
      await rm(directory, { recursive: true, force: true });
    },
  };
}

test("incoming alerts create real cases while raw payloads remain private and missing agents are reported", async () => {
  const app = await fixture();
  try {
    const response = await app.request("/api/signals", alert);
    assert.equal(response.status, 201);
    assert.equal(response.data.case.mode, "live");
    assert.equal(response.data.case.demoService, undefined);
    assert.equal(response.data.case.severity, "P2");
    assert.equal(response.data.queued, false);
    assert.match(response.data.reason, /configure OPENAI_API_KEY/);
    assert.equal(response.data.case.evidence[0].simulated, false);
    assert.equal(response.data.case.evidence[0].visibility, "private");
    assert.equal(response.data.case.evidence[0].provenance, undefined);
    const vendor = await app.request("/api/state?organizationId=contoso");
    const partnerCase = vendor.data.cases.find(
      (item: any) => item.id === response.data.case.id,
    );
    assert.equal(partnerCase.title, alert.title);
    assert.equal(partnerCase.summary, alert.summary);
    assert.deepEqual(partnerCase.evidence, []);
    assert.equal(
      JSON.stringify(partnerCase).includes("customer-private-host"),
      false,
    );
    assert.equal(JSON.stringify(partnerCase).includes(alert.externalId), false);
    assert.equal(
      (await app.request(`/api/cases/${response.data.case.id}/advance`, {}))
        .status,
      400,
    );
  } finally {
    await app.close();
  }
});

test("alerts enforce organization membership, known connector, and distinct registered vendor", async () => {
  const app = await fixture();
  try {
    assert.equal(
      (
        await app.request("/api/signals", {
          ...alert,
          organizationId: "outsider",
        })
      ).status,
      403,
    );
    assert.equal(
      (
        await app.request("/api/signals", {
          ...alert,
          connectorId: "invented-provider",
        })
      ).status,
      400,
    );
    assert.equal(
      (await app.request("/api/signals", { ...alert, vendorId: "northstar" }))
        .status,
      400,
    );
    assert.equal(
      (
        await app.request("/api/signals", {
          ...alert,
          vendorId: "missing-vendor",
        })
      ).status,
      400,
    );
    assert.equal(
      (await app.request("/api/signals", { ...alert, externalId: " " })).status,
      400,
    );
    assert.equal((await app.store.listCases()).length, 0);
  } finally {
    await app.close();
  }
});

test("concurrent duplicate alerts retain one case and one investigation turn, including after reload", async () => {
  const calls: string[] = [];
  const investigatorFactory: InvestigatorFactory = async (options) => ({
    threadId: "signal-test-thread",
    invoke: async (_message, turnId) => {
      calls.push(turnId!);
      const context = (await options.tools.readCase()) as {
        case: { mode: string; evidence: { data: { payload: unknown } }[] };
      };
      assert.equal(context.case.mode, "live");
      assert.deepEqual(context.case.evidence[0].data.payload, alert.data);
      return {
        threadId: "signal-test-thread",
        text: "Test investigator read the private alert",
      };
    },
    close: async () => {},
  });
  const app = await fixture(investigatorFactory);
  try {
    const results = await Promise.all(
      Array.from({ length: 8 }, () => app.request("/api/signals", alert)),
    );
    assert.equal(results.filter((result) => result.status === 201).length, 1);
    assert.equal(results.filter((result) => result.status === 200).length, 7);
    const id = results[0].data.case.id;
    assert(results.every((result) => result.data.case.id === id));
    const deadline = Date.now() + 5000;
    while ((await app.store.getCase(id))?.runs?.[0].status !== "completed") {
      if (Date.now() > deadline)
        throw new Error("Signal investigation did not complete");
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
    assert.equal((await app.store.listCases()).length, 1);
    assert.equal((await app.store.getCase(id))?.runs?.length, 1);
    assert.deepEqual(calls, [`signal:${id}`]);
    const repeated = await app.request("/api/signals", {
      ...alert,
      title: "Retry must not overwrite the case",
      data: { changed: true },
    });
    assert.equal(repeated.status, 200);
    assert.equal(repeated.data.case.title, alert.title);
    assert.equal(repeated.data.case.evidence.length, 1);
    const restarted = new Store();
    await restarted.initialize();
    assert.equal((await restarted.getCase(id))?.runs?.length, 1);
    const reloadedSignals = new SignalService(
      restarted,
      {
        startPending: async () => {
          throw new Error("Completed signal must not run again");
        },
      },
      () => true,
    );
    const replayed = await reloadedSignals.ingest(signalInput.parse(alert));
    assert.equal(replayed.created, false);
    assert.equal(replayed.case.id, id);
    assert.equal((await restarted.listCases()).length, 1);
    const otherSource = await app.request("/api/signals", {
      ...alert,
      connectorId: "sentry",
      investigate: false,
    });
    assert.equal(otherSource.status, 201);
    assert.notEqual(otherSource.data.case.id, id);
    assert.equal(otherSource.data.queued, false);
    assert.match(otherSource.data.reason, /investigate was false/);
  } finally {
    await app.close();
  }
});

test("live signal ingestion rejects missing user authentication before account access", async () => {
  const script = `
    import { createApp } from './server/app.ts';
    const app = await createApp();
    const server = app.listen(0, '127.0.0.1');
    await new Promise(resolve => server.once('listening', resolve));
    const response = await fetch('http://127.0.0.1:' + server.address().port + '/api/signals', {method:'POST',headers:{'Content-Type':'application/json'},body:'{}'});
    console.log(response.status);
    await new Promise(resolve => server.close(resolve));
  `;
  const result = await promisify(execFile)(
    process.execPath,
    ["--import", "tsx", "--input-type=module", "-e", script],
    {
      cwd: process.cwd(),
      env: {
        ...process.env,
        JANUS_MODE: "live",
        OPENAI_API_KEY: "",
        OPENAI_MODEL: "",
        DATABASE_URL: "",
        RELAY_WORKSPACE_KEY: "",
      },
    },
  );
  assert.equal(result.stdout.trim(), "401");
});
