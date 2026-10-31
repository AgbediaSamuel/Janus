import type { Organization, SupportCase } from "../src/types";
import { advanceDemo, newCase } from "./cases";

export const localOrganizations: Organization[] = [
  {
    id: "notion",
    name: "Notion",
    role: "Customer",
    agentName: "Notion agent",
    deployment: "hosted",
  },
  {
    id: "aws",
    name: "AWS",
    role: "Vendor",
    agentName: "AWS Support",
    deployment: "self-hosted",
  },
  {
    id: "google",
    name: "Google Cloud",
    role: "Vendor",
    agentName: "Google Cloud Support",
    deployment: "self-hosted",
  },
];

export function seededCases(): SupportCase[] {
  const uploads = newCase({ customerId: "notion", vendorId: "aws" });
  uploads.id = "JAN-1042";
  advanceDemo(uploads);
  advanceDemo(uploads);
  const indexing = newCase({ customerId: "notion", vendorId: "google" });
  indexing.id = "JAN-1041";
  for (let stage = 0; stage < 4; stage++) advanceDemo(indexing);
  const now = Date.now();
  for (const [index, item] of [uploads, indexing].entries()) {
    const started = now - (index === 0 ? 18 : 42) * 60_000;
    item.createdAt = new Date(started).toISOString();
    item.events.forEach((entry, offset) => {
      entry.createdAt = new Date(started + offset * 90_000).toISOString();
    });
    item.evidence.forEach((entry, offset) => {
      entry.collectedAt = new Date(
        started + (offset + 1) * 90_000,
      ).toISOString();
    });
    item.approvals.forEach((entry) => {
      entry.requestedAt = item.events.at(-1)!.createdAt;
    });
    item.updatedAt = item.events.at(-1)!.createdAt;
  }
  return [uploads, indexing];
}
