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
      if (organizationId === "notion") {
        assert.deepEqual(
          visible.integrations
            .map((item) => item.id)
            .filter((id) => id.startsWith("demo-")),
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
          visible.integrations
            .map((item) => item.id)
            .filter((id) => id.startsWith("demo-")),
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
          organizationId: "notion",
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
          organizationId: "aws",
        })
      ).status,
      202,
    );
    await until(
      async () => (await fixture.store.getCase(id))?.approvals.length === 1,
    );
    const pending = (await fixture.store.getCase(id))!.approvals[0];
    assert.equal(pending.organizationId, "aws");
    assert.equal(
      (await fixture.store.getCase(id))?.demoService?.route,
      "canary",
    );
    const customerState = await request("/api/state?organizationId=notion");
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
      "/api/state?organizationId=notion",
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
          organizationId: "notion",
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
          organizationId: "notion",
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

test("human conversation commits a private message with its pending turn and records the real worker reply", async () => {
  const fixture = await temporaryStore();
  const observed: string[] = [];
  const app = await createApp(fixture.store, {
    investigatorFactory: factory(
      async ({ organizationId, caseId }, message, turnId) => {
        const persisted = (await fixture.store.getCase(caseId))!;
        assert.equal(organizationId, "notion");
        assert.equal(message, "Check the private upload trace");
        assert(
          persisted.events.some(
            (entry) =>
              entry.actorType === "human" &&
              entry.channel === "janus" &&
              entry.body === message &&
              entry.visibility === "private",
          ),
        );
        assert(
          persisted.runs?.some(
            (run) => run.id === turnId && run.message === message,
          ),
        );
        observed.push(message);
      },
    ),
  });
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
    const item = newCase();
    await fixture.store.createCase(item);
    for (const body of [
      { organizationId: "ramp", text: "Cannot read this case" },
      { organizationId: "outsider", text: "Cannot impersonate a participant" },
    ]) {
      assert.equal(
        (await request(`/api/cases/${item.id}/messages`, body)).status,
        403,
      );
    }
    assert.equal(
      (
        await request(`/api/cases/${item.id}/messages`, {
          organizationId: "notion",
          text: "   ",
        })
      ).status,
      400,
    );
    assert.deepEqual(await fixture.store.getCase(item.id), item);
    const outsiderCase = newCase({ customerId: "outsider", vendorId: "aws" });
    await fixture.store.createCase(outsiderCase);
    assert.equal(
      (
        await request(`/api/cases/${outsiderCase.id}/messages`, {
          organizationId: "outsider",
          text: "No membership",
        })
      ).status,
      403,
    );
    assert.deepEqual(
      await fixture.store.getCase(outsiderCase.id),
      outsiderCase,
    );
    const queued = await request(`/api/cases/${item.id}/messages`, {
      organizationId: "notion",
      text: "  Check the private upload trace  ",
    });
    assert.equal(queued.status, 202);
    assert.equal(queued.data.queued, true);
    await until(
      async () =>
        (await fixture.store.getCase(item.id))?.runs?.[0]?.status ===
        "completed",
    );
    const completed = (await fixture.store.getCase(item.id))!;
    const conversation = completed.events.filter(
      (entry) => entry.channel === "janus",
    );
    assert.equal(conversation.length, 2);
    assert.deepEqual(
      conversation.map((entry) => entry.actorType),
      ["human", "agent"],
    );
    assert.equal(conversation[0].actor, "Notion team");
    assert.equal(
      conversation[1].body,
      "Test investigator completed its tool calls",
    );
    assert(
      conversation.every(
        (entry) => entry.type === "message" && entry.visibility === "private",
      ),
    );
    assert.deepEqual(observed, ["Check the private upload trace"]);
    const vendor = (
      await request("/api/state?organizationId=aws")
    ).data.cases.find((entry: any) => entry.id === item.id);
    assert(!vendor.events.some((entry: any) => entry.channel === "janus"));
    assert.deepEqual(vendor.runs, []);
  } finally {
    app.locals.investigations.close();
    await new Promise<void>((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve())),
    );
    await fixture.cleanup();
  }
});

