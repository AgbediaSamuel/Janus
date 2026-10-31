import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import type { Server } from "node:http";
import type { InvestigatorOptions } from "../server/agents";
import { createApp } from "../server/app";
import { Store } from "../server/store";
import { InvestigationService } from "../server/investigations";
import { newCase } from "../server/cases";

async function until(check: () => Promise<boolean>) {
  const deadline = Date.now() + 5000;
  while (!(await check())) {
    if (Date.now() > deadline)
      throw new Error("Investigation worker did not reach the expected state");
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}

async function temporaryStore() {
  const directory = await mkdtemp(path.join(tmpdir(), "janus-investigation-"));
  const previousDirectory = process.env.JANUS_DATA_DIR;
  process.env.JANUS_DATA_DIR = directory;
  const store = new Store();
  await store.initialize();
  return {
    store,
    async cleanup() {
      if (previousDirectory === undefined) delete process.env.JANUS_DATA_DIR;
      else process.env.JANUS_DATA_DIR = previousDirectory;
      await rm(directory, { recursive: true, force: true });
    },
  };
}

function factory(
  run: (
    options: InvestigatorOptions,
    message: string,
    turnId?: string,
  ) => Promise<void>,
) {
  return async (options: InvestigatorOptions) => ({
    threadId: `test:${options.organizationId}:${options.caseId}`,
    invoke: async (message: string, turnId?: string) => {
      await run(options, message, turnId);
      return {
        threadId: "test-thread",
        text: "Test investigator completed its tool calls",
      };
    },
    close: async () => {},
  });
}

test("agent-driven demo executes a bad probe, vendor-approved rollback, and fresh customer verification through the API", async () => {
  const fixture = await temporaryStore();
  const observed: string[] = [];
  const investigatorFactory = factory(
    async ({ tools, organizationId }, message) => {
      const visible = (await tools.readCase()) as {
        case: { approvals: unknown[] };
        integrations: { id: string }[];
      };
      if (organizationId === "northstar") {
        assert.deepEqual(
          visible.integrations.map((item) => item.id),
          ["demo-customer"],
        );
        assert.deepEqual(visible.case.approvals, []);
        await assert.rejects(
          tools.requestAction({
            connectorId: "demo-vendor",
            operation: "rollback",
            input: {},
            title: "Forbidden rollback",
            description: "Customer cannot access vendor controls",
          }),
          /Unknown connector operation/,
        );
        const receipt = (await tools.collectEvidence({
          connectorId: "demo-customer",
          operation: "probe",
          input: {},
        })) as { evidenceId: string; result: { status: number } };
        observed.push(`probe:${receipt.result.status}`);
        if (receipt.result.status === 503) {
          const invented = (await tools.addEvidence({
            source: "guess",
            title: "Unverified recovery",
            summary: "Model claim only",
            data: { status: 200 },
            visibility: "private",
          })) as { id: string };
          await assert.rejects(
            tools.concludeInvestigation({
              status: "resolved",
              summary: "Unverified",
              evidenceIds: [invented.id],
            }),
            /verification evidence/,
          );
          await assert.rejects(
            tools.concludeInvestigation({
              status: "resolved",
              summary: "Still failing",
              evidenceIds: [receipt.evidenceId],
            }),
            /verification evidence/,
          );
          await tools.concludeInvestigation({
            status: "waiting",
            summary: "Vendor must inspect rollout",
            evidenceIds: [receipt.evidenceId],
          });
        } else {
          await tools.concludeInvestigation({
            status: "resolved",
            summary:
              "Fresh checkout probe returned 200 after approved rollback",
            evidenceIds: [receipt.evidenceId],
          });
        }
      } else {
        assert.deepEqual(
          visible.integrations.map((item) => item.id),
          ["demo-vendor"],
        );
        if (message.includes("approved action completed")) return;
        await tools.collectEvidence({
          connectorId: "demo-vendor",
          operation: "rollouts",
          input: {},
        });
        await tools.requestAction({
          connectorId: "demo-vendor",
          operation: "rollback",
          input: {},
          title: "Restore stable route",
          description: "Canary route is unhealthy",
        });
        observed.push("approval:requested");
      }
    },
  );
  const app = await createApp(fixture.store, { investigatorFactory });
  const server: Server = app.listen(0, "127.0.0.1");
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
    const created = await request("/api/cases", {});
    assert.equal(created.status, 201);
    const id = created.data.id;
    assert.equal(
      (await request(`/api/demo/service/${id}/checkout`, {})).status,
      503,
    );
    assert.equal(
      (
        await request(`/api/cases/${id}/investigate`, {
          organizationId: "northstar",
        })
      ).status,
      202,
    );
    await until(
      async () =>
        (await fixture.store.getCase(id))?.runs?.filter(
          (run) => run.status === "completed",
        ).length === 1,
    );
    assert.equal((await request(`/api/cases/${id}/advance`, {})).status, 409);
    assert.equal(
      (
        await request(`/api/cases/${id}/investigate`, {
          organizationId: "contoso",
        })
      ).status,
      202,
    );
    await until(
      async () => (await fixture.store.getCase(id))?.approvals.length === 1,
    );
    const pending = (await fixture.store.getCase(id))!.approvals[0];
    assert.equal(pending.organizationId, "contoso");
    assert.equal(
      (await fixture.store.getCase(id))?.demoService?.route,
      "canary",
    );
    const customerState = await request("/api/state?organizationId=northstar");
    assert.deepEqual(
      customerState.data.cases.find((item: any) => item.id === id).approvals,
      [],
    );
    const approved = await request(`/api/cases/${id}/approvals/${pending.id}`, {
      decision: "approved",
    });
    assert.equal(approved.status, 200);
    assert.equal(approved.data.approvals[0].executionStatus, "succeeded");
    const customerAfterApproval = await request(
      "/api/state?organizationId=northstar",
    );
    assert.equal(
      JSON.stringify(customerAfterApproval.data).includes(
        "Restore stable route",
      ),
      false,
    );
    assert.equal(
      (
        await request(`/api/cases/${id}/approvals/${pending.id}`, {
          decision: "approved",
        })
      ).status,
      409,
    );
    assert.equal(
      (await request(`/api/demo/service/${id}/checkout`, {})).status,
      200,
    );
    assert.equal(
      (
        await request(`/api/cases/${id}/investigate`, {
          organizationId: "northstar",
          message: "Verify recovery",
        })
      ).status,
      202,
    );
    await until(
      async () => (await fixture.store.getCase(id))?.status === "resolved",
    );
    await until(
      async () =>
        !(await fixture.store.getCase(id))?.runs?.some(
          (run) => run.status === "running",
        ),
    );
    const final = (await fixture.store.getCase(id))!;
    assert.equal(final.approvals[0].executionStatus, "succeeded");
    assert(final.approvals[0].completedAt);
    assert.deepEqual(observed, [
      "probe:503",
      "approval:requested",
      "probe:200",
    ]);
    const guided = await request("/api/cases", {});
    await request(`/api/cases/${guided.data.id}/advance`, {});
    assert.equal(
      (
        await request(`/api/cases/${guided.data.id}/investigate`, {
          organizationId: "northstar",
        })
      ).status,
      409,
    );
  } finally {
    app.locals.investigations.close();
    await new Promise<void>((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve())),
    );
    await fixture.cleanup();
  }
});

