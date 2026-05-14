/**
 * Shared utilities for context compaction.
 */

/**
 * Filter messages to only include those after the latest compaction boundary.
 *
 * Uses ID-based filtering instead of position-based slicing because the
 * createdAt column has second precision (stored as Unix seconds). When
 * the compaction summary's timestamp rounds to a full second earlier,
 * it can sort before pre-compaction messages in the createdAt-ordered array,
 * causing slice() to include everything.
 *
 * Since message IDs are auto-incrementing, the compaction summary always has
 * a higher ID than all pre-compaction messages. The user message that triggered
 * compaction processing (and its placeholder) were inserted before the compaction
 * summary, so they have lower IDs — but they should be included.
 *
 * Strategy: find the last user message (by ID) inserted before the compaction
 * summary. This is the message whose processing triggered compaction. Include it,
 * all subsequent non-summary messages, and the compaction summary itself.
 */
/**
 * Identify compaction summary messages that were inserted mid-turn (i.e. during
 * an active assistant turn rather than between turns).  These summaries are
 * stored in the DB for LLM history but should be hidden from the UI because the
 * turn's assistant message already contains an inline compaction indicator.
 *
 * A summary is "mid-turn" when its createdAt timestamp is >= the triggering user
 * message's createdAt (both timestamps share the same second, or the summary is
 * strictly later — either way the summary landed inside the same turn).
 */
export function getMidTurnCompactionSummaryIds<
  T extends {
    id: number;
    role: string;
    createdAt: Date;
    isCompactionSummary: boolean | null;
  },
>(messages: T[]): Set<number> {
  const hiddenIds = new Set<number>();

  for (const summary of messages.filter((m) => m.isCompactionSummary)) {
    // If a user message exists after this summary, a new turn has already started —
    // the compaction is between-turn (manual /compact or auto between-turn). Always show.
    const hasUserMessageAfterSummary = messages.some(
      (m) => m.role === "user" && m.id > summary.id,
    );
    if (hasUserMessageAfterSummary) {
      continue;
    }

    // No user message after the summary and no subsequent assistant message either —
    // this is a terminal manual /compact. Always show.
    const hasAssistantMessageAfterSummary = messages.some(
      (m) => m.role === "assistant" && !m.isCompactionSummary && m.id > summary.id,
    );
    if (!hasAssistantMessageAfterSummary) {
      continue;
    }

    // Has a subsequent assistant message but no subsequent user message:
    // this is a mid-turn auto compaction. Apply the timestamp guard.
    const triggeringUserMessage = [...messages]
      .filter((m) => m.role === "user" && m.id < summary.id)
      .sort((a, b) => b.id - a.id)[0];

    if (!triggeringUserMessage) {
      continue;
    }

    if (
      summary.createdAt.getTime() >= triggeringUserMessage.createdAt.getTime()
    ) {
      hiddenIds.add(summary.id);
    }
  }

  return hiddenIds;
}

export function getPostCompactionMessages<
  T extends { id: number; role: string; isCompactionSummary: boolean | null },
>(messages: T[]): T[] {
  // Find the latest compaction summary by highest ID
  const latestSummary = messages
    .filter((m) => m.isCompactionSummary)
    .sort((a, b) => b.id - a.id)[0];

  if (!latestSummary) {
    return messages;
  }

  // Find the last user message (by ID) before the compaction summary.
  // This is the message that triggered compaction processing.
  const triggeringUserMsg = messages
    .filter((m) => m.role === "user" && m.id < latestSummary.id)
    .sort((a, b) => b.id - a.id)[0];

  if (triggeringUserMsg) {
    // Include: the compaction summary + all messages with id >= triggering user message
    // (excluding older compaction summaries from prior compactions)
    return messages.filter(
      (m) =>
        m.id === latestSummary.id ||
        (m.id >= triggeringUserMsg.id && !m.isCompactionSummary),
    );
  }

  // No user message before compaction — include everything from summary onward by ID
  return messages.filter((m) => m.id >= latestSummary.id);
}
