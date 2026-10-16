"use client";

import React, { useMemo } from "react";
import type { PipelineRun, SessionRow } from "@/modules/sessions/getSessions";
import type { Agent, Dataset } from "@/ui/layout/FilterContext";
import ActivityTable from "@/modules/activity/ActivityTable";
import { toActivityRows } from "@/modules/activity/activityRows";
import { AsciiFrame } from "./AsciiFrame";
import { FONT, T } from "./mono";

const PREVIEW_ROWS = 8;

/**
 * Mirrors the real panel's props exactly, requiredness included.
 *
 * The stub ignores every value, so it is tempting to mark them all optional —
 * but that makes the public type-check gate strictly weaker than the private
 * one: a call site that forgot a required prop would fail locally and pass the
 * sync, which is the wrong way round for a gate whose job is to catch drift.
 * Keep this in step with the real ActivityPanelProps.
 */
interface ActivityPanelProps {
  runs: PipelineRun[];
  sessions: SessionRow[];
  agents: Agent[];
  datasets: Dataset[];
  loading: boolean;
  error: boolean;
  partial: boolean;
  onViewFullLog: () => void;
  onOpenSession: (sessionId: string) => void;
}

export function ActivityPanel({ runs, agents, datasets, onViewFullLog }: ActivityPanelProps): React.ReactElement {
  const rows = useMemo(() => {
    const datasetNames = Object.fromEntries(datasets.map((d) => [d.id, d.name]));
    const userEmails = Object.fromEntries(agents.map((a) => [a.id, a.email.split("@")[0]]));
    return toActivityRows(runs, datasetNames, userEmails);
  }, [runs, agents, datasets]);
  const costUsd = rows.reduce((sum, r) => sum + (r.costUsd ?? 0), 0);

  return (
    <AsciiFrame
      label="Activity"
      meta={`${rows.length} operations · $${costUsd.toFixed(4)}`}
      minHeight={260}
    >
      <p style={{ ...FONT, margin: "0 0 8px", fontSize: 12, color: T.muted }}>
        Recent workspace activity, newest first. Cost is estimated from tokens.
      </p>
      <ActivityTable rows={rows.slice(0, PREVIEW_ROWS)} />
      {onViewFullLog && (
        <button
          onClick={onViewFullLog}
          style={{ ...FONT, alignSelf: "flex-start", marginTop: 10, background: "none", border: "none", padding: 0, color: T.lavender, fontSize: 12.5, cursor: "pointer" }}
        >
          View full log →{rows.length > PREVIEW_ROWS ? ` (${rows.length - PREVIEW_ROWS} more)` : ""}
        </button>
      )}
    </AsciiFrame>
  );
}
