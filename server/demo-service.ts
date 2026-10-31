import { randomUUID } from "node:crypto";
import { z } from "zod";
import type { ConnectorDefinition, SupportCase } from "../src/types";
import { HttpError } from "./config";
import { Store } from "./store";

const customer: ConnectorDefinition = {
  id: "demo-customer",
  name: "Northstar demo application",
  category: "Observability",
  description: "Executable local checkout fixture. No external customer data.",
  authFields: [],
  docsUrl: "",
  operations: [
    {
      id: "traces",
      name: "Read checkout traces",
      write: false,
      description: "Read request failures observed by the customer.",
      exampleInput: {},
    },
    {
      id: "deployments",
      name: "Read recent deployments",
      write: false,
      description: "Inspect customer deployment timing.",
      exampleInput: {},
    },
    {
      id: "probe",
      name: "Run checkout request",
      write: false,
      description:
        "Execute a checkout probe against the current local service configuration.",
      exampleInput: {},
    },
  ],
};
const vendor: ConnectorDefinition = {
  id: "demo-vendor",
  name: "Contoso demo control plane",
  category: "Cloud & data",
  description: "Private vendor configuration for the local checkout service.",
  authFields: [],
  docsUrl: "",
  operations: [
    {
      id: "rollouts",
      name: "Read tenant rollouts",
      write: false,
      description: "Read vendor deployment and backend health information.",
      exampleInput: {},
    },
    {
      id: "rollback",
      name: "Restore stable route",
      write: true,
      description:
        "Restore the customer tenant’s stable route in the local fixture. Requires approval.",
      exampleInput: {},
    },
  ],
};

export function demoDefinitions(item: SupportCase, organizationId: string) {
  if (item.mode !== "simulation") return [];
  return organizationId === item.customerId
    ? [customer]
    : organizationId === item.vendorId
      ? [vendor]
      : [];
}

export async function executeDemo(
  store: Store,
  caseId: string,
  organizationId: string,
  connectorId: string,
  operation: string,
  input: Record<string, unknown>,
) {
  z.object({}).strict().parse(input);
  const item = await store.getCase(caseId);
  if (!item?.demoService)
    throw new HttpError(400, "This case has no local demo service");
  const allowed = demoDefinitions(item, organizationId)
    .find((definition) => definition.id === connectorId)
    ?.operations.some((value) => value.id === operation);
  if (!allowed)
    throw new HttpError(
      403,
      "This demo tool belongs to the other organization",
    );
  if (operation === "deployments")
    return {
      latest: {
        id: "northstar-42",
        deployedAt: new Date(
          Date.parse(item.createdAt) - 86_400_000,
        ).toISOString(),
        changedSinceIncident: false,
      },
      fixture: true,
    };
  if (operation === "traces")
    return {
      upstream: "Contoso Cloud checkout API",
      failures: item.demoService.probes.filter((probe) => probe.status !== 200),
      initialSignal: {
        requestId: "req_8f32",
        status: 503,
        region: "us-west-2",
      },
      fixture: true,
    };
  if (operation === "rollouts")
    return {
      tenant: item.customerId,
      rollout: "r-184",
      changedAt: item.createdAt,
      currentRoute: item.demoService.route,
      backends: { stable: "healthy", canary: "unhealthy" },
      fixture: true,
    };
  if (operation === "rollback") {
    await store.updateCase(caseId, (current) => {
      current.demoService!.route = "stable";
    });
    return { route: "stable", tenant: item.customerId, fixture: true };
  }
  const probe = {
    requestId: randomUUID(),
    status: item.demoService.route === "stable" ? 200 : 503,
    at: new Date().toISOString(),
  };
  await store.updateCase(caseId, (current) => {
    current.demoService!.probes.push(probe);
  });
  return {
    ...probe,
    body:
      probe.status === 200
        ? { checkout: "accepted" }
        : { error: "upstream_unavailable" },
    fixture: true,
  };
}
