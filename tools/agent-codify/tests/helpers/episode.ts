export function episode(
  id: string,
  taskLineageId: string,
  projectId: string,
  success: boolean | null = true
) {
  const source = (eventId: number) => ({ path: `/tmp/${id}.jsonl`, hash: `${id}-hash`, line: eventId, byte_offset: eventId * 10, state: "ok" });
  const evidence = (eventId: number, role: "user" | "assistant", eventType: string, text: string) => ({
    event_id: eventId,
    event_type: eventType,
    role,
    text,
    source: source(eventId)
  });
  return {
    schema_version: "transcript-episode/v1",
    episode_id: id + ":1:user_correction",
    transcript_id: id,
    native_session_id: id,
    task_lineage_id: taskLineageId,
    project_id: projectId,
    trigger: { type: "user_correction", event_id: 2 },
    context_before: [evidence(1, "assistant", "message", "Add a second abstraction.")],
    corrections: [evidence(2, "user", "user_correction", "Use the existing abstraction instead.")],
    actions_after: [evidence(3, "assistant", "message", "Updated the existing abstraction.")],
    outcomes: [{ event_id: 4, type: "test", outcome: success === true ? "success" : success === false ? "failure" : "unknown", text: success === true ? "Tests passed." : "No result was observed.", source: source(4) }],
    task_status: success === true ? "complete" : success === false ? "failed" : "unknown",
    source_event_ids: [1, 2, 3, 4],
    omitted: { events: 0, bytes: 0, tokens: 0, context_before: 0, actions_after: 0, outcomes: 0 }
  };
}
