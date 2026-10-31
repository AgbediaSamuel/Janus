import { AgentRelay, type RelayAgentClient } from "@agent-relay/sdk";

export interface RelayCaseMessage {
  caseId: string;
  eventId: string;
  from: string;
  to: string;
  text: string;
}

export interface ReceivedRelayMessage extends RelayCaseMessage {
  messageId: string;
  deliveryId: string;
  createdAt?: string;
}

type RelayMessage = Awaited<ReturnType<RelayAgentClient["messages"]["get"]>>;
export type RelayClient = Pick<RelayAgentClient, "id" | "handle" | "sendMessage"> & {
  onDirectMessage: (handler: (message: RelayMessage) => void) => () => void;
  inbox: Pick<RelayAgentClient["inbox"], "get">;
  messages: Pick<RelayAgentClient["messages"], "listDirect" | "markRead">;
};

export function configuredRelayTokens(): Record<string, string> {
  const tokens: Record<string, string> = {};
  if (process.env.RELAY_AGENT_TOKENS_JSON) {
    const parsed: unknown = JSON.parse(process.env.RELAY_AGENT_TOKENS_JSON);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed))
      throw new Error(
        "RELAY_AGENT_TOKENS_JSON must map organization IDs to agent tokens",
      );
    for (const [id, token] of Object.entries(parsed)) {
      if (typeof token !== "string" || !token.trim())
        throw new Error(
          "Each configured Relay organization needs a nonempty agent token",
        );
      tokens[id] = token;
    }
  }
  if (process.env.RELAY_NOTION_TOKEN)
    tokens.notion = process.env.RELAY_NOTION_TOKEN;
  if (process.env.RELAY_AWS_TOKEN) tokens.aws = process.env.RELAY_AWS_TOKEN;
  if (process.env.RELAY_GOOGLE_TOKEN)
    tokens.google = process.env.RELAY_GOOGLE_TOKEN;
  if (process.env.RELAY_NORTHSTAR_TOKEN)
    tokens.northstar = process.env.RELAY_NORTHSTAR_TOKEN;
  if (process.env.RELAY_CONTOSO_TOKEN)
    tokens.contoso = process.env.RELAY_CONTOSO_TOKEN;
  return tokens;
}

const clients = new Map<string, Promise<RelayClient>>();

async function getClient(organizationId: string): Promise<RelayClient> {
  const workspaceKey = process.env.RELAY_WORKSPACE_KEY?.trim();
  const apiToken = configuredRelayTokens()[organizationId];
  if (!workspaceKey || !apiToken)
    throw new Error(
      `Agent Relay is not configured for organization ${organizationId}`,
    );
  let client = clients.get(organizationId);
  if (!client) {
    const scopedRelay = new AgentRelay({ workspaceKey, agentToken: apiToken, baseUrl: process.env.RELAY_BASE_URL || undefined });
    client = scopedRelay.workspace.reconnect({ apiToken }).then((agent) => ({
      ...agent,
      onDirectMessage: (handler: (message: RelayMessage) => void) => scopedRelay.addListener("dm.received", (event) => handler(event.message)),
    }));
    clients.set(organizationId, client);
  }
  try {
    return await client;
  } catch (error) {
    clients.delete(organizationId);
    throw error;
  }
}

