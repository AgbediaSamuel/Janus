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
    onDirectMessage: () => () => {},
    inbox: {
      get: async () => ({ unreadChannels: [], mentions: [], recentReactions: [], unreadDms: [{ conversationId: "conversation-1", from: "vendor", unreadCount: 2 }] }),
    },
    messages: {
      listDirect: async () => ([
          {
            ...message, id: "attacker", from: { id: "attacker-agent" },
          },
          message,
        ]),
      markRead: async () => {
        calls.push("ack");
        return { messageId: message.messageId };
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


test("Relay direct-message listener persists actual events before marking them read", async () => {
  const calls: string[] = [];
  const message = { id: "dm-1", messageId: "dm-1", text: "Partner diagnostic", from: { id: "vendor-agent" }, metadata: { caseId: "case-1", eventId: "event-1" } };
  const controller = new AbortController();
  let emit: ((value: typeof message) => void) | undefined;
  const recipient: RelayClient = {
    id: "customer-agent", handle: "customer", sendMessage: async () => message,
    onDirectMessage: (handler) => { emit = handler; calls.push("listen"); return () => { calls.push("unsubscribe"); }; },
    inbox: { get: async () => { calls.push("replay"); return { unreadChannels: [], mentions: [], recentReactions: [], unreadDms: [] }; } },
    messages: { listDirect: async () => [], markRead: async () => { calls.push("read"); controller.abort(); return { messageId: message.messageId }; } },
  };
  const partner = { ...recipient, id: "vendor-agent", handle: "vendor" };
  const transport = createRelayTransport(async (id) => id === "customer" ? recipient : partner);
  const subscribed = transport.subscribe({ organizationId: "customer", partnerId: "vendor", signal: controller.signal, onMessage: async (received) => { assert.equal(received.messageId, "dm-1"); calls.push("persist"); } });
  await new Promise<void>((resolve) => setImmediate(resolve));
  assert(emit);
  emit(message);
  await subscribed;
  assert.deepEqual(calls, ["listen", "replay", "persist", "read", "unsubscribe"]);
});


test("a slow unread-history request cannot delay a live Relay message", async () => {
  const message = { id: "live-dm", messageId: "live-dm", text: "Live result", from: { id: "vendor-agent" }, metadata: { caseId: "case-1", eventId: "event-live" } };
  const controller = new AbortController();
  let emit: ((value: typeof message) => void) | undefined;
  let persisted = false;
  const recipient: RelayClient = {
    id: "customer-agent", handle: "customer", sendMessage: async () => message,
    onDirectMessage: (handler) => { emit = handler; return () => {}; },
    inbox: { get: () => new Promise(() => {}) },
    messages: { listDirect: async () => [], markRead: async () => { assert(persisted); controller.abort(); return { messageId: message.messageId }; } },
  };
  const partner = { ...recipient, id: "vendor-agent", handle: "vendor" };
  const transport = createRelayTransport(async (id) => id === "customer" ? recipient : partner);
  const subscribed = transport.subscribe({ organizationId: "customer", partnerId: "vendor", signal: controller.signal, onMessage: async () => { persisted = true; } });
  await new Promise<void>((resolve) => setImmediate(resolve));
  assert(emit);
  emit(message);
  await subscribed;
  assert(persisted);
});
