"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { notifications } from "@mantine/notifications";
import { TrackPageView } from "@/modules/analytics";
import { useCogniInstance } from "@/modules/tenant/TenantProvider";
import { useFilter } from "@/ui/layout/FilterContext";
import { type DatasetCoverage, getCoverage, runCoverage, scoreColor } from "@/modules/memoryCoverage/coverage";
import { AsciiFrame } from "@/app/(app)/dashboard/partials/redesign/AsciiFrame";
import { FONT, MONO_FONT, T } from "@/app/(app)/dashboard/partials/redesign/mono";

const POLL_MS = 3000;

const button: React.CSSProperties = {
  ...FONT,
  borderRadius: 8,
  padding: "8px 16px",
  fontSize: 13,
  fontWeight: 600,
  cursor: "pointer",
};

function errorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (error && typeof error === "object" && "detail" in error) return String((error as { detail: unknown }).detail);
  return "Something went wrong";
}

function Score({ value, size = 13 }: { value: number | null; size?: number }) {
  return (
    <span style={{ ...MONO_FONT, fontSize: size, color: scoreColor(value) }}>
      {value == null ? "—" : `${Math.round(value)}%`}
    </span>
  );
}

export default function MemoryCoveragePage() {
  const { cogniInstance, isInitializing } = useCogniInstance();
  const { datasets } = useFilter();
  const router = useRouter();
  const searchParams = useSearchParams();
  const [coverage, setCoverage] = useState<Record<string, DatasetCoverage | null>>({});
  const [selectedId, setSelectedId] = useState<string | null>(searchParams.get("dataset"));
  const [starting, setStarting] = useState(false);
  const [expanded, setExpanded] = useState<number | null>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const selected = datasets.find((d) => d.id === selectedId) ?? datasets[0] ?? null;
  const current = selected ? coverage[selected.id] : undefined;

  const loadOne = useCallback(async (datasetId: string) => {
    if (!cogniInstance) return;
    try {
      const result = await getCoverage(cogniInstance, datasetId);
      setCoverage((prev) => ({ ...prev, [datasetId]: result }));
    } catch {
      setCoverage((prev) => ({ ...prev, [datasetId]: null }));
    }
  }, [cogniInstance]);

  useEffect(() => {
    if (isInitializing || !cogniInstance) return;
    datasets.forEach((d) => { void loadOne(d.id); });
  }, [isInitializing, cogniInstance, datasets, loadOne]);

  // Poll only while the selected dataset's run is in flight.
  useEffect(() => {
    if (pollRef.current) clearInterval(pollRef.current);
    if (selected && current?.status === "running") {
      pollRef.current = setInterval(() => { void loadOne(selected.id); }, POLL_MS);
    }
    return () => { if (pollRef.current) clearInterval(pollRef.current); };
  }, [selected, current?.status, loadOne]);

  async function startAnalysis() {
    if (!cogniInstance || !selected) return;
    setStarting(true);
    try {
      const started = await runCoverage(cogniInstance, selected.id);
      if (started.questions_total === 0) {
        notifications.show({ title: "Nothing to analyse yet", message: `Ask ${selected.name} some questions in Search first; analysis replays them.`, color: "yellow" });
      }
      await loadOne(selected.id);
    } catch (error) {
      notifications.show({ title: "Could not start analysis", message: errorMessage(error), color: "red" });
    } finally {
      setStarting(false);
    }
  }

  function select(datasetId: string) {
    setSelectedId(datasetId);
    setExpanded(null);
    router.replace(`/memory-gap-analysis?dataset=${datasetId}`);
  }

  const running = current?.status === "running";

  return (
    <div style={{ ...FONT, padding: "24px 32px 32px", display: "flex", flexDirection: "column", gap: 16, color: T.text }}>
      <TrackPageView page="Memory Coverage" />
      <div style={{ display: "flex", gap: 12, alignItems: "flex-end", flexWrap: "wrap" }}>
        <div style={{ flex: 1, minWidth: 260 }}>
          <h1 style={{ margin: 0, fontSize: 20, fontWeight: 300 }}>Memory Coverage</h1>
          <p style={{ margin: "5px 0 0", fontSize: 13, color: T.muted }}>
            Every question you asked, scored by how well memory answers it. Low scores are your gaps — add the missing knowledge to fix them.
          </p>
        </div>
        <button style={{ ...button, background: "transparent", color: T.text, border: `1px solid ${T.frame}` }} onClick={() => router.push("/datasets")}>
          Add memory
        </button>
        <button
          style={{ ...button, background: T.lavender, color: "#000", border: "none", opacity: !selected || running || starting ? 0.5 : 1 }}
          disabled={!selected || running || starting}
          onClick={startAnalysis}
          title="Replays this dataset's past questions and scores each answer. Uses LLM calls."
        >
          {running ? "Analysing…" : starting ? "Starting…" : "Run analysis"}
        </button>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "minmax(200px, 260px) 1fr", gap: 16 }} className="max-sm:!grid-cols-1">
        <AsciiFrame label="Datasets">
          {datasets.length === 0 ? (
            <span style={{ fontSize: 13, color: T.faint }}>No datasets yet.</span>
          ) : datasets.map((d) => {
            const c = coverage[d.id];
            const active = d.id === selected?.id;
            return (
              <button
                key={d.id}
                onClick={() => select(d.id)}
                style={{ ...FONT, display: "flex", justifyContent: "space-between", gap: 8, width: "100%", textAlign: "left", padding: "8px 10px", border: "none", cursor: "pointer", background: active ? T.purpleSoft : "transparent", color: active ? T.lavender : T.text, fontSize: 13 }}
              >
                <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{d.name}</span>
                {c?.status === "running" ? <span style={{ fontSize: 11, color: T.amber }}>running</span> : <Score value={c?.score ?? null} />}
              </button>
            );
          })}
        </AsciiFrame>

        <AsciiFrame
          label={selected ? selected.name : "Coverage"}
          meta={current?.finished_at ? `Last run ${new Date(current.finished_at).toLocaleString()}` : undefined}
          minHeight={320}
        >
          {!selected ? null : current === undefined ? (
            <span style={{ fontSize: 13, color: T.faint }}>Loading…</span>
          ) : current === null ? (
            <p style={{ fontSize: 13, color: T.muted }}>
              {selected.name} has not been scored yet. Run analysis replays every question it was asked and scores how well memory answers.
            </p>
          ) : running ? (
            <p style={{ fontSize: 13, color: T.muted }}>
              Replaying {current.questions_total} question{current.questions_total === 1 ? "" : "s"} and scoring each answer. This takes about a minute per few questions; the page updates when it finishes.
            </p>
          ) : current.status === "errored" ? (
            <p style={{ fontSize: 13, color: T.red }}>The last analysis failed: {current.error ?? "unknown error"}. Run it again.</p>
          ) : current.questions_total === 0 ? (
            <p style={{ fontSize: 13, color: T.muted }}>
              No questions were asked against {selected.name} yet, so there is nothing to replay. Ask it something in Search, then run the analysis.
            </p>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
              <div style={{ display: "flex", gap: 28, alignItems: "baseline", flexWrap: "wrap" }}>
                <div>
                  <Score value={current.score} size={30} />
                  <div style={{ fontSize: 12, color: T.muted }}>real recall</div>
                </div>
                <div>
                  <div style={{ ...MONO_FONT, fontSize: 30 }}>{current.questions_scored}/{current.questions_total}</div>
                  <div style={{ fontSize: 12, color: T.muted }}>questions scored</div>
                </div>
                <div>
                  <div style={{ ...MONO_FONT, fontSize: 30, color: T.red }}>
                    {current.questions.filter((q) => q.score != null && q.score < 50).length}
                  </div>
                  <div style={{ fontSize: 12, color: T.muted }}>gaps (score under 50%)</div>
                </div>
              </div>
              {current.questions_available > current.questions_total && (
                <p style={{ margin: 0, fontSize: 12, color: T.faint }}>
                  {current.questions_available - current.questions_total} question(s) were asked since this run. Run the analysis again to include them.
                </p>
              )}
              <div style={{ display: "flex", flexDirection: "column" }}>
                {current.questions.map((q, i) => (
                  <div key={i} style={{ borderTop: `1px solid ${T.frame}`, padding: "10px 4px" }}>
                    <button
                      onClick={() => setExpanded(expanded === i ? null : i)}
                      style={{ ...FONT, display: "flex", gap: 12, width: "100%", alignItems: "baseline", background: "none", border: "none", padding: 0, cursor: "pointer", textAlign: "left", color: T.text, fontSize: 13 }}
                    >
                      <span style={{ width: 44, flexShrink: 0 }}><Score value={q.score} /></span>
                      <span style={{ flex: 1 }}>{q.question}</span>
                      <span style={{ color: T.faint, fontSize: 11 }}>{expanded === i ? "▾" : "▸"}</span>
                    </button>
                    {q.missing && (
                      <div style={{ marginLeft: 56, marginTop: 4, fontSize: 12, color: T.amber }}>Missing: {q.missing}</div>
                    )}
                    {expanded === i && (
                      <div style={{ marginLeft: 56, marginTop: 8, display: "flex", flexDirection: "column", gap: 6, fontSize: 12.5, color: T.muted }}>
                        {q.reason && <div><strong style={{ color: T.text }}>Why: </strong>{q.reason}</div>}
                        <div style={{ whiteSpace: "pre-wrap" }}><strong style={{ color: T.text }}>Memory answered: </strong>{q.answer || "(no answer)"}</div>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}
        </AsciiFrame>
      </div>
    </div>
  );
}
