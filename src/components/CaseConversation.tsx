import { useEffect, useRef, useState } from "react";
import type { FormEvent, KeyboardEvent } from "react";
import type { CaseEvent, Evidence, Organization, SupportCase } from "../types";
import {
  ArrowLeftRight,
  ArrowUpRight,
  ChevronDown,
  Clock3,
  FileText,
  Globe2,
  Loader2,
  LockKeyhole,
  MessageSquare,
} from "./Icons";
import ProviderLogo from "./ProviderLogo";
import "./CaseConversation.css";
import { messageAudience } from "./messageAudience";

export interface ConversationDestination {
  target: "agent" | "case";
  recipientOrganizationId?: string;
}

interface CaseConversationProps {
  supportCase: SupportCase;
  organizations: Organization[];
  organizationId: string;
  onEvidence: (evidence: Evidence) => void;
  onSend: (text: string, destination: ConversationDestination) => Promise<void>;
  agentsConfigured?: boolean;
  busy?: boolean;
}

const channelLabels: Record<string, string> = {
  slack: "Slack",
  teams: "Microsoft Teams",
  "microsoft-teams": "Microsoft Teams",
  gmail: "Gmail",
  outlook: "Outlook",
  relay: "Agent Relay",
  janus: "Janus",
};

function MessageSource({ event }: { event: CaseEvent }) {
  const channel = event.channel?.toLowerCase();
  if (
    channel &&
    ["slack", "teams", "microsoft-teams", "gmail", "outlook"].includes(channel)
  ) {
    return (
      <ProviderLogo
        connectorId={channel === "microsoft-teams" ? "teams" : channel}
        size={20}
      />
    );
  }
  return channel === "relay" ? (
    <ArrowLeftRight size={17} />
  ) : (
    <MessageSquare size={17} />
  );
}

