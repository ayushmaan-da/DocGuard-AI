import { NavLink } from "react-router-dom";
import {
  LayoutDashboard,
  GitBranch,
  GitPullRequest,
  AlertCircle,
  Settings,
  ShieldCheck
} from "lucide-react";

const Sidebar = () => {
  const navItems = [
    { name: "Dashboard", path: "/", icon: LayoutDashboard },
    { name: "Repositories", path: "/repositories", icon: GitBranch },
    { name: "Pull Requests", path: "/pull-requests", icon: GitPullRequest },
    { name: "Issues", path: "/issues", icon: AlertCircle },
    { name: "Settings", path: "/settings", icon: Settings }
  ];

  return (
    <aside className="sidebar">

      <div className="brand">
        <div className="brand-icon">
          <ShieldCheck size={24} />
        </div>

        <div>
          <h2>DocGuard</h2>
          <p>Documentation Intelligence</p>
        </div>
      </div>

      <div className="sidebar-section">
        <p className="section-heading">WORKSPACE</p>

        {navItems.map((item) => {
          const Icon = item.icon;

          return (
            <NavLink
              key={item.name}
              to={item.path}
              end={item.path === "/"}
              className={({ isActive }) =>
                isActive ? "nav-link active" : "nav-link"
              }
            >
              <Icon size={19} />
              <span>{item.name}</span>
            </NavLink>
          );
        })}
      </div>

      <div className="sidebar-bottom">
        <span className="online-dot"></span>
        All systems operational
      </div>

    </aside>
  );
};

export default Sidebar;