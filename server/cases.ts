import { randomUUID } from "node:crypto";
import type { CaseEvent, Evidence, SupportCase } from "../src/types";
import { HttpError } from "./config";

export function event(
  item: SupportCase,
  input: Omit<CaseEvent, "id" | "createdAt">,
) {
  item.events.push({
    actorType: input.type === "message" ? "agent" : "system",
    ...(input.type === "message" ? { channel: "relay" } : {}),
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
        ? `${item.customerId === "ramp" ? "Ramp" : "Notion"} agent`
        : item.vendorId === "google"
          ? "Google Cloud Support"
          : "AWS Support",
    title: input.title,
    body: input.summary,
    evidenceIds: [evidence.id],
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
  const ramp = input.customerId === "ramp";
  const item: SupportCase = {
    id: `JAN-${randomUUID().slice(0, 8).toUpperCase()}`,
    title:
      input.title || (ramp ? indexing ? "Accounting exports are falling behind the reporting window" : "Receipt and invoice attachments are slow to appear" : undefined) ||
      (indexing
        ? "Search results lag behind recent page edits"
        : "S3 uploads are timing out in us-west-2"),
    summary:
      input.summary ??
      (input.live
        ? ""
        : ramp ? indexing ? "Accounting exports have queued 624 ledger updates and are 24 minutes behind. Card authorization and bill payment processing remain available." : "Receipt and invoice attachment processing is delayed. Upload requests are timing out before documents become available for expense review and bill approval." : indexing
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
            scenario: ramp ? indexing ? "ramp-exports" as const : "ramp-attachments" as const : indexing ? "google-indexing" as const : "aws-uploads" as const,
            route: "canary" as const,
            probes: [],
          },
        }
      : {}),
  };
  event(item, {
    type: "signal",
    organizationId: item.customerId,
    actor: input.live ? "Operator" : ramp ? "Ramp monitoring" : "Notion monitoring",
    title: indexing
      ? ramp ? "Accounting export freshness threshold exceeded" : "Search freshness threshold exceeded"
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
  if (![item.customerId, item.vendorId].includes(organizationId)) throw new HttpError(403, "Case access denied");
  const { demoService: _demoService, ...visible } = item;
  const evidence = item.evidence.filter((entry) => entry.visibility === "shared" || entry.organizationId === organizationId);
  const evidenceIds = new Set(evidence.map((entry) => entry.id));
  return {
    ...visible,
    runs: item.runs?.filter((run) => run.organizationId === organizationId),
    events: item.events.filter((entry) => entry.visibility === "shared" || entry.organizationId === organizationId).map((entry) => ({ ...entry, ...(entry.evidenceIds ? { evidenceIds: entry.evidenceIds.filter((id) => evidenceIds.has(id)) } : {}) })),
    evidence,
    approvals: item.approvals.filter((entry) => entry.organizationId === organizationId),
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
  if (item.customerId === "ramp") return advanceRampCase(item);
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

function advanceRampCase(item: SupportCase) {
  const exports = item.vendorId === "google";
  const vendor = exports ? "Google Cloud Support" : "AWS Support";
  const next = item.step + 1;
  if (next === 5 && item.demoService?.route !== "stable") throw new HttpError(409, "The approved recovery action must complete before verification");
  item.step = next;
  switch (next) {
    case 1:
      item.status = "investigating";
      addEvidence(item, { organizationId: "ramp", source: exports ? "Ramp accounting export workers" : "Ramp document processing", title: exports ? "Reporting lag isolated to the export consumer" : "Attachment delays isolated to document storage requests", summary: exports ? "624 ledger updates are waiting for export. The worker is retrying a payload-version mismatch; authorization and payment processing are unaffected." : "Invoice and receipt uploads are returning 503 responses before document extraction begins. Existing bills and card transactions remain available.", data: exports ? { queuedUpdates: 624, oldestUpdateSeconds: 1440, workerPayloadVersion: 2, eventPayloadVersion: 3, paymentProcessingAffected: false } : { requestIds: ["ATT-8D10", "ATT-8D11"], privateDocumentIds: ["invoice-7281", "receipt-4820"], errorRate: 0.084, latencyP95Ms: 6200, region: "us-east-1" }, visibility: "private", simulated: true });
      break;
    case 2:
      event(item, { type: "message", organizationId: "ramp", actor: `Ramp agent → ${vendor}`, title: exports ? "Export delivery correlation requested" : "Attachment request trace shared", body: exports ? "The accounting export consumer is 24 minutes behind with 624 updates queued. Please check delivery and acknowledgement health. No account names, amounts, or ledger records are included; payments remain available." : "Attachment requests ATT-8D10 and ATT-8D11 are timing out in us-east-1. We have removed invoice content and customer identifiers. Can you correlate these request IDs with storage-path health?", visibility: "shared" });
      event(item, { type: "message", organizationId: item.vendorId, actor: `${vendor} → Ramp agent`, title: "Trace investigation started", body: exports ? "We will inspect the delivery trace and retry pattern using the correlation identifiers. Please leave the queue intact until we confirm an ordered replay plan." : "We have the two request IDs and are checking the selected storage route. Please preserve the current retry queue; there is no need to resend document contents.", visibility: "shared" });
      break;
    case 3:
      addEvidence(item, { organizationId: item.vendorId, source: exports ? "Google Cloud delivery trace" : "AWS storage request trace", title: exports ? "Consumer compatibility causes repeated delivery" : "Storage route selection correlates with attachment timeouts", summary: exports ? "Delivery is healthy. The export worker rejects the new payload version before acknowledging messages. A compatible worker can replay the queued updates in order." : "The reported request IDs use a recently changed regional route. The previous route is healthy and can be restored for the affected document traffic.", data: exports ? { deliveryAvailable: true, consumerError: "payload_version_mismatch", compatibleWorker: "accounting-export-v3" } : { region: "us-east-1", routingChange: "storage-route-219", previousRoute: "stable", currentRoute: "canary", tenant: "ramp" }, visibility: "private", simulated: true });
      event(item, { type: "message", organizationId: item.vendorId, actor: `${vendor} → Ramp agent`, title: exports ? "Ordered export replay recommended" : "Storage route restoration proposed", body: exports ? "The delivery service is healthy; the accounting export worker is rejecting payload version 3. Restore the compatible worker, replay the queued updates in order, and compare the export watermark with the source. This needs approval from your accounting operations team." : "The attachment request failures correlate with a storage route change. We recommend restoring the previous route for this traffic, then verifying with a fresh upload that contains no financial or customer data.", visibility: "shared" });
      break;
    case 4: {
      item.status = "awaiting_approval";
      const owner = exports ? "ramp" : "aws";
      item.approvals.push({ id: randomUUID(), organizationId: owner, title: exports ? "Replay queued accounting exports" : "Restore the attachment storage route", description: exports ? "Restore the compatible export worker and replay 624 queued updates in order. Do not reinitiate payments or alter ledger entries." : "Restore the previous storage route for the affected document traffic and verify a fresh attachment upload.", status: "pending", requestedAt: new Date().toISOString(), action: { connectorId: exports ? "demo-customer" : "demo-vendor", operation: exports ? "replay_exports" : "rollback", input: {} } });
      event(item, { type: "approval", organizationId: owner, actor: exports ? "Ramp agent" : vendor, title: exports ? "Ramp approval required" : "AWS approval required", body: exports ? "The ordered export replay is ready for an accounting operations owner to review." : "The scoped attachment-route change is ready for the AWS operator to review.", visibility: "shared" });
      break;
    }
    case 5: {
      const probe = { requestId: randomUUID(), status: 200, at: new Date().toISOString() };
      item.demoService!.probes.push(probe);
      item.status = "resolved";
      item.outcome = exports ? "Accounting exports have caught up with the source watermark. The ordered replay completed without repeating a payment or changing ledger entries." : "A fresh receipt attachment uploaded successfully and became available for review after the approved storage-route restoration.";
      addEvidence(item, { organizationId: "ramp", source: exports ? "Ramp export watermark checks" : "Ramp attachment availability checks", title: exports ? "Export freshness verified" : "Receipt attachment available for review", summary: item.outcome, data: { ...probe, ...(exports ? { queuedUpdates: 0, watermarkMatched: true } : { attachmentAvailable: true }) }, visibility: "shared", simulated: true });
      event(item, { type: "verification", organizationId: "ramp", actor: "Ramp agent", title: "Customer verification passed", body: item.outcome, visibility: "shared" });
      break;
    }
  }
}
