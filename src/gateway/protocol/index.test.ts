import type { ErrorObject } from "ajv";
import { describe, expect, it } from "vitest";
import {
  formatValidationErrors,
  validateAuthSyncPushParams,
  validateAuthSyncPushRejectedResult,
  validateAuthSyncPushResult,
  validateTalkConfigResult,
} from "./index.js";

const makeError = (overrides: Partial<ErrorObject>): ErrorObject => ({
  keyword: "type",
  instancePath: "",
  schemaPath: "#/",
  params: {},
  message: "validation error",
  ...overrides,
});

describe("formatValidationErrors", () => {
  it("returns unknown validation error when missing errors", () => {
    expect(formatValidationErrors(undefined)).toBe("unknown validation error");
    expect(formatValidationErrors(null)).toBe("unknown validation error");
  });

  it("returns unknown validation error when errors list is empty", () => {
    expect(formatValidationErrors([])).toBe("unknown validation error");
  });

  it("formats additionalProperties at root", () => {
    const err = makeError({
      keyword: "additionalProperties",
      params: { additionalProperty: "token" },
    });

    expect(formatValidationErrors([err])).toBe("at root: unexpected property 'token'");
  });

  it("formats additionalProperties with instancePath", () => {
    const err = makeError({
      keyword: "additionalProperties",
      instancePath: "/auth",
      params: { additionalProperty: "token" },
    });

    expect(formatValidationErrors([err])).toBe("at /auth: unexpected property 'token'");
  });

  it("formats message with path for other errors", () => {
    const err = makeError({
      keyword: "required",
      instancePath: "/auth",
      message: "must have required property 'token'",
    });

    expect(formatValidationErrors([err])).toBe("at /auth: must have required property 'token'");
  });

  it("de-dupes repeated entries", () => {
    const err = makeError({
      keyword: "required",
      instancePath: "/auth",
      message: "must have required property 'token'",
    });

    expect(formatValidationErrors([err, err])).toBe(
      "at /auth: must have required property 'token'",
    );
  });
});

describe("validateAuthSyncPushParams", () => {
  it("accepts a valid auth sync push payload", () => {
    expect(
      validateAuthSyncPushParams({
        payloadVersion: 1,
        pushId: "push-123",
        profileId: "openai-codex:default",
        credential: {
          type: "oauth",
          provider: "openai-codex",
          access: "token-value",
          refresh: "refresh-value",
          expires: 1_700_000_000_000,
          accountId: "acct-123",
          email: "me@example.com",
        },
        snapshot: {
          sequence: 12,
          observedAtMs: 1_700_000_000_000,
          source: "auth.json",
          authFileMtimeMs: 1_700_000_000_100,
          helperVersion: "1.2.3",
        },
      }),
    ).toBe(true);
  });

  it("rejects credential payloads missing required oauth fields", () => {
    expect(
      validateAuthSyncPushParams({
        payloadVersion: 1,
        pushId: "push-123",
        profileId: "openai-codex:default",
        credential: {},
        snapshot: {
          sequence: 12,
          observedAtMs: 1_700_000_000_000,
          source: "auth.json",
          helperVersion: "1.2.3",
        },
      }),
    ).toBe(false);
  });

  it("rejects unexpected properties", () => {
    expect(
      validateAuthSyncPushParams({
        payloadVersion: 1,
        pushId: "push-123",
        profileId: "openai-codex:default",
        credential: {
          type: "oauth",
          provider: "openai-codex",
          access: "token-value",
          refresh: "refresh-value",
          expires: 1_700_000_000_000,
          unexpected: true,
        },
        snapshot: {
          sequence: 12,
          observedAtMs: 1_700_000_000_000,
          source: "auth.json",
          helperVersion: "1.2.3",
        },
      }),
    ).toBe(false);
  });
});

describe("validateAuthSyncPushResult", () => {
  it("accepts rejected auth sync push results", () => {
    const result = {
      ok: false,
      status: "rejected",
      reason: "profile_not_allowed",
      message: "auth.sync.push is not enabled for this profile yet",
      pushId: "push-123",
      profileId: "openai-codex:default",
    };

    expect(validateAuthSyncPushRejectedResult(result)).toBe(true);
    expect(validateAuthSyncPushResult(result)).toBe(true);
  });

  it("rejects incomplete accepted results", () => {
    expect(
      validateAuthSyncPushResult({
        ok: true,
        status: "updated",
        pushId: "push-123",
        profileId: "openai-codex:default",
      }),
    ).toBe(false);
  });
});

describe("validateTalkConfigResult", () => {
  it("accepts Talk SecretRef payloads", () => {
    expect(
      validateTalkConfigResult({
        config: {
          talk: {
            provider: "elevenlabs",
            providers: {
              elevenlabs: {
                apiKey: {
                  source: "env",
                  provider: "default",
                  id: "ELEVENLABS_API_KEY",
                },
              },
            },
            resolved: {
              provider: "elevenlabs",
              config: {
                apiKey: {
                  source: "env",
                  provider: "default",
                  id: "ELEVENLABS_API_KEY",
                },
              },
            },
            apiKey: {
              source: "env",
              provider: "default",
              id: "ELEVENLABS_API_KEY",
            },
          },
        },
      }),
    ).toBe(true);
  });

  it("rejects normalized talk payloads without talk.resolved", () => {
    expect(
      validateTalkConfigResult({
        config: {
          talk: {
            provider: "elevenlabs",
            providers: {
              elevenlabs: {
                voiceId: "voice-normalized",
              },
            },
          },
        },
      }),
    ).toBe(false);
  });
});
