import {
  ArrowLeftRight,
  ArrowRight,
  Check,
  ChevronRight,
  Database,
  FileSearch,
  Fingerprint,
  LockKeyhole,
  MessageSquare,
  ShieldCheck,
} from "./Icons";
import { useEffect, useRef, useState } from "react";
import type { Organization, SupportCase } from "../types";
import "./InvestigationMap.css";

interface InvestigationMapProps {
  supportCase?: SupportCase;
  organizations: Organization[];
  organizationId: string;
  accessibleOrganizationIds?: string[];
  onOrganizationChange: (id: string) => void;
  onOpen?: () => void;
  compact?: boolean;
}

const stageNames = ["Evidence", "Exchange", "Action", "Verification"];
const stageIcons = [FileSearch, MessageSquare, ShieldCheck, Check];

function caseProgress(supportCase?: SupportCase) {
  if (!supportCase)
    return {
      current: -1,
      completed: [false, false, false, false],
      label: "Ready when you are",
      description: "Start a case to bring both sides into one investigation.",
    };
  const evidence =
    supportCase.evidence.length > 0 ||
    supportCase.events.some((event) => event.type === "evidence");
  const exchanged = supportCase.events.some(
    (event) => event.type === "message" && event.visibility === "shared",
  );
  const acted = supportCase.approvals.some(
    (approval) =>
      approval.executionStatus === "succeeded" ||
      (supportCase.mode === "simulation" &&
        !approval.action &&
        approval.status === "approved"),
  );
  const executing = supportCase.approvals.some((approval) =>
    ["pending", "executing"].includes(approval.executionStatus || ""),
  );
  const verified =
    supportCase.status === "resolved" &&
    supportCase.events.some((event) => event.type === "verification");
  const completed = [evidence, exchanged, acted, verified];
  if (supportCase.status === "resolved")
    return {
      current: 3,
      completed,
      label: "Resolution verified",
      description: "The case is closed with its verification result preserved.",
    };
  if (supportCase.status === "verifying")
    return {
      current: executing ? 2 : 3,
      completed,
      label: executing ? "Action in progress" : "Checking the outcome",
      description: executing
        ? "An approved action is being executed."
        : "The investigation is checking whether the original problem is resolved.",
    };
  if (supportCase.status === "awaiting_approval")
    return {
      current: 2,
      completed,
      label: "Awaiting a decision",
      description:
        "An action requires approval before the investigation can continue.",
    };
  if (supportCase.status === "escalated")
    return {
      current: acted ? 3 : exchanged ? 2 : 0,
      completed,
      label: "A human handoff is needed",
      description:
        "The case retains the findings and decisions gathered so far.",
    };
  return {
    current: acted ? 3 : exchanged ? 1 : 0,
    completed,
    label: exchanged ? "Working across the boundary" : "Building the evidence",
    description: exchanged
      ? "Both organizations can work from the shared findings."
      : "The investigation starts with what each side can observe.",
  };
}

