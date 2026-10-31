export type WorkspaceView = "overview" | "cases" | "integrations" | "network";

export const workspaces = [
  { organizationId: "notion", kind: "client", id: "54d7c452-36a7-4f94-b37d-8b166e827001" },
  { organizationId: "ramp", kind: "client", id: "54d7c452-36a7-4f94-b37d-8b166e827002" },
  { organizationId: "aws", kind: "vendor", id: "54d7c452-36a7-4f94-b37d-8b166e827003" },
  { organizationId: "google", kind: "vendor", id: "54d7c452-36a7-4f94-b37d-8b166e827004" },
] as const;

export type Workspace = (typeof workspaces)[number];
export interface WorkspaceRoute {
  workspace: Workspace;
  view: WorkspaceView;
  caseId: string | null;
}

export function workspacePath(organizationId: string, view: WorkspaceView = "overview", caseId?: string) {
  const workspace = workspaces.find((item) => item.organizationId === organizationId);
  if (!workspace) throw new Error("Unknown workspace");
  const base = `/${workspace.kind}/${workspace.id}`;
  return caseId ? `${base}/cases/${encodeURIComponent(caseId)}` : view === "overview" ? base : `${base}/${view}`;
}

export function resolveWorkspaceRoute(pathname: string): WorkspaceRoute | null {
  if (!pathname.startsWith("/") || pathname.includes("//")) return null;
  const parts = pathname.replace(/\/$/, "").split("/").slice(1);
  const workspace = workspaces.find((item) => item.kind === parts[0] && item.id === parts[1]);
  if (!workspace || parts.length > 4) return null;
  const view = parts[2] || "overview";
  if (!["overview", "cases", "integrations", "network"].includes(view)) return null;
  if (parts[3] && view !== "cases") return null;
  try {
    return { workspace, view: view as WorkspaceView, caseId: parts[3] ? decodeURIComponent(parts[3]) : null };
  } catch {
    return null;
  }
}
