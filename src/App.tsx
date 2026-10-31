import { useCallback, useEffect, useRef, useState } from "react";
import {
  Activity,
  Overview,
  ArrowDown,
  ArrowLeft,
  ArrowRight,
  ArrowUpRight,
  Box,
  Check,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  Circle,
  CircleDot,
  Clock3,
  Cloud,
  Code2,
  Database,
  ExternalLink,
  FileText,
  Fingerprint,
  Globe2,
  Layers3,
  Loader2,
  LockKeyhole,
  MessageSquare,
  Network,
  Play,
  Plug,
  Plus,
  RefreshCw,
  Search,
  Server,
  ShieldCheck,
  SlidersHorizontal,
  Terminal,
  TriangleAlert,
  Unplug,
  Workflow,
  X,
  Zap,
} from "./components/Icons";
import type {
  Approval,
  CaseEvent,
  ConnectorDefinition,
  Connection,
  Evidence,
  OrganizationID,
  PlatformState,
  SupportCase,
} from "./types";
import { auth, authorizationHeaders } from "./auth";
import ProviderLogo from "./components/ProviderLogo";
import InvestigationMap from "./components/InvestigationMap";

type View = "overview" | "cases" | "integrations" | "network";
type CaseTab = "activity" | "evidence" | "conversation";
const statusLabels: Record<string, string> = {
  detected: "Detected",
  investigating: "Investigating",
  awaiting_approval: "Needs approval",
  verifying: "Verifying",
  resolved: "Resolved",
  escalated: "Escalated",
};
const time = (date: string) =>
  new Date(date).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
const shortID = (id: string) => {
  const separator = id.indexOf("-");
  return separator < 0
    ? id.slice(0, 10).toUpperCase()
    : `${id.slice(0, separator).toUpperCase()}-${id.slice(separator + 1, separator + 8).toUpperCase()}`;
};
const isFinished = (item: SupportCase) =>
  ["resolved", "escalated"].includes(item.status);

async function api<T>(path: string, body?: unknown): Promise<T> {
  const headers = await authorizationHeaders();
  const response = await fetch(
    `${import.meta.env.VITE_API_URL || ""}${path}`,
    body === undefined
      ? { headers }
      : {
          method: "POST",
          headers: { ...headers, "Content-Type": "application/json" },
          body: JSON.stringify(body),
        },
  );
  const text = await response.text();
  if (!text)
    throw new Error(
      "The Janus server did not respond. Refresh the workspace to check the latest case state.",
    );
  let payload;
  try {
    payload = JSON.parse(text);
  } catch {
    throw new Error(
      "The Janus server returned an unexpected response. Check the API connection and refresh.",
    );
  }
  if (response.status === 401)
    window.dispatchEvent(new Event("janus:auth-required"));
  if (!response.ok)
    throw new Error(
      payload.error || payload.message || "The request could not be completed.",
    );
  return payload as T;
}

function Status({ value }: { value: string }) {
  return (
    <span className={`status status-${value}`}>
      <span />
      {statusLabels[value] || value.replaceAll("_", " ")}
    </span>
  );
}

function ConnectorIcon({
  connector,
  small = false,
}: {
  connector: Pick<ConnectorDefinition, "id" | "name" | "category">;
  small?: boolean;
}) {
  return (
    <span className={`connector-icon ${small ? "small" : ""}`}>
      <ProviderLogo connectorId={connector.id} size={small ? 19 : 32} />
    </span>
  );
}

