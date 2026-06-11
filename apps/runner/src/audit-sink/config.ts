/**
 * audit-sink/config — C48-M2e configuration surface.
 *
 * Resolves the JSONL audit-trail path and ring-buffer sizing from env.
 * Default path is `<data_dir>/audit-trail.jsonl` where `<data_dir>` comes
 * from the OpenStarry home layout (bootstrap.ts).
 *
 * @since Plan48 C48-M2e
 */

import { join } from 'node:path';
import { homedir } from 'node:os';
import { envInt, envString } from '../audit-infra/env-parse.js';

export const DEFAULT_AUDIT_SINK_PATH_REL = 'audit-trail.jsonl';
export const DEFAULT_AUDIT_BUFFER_MAX = 512;
export const DEFAULT_DEDUPE_WINDOW = 1024;

export interface AuditSinkConfig {
  readonly path: string;
  readonly maxBufferSize: number;
  readonly dedupeWindow: number;
}

export function resolveAuditSinkConfig(
  overrides?: Partial<AuditSinkConfig>,
): AuditSinkConfig {
  const dataDir = envString('OPENSTARRY_DATA_DIR', join(homedir(), '.openstarry'));
  const defaultPath = join(dataDir, DEFAULT_AUDIT_SINK_PATH_REL);
  return {
    path: overrides?.path
      ?? envString('AUDIT_SINK_PATH', defaultPath),
    maxBufferSize: overrides?.maxBufferSize
      ?? envInt('AUDIT_SINK_BUFFER_MAX', DEFAULT_AUDIT_BUFFER_MAX),
    dedupeWindow: overrides?.dedupeWindow
      ?? envInt('AUDIT_SINK_DEDUPE_WINDOW', DEFAULT_DEDUPE_WINDOW),
  };
}
