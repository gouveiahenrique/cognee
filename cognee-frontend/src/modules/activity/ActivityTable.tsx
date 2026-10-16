"use client";

import type { ActivityRow } from "./activityRows";
import { formatCost, formatDuration, statusColor } from "./activityRows";
import { FONT, MONO_FONT, T } from "@/app/(app)/dashboard/partials/redesign/mono";

const COLUMNS = ["Timestamp", "Action", "Status", "Duration", "User", "Dataset", "Tokens", "Cost (est.)"] as const;

export default function ActivityTable({ rows, emptyText = "No activity yet." }: { rows: ActivityRow[]; emptyText?: string }) {
  return (
    <div style={{ overflowX: "auto" }}>
      <table style={{ ...FONT, width: "100%", borderCollapse: "collapse", fontSize: 12.5, color: T.text }}>
        <thead>
          <tr style={{ textAlign: "left", color: T.faint }}>
            {COLUMNS.map((c) => (
              <th key={c} style={{ fontWeight: 500, padding: "8px 10px", borderBottom: `1px solid ${T.frame}`, whiteSpace: "nowrap" }}>{c}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.length === 0 ? (
            <tr><td colSpan={COLUMNS.length} style={{ padding: 16, color: T.faint }}>{emptyText}</td></tr>
          ) : rows.map((r) => (
            <tr key={r.id} style={{ borderBottom: `1px solid ${T.frame}` }}>
              <td style={{ padding: "8px 10px", whiteSpace: "nowrap", color: T.muted }}>
                {r.timestamp ? new Date(r.timestamp).toLocaleString(undefined, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" }) : "—"}
              </td>
              <td style={{ padding: "8px 10px", whiteSpace: "nowrap" }}>
                {r.action}
                {r.background && <span style={{ marginLeft: 6, fontSize: 10, color: T.lavender }}>BG</span>}
              </td>
              <td style={{ padding: "8px 10px", fontSize: 11, fontWeight: 600, letterSpacing: 0.3, color: statusColor(r.status) }}>{r.status}</td>
              <td style={{ ...MONO_FONT, padding: "8px 10px" }}>{formatDuration(r.durationS)}</td>
              <td style={{ padding: "8px 10px", whiteSpace: "nowrap" }}>{r.user}</td>
              <td style={{ padding: "8px 10px", whiteSpace: "nowrap", color: T.muted }}>{r.dataset}</td>
              <td style={{ ...MONO_FONT, padding: "8px 10px" }}>{r.tokens == null ? "—" : r.tokens.toLocaleString()}</td>
              <td style={{ ...MONO_FONT, padding: "8px 10px" }}>{formatCost(r.costUsd)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
