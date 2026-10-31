export function sourceLabel(value: string) {
  return value.replaceAll("demo-customer", "Service telemetry").replaceAll("demo-vendor", "Service diagnostics");
}

export function evidenceData(key: string, value: unknown) {
  if (["simulated", "simulation", "fixture"].includes(key) ||
    (key === "mode" && value === "simulation") ||
    (key === "externalId" && typeof value === "string" && value.startsWith("demo-"))) return undefined;
  return typeof value === "string" ? sourceLabel(value) : value;
}
