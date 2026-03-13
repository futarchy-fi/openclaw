/**
 * Integration of grounding records with tool results and transcript handling.
 *
 * This module bridges grounding metadata with the tool result persistence layer,
 * ensuring that verification status travels with data across orchestration boundaries.
 */

import type { AgentMessage } from "@mariozechner/pi-agent-core";
import {
  type GroundingRecord,
  type GroundingEvaluation,
  type ToolResultGrounding,
  type ConfidenceLevel,
  type RejectionMetadata,
  normalizeGroundingRecord,
  normalizeGroundingEvaluation,
  // Re-export grounding record functions for convenience
  createRequestedGrounding,
  promoteToCandidate,
  promoteToVerified,
  promoteToApproved,
  rejectGrounding,
  createConfidence,
  createGroundingEvaluation,
  addCandidateToEvaluation,
  markCandidateVerified,
  markCandidateApproved,
  rejectCandidate,
  isSafeForAutonomousAction,
  evaluationAllowsAutonomousAction,
} from "../sessions/grounding-records.js";

// Re-export all grounding record types and functions
export {
  type GroundingRecord,
  type GroundingEvaluation,
  type ToolResultGrounding,
  type ConfidenceLevel,
  type RejectionMetadata,
  normalizeGroundingRecord,
  normalizeGroundingEvaluation,
  createRequestedGrounding,
  promoteToCandidate,
  promoteToVerified,
  promoteToApproved,
  rejectGrounding,
  createConfidence,
  createGroundingEvaluation,
  addCandidateToEvaluation,
  markCandidateVerified,
  markCandidateApproved,
  rejectCandidate,
  isSafeForAutonomousAction,
  evaluationAllowsAutonomousAction,
} from "../sessions/grounding-records.js";

// Symbol for storing grounding metadata on tool results (non-enumerable)
const GROUNDING_META_KEY = Symbol.for("openclaw.groundingMeta");

// WeakMap for grounding data (used when Symbol attachment isn't possible)
const groundingDataMap = new WeakMap<object, ToolResultGrounding>();

/**
 * Attach grounding metadata to a tool result object.
 * Uses Symbol attachment when possible, WeakMap fallback otherwise.
 */
export function attachToolResultGrounding(
  toolResult: Record<string, unknown>,
  grounding: ToolResultGrounding,
): void {
  // Try to attach via symbol (clean, non-enumerable)
  try {
    Object.defineProperty(toolResult, GROUNDING_META_KEY, {
      value: grounding,
      enumerable: false,
      writable: true,
      configurable: true,
    });
  } catch {
    // Fallback to WeakMap
    groundingDataMap.set(toolResult, grounding);
  }

  // Also attach to details for persistence across serialization boundaries
  if (!toolResult.details || typeof toolResult.details !== "object") {
    toolResult.details = {};
  }
  const details = toolResult.details as Record<string, unknown>;
  details.grounding = grounding;
}

/**
 * Extract grounding metadata from a tool result.
 * Checks Symbol attachment first, then details.grounding.
 */
export function extractToolResultGrounding(
  toolResult: Record<string, unknown>,
): ToolResultGrounding | undefined {
  // Check Symbol attachment first (most reliable)
  if (GROUNDING_META_KEY in toolResult) {
    return (toolResult as Record<typeof GROUNDING_META_KEY, ToolResultGrounding>)[
      GROUNDING_META_KEY
    ];
  }

  // Check WeakMap
  const fromMap = groundingDataMap.get(toolResult);
  if (fromMap) {
    return fromMap;
  }

  // Check details.grounding (survives serialization)
  if (toolResult.details && typeof toolResult.details === "object") {
    const details = toolResult.details as Record<string, unknown>;
    if (details.grounding && typeof details.grounding === "object") {
      return details.grounding as ToolResultGrounding;
    }
  }

  return undefined;
}

/**
 * Strip grounding metadata from tool result details for LLM consumption.
 * SECURITY: Grounding metadata should not be fed to LLMs, only used for
 * orchestration policy decisions.
 */
