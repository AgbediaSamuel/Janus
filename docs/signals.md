# Incoming alerts

`POST /api/signals` accepts a normalized alert from your monitoring bridge. In live mode, authenticate with a Supabase user access token belonging to the customer organization. This endpoint uses Janus's normal user authentication and organization membership checks. It does not verify Datadog, Sentry, PagerDuty, or other provider-native webhook signatures. Your bridge must verify the source webhook before submitting the normalized request.

```sh
curl --request POST "$JANUS_API_URL/api/signals" \
  --header "Authorization: Bearer $JANUS_USER_JWT" \
  --header 'Content-Type: application/json' \
  --data '{
    "organizationId": "northstar",
    "vendorId": "contoso",
    "connectorId": "datadog",
    "externalId": "monitor-42:incident-8",
    "title": "Checkout API error rate elevated",
    "summary": "Customer requests to the vendor checkout API are failing.",
    "severity": "P2",
    "data": {"monitorId": "42", "requestIds": ["request-9"]},
    "investigate": true
  }'
```

`JANUS_USER_JWT` must contain a current user access token, not a Supabase service-role key. Both organizations must already be registered, and the user must belong to `organizationId`. `connectorId` must be present in the Janus connector catalog. Receiving an alert does not require stored credentials for that connector; subsequent diagnostic operations do require their configured connection.

The bridge submits `title` and `summary` as shared case context visible to the partner. Redact them before submission. The external alert ID and `data` are stored as private customer evidence. They are not sent to the partner automatically. The agent may later send a relevant sanitized summary through its normal partner messaging tool. Raw alert evidence is marked as externally supplied, not independently verified provider telemetry, and cannot itself satisfy the connector-provenance requirement for resolving a live case.

Required fields are `organizationId`, `vendorId`, `connectorId`, `externalId`, `title`, and `summary`. Optional fields are `severity` (`P1`, `P2`, or `P3`; defaults to the existing case default `P1`), `data` (an object), and `investigate` (defaults to `true`). The existing API request body limit is 1 MB.

A new alert returns HTTP 201 with `{created:true, duplicate:false, queued, case}`. The case always has `mode:"live"`, even on a local demo server, because the submitted alert is real input. No demo service, fixture evidence, or guided steps are inserted. Local demo servers still use their documented local identity and persistence; deploy with `JANUS_MODE=live` for authenticated external access.

When Deep Agents is configured, the case and its initial pending run are persisted together before the worker is notified. `queued:true` means a run was recorded, not that inference or diagnosis succeeded. Check the case's run status and timeline for progress. When `OPENAI_API_KEY`, `OPENAI_MODEL`, or `DATABASE_URL` is missing, the case is created with `queued:false` and a clear `reason`. `investigate:false` also creates only the case. After configuring the runtime, an operator can start a turn through the normal case investigation endpoint.

Retries use the tuple `(organizationId, connectorId, externalId)` as the idempotency key. Concurrent duplicates return HTTP 200 with the original case and do not create another case, evidence item, or investigation run. The first accepted payload wins; a retry does not overwrite its title, vendor, data, or investigation choice. Use a new `externalId` for a new incident. A completed run is not restarted by an alert retry. A persisted pending run can be awakened again without adding a run. The deterministic case ID preserves this behavior across worker restarts. The ingestion queue follows the project's single-worker-replica architecture.

Validation errors return HTTP 400. Live requests without a valid user session return HTTP 401, and requests outside the user's organization membership return HTTP 403.
