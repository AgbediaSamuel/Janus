export type OrganizationID = string;
export type CaseStatus =
  | "detected"
  | "investigating"
  | "awaiting_approval"
  | "verifying"
  | "resolved"
  | "escalated";
export type ConnectorMode = "simulation" | "live";

export interface Organization {
  id: OrganizationID;
  name: string;
  role: string;
  agentName: string;
  deployment: "hosted" | "self-hosted";
}

export interface ConnectorDefinition {
  id: string;
  name: string;
  category:
    | "Observability"
    | "Collaboration"
    | "Cloud & data"
    | "Extensibility";
  description: string;
  authFields: {
    key: string;
    label: string;
    secret?: boolean;
    placeholder?: string;
  }[];
  operations: {
    id: string;
    name: string;
    write: boolean;
    description: string;
    exampleInput: Record<string, unknown>;
  }[];
  docsUrl: string;
}

export interface Connection {
  id: string;
  organizationId: OrganizationID;
  connectorId: string;
  mode: ConnectorMode;
  status: "connected" | "not_configured" | "error";
  lastChecked?: string;
  message?: string;
}

export interface Evidence {
  id: string;
  organizationId: OrganizationID;
  source: string;
  title: string;
  summary: string;
  data: Record<string, unknown>;
  visibility: "private" | "shared";
  collectedAt: string;
  simulated: boolean;
  provenance?: { connectorId: string; operation: string; receiptId: string };
}

export interface CaseEvent {
  id: string;
  type:
    | "signal"
    | "investigation"
    | "message"
    | "evidence"
    | "approval"
    | "action"
    | "verification"
    | "system";
  organizationId?: OrganizationID;
  actor: string;
  actorId?: string;
  target?: "agent" | "case";
  recipientOrganizationId?: string;
  channel?: string;
  actorType?: "agent" | "human" | "system";
  evidenceIds?: string[];
  title: string;
  body: string;
  createdAt: string;
  visibility: "private" | "shared";
}

export interface Approval {
  id: string;
  organizationId: OrganizationID;
  title: string;
  description: string;
  status: "pending" | "approved" | "rejected";
  requestedAt: string;
  decidedAt?: string;
  completedAt?: string;
  action?: {
    connectorId: string;
    operation: string;
    input: Record<string, unknown>;
  };
  executionStatus?: "pending" | "executing" | "succeeded" | "failed";
  result?: unknown;
}

export interface SupportCase {
  id: string;
  title: string;
  summary: string;
  status: CaseStatus;
  severity: "P1" | "P2" | "P3";
  customerId: OrganizationID;
  vendorId: OrganizationID;
  createdAt: string;
  updatedAt: string;
  step: number;
  mode: "simulation" | "live";
  events: CaseEvent[];
  evidence: Evidence[];
  approvals: Approval[];
  outcome?: string;
  demoService?: {
    scenario?:
      | "aws-uploads"
      | "google-indexing"
      | "ramp-attachments"
      | "ramp-exports";
    route: "canary" | "stable";
    probes: { requestId: string; status: number; at: string }[];
  };
  runs?: {
    id: string;
    organizationId: string;
    message: string;
    kind?: "conversation" | "investigation";
    replyVisibility?: "private" | "shared";
    sourceEventId?: string;
    status: "pending" | "running" | "completed" | "failed";
    createdAt: string;
  }[];
}

export interface PlatformState {
  organizations: Organization[];
  accessibleOrganizationIds?: string[];
  activeOrganizationId: OrganizationID;
  connectors: ConnectorDefinition[];
  connections: Connection[];
  cases: SupportCase[];
  runtime: {
    caseStore: string;
    relay: string;
    simulation: boolean;
    agentsConfigured?: boolean;
    mode?: "demo" | "live";
  };
}
