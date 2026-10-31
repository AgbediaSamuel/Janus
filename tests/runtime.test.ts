import { test } from "node:test";
import assert from "node:assert/strict";
import { commitCaseState, emptyCaseState } from "../server/runtime/case-state";

test("case events preserve state and reject stale concurrent writers", async () => {
  const first = await commitCaseState(emptyCaseState(), {
    eventId: "opened",
    expectedVersion: 0,
    snapshotJson: '{"id":"case-1"}',
  });
  assert.equal(first.state.version, 1);
  await assert.rejects(
    () =>
      commitCaseState(first.state, {
        eventId: "other",
        expectedVersion: 0,
        snapshotJson: "{}",
      }),
    /version conflict/,
  );
  assert.equal(first.state.snapshotJson, '{"id":"case-1"}');
});

test("replayed events do not overwrite newer state or increment its version", async () => {
  const firstEvent = {
    eventId: "opened",
    expectedVersion: 0,
    snapshotJson: '{"step":1}',
  };
  const first = await commitCaseState(emptyCaseState(), firstEvent);
  const second = await commitCaseState(first.state, {
    eventId: "evidence",
    expectedVersion: 1,
    snapshotJson: '{"step":2}',
  });
  const replay = await commitCaseState(second.state, firstEvent);
  assert.equal(replay.state, second.state);
  assert.deepEqual(replay.result, {
    version: 2,
    eventVersion: 1,
    duplicate: true,
  });
  await assert.rejects(
    () =>
      commitCaseState(second.state, {
        ...firstEvent,
        snapshotJson: '{"step":3}',
      }),
    /different snapshot/,
  );
});

import {
  createRelayTransport,
  type RelayClient,
} from "../server/runtime/relay";

test("Relay validates authenticated sender and acknowledges only after successful persistence", async () => {
  const calls: string[] = [];
  const message = {
    id: "message-1",
    messageId: "message-1",
    text: "Trace result",
    from: { id: "vendor-agent" },
    metadata: {
      caseId: "case-1",
      eventId: "event-1",
      organizationId: "spoofed",
    },
  };
  const delivery = {
    id: "delivery-1",
    recipient: { id: "customer-agent", name: "customer" },
    state: "queued" as const,
    attempts: 0,
    message,
  };
  const recipient: RelayClient = {
    id: "customer-agent",
    handle: "customer",
    sendMessage: async () => message,
    inbox: {
      list: async () => ({
        items: [
          {
            ...delivery,
            id: "attacker",
            message: { ...message, from: { id: "attacker-agent" } },
          },
          delivery,
        ],
      }),
      subscribe: async function* () {},
      ack: async () => {
        calls.push("ack");
        return {
          supported: true,
          deliveryId: delivery.id,
          state: "read",
        } as Awaited<ReturnType<RelayClient["inbox"]["ack"]>>;
      },
    },
  };
  const partner: RelayClient = {
    ...recipient,
    id: "vendor-agent",
    handle: "vendor",
  };
  const transport = createRelayTransport(async (id) =>
    id === "customer" ? recipient : partner,
  );
  const messages = await transport.receive({
    organizationId: "customer",
    partnerId: "vendor",
    caseId: "case-1",
    onMessage: async (value) => {
      assert.equal(value.from, "vendor");
      calls.push("persist");
    },
  });
  assert.equal(messages.length, 1);
  assert.deepEqual(calls, ["persist", "ack"]);
  calls.length = 0;
  await assert.rejects(
    transport.receive({
      organizationId: "customer",
      partnerId: "vendor",
      caseId: "case-1",
      onMessage: async () => {
        throw new Error("Persistence unavailable");
      },
    }),
    /Persistence unavailable/,
  );
  assert.deepEqual(calls, []);
});