test("worker recovers persisted running turns using their original ID and deduplicates Relay redelivery", async () => {
  const fixture = await temporaryStore();
  const calls: string[] = [];
  const service = new InvestigationService(
    fixture.store,
    factory(async (_options, _message, turnId) => {
      calls.push(turnId!);
    }),
  );
  try {
    const item = newCase();
    item.runs = [
      {
        id: "original-turn",
        organizationId: item.customerId,
        message: "Recover me",
        status: "running",
        createdAt: new Date().toISOString(),
      },
    ];
    await fixture.store.createCase(item);
    await service.recover();
    await until(
      async () =>
        (await fixture.store.getCase(item.id))?.runs?.[0].status ===
        "completed",
    );
    assert.deepEqual(calls, ["original-turn"]);
    const message = {
      caseId: item.id,
      eventId: "remote-event",
      from: item.vendorId,
      to: item.customerId,
      text: "Vendor evidence",
      messageId: "message-1",
      deliveryId: "delivery-1",
    };
    await service.acceptMessage(message);
    await service.acceptMessage({ ...message, deliveryId: "delivery-retry" });
    await until(
      async () =>
        (await fixture.store.getCase(item.id))?.runs?.every(
          (run) => run.status === "completed",
        ) === true,
    );
    const updated = (await fixture.store.getCase(item.id))!;
    assert.equal(
      updated.events.filter((entry) => entry.id === "relay:message-1").length,
      1,
    );
    assert.equal(updated.runs?.length, 2);
    assert.equal(calls.length, 2);
  } finally {
    service.close();
    await fixture.cleanup();
  }
});

test("resolution rejects a successful probe collected before the latest action completed", async () => {
  const fixture = await temporaryStore();
  let rejected = false;
  const service = new InvestigationService(
    fixture.store,
    factory(async ({ tools, caseId }) => {
      const receipt = (await tools.collectEvidence({
        connectorId: "demo-customer",
        operation: "probe",
        input: {},
      })) as { evidenceId: string; result: { status: number } };
      assert.equal(receipt.result.status, 200);
      await fixture.store.updateCase(caseId, (item) => {
        const observation = item.evidence.find(
          (entry) => entry.id === receipt.evidenceId,
        )!;
        item.approvals.push({
          id: "later-action",
          organizationId: item.vendorId,
          title: "Later route change",
          description: "A mutation completed after this observation",
          requestedAt: item.createdAt,
          decidedAt: item.createdAt,
          completedAt: new Date(
            Date.parse(observation.collectedAt) + 1,
          ).toISOString(),
          status: "approved",
          executionStatus: "succeeded",
        });
      });
      await assert.rejects(
        tools.concludeInvestigation({
          status: "resolved",
          summary: "Stale observation",
          evidenceIds: [receipt.evidenceId],
        }),
        /verification evidence/,
      );
      rejected = true;
    }),
  );
  try {
    const item = newCase();
    item.demoService!.route = "stable";
    await fixture.store.createCase(item);
    await service.enqueue(
      item.id,
      item.customerId,
      "Check verification freshness",
    );
    await until(
      async () =>
        (await fixture.store.getCase(item.id))?.runs?.[0].status ===
        "completed",
    );
    assert.equal(rejected, true);
    assert.notEqual((await fixture.store.getCase(item.id))?.status, "resolved");
  } finally {
    service.close();
    await fixture.cleanup();
  }
});
