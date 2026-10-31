import { useEffect, useState } from "react";
import { workspacePath } from "./workspaces";
import "./Admin.css";

interface RecordingCase {
  caseId: string | null;
  customerId: "notion";
  vendorId: "aws";
  queued: boolean;
  reason?: string;
}

export default function Admin() {
  const [mode, setMode] = useState<"loading" | "demo" | "live" | "unavailable">(
    "loading",
  );
  const [confirming, setConfirming] = useState(false);
  const [resetting, setResetting] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [recording, setRecording] = useState<RecordingCase | null>(null);
  const api = import.meta.env.VITE_API_URL || "";

  useEffect(() => {
    const controller = new AbortController();
    fetch(`${api}/api/health`, { signal: controller.signal })
      .then(async (response) => {
        if (!response.ok) throw new Error();
        const health = await response.json();
        setMode(health.mode === "demo" ? "demo" : "live");
      })
      .catch(() => {
        if (!controller.signal.aborted) setMode("unavailable");
      });
    return () => controller.abort();
  }, [api]);

  async function reset() {
    setResetting(true);
    setError("");
    setMessage("");
    setRecording(null);
    try {
      const response = await fetch(`${api}/api/reset`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ confirm: true }),
      });
      const result = await response.json();
      if (!response.ok)
        throw new Error(result.error || "The reset could not be completed.");
      setConfirming(false);
      setRecording(result.recording || null);
      setMessage(
        result.recording
          ? "Example workspaces restored."
          : "Example workspaces restored, but no recording case was returned.",
      );
    } catch (failure) {
      setError(
        failure instanceof Error
          ? failure.message
          : "The reset could not be completed.",
      );
    } finally {
      setResetting(false);
    }
  }

  return (
    <div className="admin-page">
      <header className="admin-header">
        <a href="/">Janus</a>
        <span>Local administration</span>
      </header>
      <main>
        <p className="admin-eyebrow">Recording setup</p>
        <h1>Start with a clean demo.</h1>
        <p className="admin-intro">
          Restore the example workspaces and start a fresh investigation from an
          upload-failure monitoring signal.
        </p>
        <section className="admin-reset" aria-labelledby="reset-heading">
          <div className="admin-section-heading">
            <h2 id="reset-heading">Reset and start an investigation</h2>
            <span className="admin-mode">
              {mode === "loading"
                ? "Checking server…"
                : mode === "demo"
                  ? "Local demo"
                  : mode === "live"
                    ? "Live mode"
                    : "Server unavailable"}
            </span>
          </div>
          <p>
            This restores the example cases and connections, then introduces a
            fresh upload-failure signal. An agent reads the signal, opens a
            case, and starts the investigation automatically. Local case
            progress and saved connection credentials are cleared.
          </p>
          <p>
            Reset does not change external provider accounts or Supabase data. A
            pending or running investigation must finish before resetting.
          </p>
          {mode === "demo" && !confirming && (
            <button
              type="button"
              onClick={() => {
                setConfirming(true);
                setMessage("");
                setError("");
                setRecording(null);
              }}
            >
              Reset and start investigation
            </button>
          )}
          {mode === "demo" && confirming && (
            <div className="admin-confirm">
              <h3>Restore the starting state?</h3>
              <p>
                The current local demo progress will be replaced, then a new
                monitoring signal will start the next investigation. This cannot
                be undone.
              </p>
              <div className="admin-actions">
                <button type="button" onClick={reset} disabled={resetting}>
                  {resetting
                    ? "Preparing investigation…"
                    : "Confirm reset and start"}
                </button>
                <button
                  className="admin-secondary"
                  type="button"
                  onClick={() => {
                    setConfirming(false);
                    setError("");
                  }}
                  disabled={resetting}
                >
                  Cancel
                </button>
              </div>
            </div>
          )}
          {mode === "live" && (
            <p className="admin-notice">Reset is disabled in live mode.</p>
          )}
          {mode === "unavailable" && (
            <p className="admin-notice">
              The local API is unavailable. Start the server and reload this
              page.
            </p>
          )}
          {error && (
            <p className="admin-error" role="alert">
              {error}
            </p>
          )}
          {message && (
            <p className="admin-success" role="status">
              {message}
            </p>
          )}
        </section>
        {recording ? (
          <section
            className="admin-recording"
            aria-labelledby="recording-heading"
          >
            <div className="admin-recording-heading">
              <h2 id="recording-heading">
                {recording.caseId
                  ? "Your recording case"
                  : "Monitoring needs attention"}
              </h2>
              <span>
                {recording.queued ? "Investigation queued" : "Not started"}
              </span>
            </div>
            <p>
              {recording.caseId
                ? recording.queued
                  ? "The monitoring agent opened a case and queued its investigation. Follow the same case from either company."
                  : "The monitoring agent opened a case, but its investigation could not start."
                : "No case was opened. An agent investigation has not started."}
            </p>
            {!recording.queued && (
              <p className="admin-recording-reason" role="alert">
                {recording.reason ||
                  "The server did not queue an agent investigation. Check the agent configuration before continuing."}
              </p>
            )}
            {recording.caseId && (
              <div className="admin-recording-links">
                <a
                  href={workspacePath(
                    recording.customerId,
                    "cases",
                    recording.caseId,
                  )}
                >
                  <span>
                    <strong>Notion</strong>
                    <small>Customer conversation</small>
                  </span>
                  <span aria-hidden="true">↗</span>
                </a>
                <a
                  href={workspacePath(
                    recording.vendorId,
                    "cases",
                    recording.caseId,
                  )}
                >
                  <span>
                    <strong>AWS</strong>
                    <small>Vendor conversation</small>
                  </span>
                  <span aria-hidden="true">↗</span>
                </a>
              </div>
            )}
          </section>
        ) : (
          <a className="admin-workspace-link" href={workspacePath("notion")}>
            Open Notion workspace <span aria-hidden="true">↗</span>
          </a>
        )}
      </main>
    </div>
  );
}