export default function App() {
  const [workspaceState, setState] = useState<PlatformState | null>(null);
  const [organizationId, setOrganizationId] =
    useState<OrganizationID>("northstar");
  const [view, setView] = useState<View>("overview");
  const [selectedCaseId, setSelectedCaseId] = useState<string | null>(null);
  const [caseTab, setCaseTab] = useState<CaseTab>("activity");
  const [query, setQuery] = useState("");
  const [caseFilter, setCaseFilter] = useState("all");
  const [category, setCategory] = useState("All integrations");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState("");
  const [connector, setConnector] = useState<ConnectorDefinition | null>(null);
  const [newCase, setNewCase] = useState(false);
  const [caseTitle, setCaseTitle] = useState(
    "Checkout requests failing for Northstar",
  );
  const [caseSummary, setCaseSummary] = useState(
    "Investigate HTTP 503 errors affecting Northstar checkout requests to Contoso Cloud.",
  );
  const [eventFilter, setEventFilter] = useState("all");
  const [evidence, setEvidence] = useState<Evidence | null>(null);
  const [mobileNav, setMobileNav] = useState(false);
  const [authRequired, setAuthRequired] = useState(false);
  const [caseVendor, setCaseVendor] = useState("");
  const initialized = useRef(false);
  const authenticationGeneration = useRef(0);
  const state =
    workspaceState?.activeOrganizationId === organizationId
      ? workspaceState
      : null;
  const organizationRef = useRef(organizationId);
  organizationRef.current = organizationId;

  const refresh = useCallback(async () => {
    const active = organizationRef.current;
    const generation = authenticationGeneration.current;
    const next = await api<PlatformState>(
      initialized.current
        ? `/api/state?organizationId=${encodeURIComponent(active)}`
        : "/api/state",
    );
    if (
      active === organizationRef.current &&
      generation === authenticationGeneration.current
    ) {
      setState(next);
      if (
        !initialized.current ||
        !next.organizations.some((item) => item.id === active)
      )
        setOrganizationId(next.activeOrganizationId);
      initialized.current = true;
    }
  }, []);

  useEffect(() => {
    refresh().catch((reason) => setError(reason.message));
  }, [refresh, organizationId]);
  useEffect(() => {
    const required = () => {
      authenticationGeneration.current += 1;
      initialized.current = false;
      setAuthRequired(true);
      setState(null);
      setEvidence(null);
      setConnector(null);
      setSelectedCaseId(null);
      setNewCase(false);
      setCaseTitle("");
      setCaseSummary("");
      setCaseVendor("");
      setQuery("");
      setNotice("");
      setError("");
      setBusy("");
    };
    window.addEventListener("janus:auth-required", required);
    return () => window.removeEventListener("janus:auth-required", required);
  }, []);
  const hasActiveCase = state?.cases.some((item) =>
    ["investigating", "verifying", "awaiting_approval"].includes(item.status),
  );
  useEffect(() => {
    if (!hasActiveCase) return;
    const interval = window.setInterval(() => {
      if (document.visibilityState === "visible")
        refresh().catch((reason) => setError(reason.message));
    }, 3000);
    return () => window.clearInterval(interval);
  }, [hasActiveCase, refresh]);
  useEffect(() => {
    const onFocus = () => {
      refresh().catch((reason) => setError(reason.message));
    };
    window.addEventListener("focus", onFocus);
    return () => window.removeEventListener("focus", onFocus);
  }, [refresh]);
  useEffect(() => {
    if (!notice) return;
    const timeout = window.setTimeout(() => setNotice(""), 6000);
    return () => window.clearTimeout(timeout);
  }, [notice]);
  useEffect(() => {
    const close = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setConnector(null);
        setEvidence(null);
        setNewCase(false);
        setMobileNav(false);
      }
    };
    document.addEventListener("keydown", close);
    return () => document.removeEventListener("keydown", close);
  }, []);
  useEffect(() => {
    if (!connector && !newCase && !evidence) return;
    const previousFocus = document.activeElement as HTMLElement | null;
    const overflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const trapFocus = (event: KeyboardEvent) => {
      if (event.key !== "Tab") return;
      const dialog = document.querySelector<HTMLElement>('[role="dialog"]');
      const controls = Array.from(
        dialog?.querySelectorAll<HTMLElement>(
          "button:not([disabled]), a[href], input, textarea, select, summary",
        ) || [],
      ).filter((element) => element.offsetParent !== null);
      const first = controls[0];
      const last = controls[controls.length - 1];
      if (
        event.shiftKey &&
        (document.activeElement === first ||
          !dialog?.contains(document.activeElement))
      ) {
        event.preventDefault();
        last?.focus();
      } else if (
        !event.shiftKey &&
        (document.activeElement === last ||
          !dialog?.contains(document.activeElement))
      ) {
        event.preventDefault();
        first?.focus();
      }
    };
    document.addEventListener("keydown", trapFocus);
    return () => {
      document.removeEventListener("keydown", trapFocus);
      document.body.style.overflow = overflow;
      previousFocus?.focus();
    };
  }, [connector, newCase, evidence]);

  async function act(
    key: string,
    action: () => Promise<unknown>,
    success?: string,
  ) {
    setBusy(key);
    setError("");
    try {
      await action();
      await refresh();
      if (success) setNotice(success);
    } catch (reason) {
      setError(
        reason instanceof Error
          ? reason.message
          : "Something went wrong. Please try again.",
      );
    } finally {
      setBusy("");
    }
  }

  function selectOrganization(id: OrganizationID) {
    organizationRef.current = id;
    setOrganizationId(id);
    setEvidence(null);
    setConnector(null);
    setNewCase(false);
    setCaseVendor("");
    setQuery("");
    setError("");
    setNotice("");
  }

  function navigate(next: View) {
    setView(next);
    setSelectedCaseId(null);
    setQuery("");
    setMobileNav(false);
  }
  function openCase(id: string) {
    setSelectedCaseId(id);
    setView("cases");
    setCaseTab("activity");
    setEventFilter("all");
    setQuery("");
  }

  const accessibleIDs = workspaceState?.accessibleOrganizationIds;
  const canAccessOrganization = (id: string) =>
    !accessibleIDs || accessibleIDs.includes(id);
  const org = workspaceState?.organizations.find(
    (item) => item.id === organizationId,
  );
  const cases = state?.cases || [];
  const selected = cases.find((item) => item.id === selectedCaseId);
  const connections = (state?.connections || []).filter(
    (item) => item.organizationId === organizationId,
  );
  const liveConnections = connections.filter(
    (item) => item.mode === "live" && item.status === "connected",
  );
  const openCases = cases.filter((item) => !isFinished(item));
  const approvals = cases.flatMap((item) =>
    item.approvals
      .filter((approval) => approval.status === "pending")
      .map((approval) => ({ ...approval, caseId: item.id })),
  );
  const visibleCases = cases.filter(
    (item) =>
      (caseFilter === "all" ||
        (caseFilter === "active"
          ? !isFinished(item)
          : item.status === caseFilter)) &&
      `${item.title} ${item.id} ${item.summary}`
        .toLowerCase()
        .includes(query.toLowerCase()),
  );
  const runtime = state?.runtime as
    | (PlatformState["runtime"] & {
        agentsConfigured?: boolean;
        agent?: string;
        agentModel?: string;
        agentRuntime?: string;
      })
    | undefined;
  const isDemo = runtime?.mode !== "live";
  const environmentLabel = isDemo ? "Sample workspace" : "Live workspace";
  const spotlightCase =
    openCases.find((item) => item.status === "awaiting_approval") ||
    openCases[0] ||
    cases[0];
  const viewLabel = {
    overview: "Overview",
    cases: "Cases",
    integrations: "Integrations",
    network: "Organization network",
  }[view];

  function renderApprovalCard({
    approval,
    caseId,
  }: {
    approval: Approval;
    caseId: string;
  }) {
    const canApprove = approval.organizationId === organizationId;
    return (
      <div className="approval-card" key={approval.id}>
        <div className="approval-icon">
          <ShieldCheck size={19} />
        </div>
        <div>
          <div className="eyebrow">HUMAN DECISION REQUIRED</div>
          <h3>{approval.title}</h3>
          <p>{approval.description}</p>
          {approval.action && canApprove && (
            <details className="approval-action">
              <summary>Review exact action</summary>
              <p>
                {approval.action.connectorId} · {approval.action.operation}
              </p>
              <pre>{JSON.stringify(approval.action.input, null, 2)}</pre>
            </details>
          )}
          {canApprove ? (
            <div className="button-row">
              <button
                className="button primary"
                disabled={!!busy}
                onClick={() =>
                  act(
                    "approve",
                    () =>
                      api(`/api/cases/${caseId}/approvals/${approval.id}`, {
                        decision: "approved",
                      }),
                    "Action approved. The investigation can continue.",
                  )
                }
              >
                <Check size={14} />
                Approve action
              </button>
              <button
                className="button"
                disabled={!!busy}
                onClick={() =>
                  act(
                    "reject",
                    () =>
                      api(`/api/cases/${caseId}/approvals/${approval.id}`, {
                        decision: "rejected",
                      }),
                    "Action declined.",
                  )
                }
              >
                Decline
              </button>
            </div>
          ) : (
            <p className="approval-owner">
              Waiting for{" "}
              {
                state?.organizations.find(
                  (item) => item.id === approval.organizationId,
                )?.name
              }
              . Switch organization to review.
            </p>
          )}
        </div>
      </div>
    );
  }

  if (authRequired)
    return (
      <AuthScreen
        onAuthenticated={async () => {
          authenticationGeneration.current += 1;
          initialized.current = false;
          setAuthRequired(false);
          setError("");
          await refresh();
        }}
      />
    );

  return (
    <div className="app-shell">
      <aside className={`sidebar ${mobileNav ? "mobile-open" : ""}`}>
        <button
          className="brand"
          onClick={() => window.location.assign("/")}
          aria-label="Janus home"
        >
          <span>Janus</span>
        </button>
        <div className="workspace-picker">
          <span className="organization-avatar">
            {org?.name.slice(0, 1).toUpperCase() || ""}
          </span>
          <div>
            <span className="workspace-label">WORKSPACE</span>
            <select
              aria-label="Active organization"
              value={organizationId}
              onChange={(event) => selectOrganization(event.target.value)}
            >
              {(
                workspaceState?.organizations || [
                  { id: "northstar", name: "Northstar" },
                  { id: "contoso", name: "Contoso Cloud" },
                ]
              )
                .filter((item) => canAccessOrganization(item.id))
                .map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.name}
                  </option>
                ))}
            </select>
          </div>
          <ChevronDown size={14} />
        </div>
        <div className="nav-label">WORKSPACE</div>
        <nav>
          {(
            [
              { id: "overview", label: "Overview", icon: Overview },
              { id: "cases", label: "Cases", icon: Layers3 },
              { id: "integrations", label: "Integrations", icon: Plug },
              { id: "network", label: "Organization network", icon: Network },
            ] as const
          ).map((item) => (
            <button
              className={`nav-item ${view === item.id ? "active" : ""}`}
              key={item.id}
              onClick={() => navigate(item.id)}
            >
              <item.icon size={18} />
              <span>{item.label}</span>
              {item.id === "cases" && openCases.length > 0 && (
                <span className="nav-count">{openCases.length}</span>
              )}
            </button>
          ))}
        </nav>
        <div className="sidebar-bottom">
          <div className="runtime-dot" />
          <div>
            <strong>{environmentLabel}</strong>
            <span>{org?.name || "Workspace"}</span>
          </div>
          <ShieldCheck size={16} />
        </div>
      </aside>

      <div className="main-shell">
        <header className="topbar">
          <div className="breadcrumb">
            <button
              className="icon-button mobile-menu"
              aria-label="Toggle navigation"
              onClick={() => setMobileNav(!mobileNav)}
            >
              <Layers3 size={18} />
            </button>
            <span>{org?.name || "Northstar"}</span>
            <ChevronRight size={14} />
            <strong>{viewLabel}</strong>
            {selected && (
              <>
                <ChevronRight size={14} />
                <span>{shortID(selected.id)}</span>
              </>
            )}
          </div>
          <div className="topbar-right">
            <span className="environment-label">
              <span />
              {environmentLabel}
            </span>
            <button
              className="icon-button"
              disabled={!!busy}
              onClick={() => act("refresh", refresh)}
              aria-label="Refresh workspace"
            >
              <RefreshCw
                size={16}
                className={busy === "refresh" ? "spin" : ""}
              />
            </button>
            <span className="user-avatar">
              {org?.name.slice(0, 1).toUpperCase() || ""}
            </span>
          </div>
        </header>
        <main>
          {error && (
            <div className="alert error" role="alert">
              <TriangleAlert size={17} />
              <span>{error}</span>
              <button
                aria-label="Dismiss error"
                className="icon-button"
                onClick={() => setError("")}
              >
                <X size={15} />
              </button>
            </div>
          )}
          {notice && (
            <div className="toast" role="status">
              <CheckCircle2 size={16} />
              {notice}
              <button
                className="icon-button"
                onClick={() => setNotice("")}
                aria-label="Dismiss notification"
              >
                <X size={14} />
              </button>
            </div>
          )}
          {!state ? (
            <div className="loading">
              {error ? (
                <TriangleAlert size={24} />
              ) : (
                <Loader2 className="spin" size={24} />
              )}
              <h2>
                {error ? "Workspace unavailable" : "Opening your workspace"}
              </h2>
              <p>
                {error
                  ? "Check your workspace access and API connection, then try again."
                  : "Connecting to Janus…"}
              </p>
              {error && (
                <button
                  className="button"
                  onClick={() => act("refresh", refresh)}
                >
                  Try again
                </button>
              )}
            </div>
          ) : (
            <>
              {view === "overview" && (
                <>
                  <div className="page-heading">
                    <div>
                      <div className="eyebrow">{org?.name}</div>
                      <h1>Overview</h1>
                      <p>Your cases, connected teams, and next decisions.</p>
                    </div>
                    <button
                      className="button primary"
                      onClick={() => setNewCase(true)}
                    >
                      <Plus size={16} />
                      {isDemo ? "Create demo case" : "Create case"}
                    </button>
                  </div>
                  {spotlightCase && (
                    <section className="case-spotlight">
                      <div className="spotlight-heading">
                        <div>
                          <span className="eyebrow">
                            {isFinished(spotlightCase)
                              ? "LATEST INVESTIGATION"
                              : "IN FOCUS"}
                          </span>
                          <h2>{spotlightCase.title}</h2>
                        </div>
                        <button
                          className="button"
                          onClick={() => openCase(spotlightCase.id)}
                        >
                          Open case <ArrowUpRight size={15} />
                        </button>
                      </div>
                      <InvestigationMap
                        supportCase={spotlightCase}
                        organizations={state.organizations}
                        organizationId={organizationId}
                        accessibleOrganizationIds={accessibleIDs}
                        onOrganizationChange={selectOrganization}
                        compact
                      />
                    </section>
                  )}
                  <div className="metric-grid">
                    <div className="metric">
                      <span>
                        Open cases <Layers3 size={16} />
                      </span>
                      <strong>
                        {openCases.length}
                        <small>in progress</small>
                      </strong>
                      <p>Across your organization network</p>
                    </div>
                    <div className="metric">
                      <span>
                        Needs your attention <ShieldCheck size={16} />
                      </span>
                      <strong>
                        {approvals.length}
                        <small>pending decisions</small>
                      </strong>
                      <p>Human oversight, exactly where it matters</p>
                    </div>
                    <div className="metric">
                      <span>
                        Resolved cases <CheckCircle2 size={16} />
                      </span>
                      <strong>
                        {
                          cases.filter((item) => item.status === "resolved")
                            .length
                        }
                        <small>verified outcomes</small>
                      </strong>
                      <p>Resolution confirmed by the workflow</p>
                    </div>
                    <div className="metric">
                      <span>
                        Live connections <Plug size={16} />
                      </span>
                      <strong>
                        {liveConnections.length}
                        <small>connected sources</small>
                      </strong>
                      <button
                        className="text-button"
                        onClick={() => navigate("integrations")}
                      >
                        Manage integrations <ArrowRight size={13} />
                      </button>
                    </div>
                  </div>
                  <div className="overview-grid">
                    <section className="panel recent-cases">
                      <div className="panel-heading">
                        <div>
                          <h2>Case activity</h2>
                          <p>From first signal to verified resolution.</p>
                        </div>
                        <button
                          className="text-button"
                          onClick={() => navigate("cases")}
                        >
                          View all cases <ArrowRight size={14} />
                        </button>
                      </div>
                      <CaseTable
                        organizations={state.organizations}
                        items={cases.slice(0, 5)}
                        query={query}
                        caseFilter={caseFilter}
                        isDemo={isDemo}
                        openCase={openCase}
                        setNewCase={setNewCase}
                      />
                    </section>
                  </div>
                  {approvals.length > 0 && (
                    <section className="attention-section">
                      <div className="section-heading">
                        <h2>Ready for your decision</h2>
                        <span className="count-pill">{approvals.length}</span>
                      </div>
                      {approvals.map((approval) =>
                        renderApprovalCard({
                          approval,
                          caseId: approval.caseId,
                        }),
                      )}
                    </section>
                  )}
                  <section className="integration-strip">
                    <div className="strip-providers" aria-hidden="true">
                      <ProviderLogo connectorId="slack" size={25} />
                      <ProviderLogo connectorId="github" size={25} />
                      <ProviderLogo connectorId="datadog" size={25} />
                    </div>
                    <div>
                      <h3>Your tools, connected.</h3>
                      <p>Add the sources your agents need to investigate.</p>
                    </div>
                    <div className="strip-count">
                      <strong>{state.connectors.length}</strong>
                      <span>available integrations</span>
                    </div>
                    <button
                      className="button"
                      onClick={() => navigate("integrations")}
                    >
                      Explore integrations <ArrowUpRight size={15} />
                    </button>
                  </section>
                  <div className="workspace-footnote">
                    <LockKeyhole size={13} />
                    Private evidence stays in its organization. Only shared
                    findings cross the boundary.
                  </div>
                </>
              )}

              {view === "cases" && !selected && (
                <>
                  <div className="page-heading">
                    <div>
                      <div className="eyebrow">INVESTIGATIONS</div>
                      <h1>Cases</h1>
                      <p>A complete record of the work between companies.</p>
                    </div>
                    <button
                      className="button primary"
                      onClick={() => setNewCase(true)}
                    >
                      <Plus size={16} />
                      {isDemo ? "Create demo case" : "Create case"}
                    </button>
                  </div>
                  <div className="list-toolbar">
                    <div className="filter-tabs">
                      {[
                        ["all", "All cases"],
                        ["active", "Active"],
                        ["awaiting_approval", "Needs approval"],
                        ["resolved", "Resolved"],
                      ].map(([value, label]) => (
                        <button
                          key={value}
                          className={caseFilter === value ? "selected" : ""}
                          onClick={() => setCaseFilter(value)}
                        >
                          {label}
                        </button>
                      ))}
                    </div>
                    <label className="search-field">
                      <Search size={16} />
                      <input
                        value={query}
                        onChange={(event) => setQuery(event.target.value)}
                        placeholder="Search cases…"
                        aria-label="Search cases"
                      />
                    </label>
                  </div>
                  <section className="panel">
                    <CaseTable
                      organizations={state.organizations}
                      items={visibleCases}
                      query={query}
                      caseFilter={caseFilter}
                      isDemo={isDemo}
                      openCase={openCase}
                      setNewCase={setNewCase}
                    />
                  </section>
                </>
              )}

              {view === "cases" && selected && (
                <>
                  <button
                    className="back-link"
                    onClick={() => setSelectedCaseId(null)}
                  >
                    <ArrowLeft size={14} />
                    All cases
                  </button>
                  <div className="case-detail-heading">
                    <div className="case-title-meta">
                      <span className="mono" title={selected.id}>
                        {shortID(selected.id)}
                      </span>
                      <span
                        className={`severity ${selected.severity.toLowerCase()}`}
                      >
                        {selected.severity}
                      </span>
                      <Status value={selected.status} />
                      <span className="subtle-label">
                        {selected.mode === "simulation" ? "SIMULATION" : "LIVE"}
                      </span>
                    </div>
                    <h1>{selected.title}</h1>
                    <p>{selected.summary}</p>
                    <div className="case-controls">
                      <span>
                        <Clock3 size={14} />
                        Opened{" "}
                        {new Date(selected.createdAt).toLocaleDateString([], {
                          month: "short",
                          day: "numeric",
                        })}{" "}
                        at {time(selected.createdAt)}
                      </span>
                      <div className="button-row">
                        <button
                          className="button"
                          disabled={!!busy || !runtime?.agentsConfigured}
                          title={
                            !runtime?.agentsConfigured
                              ? "Configure an agent provider on the server to enable live investigation."
                              : "Run the connected agent runtime"
                          }
                          onClick={() =>
                            act(
                              "investigate",
                              () =>
                                api(`/api/cases/${selected.id}/investigate`, {
                                  organizationId,
                                }),
                              "Investigation queued. The case will update as your agents work.",
                            )
                          }
                        >
                          <ArrowRight size={15} />
                          {busy === "investigate"
                            ? "Investigating…"
                            : "Run agent investigation"}
                        </button>
                        <button
                          className="button primary"
                          hidden={selected.mode !== "simulation"}
                          disabled={
                            !!busy ||
                            !!selected.runs?.length ||
                            isFinished(selected) ||
                            selected.status === "awaiting_approval"
                          }
                          onClick={() =>
                            act("advance", () =>
                              api(`/api/cases/${selected.id}/advance`, {
                                organizationId,
                              }),
                            )
                          }
                        >
                          {busy === "advance" ? (
                            <Loader2 size={15} className="spin" />
                          ) : (
                            <Play size={14} />
                          )}
                          {selected.runs?.length
                            ? "Agent-driven case"
                            : isFinished(selected)
                              ? "Workflow complete"
                              : selected.status === "awaiting_approval"
                                ? "Waiting for decision"
                                : "Advance demo"}
                        </button>
                      </div>
                    </div>
                  </div>
                  <InvestigationMap
                    supportCase={selected}
                    organizations={state.organizations}
                    organizationId={organizationId}
                    accessibleOrganizationIds={accessibleIDs}
                    onOrganizationChange={selectOrganization}
                  />
                  <div className="case-layout">
                    <section className="case-main">
                      <div className="case-tabs">
                        {(
                          ["activity", "evidence", "conversation"] as const
                        ).map((tab) => (
                          <button
                            className={caseTab === tab ? "selected" : ""}
                            key={tab}
                            onClick={() => setCaseTab(tab)}
                          >
                            {tab === "activity" ? (
                              <Activity size={15} />
                            ) : tab === "evidence" ? (
                              <FileText size={15} />
                            ) : (
                              <MessageSquare size={15} />
                            )}
                            {tab.charAt(0).toUpperCase() + tab.slice(1)}
                            {tab === "evidence" && (
                              <span className="count-pill">
                                {
                                  selected.evidence.filter(
                                    (item) =>
                                      item.visibility === "shared" ||
                                      item.organizationId === organizationId,
                                  ).length
                                }
                              </span>
                            )}
                          </button>
                        ))}
                      </div>
                      {selected.approvals
                        .filter((approval) => approval.status === "pending")
                        .map((approval) =>
                          renderApprovalCard({ approval, caseId: selected.id }),
                        )}
                      {selected.outcome && (
                        <div
                          className={`outcome ${selected.status === "resolved" ? "resolved" : ""}`}
                        >
                          <CheckCircle2 size={19} />
                          <div>
                            <strong>
                              {selected.status === "resolved"
                                ? "Resolution verified"
                                : "Case outcome"}
                            </strong>
                            <p>{selected.outcome}</p>
                          </div>
                        </div>
                      )}
                      {caseTab !== "evidence" && (
                        <>
                          <div className="timeline-toolbar">
                            <span>
                              {caseTab === "conversation"
                                ? "AGENT CORRESPONDENCE"
                                : "INVESTIGATION TIMELINE"}
                            </span>
                            <label>
                              <SlidersHorizontal size={13} />
                              <select
                                aria-label="Filter activity visibility"
                                value={eventFilter}
                                onChange={(event) =>
                                  setEventFilter(event.target.value)
                                }
                              >
                                <option value="all">
                                  All visible activity
                                </option>
                                <option value="shared">Shared only</option>
                                <option value="private">Private only</option>
                              </select>
                            </label>
                          </div>
                          <div className="timeline">
                            {selected.events
                              .filter(
                                (event) =>
                                  (event.visibility === "shared" ||
                                    event.organizationId === organizationId) &&
                                  (caseTab !== "conversation" ||
                                    event.type === "message") &&
                                  (eventFilter === "all" ||
                                    event.visibility === eventFilter),
                              )
                              .map((event) => (
                                <TimelineEvent key={event.id} event={event} />
                              ))}
                            {!selected.events.some(
                              (event) =>
                                (event.visibility === "shared" ||
                                  event.organizationId === organizationId) &&
                                (caseTab !== "conversation" ||
                                  event.type === "message") &&
                                (eventFilter === "all" ||
                                  event.visibility === eventFilter),
                            ) && (
                              <div className="empty">
                                <MessageSquare size={25} />
                                <h3>
                                  {caseTab === "conversation"
                                    ? "The conversation starts with evidence."
                                    : "No activity in this view."}
                                </h3>
                                <p>
                                  Advance the demo to see the investigation
                                  develop.
                                </p>
                              </div>
                            )}
                          </div>
                        </>
                      )}
                      {caseTab === "evidence" && (
                        <div className="evidence-list">
                          {selected.evidence
                            .filter(
                              (item) =>
                                item.visibility === "shared" ||
                                item.organizationId === organizationId,
                            )
                            .map((item) => (
                              <button
                                className="evidence-card"
                                key={item.id}
                                onClick={() => setEvidence(item)}
                              >
                                <span className="evidence-source">
                                  <Database size={17} />
                                </span>
                                <div>
                                  <span className="eyebrow">{item.source}</span>
                                  <h3>{item.title}</h3>
                                  <p>{item.summary}</p>
                                  <div className="evidence-meta">
                                    <span>
                                      {item.visibility === "private" ? (
                                        <LockKeyhole size={12} />
                                      ) : (
                                        <Globe2 size={12} />
                                      )}
                                      {item.visibility === "private"
                                        ? "Private to your organization"
                                        : "Shared with counterpart"}
                                    </span>
                                    <span>
                                      {item.simulated
                                        ? "Sample evidence"
                                        : item.provenance
                                          ? "Tool receipt"
                                          : "Reported evidence"}
                                    </span>
                                  </div>
                                </div>
                                <ArrowUpRight size={16} />
                              </button>
                            ))}
                          {!selected.evidence.filter(
                            (item) =>
                              item.visibility === "shared" ||
                              item.organizationId === organizationId,
                          ).length && (
                            <div className="empty">
                              <Database size={26} />
                              <h3>Evidence will appear here.</h3>
                              <p>
                                Agents collect relevant signals as the case
                                progresses.
                              </p>
                            </div>
                          )}
                        </div>
                      )}
                    </section>
                    <aside className="case-aside">
                      <div className="detail-block">
                        <h3>Participants</h3>
                        {state.organizations
                          .filter((item) =>
                            [selected.customerId, selected.vendorId].includes(
                              item.id,
                            ),
                          )
                          .map((item) => (
                            <div className="participant" key={item.id}>
                              <span
                                className={`organization-avatar ${item.id === selected.vendorId ? "vendor" : ""}`}
                              >
                                {item.name.slice(0, 1).toUpperCase()}
                              </span>
                              <div>
                                <strong>{item.name}</strong>
                                <span>
                                  {item.agentName} · {item.role}
                                </span>
                              </div>
                              {item.id === organizationId && (
                                <span className="you-label">YOU</span>
                              )}
                            </div>
                          ))}
                      </div>
                      <div className="detail-block">
                        <h3>Case context</h3>
                        <dl>
                          <div>
                            <dt>Workflow</dt>
                            <dd>
                              {selected.mode === "simulation"
                                ? "Checkout API failure"
                                : "Agent investigation"}
                            </dd>
                          </div>
                          <div>
                            <dt>Stage</dt>
                            <dd>{selected.step + 1}</dd>
                          </div>
                          <div>
                            <dt>Environment</dt>
                            <dd>
                              {selected.mode === "simulation"
                                ? "Simulation"
                                : "Live"}
                            </dd>
                          </div>
                          <div>
                            <dt>Evidence</dt>
                            <dd>
                              {
                                selected.evidence.filter(
                                  (item) =>
                                    item.visibility === "shared" ||
                                    item.organizationId === organizationId,
                                ).length
                              }{" "}
                              visible records
                            </dd>
                          </div>
                          <div>
                            <dt>Updated</dt>
                            <dd>{time(selected.updatedAt)}</dd>
                          </div>
                        </dl>
                      </div>
                      <div className="boundary-note">
                        <Fingerprint size={23} />
                        <h3>Your context stays yours.</h3>
                        <p>
                          You are viewing {org?.name}'s side of this case.
                          Internal evidence is scoped to its organization.
                        </p>
                      </div>
                      <div className="detail-block">
                        <h3>Connected sources</h3>
                        {connections.filter(
                          (item) => item.status === "connected",
                        ).length ? (
                          connections
                            .filter((item) => item.status === "connected")
                            .map((item) => {
                              const definition = state.connectors.find(
                                (def) => def.id === item.connectorId,
                              );
                              return (
                                definition && (
                                  <button
                                    className="source-row"
                                    key={item.id}
                                    onClick={() => setConnector(definition)}
                                  >
                                    <ConnectorIcon
                                      connector={definition}
                                      small
                                    />
                                    <span>{definition.name}</span>
                                    <span className="subtle-label">
                                      {item.mode === "live" ? "LIVE" : "DEMO"}
                                    </span>
                                  </button>
                                )
                              );
                            })
                        ) : (
                          <p className="muted small-copy">
                            No sources connected for this organization.
                          </p>
                        )}
                        <button
                          className="text-button"
                          onClick={() => navigate("integrations")}
                        >
                          Manage sources <ArrowRight size={13} />
                        </button>
                      </div>
                    </aside>
                  </div>
                </>
              )}

              {view === "integrations" && (
                <>
                  <div className="page-heading">
                    <div>
                      <div className="eyebrow">{org?.name}</div>
                      <h1>Integrations</h1>
                      <p>Bring your team’s tools into the investigation.</p>
                    </div>
                    <span className="integration-total">
                      <Plug size={16} />
                      {liveConnections.length} live connections
                    </span>
                  </div>
                  <div className="catalog-top">
                    <label className="search-field">
                      <Search size={17} />
                      <input
                        aria-label="Search integrations"
                        placeholder="Search integrations…"
                        value={query}
                        onChange={(event) => setQuery(event.target.value)}
                      />
                    </label>
                    <span>
                      {state.connectors.length} integrations available
                    </span>
                  </div>
                  <div className="catalog-layout">
                    <aside className="catalog-filters">
                      {[
                        "All integrations",
                        "Connected",
                        "Observability",
                        "Collaboration",
                        "Cloud & data",
                        "Extensibility",
                      ].map((item) => (
                        <button
                          className={category === item ? "selected" : ""}
                          key={item}
                          onClick={() => setCategory(item)}
                        >
                          {item}
                          <span>
                            {item === "All integrations"
                              ? state.connectors.length
                              : item === "Connected"
                                ? connections.filter(
                                    (connection) =>
                                      connection.status === "connected",
                                  ).length
                                : state.connectors.filter(
                                    (def) => def.category === item,
                                  ).length}
                          </span>
                        </button>
                      ))}
                      <div className="catalog-note">
                        <LockKeyhole size={16} />
                        <p>
                          Connections belong to <strong>{org?.name}</strong>.
                          Credentials are never stored in your browser.
                        </p>
                      </div>
                    </aside>
                    <div className="connector-grid">
                      {state.connectors
                        .filter(
                          (item) =>
                            (category === "All integrations" ||
                              (category === "Connected"
                                ? connections.some(
                                    (connection) =>
                                      connection.connectorId === item.id &&
                                      connection.status === "connected",
                                  )
                                : item.category === category)) &&
                            `${item.name} ${item.description}`
                              .toLowerCase()
                              .includes(query.toLowerCase()),
                        )
                        .map((item) => {
                          const connection = connections.find(
                            (connection) => connection.connectorId === item.id,
                          );
                          return (
                            <button
                              className="connector-card"
                              key={item.id}
                              onClick={() => setConnector(item)}
                            >
                              <div className="connector-card-top">
                                <ConnectorIcon connector={item} />
                                {connection?.status === "connected" ? (
                                  <span
                                    className={`connection-badge ${connection.mode === "live" ? "live" : ""}`}
                                  >
                                    <span />
                                    {connection.mode === "live"
                                      ? "Live"
                                      : "Demo"}
                                  </span>
                                ) : connection?.status === "error" ? (
                                  <span className="connection-badge error">
                                    Needs attention
                                  </span>
                                ) : (
                                  <ArrowUpRight size={17} />
                                )}
                              </div>
                              <h3>{item.name}</h3>
                              <p>{item.description}</p>
                              <div className="connector-card-bottom">
                                <span>{item.category}</span>
                                <span>
                                  {item.operations.length}{" "}
                                  {item.operations.length === 1
                                    ? "tool"
                                    : "tools"}{" "}
                                  <ChevronRight size={13} />
                                </span>
                              </div>
                            </button>
                          );
                        })}
                      {!state.connectors.some(
                        (item) =>
                          (category === "All integrations" ||
                            (category === "Connected"
                              ? connections.some(
                                  (connection) =>
                                    connection.connectorId === item.id &&
                                    connection.status === "connected",
                                )
                              : item.category === category)) &&
                          `${item.name} ${item.description}`
                            .toLowerCase()
                            .includes(query.toLowerCase()),
                      ) && (
                        <div className="empty catalog-empty">
                          <Unplug size={27} />
                          <h3>No integrations found</h3>
                          <p>Try another category or search.</p>
                        </div>
                      )}
                    </div>
                  </div>
                </>
              )}

              {view === "network" && (
                <>
                  <div className="page-heading">
                    <div>
                      <div className="eyebrow">CONNECTED ORGANIZATIONS</div>
                      <h1>Your network</h1>
                      <p>Shared investigations. Independent workspaces.</p>
                    </div>
                    <span className="subtle-label">
                      {isDemo ? "DEMO NETWORK" : "ORGANIZATION NETWORK"}
                    </span>
                  </div>
                  <section className="network-canvas">
                    <div className="network-grid-bg" />
                    {state.organizations.map((item, index) => (
                      <div className="network-node" key={item.id}>
                        <div className="network-node-heading">
                          <span
                            className={`organization-avatar large ${index ? "vendor" : ""}`}
                          >
                            {index ? "C" : "N"}
                          </span>
                          <span className="subtle-label">{item.role}</span>
                        </div>
                        <h2>{item.name}</h2>
                        <p>
                          {index
                            ? "Product knowledge, infrastructure, and account context."
                            : "Application context, customer impact, and local diagnostics."}
                        </p>
                        <div className="network-agent">
                          <span className="agent-initial">
                            {item.agentName.slice(0, 1)}
                          </span>
                          <div>
                            <strong>{item.agentName}</strong>
                            <span>Operational agent</span>
                          </div>
                        </div>
                        <div className="node-footer">
                          <span>
                            <Server size={13} />
                            {item.deployment === "hosted"
                              ? "Hosted configuration"
                              : "Self-hosted configuration"}
                          </span>
                          {item.id === organizationId ? (
                            <span className="you-label">YOUR VIEW</span>
                          ) : canAccessOrganization(item.id) ? (
                            <button
                              className="text-button"
                              onClick={() => selectOrganization(item.id)}
                            >
                              Switch view <ArrowRight size={13} />
                            </button>
                          ) : (
                            <span className="subtle-label">COUNTERPART</span>
                          )}
                        </div>
                      </div>
                    ))}
                    <div className="network-bridge">
                      <div className="bridge-line" />
                      <div className="bridge-icon">
                        <Workflow size={25} />
                      </div>
                      <strong>Shared case</strong>
                      <span>Evidence · requests · decisions</span>
                    </div>
                  </section>
                  <div className="network-info-grid">
                    <section className="panel info-panel">
                      <ShieldCheck size={22} />
                      <h2>Explicit boundaries</h2>
                      <p>
                        Private investigations remain with their organization.
                        Shared findings and requests form the common case
                        history.
                      </p>
                      <button
                        className="text-button"
                        onClick={() => navigate("cases")}
                      >
                        Explore cases <ArrowRight size={14} />
                      </button>
                    </section>
                    <section className="panel info-panel">
                      <Plug size={22} />
                      <h2>Your tools, your context</h2>
                      <p>
                        Configure each organization’s observability,
                        collaboration, and data connections independently.
                      </p>
                      <button
                        className="text-button"
                        onClick={() => navigate("integrations")}
                      >
                        Manage integrations <ArrowRight size={14} />
                      </button>
                    </section>
                    <section className="panel info-panel">
                      <Server size={22} />
                      <h2>Runtime configuration</h2>
                      <dl>
                        <div>
                          <dt>Case store</dt>
                          <dd>{state.runtime.caseStore}</dd>
                        </div>
                        <div>
                          <dt>Coordination</dt>
                          <dd>{state.runtime.relay}</dd>
                        </div>
                        <div>
                          <dt>Agent provider</dt>
                          <dd>
                            {runtime?.agentsConfigured
                              ? "Configured"
                              : "Not configured"}
                          </dd>
                        </div>
                      </dl>
                    </section>
                  </div>
                </>
              )}
            </>
          )}
        </main>
      </div>

      {connector && (
        <ConnectorDrawer
          connector={connector}
          connection={connections.find(
            (item) => item.connectorId === connector.id,
          )}
          organizationId={organizationId}
          organizationName={org?.name || organizationId}
          onClose={() => setConnector(null)}
          onChange={refresh}
        />
      )}
      {newCase && (
        <div
          className="modal-backdrop"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) setNewCase(false);
          }}
        >
          <section
            className="modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="new-case-title"
          >
            <div className="modal-heading">
              <span className="modal-icon">
                <Layers3 size={22} />
              </span>
              <button
                className="icon-button"
                onClick={() => setNewCase(false)}
                aria-label="Close new case"
              >
                <X size={19} />
              </button>
            </div>
            <div className="eyebrow">
              {isDemo ? "NEW SIMULATION" : "NEW CASE"}
            </div>
            <h2 id="new-case-title">Start a shared investigation.</h2>
            <p>
              {isDemo
                ? "Create a case between Northstar and Contoso Cloud using the checkout failure scenario."
                : "Open a shared investigation with a company in your network."}
            </p>
            <form
              onSubmit={(event) => {
                event.preventDefault();
                void act("create", async () => {
                  const created = await api<SupportCase>("/api/cases", {
                    title: caseTitle,
                    summary: caseSummary,
                    ...(!isDemo
                      ? { customerId: organizationId, vendorId: caseVendor }
                      : {}),
                  });
                  setNewCase(false);
                  openCase(created.id);
                });
              }}
            >
              {!isDemo && (
                <label>
                  Vendor organization
                  <select
                    required
                    value={caseVendor}
                    onChange={(event) => setCaseVendor(event.target.value)}
                  >
                    <option value="">Choose an organization</option>
                    {state?.organizations
                      .filter((item) => item.id !== organizationId)
                      .map((item) => (
                        <option value={item.id} key={item.id}>
                          {item.name}
                        </option>
                      ))}
                  </select>
                </label>
              )}
              <label>
                Case title
                <input
                  autoFocus
                  required
                  value={caseTitle}
                  onChange={(event) => setCaseTitle(event.target.value)}
                />
              </label>
              <label>
                Initial context
                <textarea
                  required
                  value={caseSummary}
                  onChange={(event) => setCaseSummary(event.target.value)}
                  rows={3}
                />
              </label>
              <div className="form-note">
                <Zap size={15} />
                {isDemo
                  ? "Demo steps use seeded evidence. Live investigation is a separate action."
                  : "Agents use your configured connections. External writes require human approval."}
              </div>
              <button className="button primary full-width" disabled={!!busy}>
                {busy === "create" ? (
                  <Loader2 size={15} className="spin" />
                ) : (
                  <Plus size={15} />
                )}
                {isDemo ? "Create demo case" : "Create case"}
              </button>
            </form>
          </section>
        </div>
      )}
      {evidence && (
        <div
          className="modal-backdrop"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) setEvidence(null);
          }}
        >
          <section
            className="modal evidence-modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="evidence-title"
          >
            <div className="modal-heading">
              <span className="eyebrow">
                {evidence.source} ·{" "}
                {evidence.simulated
                  ? "SAMPLE EVIDENCE"
                  : evidence.provenance
                    ? "TOOL RECEIPT"
                    : "REPORTED EVIDENCE"}
              </span>
              <button
                className="icon-button"
                onClick={() => setEvidence(null)}
                aria-label="Close evidence"
              >
                <X size={19} />
              </button>
            </div>
            <h2 id="evidence-title">{evidence.title}</h2>
            <p>{evidence.summary}</p>
            <div className="evidence-meta">
              <span>
                {evidence.visibility === "private" ? (
                  <LockKeyhole size={13} />
                ) : (
                  <Globe2 size={13} />
                )}
                {evidence.visibility}
              </span>
              <span>Collected {time(evidence.collectedAt)}</span>
            </div>
            <pre>{JSON.stringify(evidence.data, null, 2)}</pre>
          </section>
        </div>
      )}
    </div>
  );
}

