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
import VendorOperations from "./components/VendorOperations";
import CaseTimeline from "./components/CaseTimeline";
import IntegrationCatalog from "./components/IntegrationCatalog";
import { workspacePath, type WorkspaceRoute } from "./workspaces";

type View = "overview" | "cases" | "integrations" | "network";
type CaseTab = "activity" | "evidence";
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

function OrganizationLogo({ id, name }: { id: string; name: string }) {
  return ["notion", "ramp", "aws", "google"].includes(id) ? (
    <ProviderLogo connectorId={id} size={24} />
  ) : (
    <span>{name.slice(0, 1).toUpperCase()}</span>
  );
}

function SidebarPanelIcon() {
  return (
    <svg
      width="18"
      height="18"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <rect x="3" y="4" width="18" height="16" rx="2" />
      <path d="M9 4v16M5.8 8h.4m-.4 4h.4m-.4 4h.4" />
    </svg>
  );
}

export default function App({ route }: { route: WorkspaceRoute }) {
  const [workspaceState, setState] = useState<PlatformState | null>(null);
  const organizationId = route.workspace.organizationId;
  const isVendor = route.workspace.kind === "vendor";
  const [view, setView] = useState<View>(route.view);
  const [selectedCaseId, setSelectedCaseId] = useState<string | null>(
    route.caseId,
  );
  const [caseTab, setCaseTab] = useState<CaseTab>("activity");
  const [query, setQuery] = useState("");
  const [caseFilter, setCaseFilter] = useState("all");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState("");
  const [connector, setConnector] = useState<ConnectorDefinition | null>(null);
  const [newCase, setNewCase] = useState(false);
  const [caseTitle, setCaseTitle] = useState("");
  const [caseSummary, setCaseSummary] = useState("");
  const [evidence, setEvidence] = useState<Evidence | null>(null);
  const [mobileNav, setMobileNav] = useState(false);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const mobileMenuRef = useRef<HTMLButtonElement>(null);
  const mobileCloseRef = useRef<HTMLButtonElement>(null);
  const previousMobileNav = useRef(false);
  useEffect(() => {
    if (mobileNav) mobileCloseRef.current?.focus();
    else if (previousMobileNav.current) mobileMenuRef.current?.focus();
    previousMobileNav.current = mobileNav;
  }, [mobileNav]);
  const [authRequired, setAuthRequired] = useState(false);
  const [caseVendor, setCaseVendor] = useState(isVendor ? "notion" : "aws");
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
      `/api/state?organizationId=${encodeURIComponent(active)}`,
    );
    if (
      active === organizationRef.current &&
      generation === authenticationGeneration.current
    ) {
      setState(next);
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

  useEffect(() => {
    setView(route.view);
    setSelectedCaseId(route.caseId);
    setEvidence(null);
    setConnector(null);
    setNewCase(false);
    setQuery("");
  }, [route.view, route.caseId]);

  function updateURL(next: View, caseId?: string) {
    window.history.pushState(
      null,
      "",
      workspacePath(organizationId, next, caseId),
    );
    window.dispatchEvent(new PopStateEvent("popstate"));
  }

  function navigate(next: View) {
    updateURL(next);
    setView(next);
    setSelectedCaseId(null);
    setQuery("");
    setMobileNav(false);
  }
  function openCase(id: string) {
    updateURL("cases", id);
    setSelectedCaseId(id);
    setView("cases");
    setCaseTab("activity");
    setQuery("");
  }

  const org = workspaceState?.organizations.find(
    (item) => item.id === organizationId,
  );
  const cases = state?.cases || [];
  const selected = cases.find((item) => item.id === selectedCaseId);
  const connections = (state?.connections || []).filter(
    (item) => item.organizationId === organizationId,
  );
  const connected = connections.filter((item) => item.status === "connected");
  const counterpartId =
    selected && (isVendor ? selected.customerId : selected.vendorId);
  const counterpartName =
    state?.organizations.find((item) => item.id === counterpartId)?.name ||
    "the other company";
  const partners =
    state?.organizations.filter(
      (item) => item.role.toLowerCase() === (isVendor ? "customer" : "vendor"),
    ) || [];
  const openCases = cases.filter((item) => !isFinished(item));
  const approvals = cases.flatMap((item) =>
    item.approvals
      .filter(
        (approval) =>
          approval.status === "pending" &&
          approval.organizationId === organizationId,
      )
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
  const viewLabel = {
    overview: isVendor ? "Support overview" : "Overview",
    cases: isVendor ? "Customer cases" : "Cases",
    integrations: "Integrations",
    network: isVendor ? "Customers" : "Vendors",
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
              . Their team reviews this in its own workspace.
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
    <div className={`app-shell ${sidebarCollapsed ? "sidebar-collapsed" : ""}`}>
      {mobileNav && (
        <button
          type="button"
          className="sidebar-backdrop"
          aria-label="Close navigation"
          onClick={() => setMobileNav(false)}
        />
      )}
      <aside
        id="workspace-sidebar"
        className={`sidebar ${mobileNav ? "mobile-open" : ""}`}
        aria-label="Workspace navigation"
      >
        <div className="sidebar-brand-row">
          <button
            className="brand"
            onClick={() => window.location.assign("/")}
            aria-label="Janus home"
          >
            <span>Janus</span>
          </button>
          <button
            type="button"
            ref={mobileCloseRef}
            className="icon-button sidebar-mobile-close"
            aria-label="Close navigation"
            onClick={() => setMobileNav(false)}
          >
            <X size={19} />
          </button>
        </div>
        <div
          className="workspace-picker workspace-identity"
          title={org?.name || organizationId}
          aria-label={`${org?.name || organizationId} workspace`}
        >
          <span className="organization-avatar">
            <OrganizationLogo
              id={organizationId}
              name={org?.name || organizationId}
            />
          </span>
          <div>
            <span className="workspace-label">
              {isVendor ? "VENDOR WORKSPACE" : "CLIENT WORKSPACE"}
            </span>
            <strong>{org?.name || organizationId}</strong>
          </div>
        </div>
        <div className="nav-label">WORKSPACE</div>
        <nav>
          {(
            [
              {
                id: "overview",
                label: isVendor ? "Support overview" : "Overview",
                icon: Overview,
              },
              {
                id: "cases",
                label: isVendor ? "Customer cases" : "Cases",
                icon: Layers3,
              },
              { id: "integrations", label: "Integrations", icon: Plug },
              {
                id: "network",
                label: isVendor ? "Customers" : "Vendors",
                icon: Network,
              },
            ] as const
          ).map((item) => (
            <button
              className={`nav-item ${view === item.id ? "active" : ""}`}
              key={item.id}
              aria-label={item.label}
              aria-current={view === item.id ? "page" : undefined}
              title={item.label}
              onClick={() => navigate(item.id)}
            >
              <item.icon size={18} />
              <span className="nav-item-label">{item.label}</span>
              {item.id === "cases" && openCases.length > 0 && (
                <span className="nav-count">{openCases.length}</span>
              )}
            </button>
          ))}
        </nav>
      </aside>

      <div className="main-shell">
        <header className="topbar">
          <div className="breadcrumb">
            <button
              type="button"
              className="icon-button desktop-sidebar-toggle"
              aria-label={
                sidebarCollapsed ? "Expand sidebar" : "Collapse sidebar"
              }
              title={sidebarCollapsed ? "Expand sidebar" : "Collapse sidebar"}
              aria-expanded={!sidebarCollapsed}
              aria-controls="workspace-sidebar"
              onClick={() => setSidebarCollapsed(!sidebarCollapsed)}
            >
              <SidebarPanelIcon />
            </button>
            <button
              ref={mobileMenuRef}
              className="icon-button mobile-menu"
              aria-label={mobileNav ? "Close navigation" : "Open navigation"}
              aria-expanded={mobileNav}
              aria-controls="workspace-sidebar"
              onClick={() => setMobileNav(!mobileNav)}
            >
              <SidebarPanelIcon />
            </button>
            <span>{org?.name || organizationId}</span>
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
              <OrganizationLogo id={organizationId} name={org?.name || ""} />
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
                      <h1>
                        {isVendor ? "Customer support" : "Your workspace"}
                      </h1>
                      <p>
                        {openCases.length} open{" "}
                        {openCases.length === 1 ? "case" : "cases"}
                        {approvals.length > 0
                          ? ` · ${approvals.length} ${approvals.length === 1 ? "decision" : "decisions"} to review`
                          : ""}
                      </p>
                    </div>
                    <button
                      className="button primary"
                      onClick={() => setNewCase(true)}
                    >
                      <Plus size={16} />
                      New case
                    </button>
                  </div>
                  {approvals.length > 0 && (
                    <section className="attention-section">
                      <div className="section-heading">
                        <h2>Needs your decision</h2>
                      </div>
                      {approvals.map((approval) =>
                        renderApprovalCard({
                          approval,
                          caseId: approval.caseId,
                        }),
                      )}
                    </section>
                  )}
                  {isVendor ? (
                    <VendorOperations
                      cases={cases}
                      organizations={state.organizations}
                      organizationId={organizationId}
                      connections={connections}
                      connectors={state.connectors}
                      onCase={openCase}
                      onEvidence={setEvidence}
                      onConnector={setConnector}
                    />
                  ) : (
                    <section className="panel recent-cases">
                      <div className="panel-heading">
                        <h2>Cases</h2>
                        <button
                          className="text-button"
                          onClick={() => navigate("cases")}
                        >
                          View all <ArrowRight size={14} />
                        </button>
                      </div>
                      <CaseTable
                        organizations={state.organizations}
                        organizationId={organizationId}
                        items={cases}
                        query=""
                        caseFilter="all"
                        openCase={openCase}
                        setNewCase={setNewCase}
                      />
                    </section>
                  )}
                </>
              )}

              {view === "cases" && !selected && !selectedCaseId && (
                <>
                  <div className="page-heading">
                    <div>
                      <div className="eyebrow">INVESTIGATIONS</div>
                      <h1>{isVendor ? "Customer cases" : "Cases"}</h1>
                      <p>A complete record of the work between companies.</p>
                    </div>
                    <button
                      className="button primary"
                      onClick={() => setNewCase(true)}
                    >
                      <Plus size={16} />
                      New case
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
                      organizationId={organizationId}
                      openCase={openCase}
                      setNewCase={setNewCase}
                    />
                  </section>
                </>
              )}

              {view === "cases" && selectedCaseId && !selected && (
                <section className="empty-state">
                  <h2>Case unavailable</h2>
                  <p>This case is not available in your workspace.</p>
                  <button className="button secondary" onClick={() => navigate("cases")}>Back to cases</button>
                </section>
              )}

              {view === "cases" && selected && (
                <>
                  <button
                    className="back-link"
                    onClick={() => navigate("cases")}
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
                        {!isFinished(selected) && (
                          <button
                            className="button primary"
                            disabled={
                              !!busy ||
                              selected.status === "awaiting_approval" ||
                              ((selected.mode !== "simulation" ||
                                !!selected.runs?.length) &&
                                !runtime?.agentsConfigured)
                            }
                            onClick={() => {
                              const guided =
                                selected.mode === "simulation" &&
                                !selected.runs?.length;
                              void act("investigate", () =>
                                api(
                                  `/api/cases/${selected.id}/${guided ? "advance" : "investigate"}`,
                                  { organizationId },
                                ),
                              );
                            }}
                          >
                            {busy === "investigate" ? (
                              <Loader2 size={15} className="spin" />
                            ) : (
                              <ArrowRight size={15} />
                            )}
                            {selected.status === "awaiting_approval"
                              ? "Waiting for decision"
                              : "Continue investigation"}
                          </button>
                        )}
                      </div>
                    </div>
                  </div>
                  <details className="investigation-details">
                    <summary>
                      Investigation details <ChevronDown size={15} />
                    </summary>
                    {runtime?.agentsConfigured &&
                      selected.mode === "simulation" &&
                      selected.step === 0 &&
                      !selected.runs?.length &&
                      !isFinished(selected) &&
                      selected.status !== "awaiting_approval" && (
                        <button
                          className="button connected-agent-action"
                          disabled={!!busy}
                          onClick={() =>
                            act(
                              "investigate",
                              () =>
                                api(`/api/cases/${selected.id}/investigate`, {
                                  organizationId,
                                }),
                              "Investigation queued.",
                            )
                          }
                        >
                          <ArrowRight size={14} />
                          Use connected agents
                        </button>
                      )}
                    <InvestigationMap
                      supportCase={selected}
                      organizations={state.organizations}
                      organizationId={organizationId}
                    />
                  </details>
                  <div className="case-layout">
                    <section className="case-main">
                      <div className="case-tabs">
                        {(["activity", "evidence"] as const).map((tab) => (
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
                            {tab === "activity" ? "Timeline" : "Evidence"}
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
                      {caseTab === "activity" && (
                        <CaseTimeline
                          key={selected.id}
                          supportCase={selected}
                          organizations={state.organizations}
                          organizationId={organizationId}
                          onEvidence={setEvidence}
                        />
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
                                        ? `Only ${org?.name}`
                                        : `Shared with ${counterpartName}`}
                                    </span>
                                    <span>
                                      {item.simulated
                                        ? "Evidence"
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
                                <OrganizationLogo
                                  id={item.id}
                                  name={item.name}
                                />
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
                    </aside>
                  </div>
                </>
              )}

              {view === "integrations" && (
                <>
                  <div className="page-heading">
                    <div>
                      <h1>Integrations</h1>
                      <p>
                        {isVendor
                          ? "Your support team's conversations, service telemetry, and internal tools."
                          : "Your team's conversations, signals, and connected services."}
                      </p>
                    </div>
                    <span className="integration-total">
                      <Plug size={16} />
                      {connected.length} connected
                    </span>
                  </div>
                  <IntegrationCatalog
                    connectors={state.connectors}
                    connections={connections}
                    onSelect={setConnector}
                    organizationName={org?.name || organizationId}
                  />
                </>
              )}

              {view === "network" && (
                <>
                  <div className="page-heading">
                    <div>
                      <h1>{isVendor ? "Your customers" : "Your vendors"}</h1>
                      <p>
                        {isVendor
                          ? "Customer context and open investigations, in one place."
                          : "The companies your team works with, and the cases connecting you."}
                      </p>
                    </div>
                  </div>
                  <section className="partner-grid">
                    {partners.map((partner) => {
                      const partnerCases = cases.filter(
                        (item) =>
                          (isVendor ? item.customerId : item.vendorId) ===
                          partner.id,
                      );
                      return (
                        <article className="partner-card" key={partner.id}>
                          <OrganizationLogo
                            id={partner.id}
                            name={partner.name}
                          />
                          <h2>{partner.name}</h2>
                          <p>
                            {
                              partnerCases.filter((item) => !isFinished(item))
                                .length
                            }{" "}
                            open investigations
                          </p>
                          <div className="partner-case-list">
                            {partnerCases.map((item) => (
                              <button
                                key={item.id}
                                onClick={() => openCase(item.id)}
                              >
                                <span>{item.title}</span>
                                <ChevronRight size={14} />
                              </button>
                            ))}
                          </div>
                        </article>
                      );
                    })}
                  </section>
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
            <div className="eyebrow">NEW CASE</div>
            <h2 id="new-case-title">Start a shared investigation.</h2>
            <p>Open a shared investigation with a company in your network.</p>
            <form
              onSubmit={(event) => {
                event.preventDefault();
                void act("create", async () => {
                  const created = await api<SupportCase>("/api/cases", {
                    organizationId,
                    title: caseTitle,
                    summary: caseSummary,
                    customerId: isVendor
                      ? caseVendor || partners[0]?.id
                      : organizationId,
                    vendorId: isVendor
                      ? organizationId
                      : caseVendor || partners[0]?.id,
                  });
                  setNewCase(false);
                  openCase(created.id);
                });
              }}
            >
              <label>
                {isVendor ? "Customer organization" : "Vendor organization"}
                <select
                  required
                  value={caseVendor || partners[0]?.id || ""}
                  onChange={(event) => setCaseVendor(event.target.value)}
                >
                  <option value="">Choose an organization</option>
                  {partners.map((item) => (
                    <option value={item.id} key={item.id}>
                      {item.name}
                    </option>
                  ))}
                </select>
              </label>
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
              <button className="button primary full-width" disabled={!!busy}>
                {busy === "create" ? (
                  <Loader2 size={15} className="spin" />
                ) : (
                  <Plus size={15} />
                )}
                New case
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
                  ? "EVIDENCE"
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
                {evidence.visibility === "private"
                  ? `Only ${org?.name}`
                  : `Shared with ${counterpartName}`}
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
                ? "Connected"
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
  organizationId,
  openCase,
  setNewCase,
}: {
  organizations: PlatformState["organizations"];
  items: SupportCase[];
  query: string;
  caseFilter: string;
  organizationId: string;
  openCase: (id: string) => void;
  setNewCase: (value: boolean) => void;
}) {
  return (
    <div className="case-table" role="table" aria-label="Support cases">
      <div className="table-head" role="row">
        <span>Case</span>
        <span>Status</span>
        <span>Working with</span>
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
            <OrganizationLogo
              id={
                item.customerId === organizationId
                  ? item.vendorId
                  : item.customerId
              }
              name={
                organizations.find(
                  (org) =>
                    org.id ===
                    (item.customerId === organizationId
                      ? item.vendorId
                      : item.customerId),
                )?.name || ""
              }
            />
            <span>
              {
                organizations.find(
                  (org) =>
                    org.id ===
                    (item.customerId === organizationId
                      ? item.vendorId
                      : item.customerId),
                )?.name
              }
            </span>
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
              : "Create a case to coordinate an investigation with your counterpart."}
          </p>
          {!query && caseFilter === "all" && (
            <button className="button primary" onClick={() => setNewCase(true)}>
              <Plus size={15} />
              New case
            </button>
          )}
        </div>
      )}
    </div>
  );
}
