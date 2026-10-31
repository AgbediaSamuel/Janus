import { tool } from "langchain";
import type { StructuredTool } from "@langchain/core/tools";
import { z } from "zod";

const inputObject = z.record(z.string(), z.unknown());
const operationSchema = z.object({
  connectorId: z.string(),
  operation: z.string(),
  input: inputObject,
});
const evidenceSchema = z.object({
  source: z.string(),
  title: z.string(),
  summary: z.string(),
  data: inputObject,
  visibility: z.enum(["private", "shared"]),
});
const actionSchema = operationSchema.extend({
  title: z.string(),
  description: z.string(),
});
const conclusionSchema = z.object({
  status: z.enum(["waiting", "resolved", "escalated"]),
  summary: z.string().min(1),
  evidenceIds: z.array(z.string()),
});

export interface InvestigatorTools {
  readCase(): Promise<unknown>;
  collectEvidence(input: z.infer<typeof operationSchema>): Promise<unknown>;
  addEvidence(input: z.infer<typeof evidenceSchema>): Promise<unknown>;
  requestAction(input: z.infer<typeof actionSchema>): Promise<unknown>;
  sendPartnerMessage(input: { text: string }): Promise<unknown>;
  receivePartnerMessages(): Promise<unknown>;
  concludeInvestigation(
    input: z.infer<typeof conclusionSchema>,
  ): Promise<unknown>;
}

export function createInvestigationTools(
  callbacks: InvestigatorTools,
): StructuredTool[] {
  return [
    tool((input) => callbacks.concludeInvestigation(input), {
      name: "conclude_investigation",
      description:
        "Record the authoritative investigation outcome. Mark resolved only with fresh verification evidence IDs demonstrating the affected service works. Waiting means approval or partner input is needed; escalated means a human must take over.",
      schema: conclusionSchema,
    }),
    tool(() => callbacks.readCase(), {
      name: "read_case",
      description:
        "Read this case, available connectors and operations, evidence, and approval status visible to your organization.",
      schema: z.object({}),
    }),
    tool((input) => callbacks.collectEvidence(input), {
      name: "collect_evidence",
      description:
        "Run an authorized read operation in your organization. Choose connector and operation IDs returned by read_case. This tool cannot execute writes.",
      schema: operationSchema,
    }),
    tool((input) => callbacks.addEvidence(input), {
      name: "add_evidence",
      description:
        "Record observed evidence in this case. Keep private unless the data is necessary and suitable to share with the partner. Exclude credentials and unnecessary personal data.",
      schema: evidenceSchema,
    }),
    tool((input) => callbacks.requestAction(input), {
      name: "request_action",
      description:
        "Propose an external write operation with exact inputs for human approval. This creates a pending request; it does not execute the operation.",
      schema: actionSchema,
    }),
    tool((input) => callbacks.sendPartnerMessage(input), {
      name: "send_partner_message",
      description:
        "Send a necessary diagnostic question or sanitized evidence summary to the authenticated partner agent for this case through Agent Relay. A successful send means Relay accepted it, not that the partner has received or replied. Use this tool when the partner needs the update; your private final answer is not sent to them.",
      schema: z.object({ text: z.string().min(1) }),
    }),
    tool(() => callbacks.receivePartnerMessages(), {
      name: "receive_partner_messages",
      description:
        "Read partner messages already delivered by authenticated Agent Relay and persisted in this case. This reads the case record without requesting the provider inbox. If none are available, stop and wait for a subsequent turn; do not repeatedly poll.",
      schema: z.object({}),
    }),
  ];
}
