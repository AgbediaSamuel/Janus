import { test } from "node:test";
import assert from "node:assert/strict";
import {
  createInvestigationTools,
  type InvestigatorTools,
  investigationThreadId,
} from "../server/agents";
import { workspaceIdentity } from "../server/runtime/freestyle";

function callbacks(
  overrides: Partial<InvestigatorTools> = {},
): InvestigatorTools {
  return {
    readCase: async () => ({ id: "case-1" }),
    collectEvidence: async () => ({}),
    addEvidence: async () => ({}),
    requestAction: async () => ({ status: "pending" }),
    sendPartnerMessage: async () => ({}),
    receivePartnerMessages: async () => [],
    concludeInvestigation: async () => ({}),
    ...overrides,
  };
}

test("agent tool inputs cannot override server-bound organization or case", async () => {
  let received: unknown;
  const tools = createInvestigationTools(
    callbacks({
      collectEvidence: async (input) => {
        received = input;
        return { data: "private" };
      },
    }),
  );
  const collect = tools.find((entry) => entry.name === "collect_evidence")!;
  await collect.invoke({
    connectorId: "logs",
    operation: "search",
    input: { query: "error" },
    organizationId: "other-org",
    caseId: "other-case",
  });
  assert.deepEqual(received, {
    connectorId: "logs",
    operation: "search",
    input: { query: "error" },
  });
});

test("external actions are proposals and never invoke evidence connector callbacks", async () => {
  let reads = 0;
  let proposals = 0;
  const tools = createInvestigationTools(
    callbacks({
      collectEvidence: async () => {
        reads++;
      },
      requestAction: async () => {
        proposals++;
        return { status: "pending" };
      },
    }),
  );
  const request = tools.find((entry) => entry.name === "request_action")!;
  const output = await request.invoke({
    connectorId: "deploy",
    operation: "rollback",
    input: { revision: "previous" },
    title: "Rollback",
    description: "Restore prior revision",
  });
  assert.deepEqual(output, { status: "pending" });
  assert.equal(proposals, 1);
  assert.equal(reads, 0);
});

test("checkpoint and workspace identity separate organization-case pairs without delimiter collisions", () => {
  assert.notEqual(
    investigationThreadId("a:b", "c"),
    investigationThreadId("a", "b:c"),
  );
  assert.notEqual(
    investigationThreadId("customer", "same-case"),
    investigationThreadId("vendor", "same-case"),
  );
  const first = workspaceIdentity({
    organizationId: "customer",
    caseId: "same-case",
  });
  const second = workspaceIdentity({
    organizationId: "vendor",
    caseId: "same-case",
  });
  assert.notEqual(first.slug, second.slug);
  assert.notEqual(first.metadata.organization, second.metadata.organization);
  assert.equal(first.metadata.case, second.metadata.case);
});

import {
  invokeCheckpointedTurn,
  type CheckpointedAgent,
} from "../server/agents/turn";

test("a recovered pending turn resumes without submitting duplicate input", async () => {
  const inputs: unknown[] = [];
  const agent: CheckpointedAgent = {
    getState: async () => ({
      next: ["tools"],
      values: { messages: [{ id: "turn-1", content: "Investigate" }] },
    }),
    invoke: async (input) => {
      inputs.push(input);
      return { messages: [{ content: "Resumed result" }] };
    },
  };
  assert.equal(
    await invokeCheckpointedTurn(agent, "thread-1", "Investigate", "turn-1"),
    "Resumed result",
  );
  assert.deepEqual(inputs, [null]);
});

test("replaying a completed turn reads its checkpoint and never invokes the agent again", async () => {
  const agent: CheckpointedAgent = {
    getState: async () => ({
      next: [],
      values: {
        messages: [
          { id: "turn-1", content: "Investigate" },
          { content: "Complete" },
        ],
      },
    }),
    invoke: async () => {
      throw new Error("Duplicate invocation");
    },
  };
  assert.equal(
    await invokeCheckpointedTurn(agent, "thread-1", "Investigate", "turn-1"),
    "Complete",
  );
});

test("a new turn first resumes unfinished work and then submits its own stable message ID", async () => {
  const inputs: unknown[] = [];
  const agent: CheckpointedAgent = {
    getState: async () => ({
      next: ["tools"],
      values: { messages: [{ id: "turn-1", content: "Previous" }] },
    }),
    invoke: async (input) => {
      inputs.push(input);
      return { messages: [{ content: "Result" }] };
    },
  };
  await invokeCheckpointedTurn(agent, "thread-1", "New request", "turn-2");
  assert.deepEqual(inputs, [
    null,
    { messages: [{ role: "user", content: "New request", id: "turn-2" }] },
  ]);
});

import { createDeepAgent } from "deepagents";
import { FakeListChatModel } from "@langchain/core/utils/testing";
import { MemorySaver } from "@langchain/langgraph";

test("checkpoint replay works against an actual Deep Agents graph with a test model", async () => {
  const agent = createDeepAgent({
    model: new FakeListChatModel({ responses: ["Recorded diagnostic result"] }),
    tools: createInvestigationTools(callbacks()),
    checkpointer: new MemorySaver(),
  });
  const result = await invokeCheckpointedTurn(
    agent,
    "test-graph",
    "Inspect the case",
    "turn-1",
  );
  assert.equal(result, "Recorded diagnostic result");
  const replay = await invokeCheckpointedTurn(
    agent,
    "test-graph",
    "Do not append this replacement",
    "turn-1",
  );
  assert.equal(replay, result);
  const snapshot = (await agent.getState({
    configurable: { thread_id: "test-graph" },
  })) as { values: { messages: { id?: string; content: unknown }[] } };
  assert.equal(
    snapshot.values.messages.filter((entry) => entry.id === "turn-1").length,
    1,
  );
  assert.equal(
    snapshot.values.messages.some(
      (entry) => entry.content === "Do not append this replacement",
    ),
    false,
  );
});
