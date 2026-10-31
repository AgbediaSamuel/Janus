import { randomUUID } from "node:crypto";
import { AsyncResource } from "node:async_hooks";
import { Store } from "./store";
import { addEvidence, event, projectCase } from "./cases";
import { HttpError } from "./config";
import { connectorDefinitions, executeConnector } from "./connectors";
import { createInvestigator } from "./agents";
import { demoDefinitions, executeDemo } from "./demo-service";
import { executeFixtureConnection } from "./fixture-connections";
import {
  configuredRelayTokens,
  sendRelayMessage,
  subscribeRelayMessages,
  type ReceivedRelayMessage,
} from "./runtime/relay";

export type InvestigatorFactory = typeof createInvestigator;

export class InvestigationService {
  private workerContext = new AsyncResource("JanusInvestigationWorker");
  private draining = false;
  private wakeRequested = false;
  private subscriptions = new Map<string, AbortController>();

  constructor(
    private store: Store,
    private investigatorFactory: InvestigatorFactory = createInvestigator,
    private relaySender: typeof sendRelayMessage = sendRelayMessage,
  ) {}

  async enqueue(caseId: string, organizationId: string, message: string) {
    await this.queueTurn(caseId, organizationId, message);
  }

  async enqueueHuman(
    caseId: string,
    organizationId: string,
    text: string,
    actor: string,
    options: {
      target?: "agent" | "case";
      recipientOrganizationId?: string;
      actorId?: string;
    } = {},
  ) {
    const item = await this.store.getCase(caseId);
    if (!item) throw new HttpError(404, "Case not found");
    if (![item.customerId, item.vendorId].includes(organizationId))
      throw new HttpError(403, "Organization is not a case participant");
    const target = options.target || "agent";
    const recipient = options.recipientOrganizationId || organizationId;
    if (![item.customerId, item.vendorId].includes(recipient))
      throw new HttpError(403, "Recipient is not a case participant");
    if (target === "agent" && recipient === organizationId) {
      await this.queueTurn(
        caseId,
        organizationId,
        text,
        actor,
        options.actorId,
      );
      return;
    }
    const partnerId =
      organizationId === item.customerId ? item.vendorId : item.customerId;
    await this.watchCase(caseId);
    const sent = await this.relaySender({
      caseId,
      eventId: randomUUID(),
      from: organizationId,
      to: partnerId,
      text,
      actorType: "human",
      actor,
      actorId: options.actorId,
      target,
    });
    const sourceEventId = `relay:${sent.messageId}`;
    await this.store.updateCase(caseId, (current) => {
      if (!current.events.some((entry) => entry.id === sourceEventId))
        current.events.push({
          id: sourceEventId,
          type: "message",
          channel: "janus",
          actorType: "human",
          actor,
          actorId: options.actorId,
          target,
          recipientOrganizationId: target === "agent" ? partnerId : undefined,
          organizationId,
          title:
            target === "case"
              ? "Message to the case"
              : "Message to partner agent",
          body: text,
          visibility: "shared",
          delivery: { status: "accepted", messageId: sent.messageId },
          createdAt: sent.createdAt || new Date().toISOString(),
        });
      if (target === "case") {
        current.runs ??= [];
        if (
          !current.runs.some(
            (run) =>
              run.sourceEventId === sourceEventId &&
              run.organizationId === organizationId,
          )
        )
          current.runs.push({
            id: randomUUID(),
            organizationId,
            message: text,
            kind: current.step > 0 ? "conversation" : "investigation",
            replyVisibility: "shared",
            sourceEventId,
            status: "pending",
            createdAt: new Date().toISOString(),
          });
        if (current.step === 0 && current.status !== "awaiting_approval")
          current.status = "investigating";
      }
    });
    await this.startPending(caseId);
  }

  private async queueTurn(
    caseId: string,
    organizationId: string,
    message: string,
    humanActor?: string,
    actorId?: string,
  ) {
    await this.store.updateCase(caseId, (item) => {
      if (![item.customerId, item.vendorId].includes(organizationId))
        throw new HttpError(403, "Organization is not a case participant");
      if (item.automationPaused) return;
      if (item.step > 0 && !humanActor)
        throw new HttpError(
          409,
          "Create a fresh case for agent investigation; this case already uses the guided replay",
        );
      if (humanActor)
        event(item, {
          type: "message",
          channel: "janus",
          actorType: "human",
          organizationId,
          actor: humanActor,
          actorId,
          target: "agent",
          recipientOrganizationId: organizationId,
          title: "Message to your agent",
          body: message,
          visibility: "private",
        });
      item.runs ??= [];
      item.runs.push({
        id: randomUUID(),
        organizationId,
        message,
        kind: item.step > 0 ? "conversation" : "investigation",
        replyVisibility: "private",
        status: "pending",
        createdAt: new Date().toISOString(),
      });
      if (item.step === 0 && item.status !== "awaiting_approval")
        item.status = "investigating";
    });
    await this.startPending(caseId);
  }