export function stripGroundingFromDetails(details: unknown): unknown {
  if (!details || typeof details !== "object") {
    return details;
  }

  if (Array.isArray(details)) {
    return details.map(stripGroundingFromDetails);
  }

  const record = details as Record<string, unknown>;
  const { grounding: _, ...rest } = record;
  return rest;
}

/**
 * Check if a tool result has verified/approved grounding.
 * Used at orchestration boundaries to decide if data can proceed.
 */
export function isToolResultVerified(toolResult: Record<string, unknown>): boolean {
  const grounding = extractToolResultGrounding(toolResult);
  if (!grounding) {
    return false;
  }
  return grounding.verified && grounding.approved;
}

/**
 * Check if a tool result is safe for autonomous action.
 * Combines verification status with confidence thresholds.
 */
export function isToolResultSafeForAction(
  toolResult: Record<string, unknown>,
  minConfidence?: number,
): boolean {
  const grounding = extractToolResultGrounding(toolResult);
  if (!grounding) {
    return false;
  }

  if (!grounding.verified || !grounding.approved) {
    return false;
  }
  if (grounding.rejection) {
    return false;
  }

  if (minConfidence !== undefined && grounding.overallConfidence) {
    return grounding.overallConfidence.value >= minConfidence;
  }

  return true;
}

/**
 * Add a warning to tool result grounding.
 * Mutates the grounding metadata in place.
 */
export function addGroundingWarning(toolResult: Record<string, unknown>, warning: string): void {
  const grounding = extractToolResultGrounding(toolResult);
  if (!grounding) {
    return;
  }

  if (!grounding.warnings) {
    grounding.warnings = [];
  }
  grounding.warnings.push(warning);
}

/**
 * Update tool result with rejection metadata.
 */
export function rejectToolResultGrounding(
  toolResult: Record<string, unknown>,
  rejection: RejectionMetadata,
): void {
  const grounding = extractToolResultGrounding(toolResult);
  if (!grounding) {
    return;
  }

  grounding.rejection = rejection;
  grounding.approved = false;
}

/**
 * Serialize grounding records for persistence.
 * Strips any runtime-only metadata.
 */
export function serializeGroundingForPersistence(
  grounding: ToolResultGrounding,
): Record<string, unknown> {
  return {
    records: grounding.records?.map((r) => ({
      id: r.id,
      state: r.state,
      entity: r.entity,
      requestedEntity: r.requestedEntity,
      matchedEntity: r.matchedEntity,
      confidence: r.confidence,
      rejection: r.rejection,
      provenance: {
        sourceTool: r.provenance.sourceTool,
        toolCallId: r.provenance.toolCallId,
        sessionKey: r.provenance.sessionKey,
        agentId: r.provenance.agentId,
        createdAt: r.provenance.createdAt,
        parentGroundingIds: r.provenance.parentGroundingIds,
      },
      policyThresholds: r.policyThresholds,
      timestamps: r.timestamps,
      metadata: r.metadata,
    })),
    overallConfidence: grounding.overallConfidence,
    verified: grounding.verified,
    approved: grounding.approved,
    rejection: grounding.rejection,
    warnings: grounding.warnings,
  };
}

/**
 * Deserialize grounding records from persistence.
 */
export function deserializeGroundingFromPersistence(
  data: unknown,
): ToolResultGrounding | undefined {
  if (!data || typeof data !== "object") {
    return undefined;
  }
  const record = data as Record<string, unknown>;

  return {
    records: Array.isArray(record.records)
      ? (record.records.map(normalizeGroundingRecord).filter(Boolean) as GroundingRecord[])
      : undefined,
    overallConfidence: record.overallConfidence as ConfidenceLevel | undefined,
    verified: Boolean(record.verified),
    approved: Boolean(record.approved),
    rejection: record.rejection as RejectionMetadata | undefined,
    warnings: Array.isArray(record.warnings) ? (record.warnings as string[]) : undefined,
  };
}

/**
 * Apply grounding metadata to a toolResult message before persistence.
 * This is called by the tool_result_persist hook.
 */
