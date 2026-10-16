"use client";

import React, { useMemo } from "react";
import type { PipelineRun, SessionRow } from "@/modules/sessions/getSessions";
import { estimateCostUsd, tokensAvoided } from "@/modules/sessions/getSessions";
import type { TenantHourlyCosts } from "@/modules/billing/getTenantHourlyCosts";
import { AsciiFrame } from "./AsciiFrame";
import { FONT, MONO_FONT, T } from "./mono";
import { RangeToggle, type DashRange } from "./RangeToggle";

interface CostPanelProps {
  sessions: SessionRow[];
  runs: PipelineRun[];
  balanceUsd: number | null;
  range: DashRange;
  onRangeChange: (range: DashRange) => void;
  hourlyCosts?: TenantHourlyCosts | null;
  onViewBreakdown?: () => void;
  // Unused by the notice, but declared: OverviewPage syncs and passes them, and
  // a stub whose props lag the real panel fails the synced type-check gate.
  updatedAt: number;
  loading: boolean;
  runsTruncated: boolean;
  sessionsTruncated: boolean;
}

const DAY_MS = 24 * 60 * 60 * 1000;
const RANGE_DAYS: Record<string, number> = { "24h": 1, "7d": 7, "30d": 30 };

/** Self-hosted cost view: there is no billing balance, so spend is estimated
 *  from the token counts the API records on each run, bucketed per day. */
export function CostPanel({ runs, range, onRangeChange, onViewBreakdown }: CostPanelProps): React.ReactElement {
  const { buckets, totalTokens, totalUsd } = useMemo(() => {
    const days = RANGE_DAYS[range] ?? 7;
    const now = Date.now();
    const start = now - days * DAY_MS;
    const bucketCount = days === 1 ? 24 : days;
    const bucketMs = (now - start) / bucketCount;
    const values = new Array(bucketCount).fill(0);
    let tokens = 0;
    for (const r of runs) {
      const at = Date.parse(r.started_at ?? r.created_at ?? "");
      const t = (r.tokens_in ?? 0) + (r.tokens_out ?? 0);
      if (!Number.isFinite(at) || at < start || t === 0) continue;
      values[Math.min(bucketCount - 1, Math.floor((at - start) / bucketMs))] += estimateCostUsd(t, 0);
      tokens += t;
    }
    return { buckets: values, totalTokens: tokens, totalUsd: estimateCostUsd(tokens, 0) };
  }, [runs, range]);
  const max = Math.max(...buckets, 0.0001);

  return (
    <AsciiFrame label="Cost" meta={<RangeToggle value={range} onChange={onRangeChange} />} minHeight={260}>
      <div style={{ display: "flex", gap: 24, alignItems: "baseline", flexWrap: "wrap" }}>
        <div>
          <div style={{ ...MONO_FONT, fontSize: 26, color: T.text }}>${totalUsd.toFixed(2)}</div>
          <div style={{ ...FONT, fontSize: 12, color: T.muted }}>estimated LLM spend</div>
        </div>
        <div>
          <div style={{ ...MONO_FONT, fontSize: 26, color: T.text }}>{(totalTokens / 1000).toFixed(1)}K</div>
          <div style={{ ...FONT, fontSize: 12, color: T.muted }}>tokens used</div>
        </div>
        <div>
          <div style={{ ...MONO_FONT, fontSize: 26, color: T.green }}>{(tokensAvoided(totalTokens) / 1000).toFixed(1)}K</div>
          <div style={{ ...FONT, fontSize: 12, color: T.muted }}>tokens saved · estimated</div>
        </div>
      </div>
      <div aria-label="Spend per period" style={{ display: "flex", alignItems: "flex-end", gap: 3, height: 90, marginTop: 18 }}>
        {buckets.map((v, i) => (
          <div
            key={i}
            title={`$${v.toFixed(4)}`}
            style={{ flex: 1, height: `${Math.max(2, (v / max) * 100)}%`, background: v > 0 ? T.lavender : T.chrome }}
          />
        ))}
      </div>
      {onViewBreakdown && (
        <button
          onClick={onViewBreakdown}
          style={{ ...FONT, alignSelf: "flex-start", marginTop: 10, background: "none", border: "none", padding: 0, color: T.lavender, fontSize: 12.5, cursor: "pointer" }}
        >
          View breakdown →
        </button>
      )}
    </AsciiFrame>
  );
}