function TimelineEvent({ event }: { event: CaseEvent }) {
  const Icon =
    event.type === "message"
      ? MessageSquare
      : event.type === "evidence"
        ? Database
        : event.type === "verification"
          ? CheckCircle2
          : event.type === "approval"
            ? ShieldCheck
            : event.type === "signal"
              ? Activity
              : event.type === "action"
                ? Zap
                : CircleDot;
  return (
    <article className={`timeline-event event-${event.type}`}>
      <span
        className={`timeline-icon ${event.organizationId === "contoso" ? "vendor" : ""}`}
      >
        <Icon size={16} />
      </span>
      <div className="event-content">
        <div className="event-meta">
          <strong>{event.actor}</strong>
          <span className="event-type">{event.type}</span>
          <time>{time(event.createdAt)}</time>
        </div>
        <div className={event.type === "message" ? "message-body" : ""}>
          <h3>{event.title}</h3>
          <p>{event.body}</p>
        </div>
        <span className="event-visibility">
          {event.visibility === "private" ? (
            <LockKeyhole size={11} />
          ) : (
            <Globe2 size={11} />
          )}
          {event.visibility === "private"
            ? "Private to your organization"
            : "Shared across organizations"}
        </span>
      </div>
    </article>
  );
}

function AuthScreen({
  onAuthenticated,
}: {
  onAuthenticated: () => Promise<void>;
}) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  async function signIn(event: React.FormEvent) {
    event.preventDefault();
    if (!auth) return;
    setBusy(true);
    setError("");
    try {
      const result = await auth.auth.signInWithPassword({ email, password });
      if (result.error) throw result.error;
      setPassword("");
      await onAuthenticated();
    } catch (reason) {
      setError(
        reason instanceof Error
          ? reason.message
          : "Sign-in failed. Please try again.",
      );
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="auth-shell">
      <div className="auth-brand">Janus</div>
      <section className="auth-card">
        <div className="eyebrow">YOUR OPERATIONAL WORKSPACE</div>
        <h1>Welcome back.</h1>
        <p>Sign in to your organization’s Janus workspace.</p>
        {error && (
          <div className="alert error" role="alert">
            {error}
          </div>
        )}
        {auth ? (
          <form onSubmit={signIn}>
            <label>
              Email
              <input
                type="email"
                required
                autoComplete="email"
                value={email}
                onChange={(event) => setEmail(event.target.value)}
              />
            </label>
            <label>
              Password
              <input
                type="password"
                required
                autoComplete="current-password"
                value={password}
                onChange={(event) => setPassword(event.target.value)}
              />
            </label>
            <button className="button primary full-width" disabled={busy}>
              {busy ? (
                <Loader2 size={16} className="spin" />
              ) : (
                <ArrowRight size={16} />
              )}
              Sign in
            </button>
          </form>
        ) : (
          <div className="form-note">
            <LockKeyhole size={16} />
            <span>
              Authentication is required. Ask your workspace administrator to
              configure the Supabase public URL and anonymous key for this
              frontend.
            </span>
          </div>
        )}
        <div className="auth-footnote">
          <ShieldCheck size={14} />
          Access is scoped to your organization memberships.
        </div>
      </section>
    </div>
  );
}