  async startPending(caseId: string) {
    await this.watchCase(caseId);
    this.wake();
  }

  async recover() {
    for (const item of await this.store.listCases()) {
      if (item.automationPaused) {
        if (item.runs?.some((run) => ["pending", "running"].includes(run.status))) {
          await this.store.updateCase(item.id, (current) => {
            for (const run of current.runs || []) {
              if (["pending", "running"].includes(run.status)) run.status = "cancelled";
            }
          });
        }
        continue;
      }
      await this.watchCase(item.id);
      if (item.runs?.some((run) => run.status === "running")) {
        await this.store.updateCase(item.id, (current) => {
          for (const run of current.runs || [])
            if (run.status === "running") run.status = "pending";
        });
      }
    }
    this.wake();
  }

  private wake() {
    if (this.draining) {
      this.wakeRequested = true;
      return;
    }
    this.wakeRequested = false;
    this.draining = true;
    this.workerContext.runInAsyncScope(() => setImmediate(() => {
      void this.drain()
        .catch(() =>
          console.error(
            "Investigation worker stopped; inspect pending cases and restart the worker.",
          ),
        )
        .finally(() => {
          this.draining = false;
          if (this.wakeRequested) this.wake();
        });
    }));
  }

  private async watchCase(caseId: string) {
    if (!process.env.RELAY_WORKSPACE_KEY) return;
    const item = await this.store.getCase(caseId);
    if (!item || item.automationPaused) return;
    const tokens = configuredRelayTokens();
    for (const [organizationId, partnerId] of [
      [item.customerId, item.vendorId],
      [item.vendorId, item.customerId],
    ]) {
      const key = JSON.stringify([organizationId, partnerId]);
      if (
        !tokens[organizationId] ||
        !tokens[partnerId] ||
        this.subscriptions.has(key)
      )
        continue;
      const controller = new AbortController();
      this.subscriptions.set(key, controller);
      void subscribeRelayMessages({
        organizationId,
        partnerId,
        signal: controller.signal,
        onMessage: (received) => this.acceptMessage(received),
      })
        .catch(() => {
          if (!controller.signal.aborted)
            console.error(
              "Relay subscription stopped; check the Relay configuration and restart the worker.",
            );
        })
        .finally(() => {
          this.subscriptions.delete(key);
        });
    }
  }

  close() {
    for (const controller of this.subscriptions.values()) controller.abort();
  }

  private async drain() {
    while (true) {
      const cases = await this.store.listCases();
      const next = cases
        .flatMap((item) =>
          (item.automationPaused ? [] : item.runs || [])
            .filter(
              (run) =>
                run.status === "pending" &&
                (item.status !== "resolved" || run.kind === "conversation"),
            )
            .map((run) => ({ item, run })),
        )
        .sort(
          (a, b) => Date.parse(a.run.createdAt) - Date.parse(b.run.createdAt),
        )[0];
      const { item, run } = next || {};
      if (!item || !run) return;
      await this.store.updateCase(item.id, (current) => {
        current.runs!.find((candidate) => candidate.id === run.id)!.status =
          "running";
      });
      try {
        await this.investigate(
          item.id,
          run.organizationId,
          run.message,
          run.id,
        );
        await this.store.updateCase(item.id, (current) => {
          current.runs!.find((candidate) => candidate.id === run.id)!.status =
            "completed";
        });
      } catch (error) {
        let detail = error instanceof Error ? `${error.name}: ${error.message}` : "Unknown investigation error";
        for (const value of Object.values(process.env)) {
          if (value && value.length > 12) detail = detail.split(value).join("[redacted]");
        }
        detail = detail.replace(/(?:sk[-_]|sb_secret_|rk_live_|at_live_|ar_)[A-Za-z0-9_-]+/g, "[redacted]");
        console.error(`Investigation failed for ${run.organizationId} on ${item.id}: ${detail}`);
        await this.store.updateCase(item.id, (current) => {
          current.runs!.find((candidate) => candidate.id === run.id)!.status =
            "failed";
          if (run.kind !== "conversation") current.status = "escalated";
          event(current, {
            type: "system",
            organizationId: run.organizationId,
            actor: "Janus",
            title: "Investigation needs attention",
            body: "A runtime or tool operation failed. Check the configured services, then start another investigation turn.",
            visibility: "private",
          });
        });
      }
    }
  }

