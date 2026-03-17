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

type AuthSyncPushRejectedReason = AuthSyncPushRejectedResult["reason"];

function rejectedResult(
  params: Pick<AuthSyncPushParams, "pushId" | "profileId">,
  reason: AuthSyncPushRejectedReason,
  message: string,
): AuthSyncPushRejectedResult {
  return {
    ok: false,
    status: "rejected",
    reason,
    message,
    pushId: params.pushId.trim(),
    profileId: params.profileId.trim(),
  };
}

function buildRejectedResult(params: AuthSyncPushParams): AuthSyncPushRejectedResult {
  if (params.payloadVersion !== 1) {
    return rejectedResult(
      params,
      "payload_version_unsupported",
      `unsupported auth.sync.push payloadVersion: ${params.payloadVersion}`,
    );
  }

  if (params.credential.type.trim() !== "oauth") {
    return rejectedResult(
      params,
      "credential_type_invalid",
      "auth.sync.push credential.type must be oauth",
    );
  }

  if (params.credential.provider.trim() !== "openai-codex") {
    return rejectedResult(
      params,
      "provider_invalid",
      "auth.sync.push credential.provider must be openai-codex",
    );
  }

  if (
    !params.credential.access.trim() ||
    !params.credential.refresh.trim() ||
    !Number.isSafeInteger(params.credential.expires) ||
    params.credential.expires <= 0
  ) {
    return rejectedResult(
      params,
      "credential_invalid",
      "auth.sync.push credential must include non-empty access/refresh tokens and a positive expires timestamp",
    );
  }

  return rejectedResult(
    params,
    "profile_not_allowed",
    "auth.sync.push is not enabled for this profile yet",
  );
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
