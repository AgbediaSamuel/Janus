const providerAssets: Record<string, string> = {
  slack: "slack",
  linear: "linear",
  github: "github",
  datadog: "datadog",
  sentry: "sentry",
  posthog: "posthog",
  splunk: "splunk",
  "azure-monitor": "azure-monitor",
  kusto: "azure-data-explorer",
  "azure-blob": "azure-blob",
  "gcp-logging": "gcp-logging",
  bigquery: "bigquery",
  "aws-cloudwatch": "aws-cloudwatch",
  "aws-s3": "aws-s3",
  stripe: "stripe",
  http: "http",
  mcp: "modelcontextprotocol",
  "work-iq": "microsoft",
  postgres: "postgresql",
  vercel: "vercel",
  supabase: "supabase",
  auth0: "auth0",
  twilio: "twilio",
  snowflake: "snowflake",
  "mongodb-atlas": "mongodb",
  salesforce: "salesforce",
  zendesk: "zendesk",
};

export default function ProviderLogo({
  connectorId,
  size = 28,
  className,
}: {
  connectorId: string;
  size?: number;
  className?: string;
}) {
  const asset = providerAssets[connectorId];
  if (!asset) return null;
  return (
    <img
      src={`/providers/${asset}.svg`}
      alt=""
      width={size}
      height={size}
      className={className}
      style={{ objectFit: "contain", flexShrink: 0 }}
    />
  );
}
