interface CheckpointMessage {
  id?: string;
  content: unknown;
}

interface CheckpointState {
  next: readonly string[];
  values: { messages?: CheckpointMessage[] };
}

interface TurnConfig {
  configurable: { thread_id: string };
}

export interface CheckpointedAgent {
  getState(config: TurnConfig): Promise<CheckpointState>;
  invoke(
    input: {
      messages: { role: "user"; content: string; id?: string }[];
    } | null,
    config: TurnConfig,
  ): Promise<{ messages: CheckpointMessage[] }>;
}

export async function invokeCheckpointedTurn(
  agent: CheckpointedAgent,
  threadId: string,
  message: string,
  turnId?: string,
): Promise<string> {
  const config = { configurable: { thread_id: threadId } };
  const snapshot = await agent.getState(config);
  const priorMessages = snapshot.values.messages ?? [];
  const alreadySubmitted = Boolean(
    turnId && priorMessages.some((entry) => entry.id === turnId),
  );
  let resultMessages = priorMessages;
  if (snapshot.next.length > 0) {
    const resumed = await agent.invoke(null, config);
    resultMessages = resumed.messages;
  }
  if (!alreadySubmitted && !(snapshot.next.length > 0 && !turnId)) {
    const result = await agent.invoke(
      {
        messages: [
          { role: "user", content: message, ...(turnId ? { id: turnId } : {}) },
        ],
      },
      config,
    );
    resultMessages = result.messages;
  }
  const last = resultMessages.at(-1);
  if (typeof last?.content === "string") return last.content;
  if (!Array.isArray(last?.content)) return "";
  return last.content
    .flatMap((block: unknown) => {
      if (!block || typeof block !== "object") return [];
      const part = block as { type?: unknown; text?: unknown };
      return part.type === "text" && typeof part.text === "string"
        ? [part.text]
        : [];
    })
    .join("\n");
}
