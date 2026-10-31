export interface CaseActorState {
  version: number;
  snapshotJson: string | null;
  receipts: { eventId: string; digest: string; version: number }[];
}

export interface CaseCommit {
  eventId: string;
  expectedVersion: number;
  snapshotJson: string;
}

export interface CaseCommitResult {
  version: number;
  eventVersion: number;
  duplicate: boolean;
}

export function emptyCaseState(): CaseActorState {
  return { version: 0, snapshotJson: null, receipts: [] };
}

export async function commitCaseState(
  state: CaseActorState,
  input: CaseCommit,
): Promise<{ state: CaseActorState; result: CaseCommitResult }> {
  if (
    !input.eventId.trim() ||
    !Number.isSafeInteger(input.expectedVersion) ||
    input.expectedVersion < 0
  ) {
    throw new Error("Invalid case event ID or expected version");
  }
  JSON.parse(input.snapshotJson);
  const bytes = new TextEncoder().encode(input.snapshotJson);
  const hash = await crypto.subtle.digest("SHA-256", bytes);
  const digest = Array.from(new Uint8Array(hash), (value) =>
    value.toString(16).padStart(2, "0"),
  ).join("");
  const receipt = state.receipts.find((item) => item.eventId === input.eventId);
  if (receipt) {
    if (receipt.digest !== digest)
      throw new Error(
        "Case event ID was already used with a different snapshot",
      );
    return {
      state,
      result: {
        version: state.version,
        eventVersion: receipt.version,
        duplicate: true,
      },
    };
  }
  if (input.expectedVersion !== state.version) {
    throw new Error(
      `Case version conflict: expected ${input.expectedVersion}, current ${state.version}`,
    );
  }
  const version = state.version + 1;
  return {
    state: {
      version,
      snapshotJson: input.snapshotJson,
      receipts: [
        ...state.receipts,
        { eventId: input.eventId, digest, version },
      ],
    },
    result: { version, eventVersion: version, duplicate: false },
  };
}
