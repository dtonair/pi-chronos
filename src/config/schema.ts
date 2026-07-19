import { type ChronosConfig, DEFAULT_CONFIG } from "./defaults.js";

/** Deep partial: makes all properties optional recursively */
type DeepPartial<T> = T extends object ? { [K in keyof T]?: DeepPartial<T[K]> } : T;

/**
 * Configuration schema / builder. In Phase 1 this just exports the defaults
 * and provides a merge helper. Full validation via TypeBox will come in Phase 2
 * when config can be loaded from files.
 */
export function createConfig(overrides?: DeepPartial<ChronosConfig>): ChronosConfig {
  const base: ChronosConfig = {
    ...DEFAULT_CONFIG,
    defaults: { ...DEFAULT_CONFIG.defaults },
    importLimits: { ...DEFAULT_CONFIG.importLimits },
  };

  if (!overrides) return base;

  return {
    ...base,
    ...overrides,
    defaults: {
      ...base.defaults,
      ...(overrides.defaults ?? {}),
    },
    importLimits: {
      ...base.importLimits,
      ...(overrides.importLimits ?? {}),
    },
  } as ChronosConfig;
}
