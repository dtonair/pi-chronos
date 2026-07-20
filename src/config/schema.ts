import { isAbsolute } from "node:path";
import { type Static, Type } from "typebox";
import { Value } from "typebox/value";
import { ChronosError, ChronosErrorCode } from "../domain/errors.js";
import type { Result } from "../shared/result.js";
import { err, ok } from "../shared/result.js";
import { type ChronosConfig, DEFAULT_CONFIG } from "./defaults.js";

export const ChronosConfigOverridesSchema = Type.Object(
  {
    defaultTimezone: Type.Optional(Type.String({ minLength: 1, maxLength: 128 })),
    minimumIntervalMs: Type.Optional(Type.Integer({ minimum: 1_000 })),
    defaultTimeoutMs: Type.Optional(Type.Integer({ minimum: 1_000, maximum: 86_400_000 })),
    maximumTimeoutMs: Type.Optional(Type.Integer({ minimum: 1_000, maximum: 86_400_000 })),
    defaultMaxOutputBytes: Type.Optional(Type.Integer({ minimum: 1_024, maximum: 10_485_760 })),
    maximumConcurrentRuns: Type.Optional(Type.Integer({ minimum: 1, maximum: 64 })),
    schedulerPollFallbackMs: Type.Optional(Type.Integer({ minimum: 1_000, maximum: 300_000 })),
    leaseDurationMs: Type.Optional(Type.Integer({ minimum: 1_000, maximum: 3_600_000 })),
    leaseRenewalMs: Type.Optional(Type.Integer({ minimum: 1_000, maximum: 3_600_000 })),
    instanceHeartbeatMs: Type.Optional(Type.Integer({ minimum: 1_000, maximum: 300_000 })),
    instanceStaleAfterMs: Type.Optional(Type.Integer({ minimum: 1_000, maximum: 3_600_000 })),
    shutdownGraceMs: Type.Optional(Type.Integer({ minimum: 0, maximum: 300_000 })),
    allowProjectImports: Type.Optional(Type.Boolean()),
    enableWidget: Type.Optional(Type.Boolean()),
    enableOsSandbox: Type.Optional(Type.Boolean()),
    maximumImportBytes: Type.Optional(Type.Integer({ minimum: 1_024, maximum: 10_485_760 })),
    maximumImportJobs: Type.Optional(Type.Integer({ minimum: 1, maximum: 10_000 })),
    permissionMode: Type.Optional(
      Type.Union([Type.Literal("job"), Type.Literal("pi-seatbelt-sandbox")]),
    ),
    piSeatbeltExtension: Type.Optional(Type.String({ minLength: 1, maxLength: 4_096 })),
  },
  { additionalProperties: false },
);

export type ChronosConfigOverrides = Static<typeof ChronosConfigOverridesSchema>;

function isValidTimezone(timezone: string): boolean {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: timezone }).format(0);
    return true;
  } catch {
    return false;
  }
}

function validationError(message: string, meta?: Record<string, unknown>): ChronosError {
  return new ChronosError({ code: ChronosErrorCode.VALIDATION_ERROR, message, meta });
}

export function decodeConfig(value: unknown): Result<ChronosConfig> {
  const errors = [...Value.Errors(ChronosConfigOverridesSchema, value)];
  if (errors.length > 0) {
    return err(
      validationError("Invalid Chronos configuration", {
        issues: errors.slice(0, 20).map((issue) => ({
          path: issue.instancePath,
          message: issue.message,
        })),
      }),
    );
  }

  const overrides = Value.Decode(ChronosConfigOverridesSchema, value);
  const config: ChronosConfig = { ...DEFAULT_CONFIG, ...overrides };

  if (!isValidTimezone(config.defaultTimezone)) {
    return err(
      new ChronosError({
        code: ChronosErrorCode.TIMEZONE_INVALID,
        message: `Invalid IANA timezone: ${config.defaultTimezone}`,
        entity: config.defaultTimezone,
      }),
    );
  }
  if (config.defaultTimeoutMs > config.maximumTimeoutMs) {
    return err(validationError("defaultTimeoutMs must not exceed maximumTimeoutMs"));
  }
  if (config.leaseRenewalMs >= config.leaseDurationMs) {
    return err(validationError("leaseRenewalMs must be less than leaseDurationMs"));
  }
  if (config.instanceHeartbeatMs >= config.instanceStaleAfterMs) {
    return err(validationError("instanceHeartbeatMs must be less than instanceStaleAfterMs"));
  }
  if (
    config.piSeatbeltExtension !== undefined &&
    (config.piSeatbeltExtension.trim() !== config.piSeatbeltExtension ||
      /[\0\r\n]/.test(config.piSeatbeltExtension))
  ) {
    return err(validationError("piSeatbeltExtension must be trimmed and single-line"));
  }
  if (config.permissionMode === "pi-seatbelt-sandbox" && !config.piSeatbeltExtension) {
    return err(
      validationError("piSeatbeltExtension is required when permissionMode is pi-seatbelt-sandbox"),
    );
  }
  if (
    config.piSeatbeltExtension !== undefined &&
    !isAbsolute(config.piSeatbeltExtension) &&
    !/^(npm:|git:|https?:\/\/|ssh:\/\/)/.test(config.piSeatbeltExtension)
  ) {
    return err(
      validationError(
        "piSeatbeltExtension must be an absolute path or an npm, git, HTTP, or SSH source",
      ),
    );
  }

  return ok(config);
}

/** Builds trusted configuration and throws a structured error for invalid overrides. */
export function createConfig(overrides: unknown = {}): ChronosConfig {
  const result = decodeConfig(overrides);
  if (!result.ok) throw result.error;
  return result.value;
}
