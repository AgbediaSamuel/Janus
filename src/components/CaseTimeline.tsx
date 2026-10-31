import { sourceLabel } from "../presentation";
import { useState } from "react";
import type { CaseEvent, Evidence, Organization, SupportCase } from "../types";
import {
  Activity,
  ArrowLeftRight,
  CheckCircle2,
  ChevronDown,
  Clock3,
  FileText,
  LockKeyhole,
  MessageSquare,
  ShieldCheck,
  Zap,
} from "./Icons";
import ProviderLogo from "./ProviderLogo";
import "./CaseTimeline.css";
import { messageAudience } from "./messageAudience";

interface CaseTimelineProps {
  supportCase: SupportCase;
  organizations: Organization[];
  organizationId: string;
  onEvidence: (evidence: Evidence) => void;
}

type TraceFilter = "all" | "messages" | "evidence" | "decisions";
const filters: { id: TraceFilter; label: string }[] = [
  { id: "all", label: "All updates" },
  { id: "messages", label: "Messages" },
  { id: "evidence", label: "Evidence" },
  { id: "decisions", label: "Decisions" },
];
const channelNames: Record<string, string> = {
  slack: "Slack",
  teams: "Microsoft Teams",
  "microsoft-teams": "Microsoft Teams",
  gmail: "Gmail",
  outlook: "Outlook",
  relay: "Agent Relay",
};

function EventMark({ event }: { event: CaseEvent }) {
  const channel = event.channel?.toLowerCase();
  if (
    channel &&
    ["slack", "teams", "microsoft-teams", "gmail", "outlook"].includes(channel)
  ) {
    return (
      <ProviderLogo
        connectorId={channel === "microsoft-teams" ? "teams" : channel}
        size={19}
      />
    );
  }
  const Icon =
    channel === "relay"
      ? ArrowLeftRight
      : event.type === "verification"
        ? CheckCircle2
        : event.type === "message"
          ? MessageSquare
          : event.type === "approval"
            ? ShieldCheck
            : event.type === "action"
              ? Zap
              : event.type === "evidence"
                ? FileText
                : Activity;
  return <Icon size={17} />;
}

export default function CaseTimeline({
  supportCase,
  organizations,
  organizationId,
  onEvidence,
}: CaseTimelineProps) {
  const [filter, setFilter] = useState<TraceFilter>("all");
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const counterpartId =
    organizationId === supportCase.vendorId
      ? supportCase.customerId
      : supportCase.vendorId;
  const visibleEvidence = supportCase.evidence.filter(
    (item) =>
      item.visibility === "shared" || item.organizationId === organizationId,
  );
  const events = supportCase.events
    .filter(
      (event) =>
        event.visibility === "shared" ||
        event.organizationId === organizationId,
    )
    .filter((event) => {
      if (filter === "messages") return event.type === "message";
      if (filter === "evidence")
        return (
          event.type === "evidence" ||
          Boolean(
            event.evidenceIds?.some((id) =>
              visibleEvidence.some((item) => item.id === id),
            ),
          )
        );
      if (filter === "decisions")
        return event.type === "approval" || event.type === "action";
      return true;
    })
    .sort((a, b) => Date.parse(a.createdAt) - Date.parse(b.createdAt));

  function toggle(id: string) {
    setExpanded((previous) => {
      const next = new Set(previous);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  return (
    <section className="case-trace" aria-label="Case timeline">
      <div className="trace-toolbar">
        <div className="trace-filters" aria-label="Filter timeline">
          {filters.map((item) => (
            <button
              key={item.id}
              type="button"
              aria-pressed={filter === item.id}
              onClick={() => setFilter(item.id)}
            >
              {item.label}
            </button>
          ))}
        </div>
        <span className="trace-update-count">
          {events.length} {events.length === 1 ? "update" : "updates"}
        </span>
      </div>
      <ol className="trace-list">
        {events.map((event, index) => {
          const attachments = visibleEvidence.filter((item) =>
            event.evidenceIds?.includes(item.id),
          );
          const channel = event.channel?.toLowerCase();
          const open = expanded.has(event.id);
          const currentDate = new Date(event.createdAt).toLocaleDateString([], {
            month: "short",
            day: "numeric",
          });
          const previousDate =
            index > 0
              ? new Date(events[index - 1].createdAt).toLocaleDateString([], {
                  month: "short",
                  day: "numeric",
                })
              : null;
          const audience = messageAudience(
            event,
            organizations,
            organizationId,
            counterpartId,
          );
          return (
            <li className="trace-item" key={event.id}>
              {currentDate !== previousDate && (
                <div className="trace-date">{currentDate}</div>
              )}
              <div className={`trace-entry ${open ? "is-expanded" : ""}`}>
                <span
                  className={`trace-marker ${event.actorType === "human" ? "human" : ""}`}
                >
                  <EventMark event={event} />
                </span>
                <button
                  type="button"
                  className="trace-summary"
                  aria-expanded={open}
                  aria-controls={`trace-${event.id}`}
                  onClick={() => toggle(event.id)}
                >
                  <span className="trace-summary-copy">
                    <span className="trace-actor">
                      {event.actor}
                      {event.actorType === "human" && (
                        <span className="trace-human-label">Team member</span>
                      )}
                    </span>
                    <span className="trace-title">{sourceLabel(event.title)}</span>
                    <span className="trace-meta">
                      {channel && (
                        <span>{channelNames[channel] || event.channel}</span>
                      )}
                      {attachments.length > 0 && (
                        <span>
                          <FileText size={12} />
                          {attachments.length}{" "}
                          {attachments.length === 1
                            ? "evidence item"
                            : "evidence items"}
                        </span>
                      )}
                      <span>
                        {audience.pending ? (
                          <Clock3 size={11} />
                        ) : (
                          event.visibility === "private" && (
                            <LockKeyhole size={11} />
                          )
                        )}{" "}
                        {audience.label}
                      </span>
                    </span>
                  </span>
                  <time dateTime={event.createdAt}>
                    {new Date(event.createdAt).toLocaleTimeString([], {
                      hour: "2-digit",
                      minute: "2-digit",
                    })}
                  </time>
                  <ChevronDown className="trace-chevron" size={15} />
                </button>
                {open && (
                  <div className="trace-expanded" id={`trace-${event.id}`}>
                    <p
                      className={
                        event.type === "message"
                          ? "trace-correspondence"
                          : "trace-body"
                      }
                    >
                      {event.body}
                    </p>
                    {attachments.length > 0 && (
                      <div
                        className="trace-attachments"
                        aria-label="Linked evidence"
                      >
                        {attachments.map((item) => (
                          <button
                            type="button"
                            key={item.id}
                            onClick={() => onEvidence(item)}
                          >
                            <FileText size={16} />
                            <span>
                              <strong>{item.title}</strong>
                              <small>{item.source}</small>
                            </span>
                            <span className="trace-evidence-open">View</span>
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                )}
              </div>
            </li>
          );
        })}
      </ol>
      {events.length === 0 && (
        <div className="trace-empty">
          <MessageSquare size={22} />
          <p>No {filter === "all" ? "updates" : filter} yet.</p>
          <span>Updates will appear as this investigation progresses.</span>
        </div>
      )}
    </section>
  );
}
