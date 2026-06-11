/**
 * AuditTrailWriter — JSONL writer for confidence audit events.
 *
 * Subscribes to `audit:completed` events and writes structured entries
 * to a JSONL file with rotation support.
 *
 * @skandha vijnana (識蘊)
 * @see Plan31 Wave 3, D2-R1 (Core built-in), D6-R1 (JSONL schema)
 * @module audit-trail-writer
 */

import type { EventBus, AuditTrailConfig } from "@openstarry/sdk";
import { DEFAULT_AUDIT_TRAIL_WRITER_CONFIG } from "@openstarry/sdk";
import { createLogger } from "@openstarry/shared";
import { createHash } from "node:crypto";
import * as fs from "node:fs";
import * as path from "node:path";

const logger = createLogger("AuditTrailWriter");

export interface AuditTrailEntry {
  readonly timestamp: number;
  readonly agentId: string;
  readonly sessionId?: string;
  readonly version: 1;
  readonly inputConfidence: number;
  readonly rawDelta: number;
  readonly clampedDelta: number;
  readonly wasClamped: boolean;
  readonly reasoning: string;
  readonly outputConfidence: number;
  readonly result: 'adjusted' | 'unchanged' | 'error';
  readonly auditDurationMs: number;
  // Plan32 Wave 5 fields (optional for backward compatibility)
  readonly riskCategory?: string;
  readonly thresholdAtDecision?: number;
  readonly gearAtDecision?: number;
  readonly decidedBy?: string;
  // Plan36b: Hash chain fields
  readonly prevHash?: string;
  readonly entryHash?: string;
  // Type discriminant for JSONL consumers (optional for backward compat)
  readonly type?: string;
}

export interface AuditTrailWriter {
  start(): void;
  stop(): Promise<void>;
}