  async acceptMessage(message: ReceivedRelayMessage) {
    let accepted = false;
    await this.store.updateCase(message.caseId, (item) => {
      if (item.automationPaused) return;
      if (
        ![item.customerId, item.vendorId].includes(message.from) ||
        ![item.customerId, item.vendorId].includes(message.to) ||
        message.from === message.to
      )
        throw new HttpError(403, "Message participants do not match the case");
      const messageKey = `relay:${message.messageId}`;
      const existing = item.events.find((entry) => entry.id === messageKey);
      item.events = item.events.filter(
        (entry) => entry.id !== `sent:${message.eventId}`,
      );
      if (existing)
        existing.delivery = {
          status: "received",
          messageId: message.messageId,
          receivedAt: existing.delivery?.receivedAt || new Date().toISOString(),
        };
      if (existing && message.actorType !== "human") return;
      if (!existing)
        item.events.push({
          id: messageKey,
          type: "message",
          channel: message.actorType === "human" ? "janus" : "relay",
          actorType: message.actorType || "agent",
          actor: message.actor || `${message.from} agent`,
          actorId: message.actorId,
          target: message.target || "agent",
          recipientOrganizationId:
            message.target === "case" ? undefined : message.to,
          organizationId: message.from,
          title:
            message.actorType === "human"
              ? message.target === "case"
                ? "Message to the case"
                : "Message to partner agent"
              : "Partner message received",
          body: message.text,
          createdAt: message.createdAt || new Date().toISOString(),
          visibility: "shared",
          delivery: {
            status: "received",
            messageId: message.messageId,
            receivedAt: new Date().toISOString(),
          },
        });
      item.runs ??= [];
      if (
        (item.status !== "resolved" || item.step > 0) &&
        !item.runs.some(
          (run) =>
            run.sourceEventId === messageKey &&
            run.organizationId === message.to,
        )
      ) {
        item.runs.push({
          id: randomUUID(),
          organizationId: message.to,
          message:
            message.actorType === "human"
              ? `A person from the partner organization says: ${message.text}`
              : "A partner message arrived. Read the case and respond with useful evidence or actions.",
          kind: item.step > 0 ? "conversation" : "investigation",
          replyVisibility: message.actorType === "human" ? "shared" : "private",
          sourceEventId: messageKey,
          status: "pending",
          createdAt: new Date().toISOString(),
        });
        accepted = true;
      }
    });
    if (accepted) this.wake();
  }

