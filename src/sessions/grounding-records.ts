/**
 * Grounding records and provenance metadata for entity lifecycle tracking.
 *
 * This module provides canonical data shapes for tracking entities across
 * orchestration boundaries, preventing raw search/browser hits from masquerading
 * as verified entities.
 *
 * Lifecycle states:
 * - requested: What was originally asked for
 * - candidate: What was found/matched
 * - verified: What passed validation checks
 * - approved: What is authorized for action
 */

import type { InputProvenance } from "./input-provenance.js";

/**
 * Confidence level for a candidate/verified entity.
 * Uses a numeric scale (0.0-1.0) with named thresholds for policy enforcement.
 */
export type ConfidenceLevel =
  | { kind: "none"; value: 0 }
  | { kind: "low"; value: number }
  | { kind: "medium"; value: number }
  | { kind: "high"; value: number }
  | { kind: "certain"; value: 1 };

/**
 * Rejection reason categories for failed matches.
 */
export const REJECTION_REASON_VALUES = [
  "no_match",
  "ambiguous_match",
  "confidence_too_low",
  "validation_failed",
  "policy_denied",
  "expired",
  "verification_error",
  "user_rejected",
] as const;

export type RejectionReason = (typeof REJECTION_REASON_VALUES)[number];

/**
 * Metadata about why a candidate was rejected.
 */
export type RejectionMetadata = {
  reason: RejectionReason;
  message?: string;
  rejectedAt: number; // timestamp ms
  rejectedBy?: string; // tool/agent/user that rejected
  originalCandidate?: EntityReference;
  retryable: boolean;
};

/**
 * Reference to an entity with provenance.
 */
export type EntityReference = {
  /** Unique identifier for this entity within its source */
  id: string;
  /** Human-readable name/label */
  name?: string;
  /** Source that provided this entity */
  source: string;
  /** When this reference was created */
  timestamp: number;
  /** Provenance tracking */
  provenance?: GroundingProvenance;
};

/**
 * Extended provenance metadata for grounding records.
 * Builds on InputProvenance with additional grounding-specific fields.
 */
export type GroundingProvenance = {
  /** The input provenance this grounding extends */
  inputProvenance?: InputProvenance;
  /** Tool that produced this entity */
  sourceTool: string;
  /** Specific tool call ID that produced this */
  toolCallId?: string;
  /** Session where this was generated */
  sessionKey?: string;
  /** Agent that ran the tool */
  agentId?: string;
  /** When the grounding record was created */
  createdAt: number;
  /** Chain of parent grounding records (for transformations) */
  parentGroundingIds?: string[];
};

/**
 * Canonical grounding record representing an entity at a specific lifecycle state.
 *
 * This is the core data shape that flows across orchestration boundaries.
 * It carries both the entity data and metadata about its verification status.
 */
export type GroundingRecord<T = unknown> = {
  /** Unique identifier for this grounding record */
  id: string;
  /** Lifecycle state of this record */
  state: "requested" | "candidate" | "verified" | "approved";
  /** The entity data (typed by context) */
  entity: T;
  /** Reference to original request/query */
  requestedEntity?: EntityReference;
  /** For candidates/verified/approved: what was found */
  matchedEntity?: EntityReference;
  /** Confidence in the match (for candidate/verified states) */
  confidence?: ConfidenceLevel;
  /** Why this was rejected (if applicable) */
  rejection?: RejectionMetadata;
  /** Provenance chain */
  provenance: GroundingProvenance;
  /** Policy thresholds applied */
  policyThresholds?: {
    minimumConfidence: number;
    requireExplicitApproval: boolean;
  };
  /** Timestamps for state transitions */
  timestamps: {
    requested: number;
    candidate?: number;
    verified?: number;
    approved?: number;
    rejected?: number;
  };
  /** Additional metadata */
  metadata?: Record<string, unknown>;
};

/**
 * A collection of grounding records representing a match evaluation.
 * Used when multiple candidates exist for a single request.
 */
export type GroundingEvaluation<T = unknown> = {
  /** The original request */
  request: GroundingRecord<T>;
  /** All candidates found */
  candidates: GroundingRecord<T>[];
  /** Candidate that passed verification (if any) */
  verified?: GroundingRecord<T>;
  /** Candidate that was approved for action (if any) */
  approved?: GroundingRecord<T>;
  /** Rejected candidates with reasons */
  rejected: GroundingRecord<T>[];
  /** Overall evaluation status */
  status: "pending" | "has_candidates" | "verified" | "approved" | "rejected";
  /** Whether autonomous action is blocked */
  actionBlocked: boolean;
  /** Human-readable summary of the evaluation */
  summary?: string;
};

/**
 * Grounding metadata attached to tool results.
 * This is the primary integration point - tool results include grounding
 * metadata to indicate the verification status of their content.
 */