export default function CaseConversation({
  supportCase,
  organizations,
  organizationId,
  onEvidence,
  onSend,
  busy = false,
  agentsConfigured = false,
}: CaseConversationProps) {
  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState("");
  const [sent, setSent] = useState(false);
  const [recipient, setRecipient] = useState<"own" | "counterpart" | "case">(
    "own",
  );
  const scope = `${organizationId}:${supportCase.id}`;
  const transcriptRef = useRef<HTMLOListElement>(null);
  const followLatest = useRef(true);
  const scopeRef = useRef(scope);
  scopeRef.current = scope;
  useEffect(() => {
    setDraft("");
    setError("");
    setSent(false);
    setSending(false);
    setRecipient("own");
    followLatest.current = true;
  }, [scope]);
  const organization = organizations.find((item) => item.id === organizationId);
  const counterpartId =
    organizationId === supportCase.vendorId
      ? supportCase.customerId
      : supportCase.vendorId;
  const counterpart = organizations.find((item) => item.id === counterpartId);
  const messages = supportCase.events
    .filter(
      (event) =>
        event.type === "message" &&
        (event.visibility === "shared" ||
          event.organizationId === organizationId),
    )
    .sort((a, b) => Date.parse(a.createdAt) - Date.parse(b.createdAt));
  const evidence = supportCase.evidence.filter(
    (item) =>
      item.visibility === "shared" || item.organizationId === organizationId,
  );
  const activeRuns = (supportCase.runs || []).filter(
    (run) =>
      run.organizationId === organizationId &&
      ["pending", "running"].includes(run.status),
  );
  const readOnly = !agentsConfigured;
  const locked = busy || sending || readOnly;
  const participantAgents = organizations.filter((item) =>
    [supportCase.customerId, supportCase.vendorId].includes(item.id),
  );
  const humanParticipants = [
    ...new Map(
      messages
        .filter((message) => message.actorType === "human")
        .map((message) => [
          `${message.organizationId}:${message.actorId || message.actor}`,
          message,
        ]),
    ).values(),
  ];
  const privateMessage = recipient === "own";
  const destination: ConversationDestination =
    recipient === "case"
      ? { target: "case" }
      : {
          target: "agent",
          recipientOrganizationId: privateMessage
            ? organizationId
            : counterpartId,
        };
  const recipientLabel =
    recipient === "case"
      ? "everyone in this case"
      : privateMessage
        ? organization?.agentName || "your agent"
        : counterpart?.agentName || "the counterpart agent";
  const latestMessageId = messages.at(-1)?.id;
  useEffect(() => {
    if (transcriptRef.current && followLatest.current)
      transcriptRef.current.scrollTop = transcriptRef.current.scrollHeight;
  }, [latestMessageId, scope]);

  async function send(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const text = draft.trim();
    if (!text || locked) return;
    const submittedScope = scope;
    followLatest.current = true;
    setSending(true);
    setError("");
    setSent(false);
    try {
      await onSend(text, destination);
      if (scopeRef.current === submittedScope) {
        setDraft("");
        setSent(true);
      }
    } catch (reason) {
      if (scopeRef.current === submittedScope)
        setError(
          reason instanceof Error
            ? reason.message
            : "Your message could not be sent. Please try again.",
        );
    } finally {
      if (scopeRef.current === submittedScope) setSending(false);
    }
  }
  function composerKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (
      (event.metaKey || event.ctrlKey) &&
      event.key === "Enter" &&
      !event.nativeEvent.isComposing
    ) {
      event.preventDefault();
      event.currentTarget.form?.requestSubmit();
    }
  }

  return (
    <section className="case-conversation" aria-label="Case conversation">
      <div className="conversation-heading">
        <h2>Conversation</h2>
        <span>
          {messages.length} {messages.length === 1 ? "message" : "messages"}
        </span>
      </div>
      <details className="conversation-participants">
        <summary>
          <span className="conversation-participant-marks">
            {participantAgents.map((item) => (
              <span key={item.id} title={item.name}>
                <ProviderLogo connectorId={item.id} size={17} />
              </span>
            ))}
          </span>
          <span>
            {participantAgents.length + humanParticipants.length} participants
          </span>
          <ChevronDown size={12} />
        </summary>
        <div className="conversation-participant-list">
          {participantAgents.map((item) => (
            <div className="conversation-participant" key={item.id}>
              <span className="conversation-roster-mark">
                <ProviderLogo connectorId={item.id} size={21} />
              </span>
              <div>
                <strong>{item.agentName}</strong>
                <span>{item.name} · Agent</span>
              </div>
            </div>
          ))}
          {humanParticipants.map((person) => (
            <div
              className="conversation-participant"
              key={`${person.organizationId}:${person.actorId || person.actor}`}
            >
              <span className="conversation-roster-mark">
                <MessageSource event={person} />
              </span>
              <div>
                <strong>{person.actor}</strong>
                <span>
                  {organizations.find(
                    (item) => item.id === person.organizationId,
                  )?.name || "Case participant"}{" "}
                  · Team member
                </span>
              </div>
            </div>
          ))}
        </div>
      </details>
      <ol
        className="conversation-messages"
        aria-label="Case messages"
        ref={transcriptRef}
        onScroll={(event) => {
          const element = event.currentTarget;
          followLatest.current =
            Math.ceil(element.scrollTop + element.clientHeight) >=
            element.scrollHeight;
        }}
      >
        {messages.map((message, index) => {
          const linked = evidence.filter((item) =>
            message.evidenceIds?.includes(item.id),
          );
          const currentDate = new Date(message.createdAt).toLocaleDateString(
            [],
            { month: "short", day: "numeric" },
          );
          const previousDate =
            index > 0
              ? new Date(messages[index - 1].createdAt).toLocaleDateString([], {
                  month: "short",
                  day: "numeric",
                })
              : null;
          const ownHuman =
            message.actorType === "human" &&
            message.organizationId === organizationId;
          const source = message.channel
            ? channelLabels[message.channel.toLowerCase()] || message.channel
            : null;
          const audience = messageAudience(
            message,
            organizations,
            organizationId,
            counterpartId,
          );
          return (
            <li key={message.id}>
              {currentDate !== previousDate && (
                <div className="conversation-date">
                  <span>{currentDate}</span>
                </div>
              )}
              <article
                className={`conversation-message ${ownHuman ? "from-human" : ""}`}
              >
                <span className="conversation-source">
                  <MessageSource event={message} />
                </span>
                <div className="conversation-message-content">
                  <div className="conversation-message-heading">
                    <strong>{message.actor}</strong>
                    {message.actorType && (
                      <span>
                        {message.actorType === "human"
                          ? "Team member"
                          : message.actorType === "agent"
                            ? "Agent"
                            : "System"}
                      </span>
                    )}
                    <time dateTime={message.createdAt}>
                      {new Date(message.createdAt).toLocaleTimeString([], {
                        hour: "2-digit",
                        minute: "2-digit",
                      })}
                    </time>
                  </div>
                  <div className="conversation-bubble">
                    <p>{message.body}</p>
                  </div>
                  <div className="conversation-message-meta">
                    {source && <span>{source}</span>}
                    {message.target && (
                      <span>
                        {message.target === "case"
                          ? "To everyone in this case"
                          : `To ${organizations.find((item) => item.id === message.recipientOrganizationId)?.agentName || "agent"}`}
                      </span>
                    )}
                    <span>
                      {audience.pending ? (
                        <Clock3 size={11} />
                      ) : (
                        message.visibility === "private" && (
                          <LockKeyhole size={11} />
                        )
                      )}{" "}
                      {audience.label}
                    </span>
                  </div>
                  {linked.length > 0 && (
                    <details className="conversation-evidence">
                      <summary>
                        <FileText size={13} />
                        {linked.length}{" "}
                        {linked.length === 1
                          ? "evidence item"
                          : "evidence items"}
                        <ChevronDown size={12} />
                      </summary>
                      <div>
                        {linked.map((item) => (
                          <button
                            type="button"
                            key={item.id}
                            onClick={() => onEvidence(item)}
                          >
                            <FileText size={15} />
                            <span>
                              <strong>{item.title}</strong>
                              <small>{item.source}</small>
                            </span>
                            <ArrowUpRight size={13} />
                          </button>
                        ))}
                      </div>
                    </details>
                  )}
                </div>
              </article>
            </li>
          );
        })}
      </ol>
      {messages.length === 0 && (
        <div className="conversation-empty">
          <MessageSquare size={24} />
          <p>No messages yet.</p>
        </div>
      )}
      {activeRuns.length > 0 && (
        <div className="conversation-run-status" role="status">
          <Clock3 size={14} />
          <span>
            {activeRuns.some((run) => run.status === "running")
              ? `${organization?.agentName || "Your agent"} ${activeRuns.find((run) => run.status === "running")?.kind === "conversation" ? "is preparing a reply" : "is investigating"}`
              : `${organization?.agentName || "Your agent"} has a queued turn`}
            {activeRuns.length > 1
              ? ` · ${activeRuns.length} active turns`
              : ""}
          </span>
        </div>
      )}
      <form className="conversation-composer" onSubmit={send}>
        <div className="conversation-composer-heading">
          <label htmlFor={`message-agent-${supportCase.id}`}>Message</label>
          <div className="conversation-recipient">
            <label htmlFor={`message-recipient-${supportCase.id}`}>To</label>
            <select
              id={`message-recipient-${supportCase.id}`}
              aria-label="Message recipient"
              value={recipient}
              disabled={locked}
              onChange={(event) => {
                setRecipient(
                  event.target.value as "own" | "counterpart" | "case",
                );
                setSent(false);
                setError("");
              }}
            >
              <option value="own">
                {organization?.agentName || "Your agent"} · private
              </option>
              <option value="counterpart">
                {counterpart?.agentName || "Counterpart agent"} · shared
              </option>
              <option value="case">Everyone in this case · shared</option>
            </select>
            <ChevronDown size={12} />
          </div>
        </div>
        {readOnly && (
          <p className="conversation-read-only">
            Agent messaging is not configured.
          </p>
        )}
        <textarea
          id={`message-agent-${supportCase.id}`}
          value={draft}
          disabled={locked}
          onChange={(event) => {
            setDraft(event.target.value);
            setSent(false);
          }}
          onKeyDown={composerKeyDown}
          rows={3}
          placeholder={`Message ${recipientLabel}…`}
          aria-describedby={`message-privacy-${supportCase.id}`}
        />
        <div className="conversation-composer-footer">
          <span id={`message-privacy-${supportCase.id}`}>
            {privateMessage ? <LockKeyhole size={12} /> : <Globe2 size={12} />}
            {privateMessage
              ? `Only ${organization?.name || "your organization"}`
              : `Shared with ${organization?.name || "your organization"} and ${counterpart?.name || "counterpart"}`}
          </span>
          <button type="submit" disabled={locked || !draft.trim()}>
            {sending ? (
              <Loader2 size={14} className="spin" />
            ) : (
              <ArrowUpRight size={14} />
            )}{" "}
            {sending ? "Sending…" : "Send message"}
          </button>
        </div>
        {error && (
          <p className="conversation-send-error" role="alert">
            {error}
          </p>
        )}
        {sent && (
          <p className="conversation-send-success" role="status">
            Message sent.
          </p>
        )}
      </form>
    </section>
  );
}
