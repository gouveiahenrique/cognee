"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { TrackPageView } from "@/modules/analytics";
import { useCogniInstance } from "@/modules/tenant/TenantProvider";
import type { PipelineRun } from "@/ui/elements/AgentActivityTerminal";
import ActivityTable from "@/modules/activity/ActivityTable";
import { toActivityRows, toCsv } from "@/modules/activity/activityRows";
import { AsciiFrame } from "@/app/(app)/dashboard/partials/redesign/AsciiFrame";
import { FONT, T } from "@/app/(app)/dashboard/partials/redesign/mono";

// Same page size the cloud log loads: the endpoint returns a bare array with no
// total, so a full page means there may be older rows we did not fetch.
const PAGE_SIZE = 500;

const control: React.CSSProperties = {
  ...FONT,
  background: "rgba(255,255,255,0.06)",
  border: `1px solid ${T.frame}`,
  color: T.text,
  borderRadius: 6,
  padding: "6px 10px",
  fontSize: 12.5,
};

export default function ActivityPage() {
  const { cogniInstance, isInitializing } = useCogniInstance();
  const [runs, setRuns] = useState<PipelineRun[]>([]);
  const [datasetNames, setDatasetNames] = useState<Record<string, string>>({});
  const [userEmails, setUserEmails] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [updatedAt, setUpdatedAt] = useState<Date | null>(null);

  const [actionFilter, setActionFilter] = useState("all");
  const [statusFilter, setStatusFilter] = useState("all");
  const [userFilter, setUserFilter] = useState("all");
  const [hideNested, setHideNested] = useState(true);
  const [hideZeroTokens, setHideZeroTokens] = useState(false);

  const load = useCallback(async () => {
    if (!cogniInstance) return;
    setLoading(true);
    setError(null);
    try {
      const [runData, datasets, me] = await Promise.all([
        cogniInstance.fetch(`/v1/activity/pipeline-runs?limit=${PAGE_SIZE}`).then((r) => r.json()),
        cogniInstance.fetch("/v1/datasets").then((r) => r.json()).catch(() => []),
        cogniInstance.fetch("/v1/users/me").then((r) => r.json()).catch(() => null),
      ]);
      setRuns(Array.isArray(runData) ? runData : []);
      setDatasetNames(Object.fromEntries((Array.isArray(datasets) ? datasets : []).map((d: { id: string; name: string }) => [d.id, d.name])));
      // Admins can resolve every user's email; members fall back to their own.
      const users = me?.is_superuser
        ? await cogniInstance.fetch("/v1/users/admin").then((r) => r.json()).catch(() => [])
        : me ? [me] : [];
      setUserEmails(Object.fromEntries(users.map((u: { id: string; email: string }) => [u.id, u.email.split("@")[0]])));
      setUpdatedAt(new Date());
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not load activity");
    } finally {
      setLoading(false);
    }
  }, [cogniInstance]);

  useEffect(() => {
    if (!isInitializing) load();
  }, [isInitializing, load]);

  const allRows = useMemo(
    () => toActivityRows(runs, datasetNames, userEmails, !hideNested),
    [runs, datasetNames, userEmails, hideNested],
  );
  const options = useMemo(() => ({
    actions: [...new Set(allRows.map((r) => r.action))].sort(),
    statuses: [...new Set(allRows.map((r) => r.status))].sort(),
    users: [...new Set(allRows.map((r) => r.user))].sort(),
  }), [allRows]);
  const rows = allRows.filter((r) =>
    (actionFilter === "all" || r.action === actionFilter) &&
    (statusFilter === "all" || r.status === statusFilter) &&
    (userFilter === "all" || r.user === userFilter) &&
    (!hideZeroTokens || (r.tokens ?? 0) > 0),
  );
  const totalCost = rows.reduce((sum, r) => sum + (r.costUsd ?? 0), 0);

  function exportCsv() {
    const blob = new Blob([toCsv(rows)], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `cognee-activity-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <div style={{ ...FONT, padding: "24px 32px 32px", display: "flex", flexDirection: "column", gap: 16, color: T.text }}>
      <TrackPageView page="Activity" />
      <div>
        <h1 style={{ margin: 0, fontSize: 20, fontWeight: 300 }}>Activity</h1>
        <p style={{ margin: "5px 0 0", fontSize: 13, color: T.muted }}>
          Pipeline runs and memory operations across your workspace. Duration and tokens are recorded where available; cost is estimated.
        </p>
      </div>

      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
        <select aria-label="Action" style={control} value={actionFilter} onChange={(e) => setActionFilter(e.target.value)}>
          <option value="all">All actions</option>
          {options.actions.map((a) => <option key={a} value={a}>{a}</option>)}
        </select>
        <select aria-label="Status" style={control} value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}>
          <option value="all">All statuses</option>
          {options.statuses.map((s) => <option key={s} value={s}>{s}</option>)}
        </select>
        <select aria-label="User" style={control} value={userFilter} onChange={(e) => setUserFilter(e.target.value)}>
          <option value="all">All users</option>
          {options.users.map((u) => <option key={u} value={u}>{u}</option>)}
        </select>
        <label style={{ fontSize: 12.5, color: T.muted, display: "flex", gap: 6, alignItems: "center" }}>
          <input type="checkbox" checked={hideNested} onChange={(e) => setHideNested(e.target.checked)} /> hide nested
        </label>
        <label style={{ fontSize: 12.5, color: T.muted, display: "flex", gap: 6, alignItems: "center" }}>
          <input type="checkbox" checked={hideZeroTokens} onChange={(e) => setHideZeroTokens(e.target.checked)} /> hide 0 tokens
        </label>
        <span style={{ flex: 1 }} />
        <span style={{ fontSize: 12, color: T.faint }}>
          {updatedAt ? `Updated ${updatedAt.toLocaleTimeString()}` : ""}
        </span>
        <button style={{ ...control, cursor: "pointer" }} onClick={load} disabled={loading}>{loading ? "Loading…" : "Refresh"}</button>
        <button style={{ ...control, cursor: "pointer" }} onClick={exportCsv} disabled={!rows.length}>Export CSV</button>
      </div>

      {runs.length >= PAGE_SIZE && (
        <div style={{ fontSize: 12, color: T.amber }}>
          Partial view: showing the newest {PAGE_SIZE} runs and operations. Filters only apply to what is loaded.
        </div>
      )}
      {error && <div style={{ fontSize: 13, color: T.red }}>{error}</div>}

      <AsciiFrame label={`${rows.length} events`} meta={`$${totalCost.toFixed(4)} est.`}>
        <ActivityTable rows={rows} emptyText={loading ? "Loading…" : "No activity matches these filters."} />
      </AsciiFrame>
    </div>
  );
}
