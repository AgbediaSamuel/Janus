import type { CaseEvent, Connection, Organization, SupportCase } from "../src/types";
import { advanceDemo, newCase } from "./cases";

export const localOrganizations: Organization[] = [
  { id: "notion", name: "Notion", role: "Customer", agentName: "Notion agent", deployment: "hosted" },
  { id: "ramp", name: "Ramp", role: "Customer", agentName: "Ramp agent", deployment: "hosted" },
  { id: "aws", name: "AWS", role: "Vendor", agentName: "AWS Support", deployment: "self-hosted" },
  { id: "google", name: "Google Cloud", role: "Vendor", agentName: "Google Cloud Support", deployment: "self-hosted" },
];

const seedIDs = new Set(["JAN-1042", "JAN-1041", "JAN-1044", "JAN-1043"]);

export function seededConnections(): Connection[] {
  const connectors: Record<string, string[]> = {
    notion: ["slack", "gmail", "datadog", "aws-s3"],
    ramp: ["gmail", "outlook", "datadog", "gcp-logging"],
    aws: ["teams", "outlook", "aws-cloudwatch"],
    google: ["teams", "gmail", "gcp-logging"],
  };
  return Object.entries(connectors).flatMap(([organizationId, ids]) => ids.map((connectorId) => ({ id: `${organizationId}:${connectorId}`, organizationId, connectorId, mode: "simulation" as const, status: "connected" as const, message: "Connected to local workspace records. Provider access is not configured." })));
}

