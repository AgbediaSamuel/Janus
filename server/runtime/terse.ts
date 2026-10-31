import { createActorStub } from "terse-sdk/actors";
import type { SupportCase } from "../../src/types";
import type { CaseCommit, CaseCommitResult } from "./case-state";

interface CaseActorClient {
  read(): Promise<{ version: number; snapshotJson: string | null }>;
  commit(input: CaseCommit): Promise<CaseCommitResult>;
}

function actor(caseId: string): CaseActorClient {
  if (!process.env.TERSE_ACTOR_URL?.trim())
    throw new Error("Terse is not configured: set TERSE_ACTOR_URL");
  if (!caseId.trim()) throw new Error("A case ID is required");
  return createActorStub<CaseActorClient>("SupportCaseActor", caseId, [
    { name: "read", result: "value" },
    { name: "commit", result: "value" },
  ]);
}

export async function readTerseCase(
  caseId: string,
): Promise<{ version: number; snapshot: SupportCase | null }> {
  const result = await actor(caseId).read();
  const snapshot =
    result.snapshotJson === null
      ? null
      : (JSON.parse(result.snapshotJson) as SupportCase);
  if (snapshot && snapshot.id !== caseId)
    throw new Error("Terse returned a snapshot for a different case");
  return { version: result.version, snapshot };
}

export async function persistTerseCase(input: {
  caseId: string;
  eventId: string;
  expectedVersion: number;
  snapshot: SupportCase;
}): Promise<CaseCommitResult> {
  if (input.snapshot.id !== input.caseId)
    throw new Error("Snapshot and actor case IDs must match");
  return actor(input.caseId).commit({
    eventId: input.eventId,
    expectedVersion: input.expectedVersion,
    snapshotJson: JSON.stringify(input.snapshot),
  });
}