  private async investigate(
    caseId: string,
    organizationId: string,
    message: string,
    turnId: string,
  ) {
    const item = await this.store.getCase(caseId);
    if (!item) throw new HttpError(404, "Case not found");
    const organization = (await this.store.organizations()).find(
      (entry) => entry.id === organizationId,
    );
    const agentName = organization?.agentName || `${organizationId} agent`;
    const run = item.runs?.find((entry) => entry.id === turnId);
    const conversationOnly = run?.kind === "conversation";
    const replyVisibility = run?.replyVisibility || "private";
    const partnerId =
      organizationId === item.customerId ? item.vendorId : item.customerId;
    const demos = demoDefinitions(item, organizationId);
    const connectionFor = async (connectorId: string) => {
      const connection = (await this.store.listConnections()).find(
        (value) =>
          value.organizationId === organizationId &&
          value.connectorId === connectorId,
      );
      if (!connection)
        throw new HttpError(
          400,
          "Integration is not configured for your organization",
        );
      return connection;
    };
    const operationFor = (connectorId: string, operation: string) => {
      const found = [...connectorDefinitions, ...demos]
        .find((definition) => definition.id === connectorId)
        ?.operations.find((value) => value.id === operation);
      if (!found) throw new HttpError(400, "Unknown connector operation");
      return found;
    };
    const investigator = await this.investigatorFactory({
      organizationId,
      caseId,
      conversationOnly,
      sharedReply: replyVisibility === "shared",
      tools: {
        readCase: async () => {
          const connections = (await this.store.listConnections()).filter(
            (value) => value.organizationId === organizationId,
          );
          return {
            case: projectCase(
              (await this.store.getCase(caseId))!,
              organizationId,
            ),
            integrations: [
              ...connectorDefinitions.filter((definition) =>
                connections.some(
                  (connection) => connection.connectorId === definition.id,
                ),
              ),
              ...demos,
            ].map(({ authFields: _authFields, ...definition }) => definition),
          };
        },
        collectEvidence: async ({ connectorId, operation, input }) => {
          if (conversationOnly)
            throw new HttpError(
              409,
              "Conversational turns preserve the existing recovery workflow",
            );
          if (operationFor(connectorId, operation).write)
            throw new HttpError(
              403,
              "This operation requires an action request",
            );
          const isDemo = demos.some(
            (definition) => definition.id === connectorId,
          );
          const connection = isDemo
            ? undefined
            : await connectionFor(connectorId);
          const simulated = isDemo || connection?.mode === "simulation";
          const observedAt = new Date().toISOString();
          const result = isDemo
            ? await executeDemo(
                this.store,
                caseId,
                organizationId,
                connectorId,
                operation,
                input,
              )
            : connection?.mode === "simulation"
              ? await executeFixtureConnection(
                  this.store,
                  connection,
                  operation,
                  input,
                )
              : await executeConnector({
                  connectorId,
                  operationId: operation,
                  input,
                  credentials: await this.store.getCredentials(connection!),
                });
          let receiptId = "";
          await this.store.updateCase(caseId, (current) => {
            const evidence = addEvidence(current, {
              organizationId,
              source: connectorId,
              title: `${connectorId} · ${operation}`,
              summary:
                "Recorded tool result. Inspect the data before drawing a conclusion.",
              data: { result },
              visibility: "private",
              simulated,
              provenance: { connectorId, operation, receiptId: randomUUID() },
            });
            evidence.collectedAt = observedAt;
            receiptId = evidence.id;
          });
          return { evidenceId: receiptId, result };
        },
        addEvidence: async (evidence) => {
          if (conversationOnly)
            throw new HttpError(
              409,
              "Conversational turns preserve the existing recovery workflow",
            );
          const updated = await this.store.updateCase(caseId, (current) => {
            addEvidence(current, {
              ...evidence,
              organizationId,
              simulated: false,
            });
          });
          return updated.evidence.at(-1);
        },
        requestAction: async (action) => {
          if (conversationOnly)
            throw new HttpError(
              409,
              "Conversational turns preserve the existing recovery workflow",
            );
          operationFor(action.connectorId, action.operation);
          if (
            !demos.some((definition) => definition.id === action.connectorId)
          ) {
            const connection = await connectionFor(action.connectorId);
            if (connection.mode === "simulation")
              throw new HttpError(
                400,
                "Local workspace integrations are read-only. Configure provider credentials for external actions.",
              );
          }
          const requested = {
            connectorId: action.connectorId,
            operation: action.operation,
            input: action.input,
          };
          let approvalId: string = randomUUID();
          const updated = await this.store.updateCase(caseId, (current) => {
            const duplicate = current.approvals.find(
              (approval) =>
                approval.organizationId === organizationId &&
                approval.status === "pending" &&
                JSON.stringify(approval.action) === JSON.stringify(requested),
            );
            if (duplicate) {
              approvalId = duplicate.id;
              return;
            }
            current.approvals.push({
              id: approvalId,
              organizationId,
              title: action.title,
              description: action.description,
              status: "pending",
              requestedAt: new Date().toISOString(),
              action: requested,
            });
            current.status = "awaiting_approval";
            event(current, {
              type: "approval",
              organizationId,
              actor: "Janus",
              title: action.title,
              body: action.description,
              visibility: "private",
            });
          });
          return updated.approvals.find(
            (approval) => approval.id === approvalId,
          );
        },
        sendPartnerMessage: async ({ text }) => {
          const eventId = randomUUID();
          let result: Awaited<ReturnType<typeof sendRelayMessage>>;
          try {
            result = await this.relaySender({
              caseId,
              eventId,
              from: organizationId,
              to: partnerId,
              actorType: "agent",
              actor: agentName,
              text,
            });
          } catch (error) {
            await this.store.updateCase(caseId, (current) => {
              current.events.push({
                id: `sent:${eventId}`,
                type: "message",
                organizationId,
                actor: agentName,
                channel: "relay",
                actorType: "agent",
                target: "agent",
                recipientOrganizationId: partnerId,
                title: "Partner delivery unconfirmed",
                body: text,
                createdAt: new Date().toISOString(),
                visibility: "private",
                delivery: { status: "unconfirmed" },
              });
            });
            throw error;
          }
          await this.store.updateCase(caseId, (current) => {
            if (
              current.events.some(
                (entry) => entry.id === `relay:${result.messageId}`,
              )
            )
              return;
            current.events.push({
              id: `sent:${eventId}`,
              type: "message",
              organizationId,
              actor: agentName,
              channel: "relay",
              actorType: "agent",
              target: "agent",
              recipientOrganizationId: partnerId,
              title: "Sent to partner; awaiting receipt",
              body: text,
              createdAt: result.createdAt || new Date().toISOString(),
              visibility: "private",
              delivery: { status: "accepted", messageId: result.messageId },
            });
          });
          return result;
        },
        receivePartnerMessages: async () => {
          const current = await this.store.getCase(caseId);
          if (!current) throw new HttpError(404, "Case not found");
          return projectCase(current, organizationId)
            .events.filter(
              (entry) =>
                entry.id.startsWith("relay:") &&
                entry.type === "message" &&
                entry.visibility === "shared" &&
                entry.organizationId === partnerId &&
                (!entry.recipientOrganizationId ||
                  entry.recipientOrganizationId === organizationId),
            )
            .map((entry) => ({
              caseId,
              messageId: entry.id.slice("relay:".length),
              from: partnerId,
              to: organizationId,
              text: entry.body,
              createdAt: entry.createdAt,
              actorType: entry.actorType,
              actor: entry.actor,
              target: entry.target,
            }));
        },
        concludeInvestigation: async ({ status, summary, evidenceIds }) => {
          if (conversationOnly)
            throw new HttpError(
              409,
              "Conversational turns preserve the existing recovery workflow",
            );
          const updated = await this.store.updateCase(caseId, (current) => {
            if (status === "resolved") {
              if (organizationId !== current.customerId)
                throw new HttpError(
                  403,
                  "The affected customer must verify recovery",
                );
              const lastActionTime = Math.max(
                0,
                ...current.approvals
                  .filter(
                    (approval) => approval.executionStatus === "succeeded",
                  )
                  .map((approval) =>
                    Date.parse(
                      approval.completedAt || approval.decidedAt || "",
                    ),
                  ),
              );
              const valid =
                evidenceIds.length > 0 &&
                evidenceIds.every((id) =>
                  current.evidence.some((evidence) => {
                    if (
                      evidence.id !== id ||
                      evidence.organizationId !== organizationId ||
                      !evidence.provenance ||
                      Date.parse(evidence.collectedAt) < lastActionTime
                    )
                      return false;
                    if (current.mode === "live") return !evidence.simulated;
                    const result = evidence.data.result as
                      | { status?: number }
                      | undefined;
                    return (
                      evidence.provenance.connectorId === "demo-customer" &&
                      evidence.provenance.operation === "probe" &&
                      result?.status === 200
                    );
                  }),
                );
              if (!valid)
                throw new HttpError(
                  400,
                  "Resolution requires recorded customer verification evidence",
                );
              if (
                current.approvals.some(
                  (approval) =>
                    approval.status === "pending" ||
                    approval.executionStatus === "executing",
                )
              )
                throw new HttpError(
                  409,
                  "Pending actions must be completed or rejected before closing the case",
                );
              current.status = "resolved";
              current.outcome = summary;
            } else if (status === "escalated") current.status = "escalated";
            event(current, {
              type: status === "resolved" ? "verification" : "investigation",
              organizationId,
              actor: "Janus",
              title:
                status === "resolved"
                  ? "Customer verified recovery"
                  : status === "waiting"
                    ? "Investigation waiting for input"
                    : "Escalated to an operator",
              body: summary,
              visibility: status === "resolved" ? "shared" : "private",
            });
          });
          return projectCase(updated, organizationId);
        },
      },
    });
    try {
      const result = await investigator.invoke(message, turnId);
      await this.store.updateCase(caseId, (current) => {
        event(current, {
          type: "message",
          channel: "janus",
          actorType: "agent",
          organizationId,
          actor: agentName,
          title: "Agent reply",
          body: result.text,
          visibility: replyVisibility,
        });
      });
    } finally {
      await investigator.close();
    }
  }
}
