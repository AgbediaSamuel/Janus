import React, { lazy, Suspense, useEffect, useState } from "react";
import ReactDOM from "react-dom/client";
import { resolveWorkspaceRoute, workspacePath } from "./workspaces";
import "./typography.css";

const Landing = lazy(() => import("./Landing"));
const Admin = lazy(() => import("./Admin"));
const App = lazy(() => Promise.all([import("./App"), import("./App.css")]).then(([module]) => module));

function Router() {
  if (window.location.pathname === "/app" || window.location.pathname === "/app/") {
    window.history.replaceState(null, "", workspacePath("notion"));
  }
  const [pathname, setPathname] = useState(window.location.pathname);
  useEffect(() => {
    const update = () => setPathname(window.location.pathname);
    window.addEventListener("popstate", update);
    return () => window.removeEventListener("popstate", update);
  }, []);
  const route = resolveWorkspaceRoute(pathname);
  return <Suspense fallback={<div role="status" style={{ padding: 32, fontFamily: "var(--font-text)", fontSize: 32 }}>Janus</div>}>
    {pathname === "/" ? <Landing /> : pathname === "/admin" ? <Admin /> : route ? <App key={route.workspace.organizationId} route={route} /> :
      <main style={{ padding: "12vh 8vw", fontFamily: "var(--font-text)" }}><h1>Workspace not found</h1><p>Check the workspace link you were given.</p><a href="/">Back to Janus</a></main>}
  </Suspense>;
}

ReactDOM.createRoot(document.getElementById("root")!).render(<React.StrictMode><Router /></React.StrictMode>);
