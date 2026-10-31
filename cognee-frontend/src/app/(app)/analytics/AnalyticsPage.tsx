"use client";

import { useEffect, useState } from "react";
import { TrackPageView } from "@/modules/analytics";
import { useCogniInstance } from "@/modules/tenant/TenantProvider";
import { estimateCostUsd, getSessionStats, type SessionStats, type TimeRange } from "@/modules/sessions/getSessions";
import { AsciiFrame } from "@/app/(app)/dashboard/partials/redesign/AsciiFrame";
import { FONT, MONO_FONT, T } from "@/app/(app)/dashboard/partials/redesign/mono";

interface ModelCost { model: string; session_count: number; tokens_in: number; tokens_out: number }
interface UserCost { user_id: string; user_email: string | null; agent_type: string; session_count: number; tokens_in: number; tokens_out: number }

const RANGES: TimeRange[] = ["24h", "7d", "30d", "all"];

// The API prices tokens at $0 when it cannot resolve the model's list price, so
// every dollar figure here is derived from token counts (see estimateCostUsd).
function usd(tokensIn: number, tokensOut: number): string {
  return `$${estimateCostUsd(tokensIn, tokensOut).toFixed(4)}`;
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div style={{ minWidth: 140 }}>
      <div style={{ ...MONO_FONT, fontSize: 22, color: T.text }}>{value}</div>
      <div style={{ ...FONT, fontSize: 12, color: T.muted }}>{label}</div>
    </div>
  );
}

function Table({ head, rows }: { head: string[]; rows: (string | number)[][] }) {
  return (
    <table style={{ ...FONT, width: "100%", borderCollapse: "collapse", fontSize: 12.5 }}>
      <thead>
        <tr style={{ color: T.faint, textAlign: "left" }}>
          {head.map((h) => <th key={h} style={{ fontWeight: 500, padding: "8px 10px", borderBottom: `1px solid ${T.frame}` }}>{h}</th>)}
        </tr>
      </thead>
      <tbody>
        {rows.length === 0 ? (
          <tr><td colSpan={head.length} style={{ padding: 14, color: T.faint }}>No data in this range.</td></tr>
        ) : rows.map((row, i) => (
          <tr key={i} style={{ borderBottom: `1px solid ${T.frame}` }}>
            {row.map((cell, j) => <td key={j} style={{ padding: "8px 10px", ...(j > 0 ? MONO_FONT : {}) }}>{cell}</td>)}
          </tr>
        ))}
      </tbody>
    </table>
  );
}

export default function AnalyticsPage() {
  const { cogniInstance, isInitializing } = useCogniInstance();
  const [range, setRange] = useState<TimeRange>("30d");
  const [stats, setStats] = useState<SessionStats | null>(null);
  const [byModel, setByModel] = useState<ModelCost[]>([]);
  const [byUser, setByUser] = useState<UserCost[]>([]);

  useEffect(() => {
    if (isInitializing || !cogniInstance) return;
    const json = (path: string) => cogniInstance.fetch(path).then((r) => r.json()).catch(() => []);
    getSessionStats(cogniInstance, range).then(setStats);
    json(`/v1/sessions/cost-by-model?range=${range}`).then((d) => setByModel(Array.isArray(d) ? d : []));
    json(`/v1/sessions/cost-by-user-agent?range=${range}`).then((d) => setByUser(Array.isArray(d) ? d : []));
  }, [cogniInstance, isInitializing, range]);

  const modelTokensIn = byModel.reduce((s, m) => s + m.tokens_in, 0);
  const modelTokensOut = byModel.reduce((s, m) => s + m.tokens_out, 0);

  return (
    <div style={{ ...FONT, padding: "24px 32px 32px", display: "flex", flexDirection: "column", gap: 16, color: T.text }}>
      <TrackPageView page="Analytics" />
      <div style={{ display: "flex", alignItems: "flex-end", gap: 12, flexWrap: "wrap" }}>
        <div style={{ flex: 1 }}>
          <h1 style={{ margin: 0, fontSize: 20, fontWeight: 300 }}>Analytics</h1>
          <p style={{ margin: "5px 0 0", fontSize: 13, color: T.muted }}>
            Sessions, tokens and estimated spend, by model and by user.
          </p>
        </div>
        <div style={{ display: "inline-flex", border: `1px solid ${T.frame}` }}>
          {RANGES.map((r) => (
            <button
              key={r}
              onClick={() => setRange(r)}
              style={{ ...FONT, padding: "5px 12px", fontSize: 12, border: "none", cursor: "pointer", background: r === range ? T.purpleSoft : "transparent", color: r === range ? T.lavender : T.muted }}
            >
              {r}
            </button>
          ))}
        </div>
      </div>

      <AsciiFrame label="Summary">
        <div style={{ display: "flex", gap: 28, flexWrap: "wrap", paddingTop: 6 }}>
          <Stat label="sessions" value={String(stats?.sessions ?? 0)} />
          <Stat label="LLM tokens (by model)" value={(modelTokensIn + modelTokensOut).toLocaleString()} />
          <Stat label="estimated spend" value={usd(modelTokensIn, modelTokensOut)} />
          <Stat label="completed / failed / abandoned" value={`${stats?.completed ?? 0} / ${stats?.failed ?? 0} / ${stats?.abandoned ?? 0}`} />
        </div>
      </AsciiFrame>

      <AsciiFrame label="By model">
        <Table
          head={["Model", "Sessions", "Tokens in", "Tokens out", "Cost (est.)"]}
          rows={byModel.map((m) => [m.model, m.session_count, m.tokens_in.toLocaleString(), m.tokens_out.toLocaleString(), usd(m.tokens_in, m.tokens_out)])}
        />
      </AsciiFrame>

      <AsciiFrame label="By user and agent">
        <Table
          head={["User", "Agent", "Sessions", "Tokens", "Cost (est.)"]}
          rows={byUser.map((u) => [u.user_email ?? u.user_id, u.agent_type, u.session_count, (u.tokens_in + u.tokens_out).toLocaleString(), usd(u.tokens_in, u.tokens_out)])}
        />
      </AsciiFrame>
    </div>
  );
}
