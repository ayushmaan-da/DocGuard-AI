import { NavLink } from "react-router-dom";
import {
  LayoutDashboard,
  GitBranch,
  GitPullRequest,
  AlertCircle,
  Settings,
  ShieldCheck
} from "lucide-react";
import { useWorkflow } from "../workflow-context";

const navItems = [
  { name: "Dashboard", path: "/", icon: LayoutDashboard },
  { name: "Repositories", path: "/repositories", icon: GitBranch },
  { name: "Check a pull request", path: "/pull-requests", icon: GitPullRequest },
  { name: "Issues", path: "/issues", icon: AlertCircle },
  { name: "Settings", path: "/settings", icon: Settings }
];

const Sidebar = () => {
  const { backendStatus } = useWorkflow();
  return (
    <aside className="sidebar">
    <div className="brand">
      <div className="brand-icon">
        <ShieldCheck size={17} color="#12161c" />
      </div>
      <h2>DocGuard</h2>
    </div>

    <nav aria-label="Main">
      {navItems.map(({ name, path, icon: Icon }) => (
        <NavLink
          key={name}
          to={path}
          end={path === "/"}
          title={name}
          className={({ isActive }) => (isActive ? "nav-link active" : "nav-link")}
        >
          <Icon size={18} />
          <span>{name}</span>
        </NavLink>
      ))}
    </nav>

    <div className="sidebar-bottom">
      <span className={`online-dot ${backendStatus.state}`} />
      <span>{backendStatus.state === "connected" ? "Backend available" : backendStatus.state === "unavailable" ? "Backend unavailable" : "Checking backend"}</span>
    </div>
    </aside>
  );
};

export default Sidebar;