export function applyGroundingToToolResultMessage(message: AgentMessage): AgentMessage {
  // Cast through unknown to satisfy TypeScript
  const msg = message as unknown as Record<string, unknown>;

  // Only process tool results
  if (msg.role !== "toolResult") {
    return message;
  }

  const grounding = extractToolResultGrounding(msg);
  if (!grounding) {
    return message;
  }

  // Ensure details exists and contains serialized grounding
  if (!msg.details || typeof msg.details !== "object") {
    msg.details = {};
  }
  const details = msg.details as Record<string, unknown>;
  details.grounding = serializeGroundingForPersistence(grounding);

  return message;
}

/**
 * Extract grounding from a persisted toolResult message.
 * Called when loading session history.
 */
export function extractGroundingFromPersistedMessage(
  message: AgentMessage,
): ToolResultGrounding | undefined {
  const msg = message as Record<string, unknown>;
  if (msg.role !== "toolResult") {
    return undefined;
  }

  if (msg.details && typeof msg.details === "object") {
    const details = msg.details as Record<string, unknown>;
    if (details.grounding) {
      return deserializeGroundingFromPersistence(details.grounding);
    }
  }

  return undefined;
}

/**
 * Type guard for checking if a message is a grounded tool result.
 */
export function isGroundedToolResult(message: AgentMessage): boolean {
  const msg = message as Record<string, unknown>;
  if (msg.role !== "toolResult") {
    return false;
  }

  const grounding = extractGroundingFromPersistedMessage(message);
  return grounding !== undefined;
}

/**
 * Create a mismatch report when requested and matched entities differ.
 * Used for audit trails and debugging false matches.
 */
export function createMismatchReport(params: {
  requested: unknown;
  matched: unknown;
  confidence: number;
  reason: string;
  toolName: string;
  toolCallId?: string;
}): Record<string, unknown> {
  return {
    type: "grounding_mismatch",
    timestamp: Date.now(),
    toolName: params.toolName,
    toolCallId: params.toolCallId,
    confidence: params.confidence,
    reason: params.reason,
    requested: params.requested,
    matched: params.matched,
    severity: params.confidence < 0.5 ? "high" : params.confidence < 0.8 ? "medium" : "low",
  };
}

/**
 * Policy check: Determine if action should be blocked due to grounding issues.
 * Returns undefined if allowed, or a rejection reason if blocked.
 */
export function checkGroundingPolicy(
  grounding: ToolResultGrounding | undefined,
  params?: {
    requireExplicitApproval?: boolean;
    minConfidence?: number;
    allowUnverified?: boolean;
  },
): { allowed: false; reason: string; rejection: RejectionMetadata } | { allowed: true } {
  if (!grounding) {
    if (params?.allowUnverified) {
      return { allowed: true };
    }
    return {
      allowed: false,
      reason: "No grounding metadata present",
      rejection: {
        reason: "no_match",
        message: "Tool result lacks grounding metadata",
        rejectedAt: Date.now(),
        retryable: true,
      },
    };
  }

  if (grounding.rejection) {
    return {
      allowed: false,
      reason: `Rejected: ${grounding.rejection.reason}`,
      rejection: grounding.rejection,
    };
  }

  if (!grounding.verified) {
    if (params?.allowUnverified) {
      return { allowed: true };
    }
    return {
      allowed: false,
      reason: "Entity not verified",
      rejection: {
        reason: "validation_failed",
        message: "Tool result has not been verified",
        rejectedAt: Date.now(),
        retryable: true,
      },
    };
  }

  if (params?.requireExplicitApproval && !grounding.approved) {
    return {
      allowed: false,
      reason: "Explicit approval required",
      rejection: {
        reason: "policy_denied",
        message: "Tool result requires explicit approval for this action",
        rejectedAt: Date.now(),
        retryable: true,
      },
    };
  }

  if (params?.minConfidence !== undefined && grounding.overallConfidence) {
    if (grounding.overallConfidence.value < params.minConfidence) {
      return {
        allowed: false,
        reason: `Confidence too low: ${grounding.overallConfidence.value.toFixed(2)} < ${params.minConfidence}`,
        rejection: {
          reason: "confidence_too_low",
          message: `Confidence ${grounding.overallConfidence.value.toFixed(2)} below threshold ${params.minConfidence}`,
          rejectedAt: Date.now(),
          retryable: true,
        },
      };
    }
  }

  return { allowed: true };
}