export type ToolResultGrounding = {
  /** Grounding records associated with this tool result */
  records?: GroundingRecord[];
  /** Overall confidence in the result */
  overallConfidence?: ConfidenceLevel;
  /** Whether this result has been verified */
  verified: boolean;
  /** Whether this result is approved for downstream use */
  approved: boolean;
  /** Rejection metadata if the result was rejected */
  rejection?: RejectionMetadata;
  /** Warning messages about match quality */
  warnings?: string[];
};

// ============================================================================
// Factory functions for creating grounding records
// ============================================================================

let groundingIdCounter = 0;

function generateGroundingId(): string {
  return `grnd_${Date.now().toString(36)}_${(++groundingIdCounter).toString(36)}`;
}

/**
 * Create a new "requested" grounding record.
 */
export function createRequestedGrounding<T>(params: {
  entity: T;
  sourceTool: string;
  inputProvenance?: InputProvenance;
  toolCallId?: string;
  sessionKey?: string;
  agentId?: string;
  metadata?: Record<string, unknown>;
}): GroundingRecord<T> {
  const now = Date.now();
  return {
    id: generateGroundingId(),
    state: "requested",
    entity: params.entity,
    provenance: {
      inputProvenance: params.inputProvenance,
      sourceTool: params.sourceTool,
      toolCallId: params.toolCallId,
      sessionKey: params.sessionKey,
      agentId: params.agentId,
      createdAt: now,
    },
    timestamps: {
      requested: now,
    },
    metadata: params.metadata,
  };
}

/**
 * Promote a grounding record to "candidate" state.
 */
export function promoteToCandidate<T>(
  requested: GroundingRecord<T>,
  matchedEntity: EntityReference,
  confidence: ConfidenceLevel,
): GroundingRecord<T> {
  const now = Date.now();
  return {
    ...requested,
    id: generateGroundingId(),
    state: "candidate",
    matchedEntity,
    confidence,
    requestedEntity: {
      id: requested.id,
      name: typeof requested.entity === "string" ? requested.entity : undefined,
      source: requested.provenance.sourceTool,
      timestamp: requested.timestamps.requested,
      provenance: requested.provenance,
    },
    provenance: {
      ...requested.provenance,
      parentGroundingIds: [...(requested.provenance.parentGroundingIds ?? []), requested.id],
      createdAt: now,
    },
    timestamps: {
      ...requested.timestamps,
      candidate: now,
    },
  };
}

/**
 * Promote a grounding record to "verified" state.
 */
export function promoteToVerified<T>(
  candidate: GroundingRecord<T>,
  verificationDetails?: Record<string, unknown>,
): GroundingRecord<T> {
  const now = Date.now();
  return {
    ...candidate,
    id: generateGroundingId(),
    state: "verified",
    provenance: {
      ...candidate.provenance,
      parentGroundingIds: [...(candidate.provenance.parentGroundingIds ?? []), candidate.id],
      createdAt: now,
    },
    timestamps: {
      ...candidate.timestamps,
      verified: now,
    },
    metadata: {
      ...candidate.metadata,
      verificationDetails,
    },
  };
}

/**
 * Promote a grounding record to "approved" state.
 */
export function promoteToApproved<T>(
  verified: GroundingRecord<T>,
  approvedBy?: string,
): GroundingRecord<T> {
  const now = Date.now();
  return {
    ...verified,
    id: generateGroundingId(),
    state: "approved",
    provenance: {
      ...verified.provenance,
      parentGroundingIds: [...(verified.provenance.parentGroundingIds ?? []), verified.id],
      createdAt: now,
    },
    timestamps: {
      ...verified.timestamps,
      approved: now,
    },
    metadata: {
      ...verified.metadata,
      approvedBy,
    },
  };
}

/**
 * Mark a grounding record as rejected.
 */
export function rejectGrounding<T>(
  record: GroundingRecord<T>,
  reason: RejectionReason,
  message?: string,
  rejectedBy?: string,
): GroundingRecord<T> {
  const now = Date.now();
  const retryable = reason !== "user_rejected" && reason !== "policy_denied";

  return {
    ...record,
    id: generateGroundingId(),
    state: record.state, // Keep original state for audit
    rejection: {
      reason,
      message,
      rejectedAt: now,
      rejectedBy,
      originalCandidate:
        record.state === "candidate" || record.state === "verified" || record.state === "approved"
          ? {
              id: record.id,
              name: typeof record.entity === "string" ? record.entity : undefined,
              source: record.provenance.sourceTool,
              timestamp: record.provenance.createdAt,
              provenance: record.provenance,
            }
          : undefined,
      retryable,
    },
    timestamps: {
      ...record.timestamps,
      rejected: now,
    },
  };
}

// ============================================================================
// Confidence utilities
// ============================================================================

export function createConfidence(value: number): ConfidenceLevel {
  const clamped = Math.max(0, Math.min(1, value));
  if (clamped === 0) {
    return { kind: "none", value: 0 };
  }
  if (clamped === 1) {
    return { kind: "certain", value: 1 };
  }
  if (clamped < 0.33) {
    return { kind: "low", value: clamped };
  }
  if (clamped < 0.67) {
    return { kind: "medium", value: clamped };
  }
  return { kind: "high", value: clamped };
}

