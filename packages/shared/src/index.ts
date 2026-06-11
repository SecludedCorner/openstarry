export { createLogger } from "./logger/index.js";
export type { Logger, LogLevel, LogContext } from "./logger/index.js";

export { generateId } from "./utils/uuid.js";
export { validateInput, formatZodError, zodToJsonSchema } from "./utils/validation.js";
export type { ValidationResult } from "./utils/validation.js";

export { AgentConfigSchema } from "./utils/config-schema.js";
export type { ValidatedAgentConfig } from "./utils/config-schema.js";

export { AgentEventType } from "./constants/events.js";

export { SecureStore } from "./security/secure-store.js";
export type { SecureStoreOptions, EncryptedPayload } from "./security/secure-store.js";

export { validateRegexSafety, safeRegexTest, DEFAULT_MAX_INPUT_LEN } from "./utils/safe-regex.js";

export {
  ProjectConfigSchema,
  ProjectPermissionsSchema,
  ProjectPluginsSchema,
  ProjectPluginRefSchema,
} from "./utils/project-config-schema.js";
export type {
  ValidatedProjectConfig,
  ValidatedProjectPermissions,
  ValidatedProjectPlugins,
} from "./utils/project-config-schema.js";
