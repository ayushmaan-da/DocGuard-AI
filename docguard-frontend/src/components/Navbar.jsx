import { Search, Bell } from "lucide-react";
import { useLocation } from "react-router-dom";

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

  return (
    <header className="navbar">
      <div className="breadcrumb">
        <span>Workspace</span>
        <span aria-hidden="true">/</span>
        <strong>{pageNames[pathname] || "Dashboard"}</strong>
      </div>

      <div className="navbar-right">
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
