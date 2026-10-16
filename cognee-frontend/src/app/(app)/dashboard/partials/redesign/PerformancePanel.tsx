"use client";

import React from "react";
import { scoreColor } from "@/modules/memoryCoverage/coverage";
import { AsciiFrame } from "./AsciiFrame";
import { FONT, MONO_FONT, T } from "./mono";

/** A dataset's coverage score; `pct` is null until it has been analysed. */
export interface TopicScore { id: string; name: string; pct: number | null }

interface PerformancePanelProps {
  recallPct: number | null;
  topics: TopicScore[];
  // Unused by the notice, but declared: OverviewPage syncs and passes these, and
  // a stub whose props lag the real panel fails the synced type-check gate.
  unavailable: boolean;
  loading: boolean;
  datasetTotal: number;
  onUpload?: () => void;
  onViewAnalysis?: (datasetId?: string) => void;
  onRetry?: () => void;
  onViewDataset?: (datasetId: string) => void;
}

const MAX_TOPICS = 4;

export function PerformancePanel({ recallPct, topics, onUpload, onViewAnalysis }: PerformancePanelProps): React.ReactElement {
  const shown = topics.slice(0, MAX_TOPICS);
  const anyScored = topics.some((t) => t.pct != null);

  return (
    <AsciiFrame label="Memory Coverage" meta="LLM-as-judge" minHeight={260}>
      <div style={{ display: "flex", alignItems: "baseline", gap: 10 }}>
        <span style={{ ...MONO_FONT, fontSize: 26, color: scoreColor(recallPct) }}>
          {recallPct == null ? "—" : `${Math.round(recallPct)}%`}
        </span>
        <span style={{ ...FONT, fontSize: 12, color: T.muted }}>real recall</span>
      </div>

      <div style={{ ...FONT, fontSize: 12, color: T.faint, margin: "12px 0 6px" }}>Coverage by dataset</div>
      <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
        {shown.length === 0 ? (
          <span style={{ ...FONT, fontSize: 13, color: T.faint }}>No datasets yet.</span>
        ) : shown.map((t) => (
          <button
            key={t.id ?? t.name}
            onClick={() => onViewAnalysis?.(t.id)}
            style={{ ...FONT, display: "flex", justifyContent: "space-between", background: "none", border: "none", padding: "4px 0", cursor: "pointer", color: T.text, fontSize: 13 }}
          >
            <span>{t.name}</span>
            <span style={{ ...MONO_FONT, color: scoreColor(t.pct) }}>{t.pct == null ? "—" : `${Math.round(t.pct)}%`}</span>
          </button>
        ))}
      </div>

      {!anyScored && shown.length > 0 && (
        <p style={{ ...FONT, fontSize: 12, color: T.faint, margin: "8px 0 0" }}>Not scored yet. Run an analysis to see coverage per dataset.</p>
      )}
      {topics.length > MAX_TOPICS && (
        <p style={{ ...FONT, fontSize: 12, color: T.faint, margin: "8px 0 0" }}>
          Showing {MAX_TOPICS} of {topics.length} datasets. Real recall averages every scored dataset.
        </p>
      )}

      <div style={{ display: "flex", gap: 16, marginTop: "auto", paddingTop: 12 }}>
        {onViewAnalysis && (
          <button onClick={() => onViewAnalysis()} style={{ ...FONT, background: "none", border: "none", padding: 0, color: T.lavender, fontSize: 12.5, cursor: "pointer" }}>
            View analysis →
          </button>
        )}
        {onUpload && (
          <button onClick={onUpload} style={{ ...FONT, background: "none", border: "none", padding: 0, color: T.muted, fontSize: 12.5, cursor: "pointer" }}>
            Upload data
          </button>
        )}
      </div>
    </AsciiFrame>
  );
}
