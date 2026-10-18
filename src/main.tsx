import React, { lazy, Suspense, useEffect } from "react";
import { createRoot } from "react-dom/client";
import {
  BrowserRouter,
  Routes,
  Route,
  useLocation,
  Navigate,
} from "react-router-dom";
import "@fontsource/inter/latin-400.css";
import "@fontsource/inter/latin-500.css";
import "@fontsource/inter/latin-600.css";
import "@fontsource/inter/latin-700.css";
import "@fontsource/inter/latin-800.css";
import "@fontsource/jetbrains-mono/latin-400.css";
import "@fontsource/jetbrains-mono/latin-500.css";
import "./styles.css";
import { PlatformProvider } from "./components/admin/Platform";
import Landing from "./pages/Landing";
import Auth from "./pages/Auth";
import Dashboard from "./pages/Dashboard";
import { Toast } from "./components/ui";
import { useStore } from "./lib/store";
import WorkspaceSession from "./components/storage/WorkspaceSession";
const PasswordRecovery = lazy(() => import("./pages/PasswordRecovery"));
const Admin = lazy(() => import("./pages/Admin"));
const Services = lazy(() => import("./pages/Services"));
const Upgrade = lazy(() => import("./pages/Upgrade"));
const Profile = lazy(() => import("./pages/Profile"));
const Workspace = lazy(() => import("./pages/Workspace"));
const Dokumentasi = lazy(() => import("./pages/Dokumentasi"));
const Panduan = lazy(() => import("./pages/Panduan"));
const Aturan = lazy(() => import("./pages/Aturan"));
class ErrorBoundary extends React.Component<
  { children: React.ReactNode },
  { error: boolean }
> {
  state = { error: false };
  static getDerivedStateFromError() {
    return { error: true };
  }
  render() {
    return this.state.error ? (
      <div className="app-error">
        <h1>Ruang kerja perlu dimuat ulang.</h1>
        <p>Data lokal Anda tetap tersimpan.</p>
        <button
          className="button button-dark"
          onClick={() => location.reload()}
        >
          Muat ulang
        </button>
        <a href="/">Kembali ke beranda</a>
      </div>
    ) : (
      this.props.children
    );
  }
}
function WorkspaceGate({ children }: { children: React.ReactNode }) {
  const ready = useStore((s) => s.authReady);
  const user = useStore((s) => s.user);
  const location = useLocation();
  if (!ready)
    return (
      <div className="app-loading">
        <span className="loading-logo">p.</span>
        <p>Memulihkan sesi workspace Anda…</p>
      </div>
    );
  if (!user || user.demo)
    return (
      <Navigate
        to={
          "/login?next=" +
          encodeURIComponent(location.pathname + location.search)
        }
        replace
      />
    );
  return children;
}
function App() {
  const location = useLocation();
  useEffect(() => {
    if (location.hash) {
      const timer = setTimeout(() => {
        try {
          document
            .getElementById(decodeURIComponent(location.hash.slice(1)))
            ?.scrollIntoView({ behavior: "smooth" });
        } catch {
          /* Malformed external fragments must not crash routing. */
        }
      }, 100);
      return () => clearTimeout(timer);
    } else window.scrollTo(0, 0);
  }, [location.pathname, location.hash]);
  return (
    <>
      <WorkspaceSession />
      <Suspense
        fallback={
          <div className="app-loading">
            <span className="loading-logo">p.</span>
            <p>Menyiapkan ruang untuk ide Anda…</p>
          </div>
        }
      >
        <PlatformProvider>
          <Routes>
            <Route path="/" element={<Landing />} />
            <Route
              path="/admin"
              element={
                <WorkspaceGate>
                  <Admin />
                </WorkspaceGate>
              }
            />
            {(["account", "marketplace", "invite", "recording"] as const).map(
              (page) => (
                <Route
                  key={page}
                  path={
                    "/" +
                    page +
                    (["invite", "recording"].includes(page) ? "/:token" : "")
                  }
                  element={
                    <WorkspaceGate>
                      <Services page={page} />
                    </WorkspaceGate>
                  }
                />
              ),
            )}
            <Route path="/login" element={<Auth />} />
            {/* Docs — public, no gate: anyone can read. Aliases for convenience. */}
            <Route path="/docs" element={<Dokumentasi />} />
            <Route path="/dokumentasi" element={<Dokumentasi />} />
            <Route path="/panduan" element={<Panduan />} />
            <Route path="/guide" element={<Panduan />} />
            <Route path="/aturan" element={<Aturan />} />
            <Route path="/rules" element={<Aturan />} />
            {/* Pricing and profile stay reachable without the workspace gate:
                the pages themselves explain what a session would unlock. */}
            <Route path="/upgrade" element={<Upgrade />} />
            <Route
              path="/profile"
              element={
                <WorkspaceGate>
                  <Profile />
                </WorkspaceGate>
              }
            />
            <Route path="/forgot-password" element={<PasswordRecovery />} />
            <Route
              path="/reset-password"
              element={<PasswordRecovery reset />}
            />
            <Route
              path="/projects"
              element={
                <WorkspaceGate>
                  <Dashboard />
                </WorkspaceGate>
              }
            />
            <Route
              path="/project/:id"
              element={
                <WorkspaceGate>
                  <Workspace />
                </WorkspaceGate>
              }
            />
            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
        </PlatformProvider>
      </Suspense>
      <Toast />
    </>
  );
}
createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <ErrorBoundary>
      <BrowserRouter>
        <App />
      </BrowserRouter>
    </ErrorBoundary>
  </React.StrictMode>,
);
