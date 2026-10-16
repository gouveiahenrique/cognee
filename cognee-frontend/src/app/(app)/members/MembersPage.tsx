"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { notifications } from "@mantine/notifications";
import { TrackPageView } from "@/modules/analytics";
import getMe, { type Me } from "@/modules/users/getMe";
import {
  type AdminUser,
  type DatasetPermission,
  createUser,
  deleteUser,
  getPrincipalDatasets,
  grantDatasets,
  listUsers,
  setUserPassword,
  updateUser,
} from "@/modules/users/admin/adminUsers";
import localFetch from "@/modules/instances/localFetch";
import { FONT, T } from "@/app/(app)/dashboard/partials/redesign/mono";

const MIN_PASSWORD_LENGTH = 8;
const PERMISSIONS: DatasetPermission[] = ["read", "write", "delete", "share"];

const card: React.CSSProperties = {
  background: "rgba(255,255,255,0.06)",
  border: "1px solid rgba(255,255,255,0.1)",
  borderRadius: 12,
};
const input: React.CSSProperties = {
  ...FONT,
  background: "rgba(255,255,255,0.06)",
  border: "1px solid rgba(255,255,255,0.12)",
  borderRadius: 8,
  color: T.text,
  padding: "9px 12px",
  fontSize: 13,
  outline: "none",
};
const primaryBtn: React.CSSProperties = {
  ...FONT,
  background: T.lavender,
  color: "#000",
  border: "none",
  borderRadius: 8,
  padding: "8px 16px",
  fontSize: 13,
  fontWeight: 600,
  cursor: "pointer",
};
const ghostBtn: React.CSSProperties = {
  ...FONT,
  background: "transparent",
  color: T.muted,
  border: `1px solid ${T.frame}`,
  borderRadius: 6,
  padding: "4px 10px",
  fontSize: 12,
  cursor: "pointer",
};

function errorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (error && typeof error === "object" && "detail" in error) {
    const detail = (error as { detail: unknown }).detail;
    return typeof detail === "string" ? detail : JSON.stringify(detail);
  }
  return "Something went wrong";
}

function formatDate(value: string | null): string {
  if (!value) return "—";
  return new Date(value).toLocaleDateString(undefined, { day: "2-digit", month: "short", year: "2-digit" });
}

function Modal({ title, onClose, children }: { title: string; onClose: () => void; children: React.ReactNode }) {
  return (
    <div
      onClick={onClose}
      style={{ position: "fixed", inset: 0, zIndex: 500, background: "rgba(0,0,0,0.6)", display: "flex", alignItems: "center", justifyContent: "center", padding: 16 }}
    >
      <div
        role="dialog"
        aria-label={title}
        onClick={(e) => e.stopPropagation()}
        style={{ ...card, background: "#111", width: "100%", maxWidth: 440, padding: 24, display: "flex", flexDirection: "column", gap: 14 }}
      >
        <h2 style={{ ...FONT, margin: 0, fontSize: 18, fontWeight: 400, color: T.text }}>{title}</h2>
        {children}
      </div>
    </div>
  );
}

