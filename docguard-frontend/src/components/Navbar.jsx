import { Search, Bell } from "lucide-react";
import { useLocation } from "react-router-dom";

const Navbar = () => {
  const location = useLocation();

  const pageNames = {
    "/": "Dashboard",
    "/repositories": "Repositories",
    "/pull-requests": "Pull Requests",
    "/issues": "Documentation Issues",
    "/settings": "Settings"
  };

  return (
    <header className="navbar">

      <div className="breadcrumb">
        <span>Workspace</span>
        <span>/</span>
        <strong>{pageNames[location.pathname] || "Dashboard"}</strong>
      </div>

      <div className="navbar-right">

        <div className="search-box">
          <Search size={17} />
          <input placeholder="Search anything..." />
        </div>

        <button className="notification-button">
          <Bell size={20} />
          <span className="notification-indicator"></span>
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