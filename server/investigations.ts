import { randomUUID } from "node:crypto";
import { Store } from "./store";
import { addEvidence, event, projectCase } from "./cases";
import { HttpError } from "./config";
import { connectorDefinitions, executeConnector } from "./connectors";
import { createInvestigator } from "./agents";
import { demoDefinitions, executeDemo } from "./demo-service";
import {
  configuredRelayTokens,
  receiveRelayMessages,
  sendRelayMessage,
  subscribeRelayMessages,
  type ReceivedRelayMessage,
} from "./runtime/relay";

export type InvestigatorFactory = typeof createInvestigator;

export class InvestigationService {
  private draining = false;
  private wakeRequested = false;
  private subscriptions = new Map<string, AbortController>();

  constructor(
    private store: Store,
    private investigatorFactory: InvestigatorFactory = createInvestigator,
  ) {}

  async enqueue(caseId: string, organizationId: string, message: string) {
    await this.store.updateCase(caseId, (item) => {
      if (![item.customerId, item.vendorId].includes(organizationId))
        throw new HttpError(403, "Organization is not a case participant");
      if (item.step > 0)
        throw new HttpError(
          409,
          "Create a fresh case for agent investigation; this case already uses the guided replay",
        );
      item.runs ??= [];
      item.runs.push({
        id: randomUUID(),
        organizationId,
        message,
        status: "pending",
        createdAt: new Date().toISOString(),
      });
      if (item.status !== "awaiting_approval") item.status = "investigating";
    });
    await this.startPending(caseId);
  }

  async startPending(caseId: string) {
    await this.watchCase(caseId);
    this.wake();
  }

  async recover() {
    for (const item of await this.store.listCases()) {
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
    setImmediate(() => {
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
    });
  }

  private async watchCase(caseId: string) {
    if (!process.env.RELAY_WORKSPACE_KEY) return;
    const item = await this.store.getCase(caseId);
    if (!item) return;
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
      const item = cases.find(
        (candidate) =>
          candidate.status !== "resolved" &&
          candidate.runs?.some((run) => run.status === "pending"),
      );
      const run = item?.runs?.find(
        (candidate) => candidate.status === "pending",
      );
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
      } catch {
        await this.store.updateCase(item.id, (current) => {
          current.runs!.find((candidate) => candidate.id === run.id)!.status =
            "failed";
          current.status = "escalated";
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
      if (
        ![item.customerId, item.vendorId].includes(message.from) ||
        ![item.customerId, item.vendorId].includes(message.to) ||
        message.from === message.to
      )
        throw new HttpError(403, "Message participants do not match the case");
      const messageKey = `relay:${message.messageId}`;
      if (item.events.some((entry) => entry.id === messageKey)) return;
      item.events.push({
        id: messageKey,
        type: "message",
        organizationId: message.from,
        actor: `${message.from} → ${message.to}`,
        title: "Partner message received",
        body: message.text,
        createdAt: message.createdAt || new Date().toISOString(),
        visibility: "shared",
      });
      if (item.status !== "resolved") {
        item.runs ??= [];
        item.runs.push({
          id: randomUUID(),
          organizationId: message.to,
          message:
            "A partner message arrived. Read the case and respond with useful evidence or actions.",
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
          if (operationFor(connectorId, operation).write)
            throw new HttpError(
              403,
              "This operation requires an action request",
            );
          const isDemo = demos.some(
            (definition) => definition.id === connectorId,
          );
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
            : await executeConnector({
                connectorId,
                operationId: operation,
                input,
                credentials: await this.store.getCredentials(
                  await connectionFor(connectorId),
                ),
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
              simulated: isDemo,
              provenance: { connectorId, operation, receiptId: randomUUID() },
            });
            evidence.collectedAt = observedAt;
            receiptId = evidence.id;
          });
          return { evidenceId: receiptId, result };
        },
        addEvidence: async (evidence) => {
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
          operationFor(action.connectorId, action.operation);
          if (!demos.some((definition) => definition.id === action.connectorId))
            await connectionFor(action.connectorId);
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
          const result = await sendRelayMessage({
            caseId,
            eventId,
            from: organizationId,
            to: partnerId,
            text,
          });
          await this.store.updateCase(caseId, (current) => {
            current.events.push({
              id: `sent:${eventId}`,
              type: "message",
              organizationId,
              actor: "Janus",
              title: "Message submitted to Agent Relay",
              body: text,
              createdAt: result.createdAt || new Date().toISOString(),
              visibility: "private",
            });
          });
          return result;
        },
        receivePartnerMessages: () =>
          receiveRelayMessages({
            organizationId,
            partnerId,
            caseId,
            onMessage: (received) => this.acceptMessage(received),
          }),
        concludeInvestigation: async ({ status, summary, evidenceIds }) => {
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
          type: "investigation",
          organizationId,
          actor: "Janus",
          title: "Agent turn completed",
          body: result.text,
          visibility: "private",
        });
      });
    } finally {
      await investigator.close();
    }
  }
}