test("case creation can immediately enqueue an actual investigator for the selected vendor", async () => {
  const fixture = await temporaryStore();
  const observed: string[] = [];
  const app = await createApp(fixture.store, {
    investigatorFactory: factory(async ({ organizationId }, message) => {
      observed.push(organizationId);
      assert.match(message, /Investigate this case/);
    }),
  });
  const server = app.listen(0, "127.0.0.1");
  await new Promise<void>((resolve) => server.once("listening", resolve));
  const address = server.address();
  assert(address && typeof address !== "string");
  try {
    const response = await fetch(`http://127.0.0.1:${address.port}/api/cases`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        organizationId: "aws",
        customerId: "ramp",
        vendorId: "aws",
        title: "Investigate attachment delay",
        startInvestigation: true,
      }),
    });
    assert.equal(response.status, 201);
    const item = (await response.json()) as any;
    assert.equal(item.runs[0].organizationId, "aws");
    await until(
      async () =>
        (await fixture.store.getCase(item.id))?.runs?.[0]?.status ===
        "completed",
    );
    assert.deepEqual(observed, ["aws"]);
  } finally {
    app.locals.investigations.close();
    await new Promise<void>((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve())),
    );
    await fixture.cleanup();
  }
});

test("seeded Ramp chat uses a real conversational worker without changing guided approvals or progress", async () => {
  const fixture = await temporaryStore();
  const original = (await fixture.store.getCase("JAN-1043"))!;
  const app = await createApp(fixture.store, {
    investigatorFactory: factory(
      async ({ conversationOnly, sharedReply, tools }) => {
        assert.equal(conversationOnly, true);
        assert.equal(sharedReply, false);
        const visible = (await tools.readCase()) as any;
        assert.equal(visible.case.customerId, "ramp");
        await assert.rejects(
          tools.requestAction({
            connectorId: "demo-customer",
            operation: "replay_exports",
            input: {},
            title: "Unauthorized conversational change",
            description: "Must not change recovery",
          }),
          /preserve/,
        );
        await assert.rejects(
          tools.concludeInvestigation({
            status: "resolved",
            summary: "No fresh verification",
            evidenceIds: [],
          }),
          /preserve/,
        );
      },
    ),
  });
  const server = app.listen(0, "127.0.0.1");
  await new Promise<void>((resolve) => server.once("listening", resolve));
  const address = server.address();
  assert(address && typeof address !== "string");
  try {
    const unavailable = await fetch(
      `http://127.0.0.1:${address.port}/api/cases/${original.id}/messages`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          organizationId: "ramp",
          target: "case",
          text: "Needs both Relay identities",
        }),
      },
    );
    assert.equal(unavailable.status, 503);
    assert.deepEqual(await fixture.store.getCase(original.id), original);
    const response = await fetch(
      `http://127.0.0.1:${address.port}/api/cases/${original.id}/messages`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          organizationId: "ramp",
          text: "What does this approval do?",
        }),
      },
    );
    assert.equal(response.status, 202);
    await until(
      async () =>
        (await fixture.store.getCase(original.id))?.runs?.[0]?.status ===
        "completed",
    );
    const updated = (await fixture.store.getCase(original.id))!;
    assert.equal(updated.step, original.step);
    assert.equal(updated.status, original.status);
    assert.deepEqual(updated.approvals, original.approvals);
    assert.deepEqual(updated.demoService, original.demoService);
    assert.deepEqual(updated.evidence, original.evidence);
    const human = updated.events.find(
      (entry) => entry.body === "What does this approval do?",
    )!;
    assert.equal(human.actorType, "human");
    assert.equal(human.actorId, "local-demo");
    assert.equal(human.visibility, "private");
    assert.equal(human.recipientOrganizationId, "ramp");
    const api = await fetch(
      `http://127.0.0.1:${address.port}/api/cases/${original.id}/approvals/${original.approvals[0].id}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ decision: "approved" }),
      },
    );
    assert.equal(api.status, 200);
    const continued = await fetch(
      `http://127.0.0.1:${address.port}/api/cases/${original.id}/advance`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ organizationId: "ramp" }),
      },
    );
    assert.equal(continued.status, 200);
    assert.equal(((await continued.json()) as any).status, "resolved");
  } finally {
    app.locals.investigations.close();
    await new Promise<void>((resolve) => server.close(() => resolve()));
    await fixture.cleanup();
  }
});

