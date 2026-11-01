import { Outlet } from "react-router-dom";
import { useWorkflow } from "../workflow-context";
import Sidebar from "../components/Sidebar";
import Navbar from "../components/Navbar";

const MainLayout = () => {
  const { storageWarning } = useWorkflow();

  return (
    <div className="app-layout">
      <Sidebar />
      <div className="main-area">
        <Navbar />
        {storageWarning && <p className="storage-warning" role="status">{storageWarning}</p>}
        <main className="page-content">
          <Outlet />
        </main>
      </div>
    </div>
  );
};

export default MainLayout;
