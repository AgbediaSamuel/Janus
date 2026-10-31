import express, { type Response } from "express";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import type { Connection, SupportCase } from "../src/types";
import { authenticate, requireOrganization, type Identity } from "./auth";
import { addEvidence, advanceDemo, event, newCase, projectCase } from "./cases";
import { HttpError, liveMode } from "./config";
import {
  connectorDefinitions,
  executeConnector,
  validateCredentials,
  ConnectorError,
} from "./connectors";
import { Store } from "./store";
import {
  InvestigationService,
  type InvestigatorFactory,
} from "./investigations";
import { executeDemo } from "./demo-service";
import { executeFixtureConnection } from "./fixture-connections";
import { configuredRelayTokens, sendRelayMessage } from "./runtime/relay";
import { SignalService, signalInput } from "./signals";
import type { runDemoMonitor } from "./demo-monitor";

const object = z.record(z.string(), z.unknown());
const orgInput = z.string().trim().min(1);

export async function createApp(
  store = new Store(),
  options: {
    investigatorFactory?: InvestigatorFactory;
    relaySender?: typeof sendRelayMessage;
    demoMonitor?: typeof runDemoMonitor;
  } = {},
) {
  await store.initialize();
  const investigations = new InvestigationService(
    store,
    options.investigatorFactory,
    options.relaySender,
  );
  const agentsAvailable = () =>
    Boolean(
      options.investigatorFactory ||
        (process.env.OPENAI_API_KEY &&
          process.env.DATABASE_URL &&
          process.env.OPENAI_MODEL),
    );
  const signals = new SignalService(store, investigations, agentsAvailable);
  const app = express();
  app.disable("x-powered-by");
  app.use((req, res, next) => {
    const origin = process.env.JANUS_WEB_ORIGIN;
    if (origin && req.headers.origin === origin) {
      res.setHeader("Access-Control-Allow-Origin", origin);
      res.setHeader("Vary", "Origin");
      res.setHeader(
        "Access-Control-Allow-Headers",
        "Authorization, Content-Type",
      );
      res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
      if (req.method === "OPTIONS") {
        res.sendStatus(204);
        return;
      }
    }
    next();
  });
  app.use(express.json({ limit: "1mb" }));
  app.get("/api/health", (_req, res) =>
    res.json({ status: "ok", mode: liveMode ? "live" : "demo" }),
  );
  app.use("/api", authenticate);

  async function accessibleCase(
    id: string,
    res: Response,
    organizationId?: string,
  ) {
    const item = await store.getCase(id);
    if (!item) throw new HttpError(404, "Case not found");
    const identity = res.locals.identity as Identity;
    const selected =
      organizationId ||
      identity.organizationIds.find((org) =>
        [item.customerId, item.vendorId].includes(org),
      );
    if (!selected || ![item.customerId, item.vendorId].includes(selected))
      throw new HttpError(403, "Case access denied");
    requireOrganization(res, selected);
    return { item, organizationId: selected };
  }

  async function connectionFor(organizationId: string, connectorId: string) {
    const connection = (await store.listConnections()).find(
      (item) =>
        item.organizationId === organizationId &&
        item.connectorId === connectorId,
    );
    if (!connection)
      throw new HttpError(
        400,
        "Configure this integration for the selected organization first",
      );
    return connection;
  }

  function operationFor(connectorId: string, operationId: string) {
    const operation = connectorDefinitions
      .find((item) => item.id === connectorId)
      ?.operations.find((item) => item.id === operationId);
    if (!operation) throw new HttpError(400, "Unknown connector operation");
    return operation;
  }

  async function execute(
    organizationId: string,
    connectorId: string,
    operationId: string,
    input: Record<string, unknown>,
  ) {
    const connection = await connectionFor(organizationId, connectorId);
    if (connection.mode === "simulation")
      return executeFixtureConnection(store, connection, operationId, input);
    const credentials = await store.getCredentials(connection);
    return executeConnector({ connectorId, operationId, input, credentials });
  }

  app.get("/api/state", async (req, res) => {
    const identity = res.locals.identity as Identity;
    const organizations = await store.organizations();
    const organizationId = String(
      req.query.organizationId || identity.organizationIds[0] || "",
    );
    requireOrganization(res, organizationId);
    const cases = (await store.listCases())
      .filter((item) =>
        [item.customerId, item.vendorId].includes(organizationId),
      )
      .map((item) => projectCase(item, organizationId));
    const connections = (await store.listConnections()).filter(
      (item) => item.organizationId === organizationId,
    );
    res.json({
      organizations,
      accessibleOrganizationIds: identity.organizationIds,
      activeOrganizationId: organizationId,
      connectors: connectorDefinitions,
      connections,
      cases,
      runtime: {
        caseStore: process.env.TERSE_ACTOR_URL
          ? "Terse Durable Actors"
          : "Local demo file",
        relay: process.env.RELAY_WORKSPACE_KEY
          ? "Agent Relay · configured, unverified"
          : "Not configured",
        simulation: !liveMode,
        mode: liveMode ? "live" : "demo",
        agentsConfigured: agentsAvailable(),
      },
    });
  });

  app.get("/api/connectors", (_req, res) => res.json(connectorDefinitions));
  app.post("/api/connections", async (req, res) => {
    const data = z
      .object({
        organizationId: orgInput,
        connectorId: z.string(),
        credentials: z.record(z.string(), z.string()),
      })
      .strict()
      .parse(req.body);
    requireOrganization(res, data.organizationId);
    validateCredentials(data.connectorId, data.credentials);
    const connection: Connection = {
      id: `${data.organizationId}:${data.connectorId}`,
      organizationId: data.organizationId,
      connectorId: data.connectorId,
      mode: "live",
      status: "not_configured",
      message: "Credentials saved. Run a read operation to verify access.",
    };
    await store.setConnection(connection, data.credentials);
    res.status(201).json(connection);
  });

  app.post("/api/connections/:id/test", async (req, res) => {
    const connection = (await store.listConnections()).find(
      (item) => item.id === req.params.id,
    );
    if (!connection) throw new HttpError(404, "Connection not found");
    requireOrganization(res, connection.organizationId);
    const data = z
      .object({ operationId: z.string().optional(), input: object.optional() })
      .strict()
      .parse(req.body || {});
    const definition = connectorDefinitions.find(
      (item) => item.id === connection.connectorId,
    )!;
    const operation = data.operationId
      ? operationFor(connection.connectorId, data.operationId)
      : definition.operations.find((item) => !item.write);
    if (!operation || operation.write)
      throw new HttpError(
        400,
        "Choose a read operation to test this integration",
      );
    try {
      const result = await execute(
        connection.organizationId,
        connection.connectorId,
        operation.id,
        data.input || operation.exampleInput,
      );
      await store.setConnection({
        ...connection,
        status: "connected",
        lastChecked: new Date().toISOString(),
        message: `${operation.name} succeeded`,
      });
      res.json({ ok: true, result });
    } catch (error) {
      await store.setConnection({
        ...connection,
        status: "error",
        lastChecked: new Date().toISOString(),
        message:
          "Access check failed. Check credentials, scopes, and resource identifiers.",
      });
      throw error;
    }
  });

  app.post("/api/signals", async (req, res) => {
    const input = signalInput.parse(req.body);
    requireOrganization(res, input.organizationId);
    const result = await signals.ingest(input);
    res.status(result.created ? 201 : 200).json({
      ...result,
      case: projectCase(result.case, input.organizationId),
    });
  });

  app.post("/api/cases", async (req, res) => {
    const input = z
      .object({
        title: z.string().trim().min(1).optional(),
        summary: z.string().optional(),
        customerId: orgInput.optional(),
        organizationId: orgInput.optional(),
        startInvestigation: z.boolean().default(false),
        vendorId: orgInput.optional(),
      })
      .strict()
      .parse(req.body || {});
    if (liveMode && (!input.customerId || !input.vendorId || !input.title))
      throw new HttpError(
        400,
        "Live cases require a title, customerId, and vendorId",
      );
    if (input.startInvestigation && !agentsAvailable())
      throw new HttpError(
        503,
        "Set OPENAI_API_KEY, OPENAI_MODEL, and DATABASE_URL to run Deep Agents",
      );
    const item = newCase({ ...input, live: liveMode });
    const organizationId = input.organizationId || item.customerId;
    requireOrganization(res, organizationId);
    if (![item.customerId, item.vendorId].includes(organizationId))
      throw new HttpError(403, "Case access denied");
    if (item.customerId === item.vendorId)
      throw new HttpError(400, "Choose two different organizations");
    const organizations = await store.organizations();
    if (
      !organizations.some(
        (org) => org.id === item.customerId && org.role === "Customer",
      )
    )
      throw new HttpError(400, "Customer organization not found");
    if (
      !organizations.some(
        (org) => org.id === item.vendorId && org.role === "Vendor",
      )
    )
      throw new HttpError(400, "Vendor organization not found");
    await store.createCase(item);
    if (input.startInvestigation)
      await investigations.enqueue(
        item.id,
        organizationId,
        "Investigate this case. Gather evidence, coordinate with the partner when needed, and verify any recovery.",
      );
    res
      .status(201)
      .json(projectCase((await store.getCase(item.id))!, organizationId));
  });

  app.post("/api/cases/:id/advance", async (req, res) => {
    if (liveMode)
      throw new HttpError(403, "Guided replay is disabled in live mode");
    const { organizationId } = await accessibleCase(
      String(req.params.id),
      res,
      req.body?.organizationId,
    );
    const updated = await store.updateCase(String(req.params.id), (item) => {
      if (item.runs?.some((run) => run.kind !== "conversation"))
        throw new HttpError(
          409,
          "Guided replay cannot advance an agent-driven case",
        );
      advanceDemo(item);
    });
    res.json(projectCase(updated, organizationId));
  });

  app.post("/api/cases/:id/approvals/:approvalId", async (req, res) => {
    const { decision } = z
      .object({ decision: z.enum(["approved", "rejected"]) })
      .strict()
      .parse(req.body);
    const { item } = await accessibleCase(String(req.params.id), res);
    const approval = item.approvals.find(
      (value) => value.id === req.params.approvalId,
    );
    if (!approval) throw new HttpError(404, "Approval not found");
    requireOrganization(res, approval.organizationId);
    await store.updateCase(item.id, (current) => {
      const action = current.approvals.find(
        (value) => value.id === approval.id,
      )!;
      if (action.status !== "pending")
        throw new HttpError(409, "This approval has already been decided");
      action.status = decision;
      action.decidedAt = new Date().toISOString();
      action.executionStatus =
        decision === "approved" && action.action ? "executing" : undefined;
      current.status = decision === "approved" ? "verifying" : "escalated";
      event(current, {
        type: "approval",
        organizationId: action.organizationId,
        actor: "Operator",
        title: decision === "approved" ? "Action approved" : "Action rejected",
        body: action.title,
        visibility: action.action ? "private" : "shared",
      });
    });
    if (decision === "approved" && approval.action) {
      try {
        const result = approval.action.connectorId.startsWith("demo-")
          ? await executeDemo(
              store,
              item.id,
              approval.organizationId,
              approval.action.connectorId,
              approval.action.operation,
              approval.action.input,
            )
          : await execute(
              approval.organizationId,
              approval.action.connectorId,
              approval.action.operation,
              approval.action.input,
            );
        await store.updateCase(item.id, (current) => {
          const action = current.approvals.find(
            (value) => value.id === approval.id,
          )!;
          action.executionStatus = "succeeded";
          action.result = result;
          action.completedAt = new Date().toISOString();
          event(current, {
            type: "action",
            organizationId: action.organizationId,
            actor: "Janus",
            title: "Approved action completed",
            body: action.title,
            visibility: "private",
          });
        });
      } catch (error) {
        await store.updateCase(item.id, (current) => {
          current.approvals.find(
            (value) => value.id === approval.id,
          )!.executionStatus = "failed";
          current.status = "escalated";
          event(current, {
            type: "action",
            organizationId: approval.organizationId,
            actor: "Janus",
            title: "Action needs review",
            body: "The provider did not confirm success. Check its state before retrying.",
            visibility: "private",
          });
        });
        throw error;
      }
    }
    if (
      approval.action &&
      item.step === 0 &&
      decision === "approved" &&
      agentsAvailable()
    ) {
      await investigations.enqueue(
        item.id,
        approval.organizationId,
        "The approved action completed. Inspect its result and verify the outcome with the partner.",
      );
    }
    res.json(
      projectCase((await store.getCase(item.id))!, approval.organizationId),
    );
  });

  app.post("/api/cases/:id/messages", async (req, res) => {
    const input = z
      .object({
        organizationId: orgInput,
        text: z.string().trim().min(1),
        target: z.enum(["agent", "case"]).default("agent"),
        recipientOrganizationId: orgInput.optional(),
      })
      .strict()
      .parse(req.body);
    const { item, organizationId } = await accessibleCase(
      String(req.params.id),
      res,
      input.organizationId,
    );
    if (input.target === "case" && input.recipientOrganizationId)
      throw new HttpError(400, "Case messages do not select one recipient");
    const recipient = input.recipientOrganizationId || organizationId;
    if (![item.customerId, item.vendorId].includes(recipient))
      throw new HttpError(403, "Recipient is not a case participant");
    if (!agentsAvailable())
      throw new HttpError(
        503,
        "Set OPENAI_API_KEY, OPENAI_MODEL, and DATABASE_URL to run Deep Agents",
      );
    const partnerId =
      organizationId === item.customerId ? item.vendorId : item.customerId;
    if (
      (input.target === "case" || recipient !== organizationId) &&
      !options.relaySender
    ) {
      const tokens = configuredRelayTokens();
      if (
        !process.env.RELAY_WORKSPACE_KEY ||
        !tokens[organizationId] ||
        !tokens[partnerId]
      )
        throw new HttpError(
          503,
          "Configure Agent Relay for both case participants before sending a shared message",
        );
    }
    const organization = (await store.organizations()).find(
      (entry) => entry.id === organizationId,
    );
    const identity = res.locals.identity as Identity;
    await investigations.enqueueHuman(
      item.id,
      organizationId,
      input.text,
      identity.displayName || `${organization?.name || organizationId} team`,
      {
        target: input.target,
        recipientOrganizationId: input.recipientOrganizationId,
        actorId: identity.userId,
      },
    );
    res
      .status(202)
      .json({
        queued: true,
        case: projectCase((await store.getCase(item.id))!, organizationId),
      });
  });

  app.post("/api/cases/:id/investigate", async (req, res) => {
    const input = z
      .object({ organizationId: orgInput, message: z.string().optional() })
      .strict()
      .parse(req.body);
    const { item, organizationId } = await accessibleCase(
      String(req.params.id),
      res,
      input.organizationId,
    );
    if (!agentsAvailable())
      throw new HttpError(
        503,
        "Set OPENAI_API_KEY, OPENAI_MODEL, and DATABASE_URL to run Deep Agents",
      );
    await investigations.enqueue(
      item.id,
      organizationId,
      input.message ||
        "Investigate this case. Gather evidence, coordinate with the partner when needed, and verify any recovery.",
    );
    res.status(202).json({
      queued: true,
      case: projectCase((await store.getCase(item.id))!, organizationId),
    });
  });

  app.post("/api/demo/service/:id/checkout", async (req, res) => {
    const { item } = await accessibleCase(String(req.params.id), res);
    requireOrganization(res, item.customerId);
    const result = await executeDemo(
      store,
      item.id,
      item.customerId,
      "demo-customer",
      "probe",
      {},
    );
    res.status("status" in result ? result.status : 200).json(result);
  });

  app.post("/api/reset", async (req, res) => {
    const identity = res.locals.identity as Identity;
    if (liveMode || identity.userId !== "local-demo")
      throw new HttpError(403, "Reset is available only to the local demo");
    const loopback = ["127.0.0.1", "::1", "::ffff:127.0.0.1"];
    if (!loopback.includes(req.socket.remoteAddress || ""))
      throw new HttpError(
        403,
        "Reset is available only from the local computer",
      );
    if (req.headers.origin) {
      let origin: URL;
      try {
        origin = new URL(req.headers.origin);
      } catch {
        throw new HttpError(403, "Reset requires a local origin");
      }
      if (!["localhost", "127.0.0.1", "[::1]"].includes(origin.hostname))
        throw new HttpError(403, "Reset requires a local origin");
    }
    z.object({ confirm: z.literal(true) })
      .strict()
      .parse(req.body);
    if (
      (await store.listCases()).some((item) =>
        item.runs?.some((run) => ["pending", "running"].includes(run.status)),
      )
    )
      throw new HttpError(
        409,
        "Wait for pending investigations to finish before resetting the demo",
      );
    await store.reset();
    const monitor = options.demoMonitor || (await import("./demo-monitor")).runDemoMonitor;
    const recording = await monitor(signals);
    res.json({ ok: true, recording });
  });
  app.use(
    (
      error: unknown,
      _req: express.Request,
      res: Response,
      _next: express.NextFunction,
    ) => {
      if (error instanceof z.ZodError) {
        res.status(400).json({
          error: error.issues.map((issue) => issue.message).join("; "),
        });
        return;
      }
      if (error instanceof HttpError) {
        res.status(error.status).json({ error: error.message });
        return;
      }
      if (error instanceof ConnectorError) {
        res.status(400).json({ error: error.message });
        return;
      }
      console.error(
        "Request failed:",
        error instanceof Error ? error.name : "UnknownError",
      );
      res.status(500).json({
        error:
          "The operation failed. Check the server configuration and retry.",
      });
    },
  );
  app.locals.investigations = investigations;
  if (agentsAvailable()) await investigations.recover();
  return app;
}