test("partner and room messages use Relay, preserve human identity, and queue recipients once even when receipt wins the race", async () => {
  const fixture = await temporaryStore();
  const sent: any[] = [];
  const replies: string[] = [];
  const app = await createApp(fixture.store, {
    investigatorFactory: factory(
      async ({ organizationId, conversationOnly, sharedReply }) => {
        assert(conversationOnly);
        assert(sharedReply);
        replies.push(organizationId);
      },
    ),
    relaySender: async (input) => {
      sent.push(input);
      const receipt = {
        ...input,
        messageId: `message-${sent.length}`,
        deliveryId: `message-${sent.length}`,
        createdAt: new Date().toISOString(),
      };
      await app.locals.investigations.acceptMessage(receipt);
      await app.locals.investigations.acceptMessage(receipt);
      return { messageId: receipt.messageId, createdAt: receipt.createdAt };
    },
  });
  const server = app.listen(0, "127.0.0.1");
  await new Promise<void>((resolve) => server.once("listening", resolve));
  const address = server.address();
  assert(address && typeof address !== "string");
  const post = async (body: unknown) =>
    fetch(`http://127.0.0.1:${address.port}/api/cases/JAN-1044/messages`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
  try {
    const original = (await fixture.store.getCase("JAN-1044"))!;
    assert.equal(
      (
        await post({
          organizationId: "ramp",
          recipientOrganizationId: "notion",
          text: "No access",
        })
      ).status,
      403,
    );
    assert.equal(
      (
        await post({
          organizationId: "ramp",
          actor: "AWS owner",
          text: "Cannot forge",
        })
      ).status,
      400,
    );
    assert.equal(
      (
        await post({
          organizationId: "ramp",
          target: "case",
          recipientOrganizationId: "aws",
          text: "Ambiguous",
        })
      ).status,
      400,
    );
    assert.equal(sent.length, 0);
    assert.deepEqual(await fixture.store.getCase(original.id), original);
    assert.equal(
      (
        await post({
          organizationId: "ramp",
          recipientOrganizationId: "aws",
          text: "Can AWS explain the route change?",
        })
      ).status,
      202,
    );
    await until(
      async () =>
        (await fixture.store.getCase(original.id))?.runs?.[0]?.status ===
        "completed",
    );
    let updated = (await fixture.store.getCase(original.id))!;
    assert.equal(
      updated.events.filter((entry) => entry.id === "relay:message-1").length,
      1,
    );
    assert.equal(updated.runs?.length, 1);
    assert.equal(updated.runs?.[0].organizationId, "aws");
    assert.equal(sent[0].actorType, "human");
    assert.equal(sent[0].actor, "Ramp team");
    assert.equal(sent[0].actorId, "local-demo");
    assert.equal(sent[0].from, "ramp");
    assert.equal(sent[0].to, "aws");
    assert.equal(
      (
        await post({
          organizationId: "ramp",
          target: "case",
          text: "Please summarize for everyone",
        })
      ).status,
      202,
    );
    await until(
      async () =>
        (await fixture.store.getCase(original.id))?.runs?.length === 3 &&
        (await fixture.store.getCase(original.id))!.runs!.every(
          (run) => run.status === "completed",
        ),
    );
    updated = (await fixture.store.getCase(original.id))!;
    assert.equal(
      updated.events.filter((entry) => entry.id === "relay:message-2").length,
      1,
    );
    assert.equal(
      updated.events.find((entry) => entry.id === "relay:message-2")!.target,
      "case",
    );
    assert.deepEqual(replies.sort(), ["aws", "aws", "ramp"]);
    assert(
      updated.events
        .filter((entry) => entry.title === "Agent reply")
        .every((entry) => entry.visibility === "shared"),
    );
    assert.equal(updated.step, original.step);
    assert.equal(updated.status, original.status);
    assert.deepEqual(updated.approvals, original.approvals);
  } finally {
    app.locals.investigations.close();
    await new Promise<void>((resolve) => server.close(() => resolve()));
    await fixture.cleanup();
  }
});

test("a failed Relay send leaves the shared human message and own turn uncommitted", async () => {
  const fixture = await temporaryStore();
  const original = (await fixture.store.getCase("JAN-1044"))!;
  const service = new InvestigationService(
    fixture.store,
    factory(async () => {
      throw new Error("Must not run");
    }),
    async () => {
      throw new Error("Provider temporarily unavailable");
    },
  );
  try {
    await assert.rejects(
      service.enqueueHuman(
        original.id,
        "ramp",
        "Message everyone",
        "Ramp team",
        { target: "case" },
      ),
      /Provider temporarily unavailable/,
    );
    assert.deepEqual(await fixture.store.getCase(original.id), original);
  } finally {
    service.close();
    await fixture.cleanup();
  }
});

test("legacy agent receipt events do not enqueue a second turn when their old run has no sourceEventId", async () => {
  const fixture = await temporaryStore();
  const service = new InvestigationService(
    fixture.store,
    factory(async () => {
      throw new Error("Legacy receipt must not execute");
    }),
  );
  try {
    const item = newCase();
    item.events.push({
      id: "relay:legacy-message",
      type: "message",
      organizationId: "aws",
      actor: "AWS Support",
      title: "Partner message received",
      body: "Previously handled",
      visibility: "shared",
      createdAt: item.createdAt,
    });
    item.runs = [
      {
        id: "legacy-turn",
        organizationId: "notion",
        message: "Previously handled",
        status: "completed",
        createdAt: item.createdAt,
      },
    ];
    await fixture.store.createCase(item);
    await service.acceptMessage({
      caseId: item.id,
      eventId: "legacy-event",
      from: "aws",
      to: "notion",
      text: "Previously handled",
      messageId: "legacy-message",
      deliveryId: "redelivery",
    });
    const after = await fixture.store.getCase(item.id);
    assert.deepEqual(after?.runs, item.runs);
    assert.deepEqual(after?.events, item.events);
    assert.equal(after?.status, item.status);
  } finally {
    service.close();
    await fixture.cleanup();
  }
});

test("receive tool reads only delivered partner messages without provider calls or extra turns", async () => {
  const fixture = await temporaryStore();
  const originalFetch = globalThis.fetch;
  let reads = 0;
  const service = new InvestigationService(
    fixture.store,
    factory(async ({ tools }) => {
      const first = (await tools.receivePartnerMessages()) as any[];
      const second = (await tools.receivePartnerMessages()) as any[];
      assert.deepEqual(second, first);
      assert.deepEqual(
        first.map((entry) => entry.messageId),
        ["received-1"],
      );
      assert.equal(first[0].from, "aws");
      assert.equal(first[0].text, "Authenticated partner response");
      reads += 2;
    }),
  );
  try {
    const item = newCase();
    item.events.push(
      {
        id: "seed:correspondence",
        type: "message",
        channel: "relay",
        organizationId: "aws",
        actor: "AWS",
        title: "Illustrative history",
        body: "Not an actual delivery",
        visibility: "shared",
        createdAt: item.createdAt,
      },
      {
        id: "relay:private",
        type: "message",
        organizationId: "aws",
        actor: "AWS",
        title: "Internal",
        body: "Private evidence",
        visibility: "private",
        createdAt: item.createdAt,
      },
      {
        id: "relay:own",
        type: "message",
        organizationId: "notion",
        actor: "Notion",
        title: "Own message",
        body: "Outgoing",
        visibility: "shared",
        createdAt: item.createdAt,
      },
    );
    await fixture.store.createCase(item);
    globalThis.fetch = async () => {
      throw new Error("Unexpected network read");
    };
    await service.acceptMessage({
      caseId: item.id,
      eventId: "event-1",
      from: "aws",
      to: "notion",
      text: "Authenticated partner response",
      messageId: "received-1",
      deliveryId: "received-1",
    });
    await until(
      async () =>
        (await fixture.store.getCase(item.id))?.runs?.[0]?.status ===
        "completed",
    );
    assert.equal(reads, 2);
    assert.equal((await fixture.store.getCase(item.id))?.runs?.length, 1);
  } finally {
    globalThis.fetch = originalFetch;
    service.close();
    await fixture.cleanup();
  }
});

test("single worker selects the oldest pending turn across cases", async () => {
  const fixture = await temporaryStore();
  const observed: string[] = [];
  const service = new InvestigationService(
    fixture.store,
    factory(async (_options, message) => {
      observed.push(message);
    }),
  );
  try {
    const older = newCase({ customerId: "ramp", vendorId: "aws" });
    older.runs = [
      {
        id: "older",
        organizationId: "ramp",
        message: "older chat",
        status: "pending",
        createdAt: "2026-10-31T22:20:29.000Z",
      },
    ];
    await fixture.store.createCase(older);
    const firstInStore = newCase();
    firstInStore.runs = [
      {
        id: "newer-1",
        organizationId: "aws",
        message: "newer followup",
        status: "pending",
        createdAt: "2026-10-31T22:20:37.000Z",
      },
      {
        id: "newer-2",
        organizationId: "notion",
        message: "latest followup",
        status: "pending",
        createdAt: "2026-10-31T22:20:40.000Z",
      },
    ];
    await fixture.store.createCase(firstInStore);
    assert.equal((await fixture.store.listCases())[0].id, firstInStore.id);
    await service.recover();
    await until(
      async () =>
        (await fixture.store.getCase(firstInStore.id))?.runs?.every(
          (run) => run.status === "completed",
        ) === true,
    );
    assert.deepEqual(observed, [
      "older chat",
      "newer followup",
      "latest followup",
    ]);
  } finally {
    service.close();
    await fixture.cleanup();
  }
});
