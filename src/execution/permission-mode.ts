import type { PermissionMode } from "../config/defaults.js";

export const CHRONOS_PERMISSION_MODE_ENV = "CHRONOS_PERMISSION_MODE";
export const PI_SEATBELT_PROFILE_ENV = "PI_SEATBELT_PROFILE";
export const PI_SEATBELT_PROFILE_SCOPE_ENV = "PI_SEATBELT_PROFILE_SCOPE";
export const PI_SEATBELT_PROFILE_SCOPE = "tool-subprocess-v1";

export function delegatesToPiSeatbelt(mode: PermissionMode | undefined): boolean {
  return mode === "pi-seatbelt-sandbox";
}
