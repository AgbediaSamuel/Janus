import type { CaseEvent, Organization } from "../types";

export function messageAudience(
  event: CaseEvent,
  organizations: Organization[],
  organizationId: string,
  counterpartId: string,
) {
  const name = (id?: string) =>
    organizations.find((item) => item.id === id)?.name || "counterpart";
  const recipient = name(event.recipientOrganizationId || counterpartId);
  if (event.delivery?.status === "accepted")
    return { label: `Sent to ${recipient} · awaiting receipt`, pending: true };
  if (event.delivery?.status === "unconfirmed")
    return { label: `Delivery to ${recipient} unconfirmed`, pending: true };
  if (event.delivery?.status === "received")
    return { label: `Received by ${recipient}`, pending: false };
  return {
    label:
      event.visibility === "private"
        ? `Only ${name(event.organizationId || organizationId)}`
        : `Shared with ${name(counterpartId)}`,
    pending: false,
  };
}
