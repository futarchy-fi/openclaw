import { describe, expect, it } from "vitest";
import { connectOk, installGatewayTestHooks, rpcReq } from "./test-helpers.js";
import { withServer } from "./test-with-server.js";

installGatewayTestHooks({ scope: "suite" });

const validAuthSyncPushParams = {
  payloadVersion: 1,
  pushId: "push-123",
  profileId: "anthropic:default",
  credential: {
    provider: "anthropic",
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
} as const;

describe("gateway auth.sync.push", () => {
  it("requires operator.auth-sync scope", async () => {
    await withServer(async (ws) => {
      await connectOk(ws, { token: "secret", scopes: ["operator.write"] });

      const res = await rpcReq(ws, "auth.sync.push", validAuthSyncPushParams);

      expect(res.ok).toBe(false);
      expect(res.error?.message).toContain("missing scope: operator.auth-sync");
    });
  });

  it("returns a typed rejected skeleton response for supported payloads", async () => {
    await withServer(async (ws) => {
      await connectOk(ws, { token: "secret", scopes: ["operator.auth-sync"] });

      const res = await rpcReq<{
        ok: boolean;
        status: string;
        reason: string;
        message: string;
        pushId: string;
        profileId: string;
      }>(ws, "auth.sync.push", validAuthSyncPushParams);

      expect(res.ok).toBe(true);
      expect(res.payload).toEqual({
        ok: false,
        status: "rejected",
        reason: "profile_not_allowed",
        message: "auth.sync.push is not enabled for this profile yet",
        pushId: "push-123",
        profileId: "anthropic:default",
      });
    });
  });

  it("returns a typed rejection for unsupported payload versions", async () => {
    await withServer(async (ws) => {
      await connectOk(ws, { token: "secret", scopes: ["operator.auth-sync"] });

      const res = await rpcReq<{
        ok: boolean;
        status: string;
        reason: string;
        message: string;
      }>(ws, "auth.sync.push", {
        ...validAuthSyncPushParams,
        payloadVersion: 2,
      });

      expect(res.ok).toBe(true);
      expect(res.payload?.status).toBe("rejected");
      expect(res.payload?.reason).toBe("payload_version_unsupported");
      expect(res.payload?.message).toContain("payloadVersion: 2");
    });
  });
});