export function confidenceMeetsThreshold(
  confidence: ConfidenceLevel | undefined,
  threshold: number,
): boolean {
  if (!confidence) {
    return false;
  }
  return confidence.value >= threshold;
}

// ============================================================================
// Evaluation utilities
// ============================================================================

export function createGroundingEvaluation<T>(request: GroundingRecord<T>): GroundingEvaluation<T> {
  return {
    request,
    candidates: [],
    rejected: [],
    status: "pending",
    actionBlocked: true,
  };
}

export function addCandidateToEvaluation<T>(
  evaluation: GroundingEvaluation<T>,
  candidate: GroundingRecord<T>,
): GroundingEvaluation<T> {
  return {
    ...evaluation,
    candidates: [...evaluation.candidates, candidate],
    status: evaluation.status === "pending" ? "has_candidates" : evaluation.status,
  };
}

export function markCandidateVerified<T>(
  evaluation: GroundingEvaluation<T>,
  candidateId: string,
  verificationDetails?: Record<string, unknown>,
): GroundingEvaluation<T> {
  const candidate = evaluation.candidates.find((c) => c.id === candidateId);
  if (!candidate) {
    return evaluation;
  }

  const verified = promoteToVerified(candidate, verificationDetails);
  return {
    ...evaluation,
    verified,
    status: "verified",
    actionBlocked: true, // Still needs approval
  };
}

export function markCandidateApproved<T>(
  evaluation: GroundingEvaluation<T>,
  verifiedId?: string, // if undefined, uses current verified
  approvedBy?: string,
): GroundingEvaluation<T> {
  const toApprove = verifiedId
    ? evaluation.candidates.find((c) => c.id === verifiedId)
    : evaluation.verified;

  if (!toApprove) {
    return evaluation;
  }

  const approved = promoteToApproved(toApprove, approvedBy);
  return {
    ...evaluation,
    approved,
    status: "approved",
    actionBlocked: false,
  };
}

export function rejectCandidate<T>(
  evaluation: GroundingEvaluation<T>,
  candidateId: string,
  reason: RejectionReason,
  message?: string,
  rejectedBy?: string,
): GroundingEvaluation<T> {
  const candidate =
    evaluation.candidates.find((c) => c.id === candidateId) ??
    (evaluation.verified?.id === candidateId ? evaluation.verified : undefined);

  if (!candidate) {
    return evaluation;
  }

  const rejected = rejectGrounding(candidate, reason, message, rejectedBy);
  return {
    ...evaluation,
    rejected: [...evaluation.rejected, rejected],
    status: evaluation.status === "approved" ? "approved" : "rejected",
    actionBlocked: evaluation.status !== "approved",
  };
}

// ============================================================================
// Serialization helpers
// ============================================================================

/**
 * Normalize unknown value to a GroundingRecord if valid.
 */
export function normalizeGroundingRecord(value: unknown): GroundingRecord | undefined {
  if (!value || typeof value !== "object") {
    return undefined;
  }
  const record = value as Record<string, unknown>;

  if (typeof record.id !== "string") {
    return undefined;
  }
  if (!["requested", "candidate", "verified", "approved"].includes(record.state as string)) {
    return undefined;
  }
  if (!record.provenance || typeof record.provenance !== "object") {
    return undefined;
  }
  if (!record.timestamps || typeof record.timestamps !== "object") {
    return undefined;
  }

  return record as GroundingRecord;
}

/**
 * Check if a value is a valid GroundingEvaluation.
 */
export function normalizeGroundingEvaluation(value: unknown): GroundingEvaluation | undefined {
  if (!value || typeof value !== "object") {
    return undefined;
  }
  const eval_ = value as Record<string, unknown>;

  if (!eval_.request || !normalizeGroundingRecord(eval_.request)) {
    return undefined;
  }
  if (!Array.isArray(eval_.candidates)) {
    return undefined;
  }
  if (!Array.isArray(eval_.rejected)) {
    return undefined;
  }

  return eval_ as GroundingEvaluation;
}

/**
 * Check if a grounding record is safe for autonomous action.
 * This is the key policy check for orchestration boundaries.
 */
export function isSafeForAutonomousAction(record: GroundingRecord): boolean {
  if (record.state !== "approved") {
    return false;
  }
  if (record.rejection) {
    return false;
  }
  if (record.confidence && record.confidence.value < 0.67) {
    return false;
  }
  return true;
}

/**
 * Check if an evaluation allows autonomous action.
 */
export function evaluationAllowsAutonomousAction(evaluation: GroundingEvaluation): boolean {
  if (evaluation.actionBlocked) {
    return false;
  }
  if (evaluation.status !== "approved") {
    return false;
  }
  if (!evaluation.approved) {
    return false;
  }
  return isSafeForAutonomousAction(evaluation.approved);
}