export function createAuditTrailWriter(
  bus: EventBus,
  agentId: string,
  config: AuditTrailConfig,
): AuditTrailWriter {
  const maxSizeBytes = config.maxSizeBytes ?? DEFAULT_AUDIT_TRAIL_WRITER_CONFIG.maxSizeBytes;
  const maxFiles = config.maxFiles ?? DEFAULT_AUDIT_TRAIL_WRITER_CONFIG.maxFiles;
  const filePath = config.filePath;

  let unsubscribe: (() => void) | null = null;
  let unsubscribeToolAudited: (() => void) | null = null;
  let currentSize = 0;
  let lastHash = '0'; // Hash chain: first entry prevHash = '0', rotation resets

  function ensureDir(): void {
    const dir = path.dirname(filePath);
    if (dir && dir !== '.' && !fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
  }

  function getFileSize(): number {
    try {
      if (fs.existsSync(filePath)) {
        return fs.statSync(filePath).size;
      }
    } catch {
      // File doesn't exist or can't stat
    }
    return 0;
  }

  function rotate(): void {
    try {
      // Shift existing rotated files: .4 → .5 (delete), .3 → .4, .2 → .3, .1 → .2
      for (let i = maxFiles - 1; i >= 1; i--) {
        const src = `${filePath}.${i}`;
        const dst = `${filePath}.${i + 1}`;
        if (i + 1 >= maxFiles) {
          // Delete oldest
          try { fs.unlinkSync(src); } catch { /* ignore */ }
        } else if (fs.existsSync(src)) {
          fs.renameSync(src, dst);
        }
      }
      // Current → .1
      if (fs.existsSync(filePath)) {
        fs.renameSync(filePath, `${filePath}.1`);
      }
      currentSize = 0;
    } catch (err) {
      logger.error("Audit trail rotation failed", { error: String(err) });
    }
  }

  function computeHash(obj: Record<string, unknown>): string {
    const canonical = JSON.stringify(obj, Object.keys(obj).sort());
    return createHash('sha256').update(canonical).digest('hex');
  }

  function writeEntry(entry: AuditTrailEntry): void {
    try {
      ensureDir();

      // Plan36b: Hash chain — add prevHash, compute entryHash
      const withPrev = { ...entry, prevHash: lastHash } as Record<string, unknown>;
      const entryHash = computeHash(withPrev);
      const fullEntry = { ...withPrev, entryHash };

      const line = JSON.stringify(fullEntry) + '\n';
      const lineBytes = Buffer.byteLength(line, 'utf8');

      if (currentSize + lineBytes > maxSizeBytes) {
        rotate();
        // Chain reset on rotation — new file starts fresh
        lastHash = '0';
        const resetWithPrev = { ...entry, prevHash: lastHash } as Record<string, unknown>;
        const resetHash = computeHash(resetWithPrev);
        const resetEntry = { ...resetWithPrev, entryHash: resetHash };
        const resetLine = JSON.stringify(resetEntry) + '\n';
        fs.appendFileSync(filePath, resetLine, 'utf8');
        lastHash = resetHash;
        currentSize += Buffer.byteLength(resetLine, 'utf8');
        return;
      }

      fs.appendFileSync(filePath, line, 'utf8');
      lastHash = entryHash;
      currentSize += lineBytes;
    } catch (err) {
      logger.error("Audit trail write failed", { error: String(err) });
    }
  }

  return {
    start(): void {
      currentSize = getFileSize();
      unsubscribe = bus.on('audit:completed', (event) => {
        const payload = event.payload as {
          inputConfidence: number;
          rawDelta: number;
          clampedDelta: number;
          wasClamped: boolean;
          reasoning: string;
          outputConfidence: number;
          result: 'adjusted' | 'unchanged' | 'error';
          auditDurationMs: number;
          // Plan32 Wave 5
          riskCategory?: string;
          thresholdAtDecision?: number;
          gearAtDecision?: number;
          decidedBy?: string;
        } | undefined;

        if (!payload) return;

        const entry: AuditTrailEntry = {
          timestamp: event.timestamp,
          agentId,
          version: 1,
          type: 'confidence_audited',
          inputConfidence: payload.inputConfidence,
          rawDelta: payload.rawDelta,
          clampedDelta: payload.clampedDelta,
          wasClamped: payload.wasClamped,
          reasoning: payload.reasoning,
          outputConfidence: payload.outputConfidence,
          result: payload.result,
          auditDurationMs: payload.auditDurationMs,
          ...(payload.riskCategory !== undefined && { riskCategory: payload.riskCategory }),
          ...(payload.thresholdAtDecision !== undefined && { thresholdAtDecision: payload.thresholdAtDecision }),
          ...(payload.gearAtDecision !== undefined && { gearAtDecision: payload.gearAtDecision }),
          ...(payload.decidedBy !== undefined && { decidedBy: payload.decidedBy }),
        };

        writeEntry(entry);
      });

      unsubscribeToolAudited = bus.on('audit:tool_audited', (event) => {
        const payload = event.payload as {
          toolName: string;
          inferredRiskCategory: string;
          executionResult: 'success' | 'error';
          batchIndex: number;
          batchSize: number;
          routeRiskCategory?: string;
          // Plan39 W1 B-modified fields
          rawDelta?: number;
          clampedDelta?: number;
          decidedBy?: string;
          timestamp: number;
        } | undefined;

        if (!payload) return;

        const rawDelta = payload.rawDelta ?? 0;
        const clampedDelta = payload.clampedDelta ?? 0;

        const entry: AuditTrailEntry = {
          timestamp: event.timestamp,
          agentId,
          version: 1,
          type: 'tool_audited',
          // Required AuditTrailEntry fields — not applicable for tool audit; use sentinel values
          inputConfidence: 0,
          rawDelta,
          clampedDelta,
          wasClamped: rawDelta !== clampedDelta,
          reasoning: `tool:${payload.toolName} result:${payload.executionResult}`,
          outputConfidence: 0,
          result: payload.executionResult === 'error' ? 'error' : 'unchanged',
          auditDurationMs: 0,
          // Tool-specific context stored via riskCategory / decidedBy (AC-W1-6, CONSTRAINT-D1)
          riskCategory: payload.inferredRiskCategory,
          decidedBy: payload.decidedBy ?? `tool_audited:${payload.toolName}`,
        };

        writeEntry(entry);
      });
    },

    async stop(): Promise<void> {
      if (unsubscribe) {
        unsubscribe();
        unsubscribe = null;
      }
      if (unsubscribeToolAudited) {
        unsubscribeToolAudited();
        unsubscribeToolAudited = null;
      }
    },
  };
}
