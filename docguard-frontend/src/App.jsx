import { BrowserRouter, Routes, Route } from "react-router-dom";

import MainLayout from "./layouts/MainLayout";

import Dashboard from "./pages/Dashboard";
import PullRequestAnalysis from "./pages/PullRequestAnalysis";
import AnalysisResults from "./pages/AnalysisResults";
import Repositories from "./pages/Repositories";
import DocumentationIssues from "./pages/DocumentationIssues";
import Settings from "./pages/Settings";

function App() {
  return (
    <BrowserRouter>

      <Routes>

        <Route element={<MainLayout />}>

          <Route path="/" element={<Dashboard />} />

          <Route
            path="/repositories"
            element={<Repositories />}
          />

          <Route
            path="/pull-requests"
            element={<PullRequestAnalysis />}
          />

          <Route
            path="/analysis-results"
            element={<AnalysisResults />}
          />

          <Route
            path="/issues"
            element={<DocumentationIssues />}
          />

          <Route
            path="/settings"
            element={<Settings />}
          />

        </Route>

      </Routes>

    </BrowserRouter>
  );
}

export default App;