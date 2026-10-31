import { configuredRelayTokens } from "./relay";
export {
  sendRelayMessage,
  receiveRelayMessages,
  subscribeRelayMessages,
  checkRelayConnection,
  type RelayCaseMessage,
  type ReceivedRelayMessage,
} from "./relay";
export { readTerseCase, persistTerseCase } from "./terse";
export { createFreestyleWorkspace } from "./freestyle";

export function getRuntimeStatus() {
  let relayConfigured = false;
  try {
    relayConfigured = Boolean(
      process.env.RELAY_WORKSPACE_KEY &&
        Object.keys(configuredRelayTokens()).length >= 2,
    );
  } catch {
    relayConfigured = false;
  }
  const terseConfigured = Boolean(process.env.TERSE_ACTOR_URL);
  const agentsConfigured = Boolean(
    process.env.OPENAI_API_KEY &&
      process.env.OPENAI_MODEL &&
      process.env.DATABASE_URL,
  );
  const freestyleConfigured = Boolean(process.env.FREESTYLE_API_KEY);
  const status = (configured: boolean) => ({
    configured,
    status: configured ? "configured_unverified" : "not_configured",
  });
  return {
    relay: status(relayConfigured),
    terse: status(terseConfigured),
    agents: status(agentsConfigured),
    freestyle: status(freestyleConfigured),
  };
}
