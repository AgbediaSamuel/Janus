import { useEffect, useState } from "react";
import { workspacePath } from "./workspaces";
import "./Admin.css";

export default function Admin() {
  const [mode, setMode] = useState<"loading" | "demo" | "live" | "unavailable">("loading");
  const [confirming, setConfirming] = useState(false);
  const [resetting, setResetting] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const api = import.meta.env.VITE_API_URL || "";

  useEffect(() => {
    const controller = new AbortController();
    fetch(`${api}/api/health`, { signal: controller.signal })
      .then(async (response) => {
        if (!response.ok) throw new Error();
        const health = await response.json();
        setMode(health.mode === "demo" ? "demo" : "live");
      })
      .catch(() => { if (!controller.signal.aborted) setMode("unavailable"); });
    return () => controller.abort();
  }, [api]);

  async function reset() {
    setResetting(true);
    setError("");
    setMessage("");
    try {
      const response = await fetch(`${api}/api/reset`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ confirm: true }),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "The reset could not be completed.");
      setConfirming(false);
      setMessage("Demo data restored. Open a workspace to start the next recording.");
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : "The reset could not be completed.");
    } finally {
      setResetting(false);
    }
  }

  return <div className="admin-page">
    <header className="admin-header"><a href="/">Janus</a><span>Local administration</span></header>
    <main>
      <p className="admin-eyebrow">Recording setup</p>
      <h1>Start with a clean demo.</h1>
      <p className="admin-intro">Restore the example workspaces before your next walkthrough.</p>
      <section className="admin-reset" aria-labelledby="reset-heading">
        <div className="admin-section-heading"><h2 id="reset-heading">Reset demo data</h2><span className="admin-mode">{mode === "loading" ? "Checking server…" : mode === "demo" ? "Local demo" : mode === "live" ? "Live mode" : "Server unavailable"}</span></div>
        <p>This restores the seeded cases, evidence, approvals, and example connections. Local case progress and saved connection credentials are cleared.</p>
        <p>External provider accounts and Supabase data are not changed. A pending or running investigation must finish before resetting.</p>
        {mode === "demo" && !confirming && <button type="button" onClick={() => { setConfirming(true); setMessage(""); setError(""); }}>Reset demo data</button>}
        {mode === "demo" && confirming && <div className="admin-confirm">
          <h3>Restore the starting state?</h3>
          <p>The current local demo progress will be replaced. This cannot be undone.</p>
          <div className="admin-actions"><button type="button" onClick={reset} disabled={resetting}>{resetting ? "Resetting…" : "Confirm reset"}</button><button className="admin-secondary" type="button" onClick={() => { setConfirming(false); setError(""); }} disabled={resetting}>Cancel</button></div>
        </div>}
        {mode === "live" && <p className="admin-notice">Reset is disabled in live mode.</p>}
        {mode === "unavailable" && <p className="admin-notice">The local API is unavailable. Start the server and reload this page.</p>}
        {error && <p className="admin-error" role="alert">{error}</p>}
        {message && <p className="admin-success" role="status">{message}</p>}
      </section>
      <a className="admin-workspace-link" href={workspacePath("notion")}>Open Notion workspace <span aria-hidden="true">↗</span></a>
    </main>
  </div>;
}
