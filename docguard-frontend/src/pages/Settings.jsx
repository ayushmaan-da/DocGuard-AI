import { useState } from "react";

import {
  GitBranch,
  Bell,
  ShieldCheck,
  Save
} from "lucide-react";

import "./Settings.css";

const Settings = () => {
  const [notifications, setNotifications] = useState(true);
  const [criticalAlerts, setCriticalAlerts] = useState(true);
  const [defaultDocumentation, setDefaultDocumentation] =
    useState("README.md");

  const [saved, setSaved] = useState(false);

  const handleSave = () => {
    const preferences = {
      notifications,
      criticalAlerts,
      defaultDocumentation
    };

    localStorage.setItem(
      "docguard-settings",
      JSON.stringify(preferences)
    );

    setSaved(true);

    setTimeout(() => setSaved(false), 2500);
  };

  return (
    <div className="settings-page">

      <div className="settings-heading">
        <p className="eyebrow">PREFERENCES</p>
        <h1>Settings</h1>
        <p>Manage your DocGuard preferences.</p>
      </div>

      <section className="settings-card">

        <div className="settings-card-heading">
          <GitBranch size={21} />
          <div>
            <h2>GitHub Integration</h2>
            <p>Manage your GitHub connection.</p>
          </div>
        </div>

        <div className="settings-row">
          <div>
            <strong>GitHub Connection</strong>
            <p>Connect your GitHub account to analyze repositories.</p>
          </div>

          <span className="connection-pending">
            Not Connected
          </span>
        </div>

        <p className="settings-note">
          GitHub authentication will be enabled after backend integration.
        </p>

      </section>

      <section className="settings-card">

        <div className="settings-card-heading">
          <Bell size={21} />

          <div>
            <h2>Notifications</h2>
            <p>Choose which notifications you receive.</p>
          </div>
        </div>

        <div className="settings-row">
          <div>
            <strong>Enable Notifications</strong>
            <p>Receive notifications about analysis results.</p>
          </div>

          <input
            type="checkbox"
            checked={notifications}
            onChange={(e) => setNotifications(e.target.checked)}
          />
        </div>

        <div className="settings-row">
          <div>
            <strong>Critical Issue Alerts</strong>
            <p>Get notified when critical documentation drift is found.</p>
          </div>

          <input
            type="checkbox"
            checked={criticalAlerts}
            onChange={(e) => setCriticalAlerts(e.target.checked)}
          />
        </div>

      </section>

      <section className="settings-card">

        <div className="settings-card-heading">
          <ShieldCheck size={21} />

          <div>
            <h2>Analysis Preferences</h2>
            <p>Configure default documentation settings.</p>
          </div>
        </div>

        <div className="settings-row">
          <div>
            <strong>Default Documentation Source</strong>
            <p>Choose the default documentation source.</p>
          </div>

          <select
            value={defaultDocumentation}
            onChange={(e) => setDefaultDocumentation(e.target.value)}
          >
            <option value="README.md">README.md</option>
            <option value="Custom Upload">Custom Upload</option>
          </select>
        </div>

      </section>

      <div className="settings-save-area">

        {saved && (
          <span className="settings-saved">
            Settings saved successfully!
          </span>
        )}

        <button onClick={handleSave}>
          <Save size={17} />
          Save Preferences
        </button>

      </div>

    </div>
  );
};

export default Settings;