import { CogneeInstance } from "../instances/types";

/**
 * Bridge one chat session into the permanent graph: POST /v1/improve with the
 * session id, run in the background on the server.
 *
 * Recall records each Q&A turn in the session cache but never runs improve —
 * only remember() and an explicit improve() do. The Search page calls this
 * when a conversation ends (switch, new chat, leaving the page) so its turns,
 * feedback and lessons reach the graph. Improve is watermark-gated per
 * session, so a repeated call with nothing new is cheap.
 *
 * Fire-and-forget: failures are logged, never surfaced to the user.
 */
export default function improveSession(
  instance: CogneeInstance,
  sessionId: string,
  datasetId: string,
): void {
  instance
    .fetch("/v1/improve", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        dataset_id: datasetId,
        session_ids: [sessionId],
        run_in_background: true,
      }),
      // Lets the request outlive the page when sent from pagehide.
      keepalive: true,
    })
    .catch((err) => console.error("Failed to improve session:", err));
}
