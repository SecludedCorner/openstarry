/**
 * Guide adapter — bridges `IGuide.getSystemPrompt()` into the execution loop's
 * `ChatRequest.messages` array via an explicit `{ role: "system" }` Message.
 *
 * **Cycle 03-33 F-CY32 Option 2** (Master Ratification Batch 27 Item #13;
 * cycle 03-32 R3 §4.4 D-§A6.4 23/0 UNANIMOUS):
 *
 *   Prior behaviour passed the guide's persona through the top-level
 *   `ChatRequest.systemPrompt` field. For native API providers (Anthropic,
 *   OpenAI) the persona reached the model's system slot correctly; for CLI
 *   subprocess providers (`provider-claude-cli`) the persona was embedded
 *   into the prompt body via `collapseToPrompt`, where it competed with the
 *   hardcoded `--system-prompt ISOLATION_SYSTEM_PROMPT` CLI flag (Stream A
 *   evidence: plugin-path persona retention 1/5 vs tier-3 direct 5/5).
 *
 *   Option 2 routes the persona through `messages[0]` as an explicit system
 *   role entry instead. Effects per provider class:
 *     - Anthropic-class converters (`provider-claude/message-converter.ts`)
 *       extract `role: "system"` messages into the top-level `system` field
 *       (their canonical mapping; already supported).
 *     - OpenAI-class converters expect `role: "system"` in messages[] by
 *       design (canonical mapping).
 *     - `provider-claude-cli` `collapseToPrompt` emits the system-role
 *       message as a `System: <persona>` transcript line at the prompt-body
 *       head, before any User/Assistant lines — the natural transcript
 *       position. The hardcoded `--system-prompt ISOLATION_SYSTEM_PROMPT`
 *       CLI flag stays unchanged (CLAUDE.md isolation preserved).
 *
 *   This is the Option 2 wiring referenced in Batch 27 Item #13. Option 1
 *   (opt-in argv flag) and Option 3 (document as design boundary) remain
 *   unselected.
 *
 * @skandha vijnana (識蘊 — adapter bridge)
 */

import type { IGuide, Message } from "@openstarry/sdk";
import { generateId } from "@openstarry/shared";

/**
 * Build the `Message[]` that will be sent to a provider, prepending a
 * system-role Message constructed from the guide's persona when present.
 *
 * @param baseMessages context-assembled conversation messages (loop output of
 *   `contextManager.assembleContext`); MUST NOT contain a leading system role
 *   already (callers responsible for ensuring the conversation-side context
 *   manager did not introduce a competing persona).
 * @param persona the resolved persona text from `guide.getSystemPrompt()`, or
 *   `undefined` when no guide is registered for the session.
 * @param now optional clock for deterministic test timestamps; defaults to
 *   `Date.now()` for production callers.
 * @returns a new array (never mutates `baseMessages`). When `persona` is
 *   `undefined` or empty, returns `baseMessages` unchanged (no system message
 *   is prepended). When `persona` is non-empty, returns a fresh array whose
 *   first element is a freshly-stamped `role: "system"` Message followed by
 *   the original messages.
 */
export function applyGuideToMessages(
  baseMessages: readonly Message[],
  persona: string | undefined,
  now: () => number = Date.now,
): Message[] {
  if (persona == null || persona.length === 0) {
    return [...baseMessages];
  }
  const systemMessage: Message = {
    id: generateId(),
    role: "system",
    content: [{ type: "text", text: persona }],
    createdAt: now(),
  };
  return [systemMessage, ...baseMessages];
}

/**
 * Convenience: resolve a guide's persona (if a guide is provided) and apply
 * it to the messages array. Centralises the `await guide.getSystemPrompt()`
 * call site so callers do not have to duplicate the nullable-guide check.
 */
export async function resolvePersonaAndApply(
  baseMessages: readonly Message[],
  guide: IGuide | undefined,
  now: () => number = Date.now,
): Promise<Message[]> {
  if (!guide) return [...baseMessages];
  const persona = await guide.getSystemPrompt();
  return applyGuideToMessages(baseMessages, persona, now);
}
