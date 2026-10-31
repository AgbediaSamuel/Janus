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
    actor:
      input.organizationId === item.customerId
        ? "Notion agent"
        : item.vendorId === "google"
          ? "Google Cloud Support"
          : "AWS Support",
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
  const indexing = input.vendorId === "google";
  const item: SupportCase = {
    id: `JAN-${randomUUID().slice(0, 8).toUpperCase()}`,
    title:
      input.title ||
      (indexing
        ? "Search results lag behind recent page edits"
        : "S3 uploads are timing out in us-west-2"),
    summary:
      input.summary ??
      (input.live
        ? ""
        : indexing
          ? "Recent page updates are missing from Notion search. The indexing queue has 1,842 outstanding messages; page editing and reads remain available."
          : "Notion attachment uploads are intermittently returning S3 503 SlowDown responses. Upload latency reached 4.8 seconds at p95, concentrated in us-west-2."),
    status: "detected",
    severity: indexing ? "P2" : "P1",
    customerId: input.customerId || "notion",
    vendorId: input.vendorId || "aws",
    createdAt: now,
    updatedAt: now,
    step: 0,
    mode: input.live ? "live" : "simulation",
    events: [],
    evidence: [],
    approvals: [],
    ...(!input.live
      ? {
          demoService: {
            scenario: indexing
              ? ("google-indexing" as const)
              : ("aws-uploads" as const),
            route: "canary" as const,
            probes: [],
          },
        }
      : {}),
  };
  event(item, {
    type: "signal",
    organizationId: item.customerId,
    actor: input.live ? "Operator" : "Notion monitoring",
    title: indexing
      ? "Search freshness threshold exceeded"
      : "Upload error rate increased",
    body: item.summary,
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
    throw new HttpError(
      409,
      "The responsible organization must decide the pending action first",
    );
  if (["resolved", "escalated"].includes(item.status))
    throw new HttpError(409, "This case is complete");
  const indexing = item.demoService?.scenario === "google-indexing";
  const vendor = indexing ? "Google Cloud Support" : "AWS Support";
  const next = item.step + 1;
  if (next === 5 && item.demoService?.route !== "stable")
    throw new HttpError(
      409,
      "The approved recovery action must complete before verification",
    );
  item.step = next;
  switch (next) {
    case 1:
      item.status = "investigating";
      addEvidence(item, {
        organizationId: item.customerId,
        source: indexing
          ? "Notion indexing workers"
          : "Notion upload telemetry",
        title: indexing
          ? "Indexing backlog isolated to page-update events"
          : "Upload failures isolated to regional S3 requests",
        summary: indexing
          ? "Page-update messages are reaching the subscription, but consumer retries have grown since the event schema changed. Search freshness is 27 minutes behind."
          : "12.6% of attachment uploads return 503 SlowDown. The affected requests share the us-west-2 upload path; Notion’s application release has not changed since yesterday.",
        data: indexing
          ? {
              subscription: "notion-page-indexing",
              undeliveredMessages: 1842,
              oldestUnackedSeconds: 1620,
              consumerSchema: 2,
              eventSchema: 3,
            }
          : {
              requestIds: ["S3-7FC91A", "S3-7FC92D"],
              bucket: "notion-attachments-usw2",
              region: "us-west-2",
              status: 503,
              errorRate: 0.126,
              latencyP95Ms: 4800,
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
        actor: `Notion agent → ${vendor}`,
        title: indexing
          ? "Delivery and consumer health requested"
          : "Regional request correlation requested",
        body: indexing
          ? "Our page-indexing subscription has 1,842 outstanding messages, with the oldest at 27 minutes. Please confirm delivery health and correlate the repeated consumer failures. Page writes remain healthy."
          : "We are seeing 503 SlowDown for requests S3-7FC91A and S3-7FC92D in us-west-2. Upload p95 is 4.8 seconds. Can you correlate the request IDs with regional routing changes?",
        visibility: "shared",
      });
      event(item, {
        type: "message",
        organizationId: item.vendorId,
        actor: `${vendor} → Notion agent`,
        title: "Investigation acknowledged",
        body: indexing
          ? "We are checking subscription delivery and acknowledgement patterns. Please keep the current backlog intact while we identify a safe replay path."
          : "The request IDs are available in our regional trace. We are checking the route selected for your upload traffic and will return a scoped recovery recommendation.",
        visibility: "shared",
      });
      break;
    case 3:
      addEvidence(item, {
        organizationId: item.vendorId,
        source: indexing
          ? "Google Cloud Pub/Sub diagnostics"
          : "AWS regional request traces",
        title: indexing
          ? "Delivery healthy; consumer rejects the new event schema"
          : "Regional routing change correlates with upload errors",
        summary: indexing
          ? "Pub/Sub is delivering messages normally. Negative acknowledgements originate from the indexing consumer when it receives schema version 3. The previous consumer configuration accepts the queued events."
          : "The failing request IDs select a recently changed regional route. The previous route is healthy and can be restored for the affected upload traffic.",
        data: indexing
          ? {
              deliveryAvailable: true,
              acknowledgementError: "unsupported_event_schema",
              currentSchema: 3,
              compatibleConsumerAvailable: true,
            }
          : {
              rollout: "s3-router-184",
              tenant: item.customerId,
              region: "us-west-2",
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
        actor: `${vendor} → Notion agent`,
        title: indexing
          ? "Customer recovery action ready for review"
          : "Scoped route restoration recommended",
        body: indexing
          ? "Delivery is healthy. The indexing consumer rejects the new event schema and repeatedly releases those messages. Restore the compatible consumer and replay the 1,842 queued updates; your team must approve that customer-side change."
          : "The failing requests correlate with a regional route change. We can restore the previous route for the affected traffic, then ask you to verify uploads from your application.",
        visibility: "shared",
      });
      break;
    case 4: {
      item.status = "awaiting_approval";
      const owner = indexing ? item.customerId : item.vendorId;
      item.approvals.push({
        id: randomUUID(),
        organizationId: owner,
        title: indexing
          ? "Replay stalled indexing jobs"
          : "Restore the stable S3 upload route",
        description: indexing
          ? "Restore the compatible indexing consumer and requeue 1,842 page updates. Page editing remains available while the backlog drains."
          : "Restore the previous regional request route for Notion’s affected upload traffic, then verify a fresh attachment upload.",
        status: "pending",
        requestedAt: new Date().toISOString(),
        action: {
          connectorId: indexing ? "demo-customer" : "demo-vendor",
          operation: indexing ? "reindex" : "rollback",
          input: {},
        },
      });
      event(item, {
        type: "approval",
        organizationId: owner,
        actor: indexing ? "Notion agent" : vendor,
        title: indexing ? "Notion approval required" : "AWS approval required",
        body: indexing
          ? "The indexing recovery plan is ready for the Notion operator to review."
          : "The scoped route restoration is ready for the AWS operator to review.",
        visibility: "shared",
      });
      break;
    }
    case 5: {
      const probe = {
        requestId: randomUUID(),
        status: 200,
        at: new Date().toISOString(),
      };
      item.demoService!.probes.push(probe);
      item.status = "resolved";
      item.outcome = indexing
        ? "The indexing backlog has drained. A fresh page update is now returned by search after the approved consumer restoration and replay."
        : "Attachment uploads are completing normally. A fresh upload probe returned HTTP 200 after the approved regional route restoration.";
      addEvidence(item, {
        organizationId: item.customerId,
        source: indexing
          ? "Notion search freshness checks"
          : "Notion attachment upload checks",
        title: indexing
          ? "Recent page edits are searchable again"
          : "Attachment upload verified successfully",
        summary: item.outcome,
        data: indexing
          ? { ...probe, backlog: 0, indexed: true }
          : { ...probe, successful: 1, failed: 0 },
        visibility: "shared",
        simulated: true,
      });
      event(item, {
        type: "verification",
        organizationId: item.customerId,
        actor: "Notion agent",
        title: "Customer verification passed",
        body: item.outcome,
        visibility: "shared",
      });
      break;
    }
  }
}
