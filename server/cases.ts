import { randomUUID } from "node:crypto";
import type { CaseEvent, Evidence, SupportCase } from "../src/types";
import { HttpError } from "./config";

export function event(
  item: SupportCase,
  input: Omit<CaseEvent, "id" | "createdAt">,
) {
  item.events.push({
    ...input,
    id: randomUUID(),
    createdAt: new Date().toISOString(),
  });
}

export function addEvidence(
  item: SupportCase,
  input: Omit<Evidence, "id" | "collectedAt">,
) {
  const evidence = {
    ...input,
    id: randomUUID(),
    collectedAt: new Date().toISOString(),
  };
  item.evidence.push(evidence);
  event(item, {
    type: "evidence",
    organizationId: input.organizationId,
    actor: input.organizationId === "northstar" ? "Nova" : "Atlas",
    title: input.title,
    body: input.summary,
    visibility: input.visibility,
  });
  return evidence;
}

export function newCase(
  input: {
    title?: string;
    summary?: string;
    customerId?: string;
    vendorId?: string;
    live?: boolean;
  } = {},
): SupportCase {
  const now = new Date().toISOString();
  const item: SupportCase = {
    id: `JAN-${randomUUID().slice(0, 8).toUpperCase()}`,
    title: input.title || "Checkout requests failing for Northstar",
    summary:
      input.summary ||
      "Northstar checkout requests to Contoso Cloud are failing. Investigate the cause across both organizations and verify recovery.",
    status: "detected",
    severity: "P1",
    customerId: input.customerId || "northstar",
    vendorId: input.vendorId || "contoso",
    createdAt: now,
    updatedAt: now,
    step: 0,
    mode: input.live ? "live" : "simulation",
    events: [],
    evidence: [],
    approvals: [],
    ...(!input.live
      ? { demoService: { route: "canary" as const, probes: [] } }
      : {}),
  };
  event(item, {
    type: "signal",
    organizationId: item.customerId,
    actor: input.live ? "Operator" : "Demo telemetry",
    title: "Incident detected",
    body: input.live
      ? item.summary
      : "Guided demo: 23% of checkout requests return HTTP 503. No live provider has been contacted.",
    visibility: "shared",
  });
  return item;
}

export function projectCase(
  item: SupportCase,
  organizationId: string,
): SupportCase {
  const { demoService: _demoService, ...visible } = item;
  return {
    ...visible,
    runs: item.runs?.filter((run) => run.organizationId === organizationId),
    events: item.events.filter(
      (entry) =>
        entry.visibility === "shared" ||
        entry.organizationId === organizationId,
    ),
    evidence: item.evidence.filter(
      (entry) =>
        entry.visibility === "shared" ||
        entry.organizationId === organizationId,
    ),
    approvals: item.approvals.filter(
      (entry) => entry.organizationId === organizationId,
    ),
  };
}

export function advanceDemo(item: SupportCase) {
  if (item.mode !== "simulation")
    throw new HttpError(400, "Guided replay is only available for demo cases");
  if (item.status === "awaiting_approval")
    throw new HttpError(409, "The vendor must decide the pending action first");
  if (["resolved", "escalated"].includes(item.status))
    throw new HttpError(409, "This case is complete");
  item.step += 1;
  switch (item.step) {
    case 1:
      item.status = "investigating";
      addEvidence(item, {
        organizationId: item.customerId,
        source: "Demo · customer telemetry",
        title: "Failure isolated to the upstream API",
        summary:
          "Checkout traces fail inside Contoso Cloud. Northstar’s last deployment predates the incident.",
        data: {
          requestIds: ["req_8f32", "req_8f33"],
          status: 503,
          region: "us-west-2",
          deploymentChanged: false,
        },
        visibility: "private",
        simulated: true,
      });
      break;
    case 2:
      event(item, {
        type: "message",
        organizationId: item.customerId,
        actor: "Nova → Atlas",
        title: "Evidence package shared with vendor",
        body: "Requests req_8f32 and req_8f33 return 503 in us-west-2. Please correlate with tenant-specific changes. Demo transport: no external message sent.",
        visibility: "shared",
      });
      break;
    case 3:
      addEvidence(item, {
        organizationId: item.vendorId,
        source: "Demo · vendor deployment log",
        title: "Tenant rollout correlates with the failures",
        summary:
          "Routing rollout r-184 selected an unhealthy backend for Northstar. Other tenants use the previous route.",
        data: {
          rollout: "r-184",
          tenant: item.customerId,
          previousRoute: "stable",
          newRoute: "canary",
          backendHealth: "unhealthy",
        },
        visibility: "private",
        simulated: true,
      });
      event(item, {
        type: "message",
        organizationId: item.vendorId,
        actor: "Atlas → Nova",
        title: "Vendor identified the faulty rollout",
        body: "The affected tenant was moved to an unhealthy backend. Requesting approval to restore its previous route.",
        visibility: "shared",
      });
      break;
    case 4:
      item.status = "awaiting_approval";
      item.approvals.push({
        id: randomUUID(),
        organizationId: item.vendorId,
        title: "Roll back Northstar’s routing change",
        description:
          "Restore the stable route for this tenant. This guided demo changes only its local case state.",
        status: "pending",
        requestedAt: new Date().toISOString(),
      });
      event(item, {
        type: "approval",
        organizationId: item.vendorId,
        actor: "Atlas",
        title: "Vendor approval required",
        body: "A tenant routing change requires an operator decision.",
        visibility: "shared",
      });
      break;
    case 5:
      item.status = "resolved";
      item.outcome =
        "Guided demo completed: the customer’s verification fixture reports successful requests after the approved rollback. Live recovery has not been tested.";
      addEvidence(item, {
        organizationId: item.customerId,
        source: "Demo · verification fixture",
        title: "Customer verification passed",
        summary:
          "The guided fixture reports 20 successful checkout probes after restoration of the stable route.",
        data: { successful: 20, failed: 0, fixture: true },
        visibility: "shared",
        simulated: true,
      });
      event(item, {
        type: "verification",
        actor: "Nova",
        title: "Resolution verified in the demo",
        body: item.outcome,
        visibility: "shared",
      });
      break;
  }
}
