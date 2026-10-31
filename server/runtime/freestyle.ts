import { createHash } from "node:crypto";
import { Freestyle, type CreateVmOptions, type ExecResult } from "freestyle";

export interface WorkspaceScope {
  organizationId: string;
  caseId: string;
}

export function workspaceIdentity(scope: WorkspaceScope) {
  if (!scope.organizationId.trim() || !scope.caseId.trim())
    throw new Error("Organization and case IDs are required");
  const digest = (value: string) =>
    createHash("sha256").update(value).digest("hex").slice(0, 40);
  return {
    slug: `janus-${digest(JSON.stringify([scope.organizationId, scope.caseId]))}`,
    metadata: {
      app: "janus",
      organization: digest(scope.organizationId),
      case: digest(scope.caseId),
    },
  };
}

export function createFreestyleWorkspace(
  scope: WorkspaceScope,
  options: {
    apiKey?: string;
    snapshotId?: string;
    firewall?: CreateVmOptions["firewall"];
  } = {},
) {
  const apiKey = options.apiKey ?? process.env.FREESTYLE_API_KEY;
  if (!apiKey)
    throw new Error("Freestyle is not configured: set FREESTYLE_API_KEY");
  const client = new Freestyle({ apiKey });
  const identity = workspaceIdentity(scope);
  const workspace = client.vms.ref(identity.slug);

  async function requireWorkspace() {
    const data = await workspace.data();
    for (const [key, value] of Object.entries(identity.metadata)) {
      if (data.metadata?.[key] !== value)
        throw new Error(
          "Workspace does not belong to this organization and case",
        );
    }
    return data;
  }

  return {
    async create() {
      const existing = await client.vms.list({ slug: identity.slug });
      if (existing.vms.length) return requireWorkspace();
      const result = await client.vms.create({
        slug: identity.slug,
        metadata: identity.metadata,
        snapshotId: options.snapshotId ?? process.env.FREESTYLE_SNAPSHOT_ID,
        firewall: options.firewall ?? {
          rules: [
            { action: "allow", source: {}, destination: { public: true } },
          ],
        },
      });
      return result.data;
    },
    async execute(command: string): Promise<ExecResult> {
      if (!command.trim()) throw new Error("A workspace command is required");
      await requireWorkspace();
      return workspace.exec({ command });
    },
    async start() {
      await requireWorkspace();
      return workspace.start();
    },
    async pause() {
      await requireWorkspace();
      return workspace.pause();
    },
  };
}
