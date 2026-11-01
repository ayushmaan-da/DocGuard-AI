import { useEffect } from "react";
import { Search, Bell } from "lucide-react";
import { useLocation } from "react-router-dom";

import { useWorkflow } from "../workflow-context";
import { getApiErrorMessage, getHealth } from "../services/api";

const pageNames = {
  "/": "Dashboard",
  "/repositories": "Repositories",
  "/pull-requests": "Check a pull request",
  "/analysis-results": "Results",
  "/issues": "Documentation issues",
  "/settings": "Settings"
};

const Navbar = () => {
  const { pathname } = useLocation();
  const { backendStatus, setBackendStatus } = useWorkflow();

  useEffect(() => {
    let active = true;
    let nextCheck;

    const checkHealth = async () => {
      if (active) setBackendStatus({ state: "checking", message: "" });
      try {
        const health = await getHealth();
        if (active) {
          setBackendStatus({
            state: health?.status === "ok" ? "connected" : "unavailable",
            message: health?.status === "ok"
              ? `${health.service ?? "Backend"} is responding.`
              : "The backend health endpoint returned an unexpected status."
          });
        }
      } catch (error) {
        if (active) {
          setBackendStatus({ state: "unavailable", message: getApiErrorMessage(error) });
        }
      } finally {
        if (active) nextCheck = window.setTimeout(checkHealth, 30_000);
      }
    };

    void checkHealth();
    return () => {
      active = false;
      window.clearTimeout(nextCheck);
    };
  }, [setBackendStatus]);

  return (
    <header className="navbar">
      <div className="breadcrumb">
        <span>Workspace</span>
        <span aria-hidden="true">/</span>
        <strong>{pageNames[pathname] || "Dashboard"}</strong>
      </div>

      <div className="navbar-right">
        <span className={`connection-status ${backendStatus.state}`} role="status" title={backendStatus.message}>
          <span className="connection-dot" />
          {backendStatus.state === "connected"
            ? "Backend connected"
            : backendStatus.state === "unavailable"
              ? "Backend unavailable"
              : "Checking backend"}
        </span>
        <label className="search-box">
          <Search size={16} />
          <input placeholder="Search" aria-label="Search" />
        </label>

        <button className="notification-button" aria-label="Notifications">
          <Bell size={18} />
          <span className="notification-indicator" />
        </button>

        <div className="user-profile">
          <div className="avatar">A</div>
          <span>Admin</span>
        </div>
      </div>
    </header>
  );
};

export default Navbar;
