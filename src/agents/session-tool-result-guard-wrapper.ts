import type { AgentMessage } from "@mariozechner/pi-agent-core";
import type { SessionManager } from "@mariozechner/pi-coding-agent";
import { getGlobalHookRunner } from "../plugins/hook-runner-global.js";
import {
  applyInputProvenanceToUserMessage,
  type InputProvenance,
} from "../sessions/input-provenance.js";
import {
  applyGroundingToToolResultMessage,
  stripGroundingFromDetails,
} from "./grounding-integration.js";
import { installSessionToolResultGuard } from "./session-tool-result-guard.js";

export type GuardedSessionManager = SessionManager & {
  /** Flush any synthetic tool results for pending tool calls. Idempotent. */
  flushPendingToolResults?: () => void;
};

/**
 * Compose multiple message transforms for persistence.
 * Applies input provenance and grounding metadata preservation.
 */
function composeMessageTransform(
  message: AgentMessage,
  inputProvenance?: InputProvenance,
): AgentMessage {
  // Apply input provenance for user messages
  let result = applyInputProvenanceToUserMessage(message, inputProvenance);
  // Apply grounding metadata preservation for tool results
  result = applyGroundingToToolResultMessage(result);
  return result;
}

/**
 * Transform tool result for persistence while preserving grounding metadata.
 * This runs the plugin hooks and ensures grounding data is serialized.
 */
function createToolResultTransform(
  hookRunner: ReturnType<typeof getGlobalHookRunner>,
  opts?: {
    agentId?: string;
    sessionKey?: string;
  },
): (
  message: AgentMessage,
  meta: { toolCallId?: string; toolName?: string; isSynthetic?: boolean },
) => AgentMessage {
  return (message, meta) => {
    // First apply plugin transforms
    let result = message;
    if (hookRunner?.hasHooks("tool_result_persist")) {
      const out = hookRunner.runToolResultPersist(
        {
          toolName: meta.toolName,
          toolCallId: meta.toolCallId,
          message,
          isSynthetic: meta.isSynthetic,
        },
        {
          agentId: opts?.agentId,
          sessionKey: opts?.sessionKey,
          toolName: meta.toolName,
          toolCallId: meta.toolCallId,
        },
      );
      result = out?.message ?? message;
    }

    // Then ensure grounding metadata is preserved
    result = applyGroundingToToolResultMessage(result);

    return result;
  };
}

/**
 * Apply the tool-result guard to a SessionManager exactly once and expose
 * a flush method on the instance for easy teardown handling.
 */
export function guardSessionManager(
  sessionManager: SessionManager,
  opts?: {
    agentId?: string;
    sessionKey?: string;
    inputProvenance?: InputProvenance;
    allowSyntheticToolResults?: boolean;
    allowedToolNames?: Iterable<string>;
  },
): GuardedSessionManager {
  if (typeof (sessionManager as GuardedSessionManager).flushPendingToolResults === "function") {
    return sessionManager as GuardedSessionManager;
  }

  const hookRunner = getGlobalHookRunner();
  const beforeMessageWrite = hookRunner?.hasHooks("before_message_write")
    ? (event: { message: AgentMessage }) => {
        return hookRunner.runBeforeMessageWrite(event, {
          agentId: opts?.agentId,
          sessionKey: opts?.sessionKey,
        });
      }
    : undefined;

  const toolResultTransform = createToolResultTransform(hookRunner, {
    agentId: opts?.agentId,
    sessionKey: opts?.sessionKey,
  });

  const guard = installSessionToolResultGuard(sessionManager, {
    transformMessageForPersistence: (message) =>
      composeMessageTransform(message, opts?.inputProvenance),
    transformToolResultForPersistence: toolResultTransform,
    allowSyntheticToolResults: opts?.allowSyntheticToolResults,
    allowedToolNames: opts?.allowedToolNames,
    beforeMessageWriteHook: beforeMessageWrite,
  });
  (sessionManager as GuardedSessionManager).flushPendingToolResults = guard.flushPendingToolResults;
  return sessionManager as GuardedSessionManager;
}

/**
 * Strip grounding metadata from tool result details for LLM consumption.
 * SECURITY: This should be called before sending tool results to LLMs.
 */
export { stripGroundingFromDetails };
