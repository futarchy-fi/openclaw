import { describe, expect, it } from "vitest";
import {
  addCandidateToEvaluation,
  addGroundingWarning,
  attachToolResultGrounding,
  checkGroundingPolicy,
  createConfidence,
  createGroundingEvaluation,
  createMismatchReport,
  createRequestedGrounding,
  deserializeGroundingFromPersistence,
  evaluationAllowsAutonomousAction,
  extractGroundingFromPersistedMessage,
  extractToolResultGrounding,
  isGroundedToolResult,
  isSafeForAutonomousAction,
  isToolResultSafeForAction,
  isToolResultVerified,
  markCandidateApproved,
  markCandidateVerified,
  normalizeGroundingEvaluation,
  normalizeGroundingRecord,
  promoteToApproved,
  promoteToCandidate,
  promoteToVerified,
  rejectCandidate,
  rejectGrounding,
  rejectToolResultGrounding,
  serializeGroundingForPersistence,
  stripGroundingFromDetails,
} from "./grounding-integration.js";

describe("grounding-integration", () => {
  describe("createRequestedGrounding", () => {
    it("creates a grounding record in requested state", () => {
      const record = createRequestedGrounding({
        entity: { name: "test-entity" },
        sourceTool: "web_search",
        toolCallId: "call_123",
        sessionKey: "session-abc",
        agentId: "agent-1",
      });

      expect(record.state).toBe("requested");
      expect(record.entity).toEqual({ name: "test-entity" });
      expect(record.provenance.sourceTool).toBe("web_search");
      expect(record.provenance.toolCallId).toBe("call_123");
      expect(record.timestamps.requested).toBeGreaterThan(0);
      expect(record.id).toMatch(/^grnd_/);
    });

    it("generates unique IDs for each record", () => {
      const r1 = createRequestedGrounding({ entity: "a", sourceTool: "test" });
      const r2 = createRequestedGrounding({ entity: "b", sourceTool: "test" });
      expect(r1.id).not.toBe(r2.id);
    });
  });

  describe("promoteToCandidate", () => {
    it("promotes requested to candidate with confidence", () => {
      const requested = createRequestedGrounding({ entity: "query", sourceTool: "test" });
      const matchedEntity = {
        id: "result-1",
        name: "Result One",
        source: "web_search",
        timestamp: Date.now(),
      };
      const confidence = createConfidence(0.85);

      const candidate = promoteToCandidate(requested, matchedEntity, confidence);

      expect(candidate.state).toBe("candidate");
      expect(candidate.matchedEntity).toEqual(matchedEntity);
      expect(candidate.confidence?.value).toBe(0.85);
      expect(candidate.requestedEntity?.id).toBe(requested.id);
      expect(candidate.timestamps.candidate).toBeDefined();
      expect(candidate.provenance.parentGroundingIds).toContain(requested.id);
    });
  });

  describe("promoteToVerified", () => {
    it("promotes candidate to verified with verification details", () => {
      const requested = createRequestedGrounding({ entity: "query", sourceTool: "test" });
      const candidate = promoteToCandidate(
        requested,
        { id: "r1", source: "test", timestamp: Date.now() },
        createConfidence(0.9),
      );

      const verified = promoteToVerified(candidate, { checkMethod: "exact_match" });

      expect(verified.state).toBe("verified");
      expect(verified.timestamps.verified).toBeDefined();
      expect(verified.metadata?.verificationDetails).toEqual({ checkMethod: "exact_match" });
    });
  });

  describe("promoteToApproved", () => {
    it("promotes verified to approved with approver info", () => {
      const requested = createRequestedGrounding({ entity: "query", sourceTool: "test" });
      const candidate = promoteToCandidate(
        requested,
        { id: "r1", source: "test", timestamp: Date.now() },
        createConfidence(0.9),
      );
      const verified = promoteToVerified(candidate);

      const approved = promoteToApproved(verified, "user@example.com");

      expect(approved.state).toBe("approved");
      expect(approved.timestamps.approved).toBeDefined();
      expect(approved.metadata?.approvedBy).toBe("user@example.com");
    });
  });

  describe("rejectGrounding", () => {
    it("marks record as rejected with reason", () => {
      const requested = createRequestedGrounding({ entity: "query", sourceTool: "test" });
      const candidate = promoteToCandidate(
        requested,
        { id: "r1", source: "test", timestamp: Date.now() },
        createConfidence(0.3),
      );

      const rejected = rejectGrounding(
        candidate,
        "confidence_too_low",
        "Match confidence below threshold",
        "policy-engine",
      );

      expect(rejected.rejection).toBeDefined();
      expect(rejected.rejection?.reason).toBe("confidence_too_low");
      expect(rejected.rejection?.message).toBe("Match confidence below threshold");
      expect(rejected.rejection?.rejectedBy).toBe("policy-engine");
      expect(rejected.rejection?.retryable).toBe(true);
      expect(rejected.timestamps.rejected).toBeDefined();
    });

    it("marks user_rejected as non-retryable", () => {
      const record = createRequestedGrounding({ entity: "query", sourceTool: "test" });
      const rejected = rejectGrounding(record, "user_rejected");
      expect(rejected.rejection?.retryable).toBe(false);
    });

    it("marks policy_denied as non-retryable", () => {
      const record = createRequestedGrounding({ entity: "query", sourceTool: "test" });
      const rejected = rejectGrounding(record, "policy_denied");
      expect(rejected.rejection?.retryable).toBe(false);
    });
  });

  describe("createConfidence", () => {
    it("creates 'none' confidence for 0", () => {
      const c = createConfidence(0);
      expect(c.kind).toBe("none");
      expect(c.value).toBe(0);
    });

    it("creates 'certain' confidence for 1", () => {
      const c = createConfidence(1);
      expect(c.kind).toBe("certain");
      expect(c.value).toBe(1);
    });

    it("creates 'low' confidence for values below 0.33", () => {
      expect(createConfidence(0.1).kind).toBe("low");
      expect(createConfidence(0.32).kind).toBe("low");
    });

    it("creates 'medium' confidence for values 0.33-0.66", () => {
      expect(createConfidence(0.33).kind).toBe("medium");
      expect(createConfidence(0.5).kind).toBe("medium");
      expect(createConfidence(0.66).kind).toBe("medium");
    });

    it("creates 'high' confidence for values above 0.66", () => {
      expect(createConfidence(0.67).kind).toBe("high");
      expect(createConfidence(0.9).kind).toBe("high");
    });

    it("clamps values outside 0-1 range", () => {
      expect(createConfidence(-0.5).value).toBe(0);
      expect(createConfidence(1.5).value).toBe(1);
    });
  });

  describe("grounding evaluation lifecycle", () => {
    it("supports full evaluation lifecycle", () => {
      // Create request
      const request = createRequestedGrounding({ entity: "find user", sourceTool: "test" });
      const evaluation = createGroundingEvaluation(request);

      expect(evaluation.status).toBe("pending");
      expect(evaluation.actionBlocked).toBe(true);

      // Add candidates
      const candidate1 = promoteToCandidate(
        request,
        { id: "u1", name: "User One", source: "db", timestamp: Date.now() },
        createConfidence(0.7),
      );
      let eval2 = addCandidateToEvaluation(evaluation, candidate1);

      expect(eval2.status).toBe("has_candidates");
      expect(eval2.candidates).toHaveLength(1);

      // Mark verified
      const eval3 = markCandidateVerified(eval2, candidate1.id, { method: "exact" });
      expect(eval3.status).toBe("verified");
      expect(eval3.verified).toBeDefined();
      expect(eval3.actionBlocked).toBe(true); // Still blocked until approved

      // Mark approved
      const eval4 = markCandidateApproved(eval3, undefined, "admin");
      expect(eval4.status).toBe("approved");
      expect(eval4.approved).toBeDefined();
      expect(eval4.actionBlocked).toBe(false);
    });

    it("handles candidate rejection", () => {
      const request = createRequestedGrounding({ entity: "find user", sourceTool: "test" });
      const candidate = promoteToCandidate(
        request,
        { id: "u1", source: "db", timestamp: Date.now() },
        createConfidence(0.4),
      );

      let evaluation = addCandidateToEvaluation(createGroundingEvaluation(request), candidate);
      evaluation = rejectCandidate(evaluation, candidate.id, "confidence_too_low");

      expect(evaluation.rejected).toHaveLength(1);
      expect(evaluation.rejected[0]?.rejection?.reason).toBe("confidence_too_low");
    });
  });

  describe("isSafeForAutonomousAction", () => {
    it("returns true only for approved high-confidence records", () => {
      const request = createRequestedGrounding({ entity: "query", sourceTool: "test" });
      expect(isSafeForAutonomousAction(request)).toBe(false);

      const candidate = promoteToCandidate(
        request,
        { id: "r1", source: "test", timestamp: Date.now() },
        createConfidence(0.9),
      );
      expect(isSafeForAutonomousAction(candidate)).toBe(false);

      const verified = promoteToVerified(candidate);
      expect(isSafeForAutonomousAction(verified)).toBe(false);

      const approved = promoteToApproved(verified);
      expect(isSafeForAutonomousAction(approved)).toBe(true);
    });

    it("returns false for low-confidence approved records", () => {
      const request = createRequestedGrounding({ entity: "query", sourceTool: "test" });
      const candidate = promoteToCandidate(
        request,
        { id: "r1", source: "test", timestamp: Date.now() },
        createConfidence(0.5), // Below threshold
      );
      const verified = promoteToVerified(candidate);
      const approved = promoteToApproved(verified);

      expect(isSafeForAutonomousAction(approved)).toBe(false);
    });

    it("returns false for rejected records", () => {
      const request = createRequestedGrounding({ entity: "query", sourceTool: "test" });
      const approved = promoteToApproved(
        promoteToVerified(
          promoteToCandidate(
            request,
            { id: "r1", source: "test", timestamp: Date.now() },
            createConfidence(0.9),
          ),
        ),
      );
      const rejected = rejectGrounding(approved, "user_rejected");

      expect(isSafeForAutonomousAction(rejected)).toBe(false);
    });
  });

  describe("evaluationAllowsAutonomousAction", () => {
    it("returns true only for approved evaluations with safe records", () => {
      const request = createRequestedGrounding({ entity: "query", sourceTool: "test" });
      let evaluation = createGroundingEvaluation(request);
      expect(evaluationAllowsAutonomousAction(evaluation)).toBe(false);

      const candidate = promoteToCandidate(
        request,
        { id: "r1", source: "test", timestamp: Date.now() },
        createConfidence(0.9),
      );
      evaluation = addCandidateToEvaluation(evaluation, candidate);
      expect(evaluationAllowsAutonomousAction(evaluation)).toBe(false);

      evaluation = markCandidateVerified(evaluation, candidate.id);
      expect(evaluationAllowsAutonomousAction(evaluation)).toBe(false);

      evaluation = markCandidateApproved(evaluation);
      expect(evaluationAllowsAutonomousAction(evaluation)).toBe(true);
    });
  });

  describe("tool result grounding attachment", () => {
    it("attaches and extracts grounding metadata", () => {
      const toolResult: Record<string, unknown> = { ok: true, text: "result" };
      const grounding = {
        verified: true,
        approved: true,
        overallConfidence: createConfidence(0.9),
      };

      attachToolResultGrounding(toolResult, grounding);

      const extracted = extractToolResultGrounding(toolResult);
      expect(extracted?.verified).toBe(true);
      expect(extracted?.approved).toBe(true);
    });

    it("preserves grounding in details for serialization", () => {
      const toolResult: Record<string, unknown> = { ok: true };
      const grounding = { verified: true, approved: false };

      attachToolResultGrounding(toolResult, grounding);

      expect(toolResult.details).toBeDefined();
      const details = toolResult.details as Record<string, unknown>;
      expect(details.grounding).toBeDefined();
    });
  });

  describe("stripGroundingFromDetails", () => {
    it("removes grounding field from details", () => {
      const details = { result: "data", grounding: { verified: true } };
      const stripped = stripGroundingFromDetails(details);

      expect(stripped).toEqual({ result: "data" });
      expect((stripped as Record<string, unknown>).grounding).toBeUndefined();
    });

    it("handles nested arrays", () => {
      const details = [{ a: 1, grounding: {} }, { b: 2 }];
      const stripped = stripGroundingFromDetails(details);

      expect(stripped).toEqual([{ a: 1 }, { b: 2 }]);
    });

    it("handles non-objects gracefully", () => {
      expect(stripGroundingFromDetails(null)).toBe(null);
      expect(stripGroundingFromDetails("string")).toBe("string");
      expect(stripGroundingFromDetails(123)).toBe(123);
    });
  });

  describe("isToolResultVerified", () => {
    it("returns true for verified and approved results", () => {
      const toolResult: Record<string, unknown> = { ok: true };
      attachToolResultGrounding(toolResult, { verified: true, approved: true });

      expect(isToolResultVerified(toolResult)).toBe(true);
    });

    it("returns false for unverified results", () => {
      const toolResult: Record<string, unknown> = { ok: true };
      attachToolResultGrounding(toolResult, { verified: false, approved: true });

      expect(isToolResultVerified(toolResult)).toBe(false);
    });

    it("returns false when no grounding present", () => {
      const toolResult: Record<string, unknown> = { ok: true };
      expect(isToolResultVerified(toolResult)).toBe(false);
    });
  });

  describe("isToolResultSafeForAction", () => {
    it("respects confidence threshold", () => {
      const toolResult: Record<string, unknown> = { ok: true };
      attachToolResultGrounding(toolResult, {
        verified: true,
        approved: true,
        overallConfidence: createConfidence(0.7),
      });

      expect(isToolResultSafeForAction(toolResult, 0.8)).toBe(false);
      expect(isToolResultSafeForAction(toolResult, 0.6)).toBe(true);
    });

    it("rejects rejected results", () => {
      const toolResult: Record<string, unknown> = { ok: true };
      attachToolResultGrounding(toolResult, {
        verified: true,
        approved: true,
        rejection: {
          reason: "user_rejected",
          rejectedAt: Date.now(),
          retryable: false,
        },
      });

      expect(isToolResultSafeForAction(toolResult)).toBe(false);
    });
  });

  describe("addGroundingWarning", () => {
    it("adds warnings to grounding metadata", () => {
      const toolResult: Record<string, unknown> = { ok: true };
      attachToolResultGrounding(toolResult, { verified: true, approved: true });

      addGroundingWarning(toolResult, "Low confidence match");
      addGroundingWarning(toolResult, "Multiple candidates found");

      const grounding = extractToolResultGrounding(toolResult);
      expect(grounding?.warnings).toEqual(["Low confidence match", "Multiple candidates found"]);
    });
  });

  describe("rejectToolResultGrounding", () => {
    it("sets rejection and unapproves result", () => {
      const toolResult: Record<string, unknown> = { ok: true };
      attachToolResultGrounding(toolResult, { verified: true, approved: true });

      rejectToolResultGrounding(toolResult, {
        reason: "confidence_too_low",
        rejectedAt: Date.now(),
        retryable: true,
      });

      const grounding = extractToolResultGrounding(toolResult);
      expect(grounding?.rejection?.reason).toBe("confidence_too_low");
      expect(grounding?.approved).toBe(false);
    });
  });

  describe("serialization roundtrip", () => {
    it("preserves grounding through serialize/deserialize", () => {
      const request = createRequestedGrounding({ entity: "query", sourceTool: "test" });
      const candidate = promoteToCandidate(
        request,
        { id: "r1", source: "test", timestamp: Date.now() },
        createConfidence(0.85),
      );
      const verified = promoteToVerified(candidate);
      const approved = promoteToApproved(verified, "admin");

      const grounding: import("./grounding-integration.js").ToolResultGrounding = {
        records: [approved],
        verified: true,
        approved: true,
        overallConfidence: createConfidence(0.85),
        warnings: ["test warning"],
      };

      const serialized = serializeGroundingForPersistence(grounding);
      const deserialized = deserializeGroundingFromPersistence(serialized);

      expect(deserialized?.verified).toBe(true);
      expect(deserialized?.approved).toBe(true);
      expect(deserialized?.overallConfidence?.value).toBe(0.85);
      expect(deserialized?.warnings).toEqual(["test warning"]);
      expect(deserialized?.records?.[0]?.state).toBe("approved");
    });
  });

  describe("normalizeGroundingRecord", () => {
    it("returns valid record for valid input", () => {
      const request = createRequestedGrounding({ entity: "test", sourceTool: "test" });
      const normalized = normalizeGroundingRecord(request);

      expect(normalized).toBeDefined();
      expect(normalized?.id).toBe(request.id);
    });

    it("returns undefined for invalid input", () => {
      expect(normalizeGroundingRecord(null)).toBeUndefined();
      expect(normalizeGroundingRecord("string")).toBeUndefined();
      expect(normalizeGroundingRecord({})).toBeUndefined();
      expect(normalizeGroundingRecord({ id: "test" })).toBeUndefined(); // missing state, provenance
    });
  });

  describe("normalizeGroundingEvaluation", () => {
    it("returns valid evaluation for valid input", () => {
      const request = createRequestedGrounding({ entity: "test", sourceTool: "test" });
      const evaluation = createGroundingEvaluation(request);

      const normalized = normalizeGroundingEvaluation(evaluation);
      expect(normalized).toBeDefined();
    });

    it("returns undefined for invalid input", () => {
      expect(normalizeGroundingEvaluation(null)).toBeUndefined();
      expect(normalizeGroundingEvaluation({})).toBeUndefined();
    });
  });

  describe("persisted message handling", () => {
    it("extracts grounding from toolResult message details", () => {
      const grounding = { verified: true, approved: true };
      const message = {
        role: "toolResult" as const,
        content: "test",
        details: { grounding },
      };

      const extracted = extractGroundingFromPersistedMessage(
        message as unknown as import("@mariozechner/pi-agent-core").AgentMessage,
      );
      expect(extracted?.verified).toBe(true);
    });

    it("returns undefined for non-toolResult messages", () => {
      const message = {
        role: "user" as const,
        content: "test",
      };

      const extracted = extractGroundingFromPersistedMessage(
        message as unknown as import("@mariozechner/pi-agent-core").AgentMessage,
      );
      expect(extracted).toBeUndefined();
    });

    it("isGroundedToolResult identifies grounded messages", () => {
      const groundedMessage = {
        role: "toolResult" as const,
        content: "test",
        details: { grounding: { verified: true } },
      };
      const ungroundedMessage = {
        role: "toolResult" as const,
        content: "test",
      };
      const userMessage = {
        role: "user" as const,
        content: "test",
      };

      expect(
        isGroundedToolResult(
          groundedMessage as unknown as import("@mariozechner/pi-agent-core").AgentMessage,
        ),
      ).toBe(true);
      expect(
        isGroundedToolResult(
          ungroundedMessage as unknown as import("@mariozechner/pi-agent-core").AgentMessage,
        ),
      ).toBe(false);
      expect(
        isGroundedToolResult(
          userMessage as unknown as import("@mariozechner/pi-agent-core").AgentMessage,
        ),
      ).toBe(false);
    });
  });

  describe("checkGroundingPolicy", () => {
    it("allows verified and approved grounding", () => {
      const grounding: import("./grounding-integration.js").ToolResultGrounding = {
        verified: true,
        approved: true,
        overallConfidence: createConfidence(0.9),
      };

      const result = checkGroundingPolicy(grounding);
      expect(result.allowed).toBe(true);
    });

    it("blocks when no grounding present", () => {
      const result = checkGroundingPolicy(undefined);
      expect(result.allowed).toBe(false);
      if (!result.allowed) {
        expect(result.rejection.reason).toBe("no_match");
      }
    });

    it("allows unverified with allowUnverified flag", () => {
      const grounding: import("./grounding-integration.js").ToolResultGrounding = {
        verified: false,
        approved: false,
      };

      const result = checkGroundingPolicy(grounding, { allowUnverified: true });
      expect(result.allowed).toBe(true);
    });

    it("blocks when explicit approval required but not approved", () => {
      const grounding: import("./grounding-integration.js").ToolResultGrounding = {
        verified: true,
        approved: false,
      };

      const result = checkGroundingPolicy(grounding, { requireExplicitApproval: true });
      expect(result.allowed).toBe(false);
      if (!result.allowed) {
        expect(result.rejection.reason).toBe("policy_denied");
      }
    });

    it("blocks when confidence below threshold", () => {
      const grounding: import("./grounding-integration.js").ToolResultGrounding = {
        verified: true,
        approved: true,
        overallConfidence: createConfidence(0.5),
      };

      const result = checkGroundingPolicy(grounding, { minConfidence: 0.8 });
      expect(result.allowed).toBe(false);
      if (!result.allowed) {
        expect(result.rejection.reason).toBe("confidence_too_low");
      }
    });

    it("blocks when rejection present", () => {
      const grounding: import("./grounding-integration.js").ToolResultGrounding = {
        verified: true,
        approved: true,
        rejection: {
          reason: "user_rejected",
          rejectedAt: Date.now(),
          retryable: false,
        },
      };

      const result = checkGroundingPolicy(grounding);
      expect(result.allowed).toBe(false);
      if (!result.allowed) {
        expect(result.rejection.reason).toBe("user_rejected");
      }
    });
  });

  describe("createMismatchReport", () => {
    it("creates audit trail for mismatches", () => {
      const report = createMismatchReport({
        requested: { name: "Alice" },
        matched: { name: "Bob" },
        confidence: 0.3,
        reason: "Name similarity below threshold",
        toolName: "user_lookup",
        toolCallId: "call_123",
      });

      expect(report.type).toBe("grounding_mismatch");
      expect(report.severity).toBe("high");
      expect(report.confidence).toBe(0.3);
      expect(report.toolName).toBe("user_lookup");
    });

    it("adjusts severity based on confidence", () => {
      const low = createMismatchReport({
        requested: "a",
        matched: "b",
        confidence: 0.2,
        reason: "",
        toolName: "test",
      });
      const med = createMismatchReport({
        requested: "a",
        matched: "b",
        confidence: 0.6,
        reason: "",
        toolName: "test",
      });
      const high = createMismatchReport({
        requested: "a",
        matched: "b",
        confidence: 0.9,
        reason: "",
        toolName: "test",
      });

      expect(low.severity).toBe("high");
      expect(med.severity).toBe("medium");
      expect(high.severity).toBe("low");
    });
  });
});
