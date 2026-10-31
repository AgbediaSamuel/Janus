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

type RelayInboxItem = Awaited<
  ReturnType<RelayAgentClient["inbox"]["list"]>
>["items"][number];
export type RelayClient = Pick<
  RelayAgentClient,
  "id" | "handle" | "sendMessage"
> & {
  inbox: Pick<RelayAgentClient["inbox"], "list" | "subscribe" | "ack">;
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
  if (process.env.RELAY_NORTHSTAR_TOKEN)
    tokens.northstar = process.env.RELAY_NORTHSTAR_TOKEN;
  if (process.env.RELAY_CONTOSO_TOKEN)
    tokens.contoso = process.env.RELAY_CONTOSO_TOKEN;
  return tokens;
}

let relay: AgentRelay | undefined;
const clients = new Map<string, Promise<RelayAgentClient>>();

async function getClient(organizationId: string): Promise<RelayAgentClient> {
  const workspaceKey = process.env.RELAY_WORKSPACE_KEY?.trim();
  const apiToken = configuredRelayTokens()[organizationId];
  if (!workspaceKey || !apiToken)
    throw new Error(
      `Agent Relay is not configured for organization ${organizationId}`,
    );
  if (!relay)
    relay = new AgentRelay({
      workspaceKey,
      baseUrl: process.env.RELAY_BASE_URL || undefined,
    });
  let client = clients.get(organizationId);
  if (!client) {
    client = relay.workspace.reconnect({ apiToken });
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
    item: RelayInboxItem,
    recipient: RelayClient,
    partner: RelayClient,
    organizationId: string,
    partnerId: string,
  ): ReceivedRelayMessage | null {
    if (item.message.from.id !== partner.id) return null;
    if (item.recipient.id && item.recipient.id !== recipient.id) return null;
    const metadata = item.message.metadata;
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
      text: item.message.text,
      messageId: item.message.messageId,
      deliveryId: item.id,
      createdAt: item.message.createdAt,
    };
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
      const { recipient, partner } = await identities(
        input.organizationId,
        input.partnerId,
      );
      const inbox = await recipient.inbox.list();
      const received: ReceivedRelayMessage[] = [];
      for (const item of inbox.items) {
        const message = decode(
          item,
          recipient,
          partner,
          input.organizationId,
          input.partnerId,
        );
        if (!message || message.caseId !== input.caseId) continue;
        await input.onMessage(message);
        await recipient.inbox.ack({ inboxItemId: item.id, state: "read" });
        received.push(message);
      }
      return received;
    },
    async subscribe(input: {
      organizationId: string;
      partnerId: string;
      signal?: AbortSignal;
      onMessage: (message: ReceivedRelayMessage) => Promise<void>;
    }) {
      const { recipient, partner } = await identities(
        input.organizationId,
        input.partnerId,
      );
      for await (const item of recipient.inbox.subscribe({
        signal: input.signal,
      })) {
        const message = decode(
          item,
          recipient,
          partner,
          input.organizationId,
          input.partnerId,
        );
        if (!message) continue;
        await input.onMessage(message);
        await recipient.inbox.ack({ inboxItemId: item.id, state: "read" });
      }
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