export function enrichSeedCase(item: SupportCase): boolean {
  if (!seedIDs.has(item.id) || item.mode !== "simulation") return false;
  const ramp = item.customerId === "ramp";
  const cloud = item.vendorId === "google";
  const customer = ramp ? "Ramp" : "Notion";
  const vendor = cloud ? "Google Cloud" : "AWS";
  let changed = false;
  const diagnosticId = `seed:${item.id}:aws-route-diagnostic`;
  if (!cloud && !item.evidence.some((entry) => entry.id === diagnosticId)) {
    item.evidence.push({
      id: diagnosticId,
      organizationId: item.vendorId,
      source: "AWS regional request-route diagnostics",
      title: "Affected requests correlate with the regional route change",
      summary: "The reviewed request window uses the recently changed route. The previous route is healthy; a scoped restoration requires operator approval before customer verification.",
      data: { region: ramp ? "us-east-1" : "us-west-2", observedRoute: "canary", previousRoute: "stable", previousRouteHealthy: true, customer: item.customerId },
      visibility: "private",
      collectedAt: new Date(Date.parse(item.createdAt) + 120_000).toISOString(),
      simulated: true,
    });
    changed = true;
  }
  const customerEvidence = item.evidence.filter((entry) => entry.organizationId === item.customerId).map((entry) => entry.id);
  const vendorEvidence = item.evidence.filter((entry) => entry.organizationId === item.vendorId).map((entry) => entry.id);
  const sharedEvidence = item.evidence.filter((entry) => entry.visibility === "shared").map((entry) => entry.id);
  const note = ramp ? cloud
    ? "Finance operations is missing the latest accounting export. The source ledger watermark is ahead by 24 minutes. Please check the export worker before we ask anyone to rerun a payment. I've attached the internal worker trace; keep account names and amounts out of the provider conversation."
    : "Several receipt and invoice PDFs are taking minutes to appear in expense review and Bill Pay. Uploads were retried by the application, so please confirm whether the stored objects exist before asking a customer to upload them again. The sample document IDs are internal only."
    : cloud
      ? "A page I updated this morning still isn't showing in search. Editing and sharing the page work normally. Could you check whether this is the indexing queue rather than the page service? I've added the worker trace from our internal dashboard."
      : "I'm seeing attachment uploads stall in the workspace, then return an error after a retry. This started without an application deploy. Please check the upload trace and keep the workspace and document names private when you contact AWS.";
  const reply = ramp ? cloud
    ? "I can see the export lag and the payload-version error. Payment processing is outside the recovery scope. I'll ask Google Cloud to check delivery health using correlation IDs only, then prepare an ordered replay for accounting operations to review."
    : "The document path is failing before extraction, and there is no indication that a bill payment was retried. I'll correlate the storage request IDs with AWS. I will not send receipt contents, invoice details, or customer identifiers."
    : cloud
      ? "The page service is healthy. The indexing consumer is retrying messages with a newer schema. I'll ask Google Cloud to confirm delivery health, then bring the consumer restoration and replay back to your team for approval."
      : "I found the failing upload requests and the elevated latency. I'll send AWS only the request IDs, region, and time window. Internal workspace names and object paths will stay in this case's private evidence.";
  const messages: Omit<CaseEvent, "id" | "createdAt">[] = [
    { type: "message", organizationId: item.customerId, channel: ramp ? "gmail" : "slack", actorType: "human", actor: ramp ? "Maya Patel · Finance operations" : "Felipe Sanchez · Product engineering", title: ramp ? "Can you investigate this before we retry?" : "Can you check the service behind this error?", body: note, visibility: "private", evidenceIds: customerEvidence },
    { type: "message", organizationId: item.customerId, channel: ramp ? "gmail" : "slack", actorType: "agent", actor: `${customer} agent`, title: "I have the trace and will keep private details scoped", body: reply, visibility: "private", evidenceIds: customerEvidence },
    { type: "message", organizationId: item.vendorId, channel: "teams", actorType: "agent", actor: `${vendor} support agent`, title: `Requesting an internal review of the ${customer} trace`, body: `The ${customer} agent sent sanitized correlation identifiers for this case. Can the on-call owner check ${cloud ? "delivery acknowledgements and the consumer compatibility error" : "the regional request route and its recent change history"}? Please keep other tenants and internal rollout details inside our workspace.`, visibility: "private", evidenceIds: vendorEvidence },
    { type: "message", organizationId: item.vendorId, channel: "teams", actorType: "human", actor: cloud ? "Priya Nair · Cloud support" : "Jordan Lee · Storage support", title: "Internal trace review", body: cloud ? "Delivery is available. The repeat pattern is consistent with a consumer rejecting the payload before acknowledging it. Recommend a compatible consumer and an ordered replay; the customer needs to approve that change. Keep the internal trace attached here." : "The supplied request IDs align with the regional route change. The previous route is healthy. Prepare the scoped restoration for operator approval and ask the customer for a fresh request after it completes; do not include other tenants in the reply.", visibility: "private", evidenceIds: vendorEvidence },
    { type: "message", organizationId: item.vendorId, channel: "outlook", actorType: "human", actor: cloud ? "Priya Nair · Cloud support" : "Jordan Lee · Storage support", title: "Review notes for the support handoff", body: `The proposed ${cloud ? "consumer replay" : "route restoration"} is limited to the affected workflow. The customer-visible reply should describe the action, required owner approval, and verification request. Internal diagnostic attachments stay with ${vendor}; financial, workspace, and unrelated tenant information must not be forwarded.`, visibility: "private", evidenceIds: vendorEvidence },
    { type: "message", organizationId: item.vendorId, channel: "relay", actorType: "agent", actor: `${vendor} agent → ${customer} agent`, title: "Sanitized review summary", body: cloud ? "Our delivery checks do not show a service outage. The consumer is rejecting the event format. Please review a compatible-worker restoration and ordered replay with the workflow owner, then send a fresh verification result. We do not need the underlying business records." : "The request IDs correlate with the regional route under review. A scoped restoration can be submitted for operator approval. After it completes, please verify with a fresh request containing no private customer data.", visibility: "shared", evidenceIds: sharedEvidence },
    { type: "message", organizationId: item.customerId, channel: ramp ? "outlook" : "slack", actorType: "agent", actor: `${customer} agent`, title: "Recovery scope and owner review", body: `The provider has returned a scoped recommendation. I will keep the ${cloud ? "replay" : "restoration"} behind the responsible owner's approval, then verify the original ${ramp ? cloud ? "accounting export watermark" : "receipt attachment workflow" : cloud ? "search freshness" : "attachment upload"}. ${ramp ? "No payment, ledger entry, or invoice approval is being recreated." : "No document content or workspace names have been sent to the provider."}`, visibility: "private", evidenceIds: customerEvidence },
  ];
  messages.forEach((message, index) => {
    const id = `seed:${item.id}:correspondence:${index + 1}`;
    const existing = item.events.find((entry) => entry.id === id);
    if (existing) {
      if (!cloud && existing.organizationId === item.vendorId && existing.visibility === "private" && !(existing.evidenceIds || []).includes(diagnosticId)) {
        existing.evidenceIds = [...(existing.evidenceIds || []), diagnosticId];
        changed = true;
      }
      return;
    }
    item.events.push({ ...message, id, createdAt: new Date(Date.parse(item.createdAt) + (index + 1) * 45_000).toISOString() });
    changed = true;
  });
  for (const entry of item.events) {
    if (!entry.actorType) { entry.actorType = entry.type === "message" ? "agent" : "system"; changed = true; }
    if (entry.type === "message" && !entry.channel) { entry.channel = "relay"; changed = true; }
  }
  if (changed) item.events.sort((a, b) => Date.parse(a.createdAt) - Date.parse(b.createdAt));
  return changed;
}

export function seededCases(): SupportCase[] {
  const definitions = [
    { id: "JAN-1042", customerId: "notion", vendorId: "aws", steps: 2, minutes: 18 },
    { id: "JAN-1041", customerId: "notion", vendorId: "google", steps: 4, minutes: 42 },
    { id: "JAN-1044", customerId: "ramp", vendorId: "aws", steps: 2, minutes: 26 },
    { id: "JAN-1043", customerId: "ramp", vendorId: "google", steps: 4, minutes: 55 },
  ];
  return definitions.map((definition) => {
    const item = newCase({ customerId: definition.customerId, vendorId: definition.vendorId });
    item.id = definition.id;
    for (let stage = 0; stage < definition.steps; stage++) advanceDemo(item);
    const started = Date.now() - definition.minutes * 60_000;
    item.createdAt = new Date(started).toISOString();
    item.events.forEach((entry, offset) => { entry.createdAt = new Date(started + offset * 90_000).toISOString(); });
    item.evidence.forEach((entry, offset) => { entry.collectedAt = new Date(started + (offset + 1) * 90_000).toISOString(); });
    item.approvals.forEach((entry) => { entry.requestedAt = item.events.at(-1)!.createdAt; });
    item.updatedAt = item.events.at(-1)!.createdAt;
    enrichSeedCase(item);
    return item;
  });
}
