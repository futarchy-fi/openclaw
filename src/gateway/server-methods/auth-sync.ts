import {
  ErrorCodes,
  errorShape,
  formatValidationErrors,
  type AuthSyncPushParams,
  type AuthSyncPushRejectedResult,
  validateAuthSyncPushParams,
  validateAuthSyncPushRejectedResult,
  validateAuthSyncPushResult,
} from "../protocol/index.js";
import type { GatewayRequestHandlers } from "./types.js";
import { assertValidParams } from "./validation.js";

function buildRejectedResult(params: AuthSyncPushParams): AuthSyncPushRejectedResult {
  if (params.payloadVersion !== 1) {
    return {
      ok: false,
      status: "rejected",
      reason: "payload_version_unsupported",
      message: `unsupported auth.sync.push payloadVersion: ${params.payloadVersion}`,
      pushId: params.pushId.trim(),
      profileId: params.profileId.trim(),
    };
  }

  return {
    ok: false,
    status: "rejected",
    reason: "profile_not_allowed",
    message: "auth.sync.push is not enabled for this profile yet",
    pushId: params.pushId.trim(),
    profileId: params.profileId.trim(),
  };
}

export const authSyncHandlers: GatewayRequestHandlers = {
  "auth.sync.push": async ({ params, respond, context }) => {
    if (!assertValidParams(params, validateAuthSyncPushParams, "auth.sync.push", respond)) {
      return;
    }

    const pushId = params.pushId.trim();
    const profileId = params.profileId.trim();
    if (!pushId || !profileId) {
      respond(
        false,
        undefined,
        errorShape(
          ErrorCodes.INVALID_REQUEST,
          "invalid auth.sync.push params: pushId/profileId must be non-empty",
        ),
      );
      return;
    }

    const result = buildRejectedResult({
      ...params,
      pushId,
      profileId,
    });

    if (!validateAuthSyncPushRejectedResult(result) || !validateAuthSyncPushResult(result)) {
      const errors = [
        ...(validateAuthSyncPushRejectedResult.errors ?? []),
        ...(validateAuthSyncPushResult.errors ?? []),
      ];
      context.logGateway.warn(
        `auth.sync.push produced invalid payload: ${formatValidationErrors(errors)}`,
      );
      respond(
        false,
        undefined,
        errorShape(ErrorCodes.UNAVAILABLE, "auth.sync.push returned invalid payload", {
          details: { errors },
        }),
      );
      return;
    }

    respond(true, result, undefined);
  },
};
