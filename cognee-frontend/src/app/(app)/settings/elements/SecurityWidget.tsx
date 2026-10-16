"use client";

import { useState, type CSSProperties } from "react";
import { trackPageEvent } from "@/modules/analytics";
import isCloudEnvironment from "@/utils/isCloudEnvironment";
import styles from "../SettingsPage.module.css";
import { changeOwnPassword } from "@/modules/users/admin/adminUsers";

const MIN_PASSWORD_LENGTH = 8;

const INPUT_STYLE: CSSProperties = {
  width: "100%", minHeight: 40, padding: "8px 12px", borderRadius: 8, fontSize: 14,
  color: "#edecea", background: "rgba(255, 255, 255, 0.04)", border: "1px solid rgba(255, 255, 255, 0.18)",
};
const FIELD_LABEL_STYLE: CSSProperties = { display: "flex", flexDirection: "column", gap: 6, fontSize: 13 };

type Status = { kind: "ok" | "error"; text: string } | null;

function LocalPasswordForm() {
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [saving, setSaving] = useState(false);
  const [status, setStatus] = useState<Status>(null);
  const mismatch = confirm.length > 0 && password !== confirm;
  const valid = password.length >= MIN_PASSWORD_LENGTH && password === confirm;

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setSaving(true);
    setStatus(null);
    try {
      await changeOwnPassword(password);
      setPassword("");
      setConfirm("");
      setStatus({ kind: "ok", text: "Password changed. Use the new password next time you sign in." });
    } catch (error) {
      const message = error instanceof Error ? error.message : (error as { detail?: unknown })?.detail;
      setStatus({ kind: "error", text: typeof message === "string" ? message : "Could not change the password." });
    } finally {
      setSaving(false);
    }
  }

  return (
    <form onSubmit={submit} style={{ display: "flex", flexDirection: "column", gap: 12, maxWidth: 352, marginTop: 12 }}>
      <label style={FIELD_LABEL_STYLE}>
        New password
        <input type="password" autoComplete="new-password" value={password} style={INPUT_STYLE}
          onChange={(e) => setPassword(e.currentTarget.value)} />
        <span className={styles.subtitle} style={{ fontSize: 12 }}>At least {MIN_PASSWORD_LENGTH} characters</span>
      </label>
      <label style={FIELD_LABEL_STYLE}>
        Confirm new password
        <input type="password" autoComplete="new-password" value={confirm} style={INPUT_STYLE}
          aria-invalid={mismatch} onChange={(e) => setConfirm(e.currentTarget.value)} />
        {mismatch && <span role="alert" style={{ fontSize: 12, color: "#FF8A8A" }}>Passwords do not match</span>}
      </label>
      <button type="submit" className={styles.logout} disabled={!valid || saving}
        style={{ alignSelf: "flex-start", marginTop: 0, cursor: valid && !saving ? "pointer" : "not-allowed", opacity: valid && !saving ? 1 : 0.5 }}>
        {saving ? "Changing…" : "Change password"}
      </button>
      {status && (
        <p role={status.kind === "error" ? "alert" : "status"} style={{ margin: 0, fontSize: 13, color: status.kind === "error" ? "#FF8A8A" : "#22C55E" }}>
          {status.text}
        </p>
      )}
    </form>
  );
}

export default function SecurityWidget() {
  const cloud = isCloudEnvironment();

  return (
    <section className={styles.card} aria-labelledby="security-heading">
      <h2 id="security-heading">Security</h2>
      <p className={styles.subtitle}>Manage your account security and session</p>
      <div className={styles.section}>
        <h3 className={styles.label}>Password</h3>
        {cloud ? (
          <p className={styles.subtitle}>Your password is managed by your authentication provider.</p>
        ) : (
          <LocalPasswordForm />
        )}
      </div>
      <div className={styles.section}>
        <h3 className={styles.label}>Session</h3>
        <p className={styles.subtitle}>Sign out of your account on this device.</p>
        <a
          href={cloud ? "/api/signout" : "/api/local-signout"}
          className={styles.logout}
          onClick={() => trackPageEvent({ pageName: "Settings", eventName: "sign_out" })}
        >
          Log out
        </a>
      </div>
    </section>
  );
}
