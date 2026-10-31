import type { Connection } from "../src/types";
import { projectCase } from "./cases";
import { HttpError } from "./config";
import { connectorDefinitions } from "./connectors";
import type { Store } from "./store";

export async function executeFixtureConnection(store: Store, connection: Connection, operationId: string, input: Record<string, unknown>) {
  if (connection.mode !== "simulation") throw new HttpError(400, "Expected a local workspace connection");
  const operation = connectorDefinitions.find((connector) => connector.id === connection.connectorId)?.operations.find((entry) => entry.id === operationId);
  if (!operation) throw new HttpError(400, "Unknown connector operation");
  if (operation.write) throw new HttpError(400, "Local workspace integrations are read-only. Connect provider credentials to send or change external data.");
  const cases = (await store.listCases()).filter((item) => item.mode === "simulation" && [item.customerId, item.vendorId].includes(connection.organizationId)).map((item) => projectCase(item, connection.organizationId));
  const messages = cases.flatMap((item) => item.events.filter((event) => event.channel === connection.connectorId).map((event) => ({ ...event, caseId: item.id })));
  const targetId = typeof input.messageId === "string" ? input.messageId : undefined;
  const selected = targetId ? messages.filter((message) => message.id === targetId) : messages;
  return {
    fixture: true,
    connectorId: connection.connectorId,
    operationId,
    organizationId: connection.organizationId,
    messages: selected,
    evidence: ["slack", "teams", "outlook", "gmail"].includes(connection.connectorId) ? [] : cases.flatMap((item) => item.evidence.map((entry) => ({ ...entry, caseId: item.id }))),
  };
}
