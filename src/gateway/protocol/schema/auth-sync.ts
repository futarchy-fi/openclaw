import { Type } from "@sinclair/typebox";
import { NonEmptyString } from "./primitives.js";

const AuthSyncSourceSchema = Type.String({ enum: ["keychain", "auth.json"] });

export const AuthSyncPushCredentialSchema = Type.Object(
  {
    type: Type.Optional(Type.String()),
    provider: Type.Optional(Type.String()),
    access: Type.Optional(Type.String()),
    refresh: Type.Optional(Type.String()),
    expires: Type.Optional(Type.Integer({ minimum: 0 })),
    accountId: Type.Optional(Type.String()),
    email: Type.Optional(Type.String()),
  },
  { additionalProperties: false },
);

export const AuthSyncPushSnapshotSchema = Type.Object(
  {
    sequence: Type.Integer({ minimum: 0 }),
    observedAtMs: Type.Integer({ minimum: 0 }),
    source: AuthSyncSourceSchema,
    authFileMtimeMs: Type.Optional(Type.Integer({ minimum: 0 })),
    helperVersion: NonEmptyString,
  },
  { additionalProperties: false },
);

export const AuthSyncPushParamsSchema = Type.Object(
  {
    payloadVersion: Type.Integer({ minimum: 1 }),
    pushId: NonEmptyString,
    profileId: NonEmptyString,
    credential: AuthSyncPushCredentialSchema,
    snapshot: AuthSyncPushSnapshotSchema,
  },
  { additionalProperties: false },
);

const AuthSyncPushResultCommonFields = {
  profileId: NonEmptyString,
  pushId: NonEmptyString,
} as const;

const AuthSyncPushAcceptedResultCommonFields = {
  ok: Type.Literal(true),
  acceptedAtMs: Type.Integer({ minimum: 0 }),
  sequence: Type.Integer({ minimum: 0 }),
  snapshotHash: NonEmptyString,
  credentialExpiresAtMs: Type.Integer({ minimum: 0 }),
} as const;

export const AuthSyncPushUpdatedResultSchema = Type.Object(
  {
    ...AuthSyncPushResultCommonFields,
    ...AuthSyncPushAcceptedResultCommonFields,
    status: Type.Literal("updated"),
  },
  { additionalProperties: false },
);

export const AuthSyncPushNoopResultSchema = Type.Object(
  {
    ...AuthSyncPushResultCommonFields,
    ...AuthSyncPushAcceptedResultCommonFields,
    status: Type.Literal("noop"),
  },
  { additionalProperties: false },
);

export const AuthSyncPushRejectedReasonSchema = Type.String({
  enum: [
    "push_id_reused",
    "stale_sequence",
    "sequence_reused",
    "stale_snapshot",
    "observed_at_invalid",
    "regressive_expiry",
    "device_not_paired",
    "device_token_revoked",
    "alias_not_bound",
    "device_mismatch",
    "profile_not_allowed",
    "account_id_missing",
    "account_mismatch",
    "email_mismatch",
    "payload_version_unsupported",
    "credential_type_invalid",
    "provider_invalid",
    "credential_invalid",
  ],
});

export const AuthSyncPushRejectedResultSchema = Type.Object(
  {
    ...AuthSyncPushResultCommonFields,
    ok: Type.Literal(false),
    status: Type.Literal("rejected"),
    reason: AuthSyncPushRejectedReasonSchema,
    message: NonEmptyString,
  },
  { additionalProperties: false },
);

export const AuthSyncPushResultSchema = Type.Union(
  [AuthSyncPushUpdatedResultSchema, AuthSyncPushNoopResultSchema, AuthSyncPushRejectedResultSchema],
  { discriminator: "status" },
);
