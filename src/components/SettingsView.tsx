"use client";

import { useState } from "react";
import {
  Bell,
  Bot,
  Check,
  FileArchive,
  Lock,
  Palette,
  Save,
  Search,
  ShieldCheck,
  SlidersHorizontal,
  User,
} from "lucide-react";

function Toggle({ label, enabled, onChange }: { label: string; enabled: boolean; onChange: () => void }) {
  return (
    <label className="settings-toggle-row">
      <span>{label}</span>
      <button type="button" className={`settings-toggle ${enabled ? "on" : ""}`} onClick={onChange} aria-pressed={enabled}>
        <span />
      </button>
    </label>
  );
}

function SettingsSection({ icon, title, description, children }: { icon: React.ReactNode; title: string; description: string; children: React.ReactNode }) {
  return (
    <section className="settings-card">
      <div className="settings-card-heading">
        <span className="settings-card-icon">{icon}</span>
        <div><h2>{title}</h2><p>{description}</p></div>
      </div>
      <div className="settings-card-body">{children}</div>
    </section>
  );
}

export function SettingsView({ userName = "Administrator", username = "admin" }: { userName?: string; username?: string }) {
  const [toggles, setToggles] = useState({ completed: true, nonCompliant: true, review: true, errors: true, email: false, browser: true, autoAnalysis: true, manualReview: true, multiPass: true, autoArchive: false, darkMode: false });
  const toggle = (key: keyof typeof toggles) => setToggles((current) => ({ ...current, [key]: !current[key] }));

  return (
    <div className="settings-page">
      <div className="settings-page-header">
        <div><span className="settings-kicker">ADMINISTRATION / SYSTEM PREFERENCES</span><h1>Settings</h1><p>Configure your Inspectra console, inspection engine, evidence, and security preferences.</p></div>
        <button className="button primary settings-save" type="button"><Save size={14} /> Save Changes</button>
      </div>

      <div className="settings-grid">
        <SettingsSection icon={<User size={17} />} title="Admin Profile" description="Manage administrator identity and access.">
          <div className="settings-profile"><div className="settings-avatar">{userName.charAt(0)}</div><div><strong>{userName}</strong><small>@{username}</small></div><button type="button" className="button secondary">Change photo</button></div>
          <div className="settings-fields"><label>Name<input defaultValue={userName} /></label><label>Email<input defaultValue={`${username}@inspectra.local`} /></label><label>Role<select defaultValue="Administrator"><option>Administrator</option><option>Enforcement Officer</option></select></label><label>Account<input value="Active" readOnly /></label></div>
          <button type="button" className="settings-inline-action"><Lock size={13} /> Change password</button>
        </SettingsSection>

        <SettingsSection icon={<Bell size={17} />} title="Notifications" description="Choose which operational events are reported.">
          <Toggle label="Inspection completed" enabled={toggles.completed} onChange={() => toggle("completed")} /><Toggle label="Non-compliant package detected" enabled={toggles.nonCompliant} onChange={() => toggle("nonCompliant")} /><Toggle label="Review required" enabled={toggles.review} onChange={() => toggle("review")} /><Toggle label="System errors" enabled={toggles.errors} onChange={() => toggle("errors")} /><div className="settings-divider" /><Toggle label="Email notifications" enabled={toggles.email} onChange={() => toggle("email")} /><Toggle label="Browser notifications" enabled={toggles.browser} onChange={() => toggle("browser")} />
        </SettingsSection>

        <SettingsSection icon={<SlidersHorizontal size={17} />} title="Inspection Settings" description="Tune capture quality and review behavior.">
          <div className="settings-fields"><label>OCR confidence threshold<input type="number" defaultValue="40" min="0" max="100" /></label><label>Image quality threshold<input type="number" defaultValue="65" min="0" max="100" /></label><label>Maximum image/file size<select defaultValue="10 MB"><option>5 MB</option><option>10 MB</option><option>25 MB</option></select></label></div>
          <Toggle label="Auto-analysis after upload" enabled={toggles.autoAnalysis} onChange={() => toggle("autoAnalysis")} /><Toggle label="Manual review trigger" enabled={toggles.manualReview} onChange={() => toggle("manualReview")} />
        </SettingsSection>

        <SettingsSection icon={<ShieldCheck size={17} />} title="Compliance Rules" description="Manage the active statutory ruleset.">
          <div className="settings-fields"><label>Active Ruleset version<select defaultValue="LM-PC 2011 / v1.1"><option>LM-PC 2011 / v1.1</option><option>LM-PC 2011 / v1.0</option></select></label><label>Rule update status<input value="Active and verified" readOnly /></label></div>
          <div className="settings-approval"><Lock size={14} /><span>Rule changes require admin approval.</span><button type="button">Check for updates</button></div>
        </SettingsSection>

        <SettingsSection icon={<Bot size={17} />} title="AI / Detection Settings" description="Configure the deterministic vision pipeline.">
          <div className="settings-fields"><label>OCR engine<select defaultValue="PaddleOCR PP-OCRv4"><option>PaddleOCR PP-OCRv4</option><option>Tesseract fallback</option></select></label><label>YOLO detection<select defaultValue="Enabled"><option>Enabled</option><option>Disabled</option></select></label><label>Detection confidence threshold<input type="number" defaultValue="65" min="0" max="100" /></label></div>
          <Toggle label="Multi-pass OCR" enabled={toggles.multiPass} onChange={() => toggle("multiPass")} /><div className="settings-security-note"><Lock size={13} /> Generative AI is disabled on the inspection path.</div>
        </SettingsSection>

        <SettingsSection icon={<FileArchive size={17} />} title="Evidence & Storage" description="Control accepted evidence and retention.">
          <div className="settings-fields"><label>Evidence retention period<select defaultValue="90 days"><option>30 days</option><option>90 days</option><option>1 year</option></select></label><label>Accepted file formats<input value="JPG, PNG, WEBP, PDF" readOnly /></label><label>Maximum upload size<select defaultValue="10 MB"><option>5 MB</option><option>10 MB</option><option>25 MB</option></select></label></div>
          <Toggle label="Auto-delete/archive expired evidence" enabled={toggles.autoArchive} onChange={() => toggle("autoArchive")} />
        </SettingsSection>

        <SettingsSection icon={<Search size={17} />} title="Security & Audit" description="Review account activity and session protection.">
          <div className="settings-audit-links"><button type="button">Login history <Check size={13} /></button><button type="button">Admin activity log <Check size={13} /></button><button type="button">Rule-change history <Check size={13} /></button><button type="button">Inspection modification history <Check size={13} /></button></div>
          <label className="settings-single-field">Session timeout<select defaultValue="30 minutes"><option>15 minutes</option><option>30 minutes</option><option>60 minutes</option></select></label>
        </SettingsSection>

        <SettingsSection icon={<Palette size={17} />} title="Appearance" description="Personalize your console workspace.">
          <div className="settings-fields"><label>Theme<select value={toggles.darkMode ? "Dark" : "Light"} onChange={() => toggle("darkMode")}><option>Light</option><option>Dark</option></select></label><label>Layout density<select defaultValue="Comfortable"><option>Compact</option><option>Comfortable</option></select></label><label>Language<select defaultValue="English"><option>English</option><option>Telugu</option></select></label><label>Date/time format<select defaultValue="20 Sep 2026, 10:24 AM"><option>20 Sep 2026, 10:24 AM</option><option>2026-09-20 10:24</option></select></label></div>
        </SettingsSection>
      </div>
    </div>
  );
}