export function createRelayTransport(
  resolveClient: (organizationId: string) => Promise<RelayClient>,
) {
  async function identities(organizationId: string, partnerId: string) {
    if (organizationId === partnerId)
      throw new Error(
        "A cross-organization message requires different organizations",
      );
    const [recipient, partner] = await Promise.all([
      resolveClient(organizationId),
      resolveClient(partnerId),
    ]);
    if (recipient.id === partner.id)
      throw new Error("Organizations must use distinct Relay agent identities");
    return { recipient, partner };
  }

  function decode(
    message: RelayMessage,
    recipient: RelayClient,
    partner: RelayClient,
    organizationId: string,
    partnerId: string,
  ): ReceivedRelayMessage | null {
    if (message.from.id !== partner.id) return null;
    const metadata = message.metadata;
    if (
      !metadata ||
      typeof metadata.caseId !== "string" ||
      typeof metadata.eventId !== "string"
    )
      return null;
    return {
      caseId: metadata.caseId,
      eventId: metadata.eventId,
      from: partnerId,
      to: organizationId,
      text: message.text,
      messageId: message.messageId,
      deliveryId: message.messageId,
      createdAt: message.createdAt,
    };
  }

  async function replayUnread(
    recipient: RelayClient,
    partner: RelayClient,
    organizationId: string,
    partnerId: string,
    onMessage: (message: ReceivedRelayMessage) => Promise<boolean>,
  ) {
    const inbox = await recipient.inbox.get();
    for (const conversation of inbox.unreadDms) {
      const messages = await recipient.messages.listDirect({ conversationId: conversation.conversationId, limit: conversation.unreadCount });
      for (const raw of [...messages].reverse()) {
        const message = decode(raw, recipient, partner, organizationId, partnerId);
        if (!message || !(await onMessage(message))) continue;
        await recipient.messages.markRead(message.messageId);
      }
    }
  }

  return {
    async send(input: RelayCaseMessage) {
      if (!input.caseId.trim() || !input.eventId.trim() || !input.text.trim())
        throw new Error("Case ID, event ID, and message text are required");
      const { recipient: sender, partner: recipient } = await identities(
        input.from,
        input.to,
      );
      const message = await sender.sendMessage({
        to: recipient.handle.startsWith("@")
          ? recipient.handle
          : `@${recipient.handle}`,
        text: input.text,
        idempotencyKey: JSON.stringify([input.caseId, input.eventId]),
        metadata: {
          caseId: input.caseId,
          eventId: input.eventId,
          organizationId: input.from,
        },
      });
      return { messageId: message.messageId, createdAt: message.createdAt };
    },
    async receive(input: {
      organizationId: string;
      partnerId: string;
      caseId: string;
      onMessage: (message: ReceivedRelayMessage) => Promise<void>;
    }) {
      const { recipient, partner } = await identities(input.organizationId, input.partnerId);
      const received: ReceivedRelayMessage[] = [];
      await replayUnread(recipient, partner, input.organizationId, input.partnerId, async (message) => {
        if (message.caseId !== input.caseId) return false;
        await input.onMessage(message);
        received.push(message);
        return true;
      });
      return received;
    },
    async subscribe(input: {
      organizationId: string;
      partnerId: string;
      signal?: AbortSignal;
      onMessage: (message: ReceivedRelayMessage) => Promise<void>;
    }) {
      if (input.signal?.aborted) return;
      const { recipient, partner } = await identities(input.organizationId, input.partnerId);
      let queue = Promise.resolve();
      let stop!: () => void;
      let fail!: (error: unknown) => void;
      const stopped = new Promise<void>((resolve, reject) => { stop = resolve; fail = reject; });
      const handle = async (message: ReceivedRelayMessage) => { await input.onMessage(message); return true; };
      const unsubscribe = recipient.onDirectMessage((received) => {
        const message = decode(received, recipient, partner, input.organizationId, input.partnerId);
        if (!message) return;
        queue = queue.then(async () => {
          await input.onMessage(message);
          await recipient.messages.markRead(message.messageId);
        });
        void queue.catch(fail);
      });
      input.signal?.addEventListener("abort", stop, { once: true });
      void replayUnread(recipient, partner, input.organizationId, input.partnerId, handle).catch(() => {
        console.warn("Relay unread-message replay failed; live direct-message listening remains active. Restart to retry unread history.");
      });
      if (input.signal?.aborted) stop();
      try { await stopped; await queue; }
      finally { unsubscribe(); input.signal?.removeEventListener("abort", stop); }
    },
  };
}

const transport = createRelayTransport(getClient);
export const sendRelayMessage = transport.send;
export const receiveRelayMessages = transport.receive;
export const subscribeRelayMessages = transport.subscribe;

export async function checkRelayConnection(
  organizationIds = Object.keys(configuredRelayTokens()),
): Promise<Record<string, string>> {
  const handles = await Promise.all(
    organizationIds.map(
      async (id) => [id, (await getClient(id)).handle] as const,
    ),
  );
  return Object.fromEntries(handles);
}