export default function MembersPage() {
  const [me, setMe] = useState<Me | null>(null);
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [loading, setLoading] = useState(true);
  const [forbidden, setForbidden] = useState(false);
  const [query, setQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState<"all" | "active" | "inactive">("all");

  const [showCreate, setShowCreate] = useState(false);
  const [passwordFor, setPasswordFor] = useState<AdminUser | null>(null);
  const [accessFor, setAccessFor] = useState<AdminUser | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const current = await getMe();
      setMe(current);
      if (!current.is_superuser) {
        setForbidden(true);
        return;
      }
      setUsers(await listUsers());
    } catch (error) {
      notifications.show({ title: "Could not load users", message: errorMessage(error), color: "red" });
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    return users.filter((u) =>
      (!q || u.email.toLowerCase().includes(q)) &&
      (statusFilter === "all" || (statusFilter === "active") === u.is_active),
    );
  }, [users, query, statusFilter]);

  async function run(action: () => Promise<void>, success: string) {
    try {
      await action();
      notifications.show({ title: success, message: "", color: "green" });
      await load();
    } catch (error) {
      notifications.show({ title: "Action failed", message: errorMessage(error), color: "red" });
    }
  }

  return (
    <div style={{ ...FONT, padding: "24px 32px 32px", display: "flex", flexDirection: "column", gap: 20, color: T.text }}>
      <TrackPageView page="Members" />
      <div>
        <h1 style={{ margin: 0, fontSize: 20, fontWeight: 300 }}>Team</h1>
        <p style={{ margin: "5px 0 0", fontSize: 13, color: T.muted }}>
          The people who can sign in to this instance, and which datasets each of them can use.
        </p>
      </div>

      {forbidden ? (
        <div style={{ ...card, padding: 24, fontSize: 14, color: T.muted }}>
          Only administrators can manage users. You are signed in as {me?.email}.
        </div>
      ) : (
        <section style={{ ...card, padding: 20, display: "flex", flexDirection: "column", gap: 14 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
            <div style={{ flex: 1, minWidth: 180 }}>
              <h2 style={{ margin: 0, fontSize: 16, fontWeight: 600 }}>
                {users.length} {users.length === 1 ? "User" : "Users"}
              </h2>
              <span style={{ fontSize: 12, color: T.faint }}>Administrators can manage users, settings and every dataset.</span>
            </div>
            <input aria-label="Search users" placeholder="Search users" value={query} onChange={(e) => setQuery(e.target.value)} style={{ ...input, width: 200 }} />
            <select aria-label="Filter by status" value={statusFilter} onChange={(e) => setStatusFilter(e.target.value as typeof statusFilter)} style={input}>
              <option value="all">All statuses</option>
              <option value="active">Active</option>
              <option value="inactive">Deactivated</option>
            </select>
            <button style={primaryBtn} onClick={() => setShowCreate(true)}>+ User</button>
          </div>

          <div style={{ overflowX: "auto" }}>
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
              <thead>
                <tr style={{ color: T.faint, textAlign: "left" }}>
                  {["Email", "Role", "Added", "Status", ""].map((h) => (
                    <th key={h} style={{ fontWeight: 500, padding: "8px 10px", borderBottom: `1px solid ${T.frame}` }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {loading && users.length === 0 ? (
                  <tr><td colSpan={5} style={{ padding: 16, color: T.faint }}>Loading…</td></tr>
                ) : visible.length === 0 ? (
                  <tr><td colSpan={5} style={{ padding: 16, color: T.faint }}>No users match.</td></tr>
                ) : visible.map((u) => {
                  const isMe = u.id === me?.id;
                  return (
                    <tr key={u.id} style={{ borderBottom: `1px solid ${T.frame}` }}>
                      <td style={{ padding: "10px" }}>
                        {u.email}{isMe && <span style={{ color: T.faint }}> (you)</span>}
                      </td>
                      <td style={{ padding: "10px" }}>{u.is_superuser ? "Admin" : "Member"}</td>
                      <td style={{ padding: "10px", color: T.muted }}>{formatDate(u.created_at)}</td>
                      <td style={{ padding: "10px" }}>
                        <span style={{ fontSize: 11, fontWeight: 600, letterSpacing: 0.4, color: u.is_active ? T.green : T.amber }}>
                          {u.is_active ? "ACTIVE" : "DEACTIVATED"}
                        </span>
                      </td>
                      <td style={{ padding: "10px", whiteSpace: "nowrap", textAlign: "right" }}>
                        <div style={{ display: "inline-flex", gap: 6 }}>
                          <button style={ghostBtn} onClick={() => setAccessFor(u)} disabled={u.is_superuser} title={u.is_superuser ? "Admins can access every dataset" : undefined}>
                            Datasets
                          </button>
                          <button style={ghostBtn} onClick={() => setPasswordFor(u)}>Password</button>
                          {!isMe && (
                            <>
                              <button
                                style={ghostBtn}
                                onClick={() => run(() => updateUser(u.id, { is_superuser: !u.is_superuser }), u.is_superuser ? "Admin rights removed" : "User is now an admin")}
                              >
                                {u.is_superuser ? "Make member" : "Make admin"}
                              </button>
                              <button
                                style={ghostBtn}
                                onClick={() => run(() => updateUser(u.id, { is_active: !u.is_active }), u.is_active ? "User deactivated" : "User reactivated")}
                              >
                                {u.is_active ? "Deactivate" : "Reactivate"}
                              </button>
                              <button
                                style={{ ...ghostBtn, color: T.red }}
                                onClick={() => {
                                  if (window.confirm(`Delete ${u.email}? Their API keys stop working. This cannot be undone.`)) {
                                    run(() => deleteUser(u.id), "User deleted");
                                  }
                                }}
                              >
                                Delete
                              </button>
                            </>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </section>
      )}

      {showCreate && (
        <CreateUserModal
          onClose={() => setShowCreate(false)}
          onCreated={async () => { setShowCreate(false); await load(); }}
        />
      )}
      {passwordFor && (
        <PasswordModal user={passwordFor} onClose={() => setPasswordFor(null)} />
      )}
      {accessFor && (
        <DatasetAccessModal user={accessFor} onClose={() => setAccessFor(null)} />
      )}
    </div>
  );
}

function CreateUserModal({ onClose, onCreated }: { onClose: () => void; onCreated: () => Promise<void> }) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [isAdmin, setIsAdmin] = useState(false);
  const [saving, setSaving] = useState(false);
  const valid = /.+@.+\..+/.test(email) && password.length >= MIN_PASSWORD_LENGTH;

  async function submit() {
    setSaving(true);
    try {
      await createUser({ email: email.trim(), password, isSuperuser: isAdmin });
      notifications.show({ title: "User created", message: `Share the password with ${email} through a secure channel.`, color: "green" });
      await onCreated();
    } catch (error) {
      notifications.show({ title: "Could not create user", message: errorMessage(error), color: "red" });
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal title="Add user" onClose={onClose}>
      <input aria-label="Email" placeholder="name@company.com" value={email} onChange={(e) => setEmail(e.target.value)} style={input} autoFocus />
      <input aria-label="Initial password" type="password" placeholder={`Initial password (min ${MIN_PASSWORD_LENGTH} characters)`} value={password} onChange={(e) => setPassword(e.target.value)} style={input} />
      <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13, color: T.muted }}>
        <input type="checkbox" checked={isAdmin} onChange={(e) => setIsAdmin(e.target.checked)} />
        Administrator (can manage users and see every dataset)
      </label>
      <div style={{ display: "flex", justifyContent: "flex-end", gap: 8 }}>
        <button style={ghostBtn} onClick={onClose}>Cancel</button>
        <button style={{ ...primaryBtn, opacity: valid && !saving ? 1 : 0.5 }} disabled={!valid || saving} onClick={submit}>
          {saving ? "Creating…" : "Create user"}
        </button>
      </div>
    </Modal>
  );
}

function PasswordModal({ user, onClose }: { user: AdminUser; onClose: () => void }) {
  const [password, setPassword] = useState("");
  const [saving, setSaving] = useState(false);

  async function submit() {
    setSaving(true);
    try {
      await setUserPassword(user.id, password);
      notifications.show({ title: "Password updated", message: user.email, color: "green" });
      onClose();
    } catch (error) {
      notifications.show({ title: "Could not set password", message: errorMessage(error), color: "red" });
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal title={`Set password for ${user.email}`} onClose={onClose}>
      <input aria-label="New password" type="password" placeholder={`New password (min ${MIN_PASSWORD_LENGTH} characters)`} value={password} onChange={(e) => setPassword(e.target.value)} style={input} autoFocus />
      <div style={{ display: "flex", justifyContent: "flex-end", gap: 8 }}>
        <button style={ghostBtn} onClick={onClose}>Cancel</button>
        <button style={{ ...primaryBtn, opacity: password.length >= MIN_PASSWORD_LENGTH && !saving ? 1 : 0.5 }} disabled={password.length < MIN_PASSWORD_LENGTH || saving} onClick={submit}>
          Save
        </button>
      </div>
    </Modal>
  );
}

function DatasetAccessModal({ user, onClose }: { user: AdminUser; onClose: () => void }) {
  const [datasets, setDatasets] = useState<{ id: string; name: string }[]>([]);
  const [granted, setGranted] = useState<Record<DatasetPermission, Set<string>>>({
    read: new Set(), write: new Set(), delete: new Set(), share: new Set(),
  });
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [permission, setPermission] = useState<DatasetPermission>("read");
  const [saving, setSaving] = useState(false);

  const loadGrants = useCallback(async () => {
    const [all, ...perUser] = await Promise.all([
      localFetch("/v1/datasets").then((r) => r.json()),
      ...PERMISSIONS.map((p) => getPrincipalDatasets(user.id, p).catch(() => [])),
    ]);
    setDatasets(Array.isArray(all) ? all : []);
    setGranted(Object.fromEntries(PERMISSIONS.map((p, i) => [p, new Set(perUser[i].map((d) => d.id))])) as Record<DatasetPermission, Set<string>>);
  }, [user.id]);

  useEffect(() => {
    loadGrants().catch((error) => notifications.show({ title: "Could not load datasets", message: errorMessage(error), color: "red" }));
  }, [loadGrants]);

  async function submit() {
    setSaving(true);
    try {
      await grantDatasets(user.id, permission, [...selected]);
      notifications.show({ title: `Granted ${permission}`, message: `${selected.size} dataset(s) for ${user.email}`, color: "green" });
      setSelected(new Set());
      await loadGrants();
    } catch (error) {
      notifications.show({ title: "Could not grant access", message: errorMessage(error), color: "red" });
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal title={`Dataset access — ${user.email}`} onClose={onClose}>
      <p style={{ margin: 0, fontSize: 12, color: T.faint }}>
        Datasets you own. Tick the ones to share, pick a permission and grant it. Current grants are shown per dataset.
      </p>
      <div style={{ maxHeight: 260, overflowY: "auto", display: "flex", flexDirection: "column", gap: 6 }}>
        {datasets.length === 0 ? (
          <span style={{ fontSize: 13, color: T.faint }}>No datasets yet.</span>
        ) : datasets.map((d) => {
          const has = PERMISSIONS.filter((p) => granted[p].has(d.id));
          return (
            <label key={d.id} style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13 }}>
              <input
                type="checkbox"
                checked={selected.has(d.id)}
                onChange={(e) => {
                  const next = new Set(selected);
                  if (e.target.checked) next.add(d.id); else next.delete(d.id);
                  setSelected(next);
                }}
              />
              <span style={{ flex: 1 }}>{d.name}</span>
              <span style={{ fontSize: 11, color: has.length ? T.lavender : T.ghost }}>{has.length ? has.join(" · ") : "no access"}</span>
            </label>
          );
        })}
      </div>
      <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, alignItems: "center" }}>
        <select aria-label="Permission" value={permission} onChange={(e) => setPermission(e.target.value as DatasetPermission)} style={input}>
          {PERMISSIONS.map((p) => <option key={p} value={p}>{p}</option>)}
        </select>
        <button style={ghostBtn} onClick={onClose}>Close</button>
        <button style={{ ...primaryBtn, opacity: selected.size && !saving ? 1 : 0.5 }} disabled={!selected.size || saving} onClick={submit}>
          Grant
        </button>
      </div>
    </Modal>
  );
}