function ConnectorDrawer({
  connector,
  connection,
  organizationId,
  organizationName,
  onClose,
  onChange,
}: {
  connector: ConnectorDefinition;
  connection?: Connection;
  organizationId: OrganizationID;
  organizationName: string;
  onClose: () => void;
  onChange: () => Promise<void>;
}) {
  const [tab, setTab] = useState<"setup" | "tools">("setup");
  const [credentials, setCredentials] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const readOperations = connector.operations.filter(
    (operation) => !operation.write,
  );
  const [testOperation, setTestOperation] = useState(
    readOperations[0]?.id || "",
  );
  const [testInput, setTestInput] = useState(
    JSON.stringify(readOperations[0]?.exampleInput || {}, null, 2),
  );
  const closeRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    closeRef.current?.focus();
  }, []);
  async function save(event: React.FormEvent) {
    event.preventDefault();
    setBusy("save");
    setError("");
    setMessage("");
    try {
      await api("/api/connections", {
        organizationId,
        connectorId: connector.id,
        credentials,
      });
      setCredentials({});
      await onChange();
      setMessage("Connection configuration saved. Test it to verify access.");
    } catch (reason) {
      setError(
        reason instanceof Error
          ? reason.message
          : "Could not save this connection.",
      );
    } finally {
      setBusy("");
    }
  }
  async function test() {
    if (!connection) return;
    setBusy("test");
    setError("");
    setMessage("");
    try {
      let input: Record<string, unknown>;
      try {
        input = JSON.parse(testInput);
      } catch {
        throw new Error("Test input must be valid JSON.");
      }
      if (!input || typeof input !== "object" || Array.isArray(input))
        throw new Error("Test input must be a JSON object.");
      const result = await api<{ message?: string }>(
        `/api/connections/${encodeURIComponent(connection.id)}/test`,
        { operationId: testOperation, input },
      );
      await onChange();
      setMessage(
        result.message || "Read operation succeeded. Connection verified.",
      );
    } catch (reason) {
      setError(
        reason instanceof Error
          ? reason.message
          : "The connection test failed.",
      );
      await onChange();
    } finally {
      setBusy("");
    }
  }
  return (
    <div
      className="drawer-backdrop"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <section
        className="drawer"
        role="dialog"
        aria-modal="true"
        aria-labelledby="connector-title"
      >
        <div className="drawer-top">
          <span className="eyebrow">INTEGRATION DETAILS</span>
          <button
            ref={closeRef}
            className="icon-button"
            onClick={onClose}
            aria-label="Close integration"
          >
            <X size={20} />
          </button>
        </div>
        <div className="drawer-identity">
          <ConnectorIcon connector={connector} />
          <div>
            <h2 id="connector-title">{connector.name}</h2>
            <span>{connector.category}</span>
          </div>
        </div>
        <p className="drawer-description">{connector.description}</p>
        <div className="connection-summary">
          <span>
            <CircleDot size={14} />
            {connection
              ? connection.status === "connected"
                ? `${connection.mode === "live" ? "Live" : "Demo"} connection`
                : connection.status === "error"
                  ? "Connection needs attention"
                  : "Not configured"
              : "Not connected"}
          </span>
          <span>{organizationName}</span>
        </div>
        <div className="drawer-tabs">
          <button
            className={tab === "setup" ? "selected" : ""}
            onClick={() => setTab("setup")}
          >
            Configuration
          </button>
          <button
            className={tab === "tools" ? "selected" : ""}
            onClick={() => setTab("tools")}
          >
            Available tools{" "}
            <span className="count-pill">{connector.operations.length}</span>
          </button>
        </div>
        <div className="drawer-content">
          {error && (
            <div className="alert error" role="alert">
              <TriangleAlert size={15} />
              {error}
            </div>
          )}
          {message && (
            <div className="alert success" role="status">
              <CheckCircle2 size={15} />
              {message}
            </div>
          )}
          {tab === "setup" ? (
            <form onSubmit={save}>
              <h3>Connect {connector.name}</h3>
              <p className="small-copy muted">
                Provide credentials for {organizationName}. Saving credentials
                enables this connector to access the configured service.
              </p>
              {connector.authFields.map((field) => (
                <label key={field.key}>
                  {field.label}
                  {field.secret && <LockKeyhole size={12} />}
                  <input
                    type={field.secret ? "password" : "text"}
                    autoComplete="off"
                    spellCheck={false}
                    placeholder={field.placeholder || field.label}
                    value={credentials[field.key] || ""}
                    onChange={(event) =>
                      setCredentials((current) => ({
                        ...current,
                        [field.key]: event.target.value,
                      }))
                    }
                  />
                </label>
              ))}
              <div className="form-note">
                <LockKeyhole size={15} />
                Credentials are sent to your Janus server and never saved in
                browser storage.
              </div>
              <button
                className="button primary full-width"
                disabled={!!busy || !Object.values(credentials).some(Boolean)}
              >
                {busy === "save" ? (
                  <Loader2 className="spin" size={15} />
                ) : (
                  <Plug size={15} />
                )}
                Save connection
              </button>
              {connection && readOperations.length > 0 && (
                <div className="connection-test">
                  <h3>Verify read access</h3>
                  <p className="small-copy muted">
                    Choose a read operation and supply identifiers from your
                    account.
                  </p>
                  <label>
                    Read operation
                    <select
                      value={testOperation}
                      onChange={(event) => {
                        setTestOperation(event.target.value);
                        setTestInput(
                          JSON.stringify(
                            readOperations.find(
                              (operation) =>
                                operation.id === event.target.value,
                            )?.exampleInput || {},
                            null,
                            2,
                          ),
                        );
                      }}
                    >
                      {readOperations.map((operation) => (
                        <option value={operation.id} key={operation.id}>
                          {operation.name}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label>
                    Input JSON
                    <textarea
                      rows={5}
                      value={testInput}
                      onChange={(event) => setTestInput(event.target.value)}
                      spellCheck={false}
                    />
                  </label>
                  <button
                    type="button"
                    className="button full-width test-button"
                    disabled={!!busy}
                    onClick={test}
                  >
                    {busy === "test" ? (
                      <Loader2 size={15} className="spin" />
                    ) : (
                      <Activity size={15} />
                    )}
                    Test connection
                  </button>
                </div>
              )}
              {connection && readOperations.length === 0 && (
                <p className="form-note">
                  This integration exposes write operations only. Its actions
                  are tested through case approval.
                </p>
              )}
              {connection?.lastChecked && (
                <p className="last-tested">
                  Last checked{" "}
                  {new Date(connection.lastChecked).toLocaleString()}
                </p>
              )}
            </form>
          ) : (
            <div>
              <p className="small-copy muted tools-intro">
                Tools available to agents through this integration. Actions that
                change external systems require approval.
              </p>
              {connector.operations.map((operation) => (
                <details className="operation" key={operation.id}>
                  <summary>
                    <span
                      className={`operation-icon ${operation.write ? "write" : ""}`}
                    >
                      {operation.write ? (
                        <Zap size={15} />
                      ) : (
                        <Search size={15} />
                      )}
                    </span>
                    <span>
                      <strong>{operation.name}</strong>
                      <small>
                        {operation.write
                          ? "Write · approval required"
                          : "Read operation"}
                      </small>
                    </span>
                    <ChevronDown size={15} />
                  </summary>
                  <div className="operation-body">
                    <p>{operation.description}</p>
                    <span className="eyebrow">EXAMPLE INPUT</span>
                    <pre>{JSON.stringify(operation.exampleInput, null, 2)}</pre>
                  </div>
                </details>
              ))}
            </div>
          )}
        </div>
        <div className="drawer-footer">
          <a href={connector.docsUrl} target="_blank" rel="noreferrer">
            Official documentation <ExternalLink size={14} />
          </a>
          <span>Janus integration</span>
        </div>
      </section>
    </div>
  );
}

function CaseTable({
  organizations,
  items,
  query,
  caseFilter,
  isDemo,
  openCase,
  setNewCase,
}: {
  organizations: PlatformState["organizations"];
  items: SupportCase[];
  query: string;
  caseFilter: string;
  isDemo: boolean;
  openCase: (id: string) => void;
  setNewCase: (value: boolean) => void;
}) {
  return (
    <div className="case-table" role="table" aria-label="Support cases">
      <div className="table-head" role="row">
        <span>Case</span>
        <span>Status</span>
        <span>Participants</span>
        <span>Updated</span>
        <span />
      </div>
      {items.map((item) => (
        <button
          className="case-row"
          key={item.id}
          onClick={() => openCase(item.id)}
          role="row"
        >
          <span className="case-name">
            <span className="case-code">
              <span className={`severity ${item.severity.toLowerCase()}`}>
                {item.severity}
              </span>{" "}
              {shortID(item.id)}
            </span>
            <strong>{item.title}</strong>
          </span>
          <Status value={item.status} />
          <span className="table-participants">
            <span className="mini-avatar">
              {organizations
                .find((organization) => organization.id === item.customerId)
                ?.name.slice(0, 1)}
            </span>
            <span className="mini-avatar vendor">
              {organizations
                .find((organization) => organization.id === item.vendorId)
                ?.name.slice(0, 1)}
            </span>
            <span>2 organizations</span>
          </span>
          <span className="muted">{time(item.updatedAt)}</span>
          <ChevronRight size={16} />
        </button>
      ))}
      {!items.length && (
        <div className="empty">
          <Layers3 size={26} />
          <h3>
            {query || caseFilter !== "all"
              ? "No matching cases"
              : "Your next resolution starts here"}
          </h3>
          <p>
            {query || caseFilter !== "all"
              ? "Try a different search or status."
              : isDemo
                ? "Create a demo case to see two agents investigate a shared issue."
                : "Create a case to coordinate an investigation with your counterpart."}
          </p>
          {!query && caseFilter === "all" && (
            <button className="button primary" onClick={() => setNewCase(true)}>
              <Plus size={15} />
              {isDemo ? "Create demo case" : "Create case"}
            </button>
          )}
        </div>
      )}
    </div>
  );
}
