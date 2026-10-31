import { test } from "node:test";
import assert from "node:assert/strict";
import { resolveWorkspaceRoute, workspacePath, workspaces, type WorkspaceView } from "../src/workspaces";

test("all four workspace identities round-trip their role and views", () => {
  assert.deepEqual(workspaces.map((workspace) => workspace.organizationId), ["notion", "ramp", "aws", "google"]);
  assert.equal(new Set(workspaces.map((workspace) => workspace.id)).size, 4);
  const views: WorkspaceView[] = ["overview", "cases", "integrations", "network"];
  for (const workspace of workspaces) {
    assert.equal(workspace.kind, ["notion", "ramp"].includes(workspace.organizationId) ? "client" : "vendor");
    for (const view of views) {
      const pathname = workspacePath(workspace.organizationId, view);
      assert(pathname.startsWith(`/${workspace.kind}/${workspace.id}`));
      assert.deepEqual(resolveWorkspaceRoute(pathname), { workspace, view, caseId: null });
      assert.deepEqual(resolveWorkspaceRoute(`${pathname}/`), { workspace, view, caseId: null });
    }
    assert.deepEqual(resolveWorkspaceRoute(`${workspacePath(workspace.organizationId)}/overview`), { workspace, view: "overview", caseId: null });
  }
});

test("case detail routes encode the full identifier and resolve within the selected workspace", () => {
  const caseIds = ["JAN-1042", "case with spaces", "account/region?#%", "事件-42"];
  for (const workspace of workspaces) {
    for (const caseId of caseIds) {
      const pathname = workspacePath(workspace.organizationId, "cases", caseId);
      assert.equal(pathname, `${workspacePath(workspace.organizationId)}/cases/${encodeURIComponent(caseId)}`);
      assert.deepEqual(resolveWorkspaceRoute(pathname), { workspace, view: "cases", caseId });
    }
  }
});

test("unknown workspaces and mismatched roles cannot resolve", () => {
  assert.throws(() => workspacePath("outsider"), /Unknown workspace/);
  for (const workspace of workspaces) {
    const wrongRole = workspace.kind === "client" ? "vendor" : "client";
    assert.equal(resolveWorkspaceRoute(`/${wrongRole}/${workspace.id}`), null);
    assert.equal(resolveWorkspaceRoute(`/admin/${workspace.id}`), null);
  }
  for (const path of ["/", "/app", "/client", "/client/notion", "/vendor/aws", "/client/00000000-0000-4000-8000-000000000000"]) {
    assert.equal(resolveWorkspaceRoute(path), null, path);
  }
});

test("unknown views, malformed identifiers, empty segments, and extra segments are rejected", () => {
  const base = workspacePath("notion");
  const invalidPaths = [
    `${base}/settings`,
    `${base}/CASES`,
    `${base}/overview/JAN-1042`,
    `${base}/integrations/slack`,
    `${base}/network/aws`,
    `${base}/cases/JAN-1042/extra`,
    `${base}/cases/JAN-1042/extra/again`,
    `${base}/cases/%`,
    `${base}/cases/%E0%A4%A`,
    `${base}//`,
    `${base}//JAN-1042`,
    `${base}/cases//`,
    base.slice(1),
  ];
  for (const path of invalidPaths) assert.equal(resolveWorkspaceRoute(path), null, path);
});