export default function InvestigationMap({
  supportCase,
  organizations,
  organizationId,
  accessibleOrganizationIds,
  onOrganizationChange,
  onOpen,
  compact = false,
}: InvestigationMapProps) {
  const customer =
    organizations.find(
      (organization) => organization.id === supportCase?.customerId,
    ) ||
    organizations.find(
      (organization) => organization.role.toLowerCase() === "customer",
    ) ||
    organizations[0];
  const vendor =
    organizations.find(
      (organization) => organization.id === supportCase?.vendorId,
    ) || organizations.find((organization) => organization.id !== customer?.id);
  const progress = caseProgress(supportCase);
  const signature = `${supportCase?.id}:${progress.current}:${progress.completed.join("")}`;
  const previousSignature = useRef(signature);
  const [transition, setTransition] = useState(false);
  useEffect(() => {
    if (previousSignature.current === signature) return;
    previousSignature.current = signature;
    setTransition(true);
    const timeout = window.setTimeout(() => setTransition(false), 1100);
    return () => window.clearTimeout(timeout);
  }, [signature]);
  const sharedEvents =
    supportCase?.events.filter((event) => event.visibility === "shared")
      .length || 0;

  function participant(
    organization: Organization | undefined,
    side: "customer" | "vendor",
  ) {
    if (!organization)
      return (
        <div className={`map-participant ${side} empty-participant`}>
          <Fingerprint size={28} />
          <h3>Connect a counterpart</h3>
          <p>A second organization completes the network.</p>
        </div>
      );
    const owned = organization.id === organizationId;
    const canAccess =
      !accessibleOrganizationIds ||
      accessibleOrganizationIds.includes(organization.id);
    const localEvidence =
      supportCase?.evidence.filter(
        (item) =>
          item.organizationId === organization.id &&
          (item.visibility === "shared" || owned),
      ) || [];
    const sources = [...new Set(localEvidence.map((item) => item.source))];
    const lastUpdate = supportCase?.events
      .filter(
        (event) =>
          event.organizationId === organization.id &&
          (event.visibility === "shared" || owned),
      )
      .at(-1);
    return (
      <article
        className={`map-participant ${side} ${owned ? "current-workspace" : ""}`}
      >
        <div className="map-participant-top">
          <span className="map-role">
            {side === "customer" ? "Customer" : "Vendor"}
          </span>
          <span className="map-privacy">
            <LockKeyhole size={11} />
            {owned ? "Your workspace" : "Independent workspace"}
          </span>
        </div>
        <div className="map-company">
          <span className="map-company-icon">
            {organization.name.slice(0, 1).toUpperCase()}
            <span />
          </span>
          <h3>{organization.name}</h3>
        </div>
        <div className="map-agent">
          <span className="map-agent-icon">
            {organization.agentName.slice(0, 1)}
          </span>
          <div>
            <strong>{organization.agentName}</strong>
            <span>Operational agent</span>
          </div>
          <span className="map-agent-label">AGENT</span>
        </div>
        <div className="map-context">
          <span className="map-context-label">
            {lastUpdate
              ? "Latest update"
              : owned
                ? "Organization context"
                : "Shared context"}
          </span>
          <p>
            {lastUpdate?.title ||
              (owned
                ? "Evidence stays in your workspace until shared."
                : "Only shared findings cross the company boundary.")}
          </p>
        </div>
        <div className="map-participant-footer">
          <span className="map-sources">
            <Database size={12} />
            {sources.length
              ? sources.slice(0, 2).join(" · ")
              : "Evidence pending"}
          </span>
          {owned ? (
            <span className="map-current">
              <span />
              Viewing
            </span>
          ) : canAccess ? (
            <button onClick={() => onOrganizationChange(organization.id)}>
              View side <ArrowRight size={12} />
            </button>
          ) : (
            <span className="map-external">Counterpart</span>
          )}
        </div>
      </article>
    );
  }

  return (
    <section
      className={`investigation-map ${compact ? "compact" : ""} ${transition ? "state-transition" : ""}`}
      aria-label="Investigation map"
    >
      <div className="map-heading">
        <div>
          <span className="map-heading-icon">
            <ArrowLeftRight size={14} />
          </span>
          <span>Investigation map</span>
        </div>
        <span className="map-mode">
          {supportCase?.runs?.length
            ? "Agent investigation"
            : supportCase?.mode === "simulation"
              ? "Guided simulation"
              : supportCase
                ? "Shared investigation"
                : "Organization network"}
        </span>
      </div>
      <div className="map-stage">
        {participant(customer, "customer")}
        <div className="map-junction">
          <div className="map-wire" />
          <span className="junction-symbol">
            <ArrowLeftRight size={23} />
          </span>
          <strong>Shared case</strong>
          <span>
            {supportCase
              ? `${sharedEvents} shared updates`
              : "One source of progress"}
          </span>
          <div className="junction-lock">
            <ShieldCheck size={11} />
            Shared findings
          </div>
          {onOpen && (
            <button onClick={onOpen}>
              Open investigation <ChevronRight size={13} />
            </button>
          )}
        </div>
        {participant(vendor, "vendor")}
      </div>
      <div className="map-bottom">
        <div className="map-progress-heading">
          <span className={`map-status-dot ${supportCase?.status || "idle"}`} />
          <div>
            <strong>{progress.label}</strong>
            <p>{progress.description}</p>
          </div>
        </div>
        <ol className="map-pipeline" aria-label="Case progress">
          {stageNames.map((label, index) => {
            const Icon = stageIcons[index];
            const done = progress.completed[index];
            const active = index === progress.current && !done;
            return (
              <li
                key={label}
                className={`${done ? "complete" : ""} ${active ? "current" : ""}`}
                aria-current={active ? "step" : undefined}
              >
                <span className="pipeline-icon">
                  {done ? <Check size={13} /> : <Icon size={13} />}
                </span>
                <span>{label}</span>
                <span className="pipeline-line" />
              </li>
            );
          })}
        </ol>
      </div>
    </section>
  );
}
