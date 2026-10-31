import { useState } from "react";
import { Save } from "lucide-react";

import "./Settings.css";

const STORAGE_KEY = "docguard-settings";
const defaults = {
  notifications: true,
  criticalAlerts: true,
  defaultDocumentation: "README.md"
};

const loadPreferences = () => {
  try {
    return { ...defaults, ...JSON.parse(localStorage.getItem(STORAGE_KEY)) };
  } catch {
    return defaults;
  }
};

const Settings = () => {
  const [prefs, setPrefs] = useState(loadPreferences);
  const [saved, setSaved] = useState(false);

  const update = (key, value) => setPrefs((p) => ({ ...p, [key]: value }));

  const handleSave = () => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(prefs));
    } catch {
      /* storage unavailable; keep going */
    }
    setSaved(true);
    setTimeout(() => setSaved(false), 2500);
  };

  return (
    <div className="page settings-page">
      <header className="page-head">
        <div>
          <h1>Settings</h1>
          <p>Choose how DocGuard connects, notifies and checks.</p>
        </div>
      </header>

      <section className="settings-section">
        <h2>GitHub</h2>
        <div className="settings-row">
          <div>
            <strong>GitHub account</strong>
            <p>Connect your account so DocGuard can read pull requests.</p>
          </div>
          <span className="status pending">Not connected</span>
        </div>
        <p className="settings-note">Connecting will be available once the backend is live.</p>
      </section>

      <section className="settings-section">
        <h2>Notifications</h2>

        <label className="settings-row">
          <div>
            <strong>Notify me about results</strong>
            <p>Get a notification when a check finishes.</p>
          </div>
          <input
            type="checkbox"
            className="switch"
            checked={prefs.notifications}
            onChange={(e) => update("notifications", e.target.checked)}
          />
        </label>

        <label className="settings-row">
          <div>
            <strong>Alert me to critical issues</strong>
            <p>Send an alert as soon as a critical mismatch is found.</p>
          </div>
          <input
            type="checkbox"
            className="switch"
            checked={prefs.criticalAlerts}
            disabled={!prefs.notifications}
            onChange={(e) => update("criticalAlerts", e.target.checked)}
          />
        </label>
      </section>

      <section className="settings-section">
        <h2>Checks</h2>
        <label className="settings-row">
          <div>
            <strong>Default documentation source</strong>
            <p>What DocGuard compares code against when you don’t upload a file.</p>
          </div>
          <select
            value={prefs.defaultDocumentation}
            onChange={(e) => update("defaultDocumentation", e.target.value)}
          >
            <option value="README.md">README.md</option>
            <option value="Custom Upload">Custom upload</option>
          </select>
        </label>
      </section>

      <div className="settings-save">
        <span className="settings-saved" role="status">
          {saved ? "Preferences saved" : ""}
        </span>
        <button className="btn" onClick={handleSave}>
          <Save size={16} />
          Save preferences
        </button>
      </div>
    </div>
  );
};

export default Settings;
