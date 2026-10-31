import { randomUUID } from "node:crypto";
import { z } from "zod";
import type { ConnectorDefinition, SupportCase } from "../src/types";
import { HttpError } from "./config";
import { Store } from "./store";

export function demoDefinitions(
  item: SupportCase,
  organizationId: string,
): ConnectorDefinition[] {
  if (item.mode !== "simulation") return [];
  const indexing = item.demoService?.scenario === "google-indexing";
  if (organizationId === item.customerId)
    return [
      {
        id: "demo-customer",
        name: indexing ? "Notion indexing service" : "Notion upload service",
        category: "Observability",
        description:
          "Case-scoped local service for diagnosis and verification.",
        authFields: [],
        docsUrl: "",
        operations: [
          {
            id: "traces",
            name: indexing ? "Read indexing traces" : "Read upload traces",
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
            name: indexing
              ? "Check search freshness"
              : "Test attachment upload",
            write: false,
            description:
              "Run a fresh request against the current local service configuration.",
            exampleInput: {},
          },
          ...(indexing
            ? [
                {
                  id: "reindex",
                  name: "Replay indexing backlog",
                  write: true,
                  description:
                    "Restore the compatible consumer and replay pending updates. Requires customer approval.",
                  exampleInput: {},
                },
              ]
            : []),
        ],
      },
    ];
  if (organizationId === item.vendorId)
    return [
      {
        id: "demo-vendor",
        name: indexing
          ? "Google Cloud delivery diagnostics"
          : "AWS regional request diagnostics",
        category: "Cloud & data",
        description:
          "Private vendor diagnostics for this case’s local service.",
        authFields: [],
        docsUrl: "",
        operations: [
          {
            id: "rollouts",
            name: indexing
              ? "Inspect delivery health"
              : "Inspect regional routing",
            write: false,
            description:
              "Read vendor deployment and service health information.",
            exampleInput: {},
          },
          ...(!indexing
            ? [
                {
                  id: "rollback",
                  name: "Restore stable route",
                  write: true,
                  description:
                    "Restore the previous route for the affected uploads. Requires vendor approval.",
                  exampleInput: {},
                },
              ]
            : []),
        ],
      },
    ];
  return [];
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
    throw new HttpError(403, "This tool belongs to the other organization");
  const indexing = item.demoService.scenario === "google-indexing";
  if (operation === "deployments")
    return {
      latest: {
        id: indexing ? "notion-indexer-73" : "notion-upload-42",
        deployedAt: new Date(
          Date.parse(item.createdAt) - (indexing ? 300_000 : 86_400_000),
        ).toISOString(),
        changedSinceIncident: indexing,
      },
      fixture: true,
    };
  if (operation === "traces")
    return {
      upstream: indexing ? "Google Cloud Pub/Sub" : "AWS S3",
      failures: item.demoService.probes.filter((probe) => probe.status !== 200),
      initialSignal: indexing
        ? {
            subscription: "notion-page-indexing",
            backlog: 1842,
            error: "unsupported_event_schema",
          }
        : {
            requestId: "S3-7FC91A",
            status: 503,
            region: "us-west-2",
            latencyP95Ms: 4800,
          },
      fixture: true,
    };
  if (operation === "rollouts")
    return indexing
      ? {
          tenant: item.customerId,
          deliveryAvailable: true,
          consumerSchema: item.demoService.route === "stable" ? 3 : 2,
          eventSchema: 3,
          backlog: item.demoService.route === "stable" ? 0 : 1842,
          fixture: true,
        }
      : {
          tenant: item.customerId,
          rollout: "s3-router-184",
          changedAt: item.createdAt,
          currentRoute: item.demoService.route,
          backends: { stable: "healthy", canary: "unhealthy" },
          fixture: true,
        };
  if (operation === "rollback" || operation === "reindex") {
    await store.updateCase(caseId, (current) => {
      current.demoService!.route = "stable";
    });
    return indexing
      ? {
          consumerSchema: 3,
          backlog: 0,
          tenant: item.customerId,
          fixture: true,
        }
      : { route: "stable", tenant: item.customerId, fixture: true };
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
        ? indexing
          ? { indexed: true, backlog: 0 }
          : { upload: "accepted" }
        : indexing
          ? { error: "indexing_delayed", backlog: 1842 }
          : { error: "SlowDown" },
    fixture: true,
  };
}
