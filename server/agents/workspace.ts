import { tool } from "langchain";
import type { StructuredTool } from "@langchain/core/tools";
import { z } from "zod";
import {
  createFreestyleWorkspace,
  type WorkspaceScope,
} from "../runtime/freestyle";

export function createWorkspaceTools(scope: WorkspaceScope): StructuredTool[] {
  const workspace = createFreestyleWorkspace(scope);
  return [
    tool(() => workspace.create(), {
      name: "create_workspace",
      description:
        "Create or find the isolated Freestyle reproduction VM for this organization and case. This uses billed infrastructure. No production credentials are copied into it.",
      schema: z.object({}),
    }),
    tool((input) => workspace.execute(input.command), {
      name: "execute_workspace",
      description:
        "Execute a shell command in this case’s existing isolated reproduction VM. Check statusCode: a nonzero exit or null timeout is not success. This does not modify production systems.",
      schema: z.object({ command: z.string().min(1) }),
    }),
    tool(() => workspace.start(), {
      name: "start_workspace",
      description: "Start or resume this case’s existing reproduction VM.",
      schema: z.object({}),
    }),
    tool(() => workspace.pause(), {
      name: "pause_workspace",
      description:
        "Pause this case’s reproduction VM, retaining its disk and memory.",
      schema: z.object({}),
    }),
  ];
}
