#!/usr/bin/env node
/**
 * sibling-naming-check — Plan51 cycle 03-15 supporting Dev tool.
 *
 * Implements **Rule #78 §78.7 sibling-naming convention** for the
 * canonical docs corpus (`share/openstarry_doc/Implementation_Reference/EN/`
 * ↔ `share/openstarry_doc/Implementation_Reference/TW/`).
 *
 * **Cycle 03-28 prep (task #191; 2026-05-12)**: retargeted from the
 * now-removed Dev-side mirror `agent_dev/openstarry/docs/{EN,TW}/` to the
 * single-source canonical at `share/openstarry_doc/Implementation_Reference/{EN,TW}/`
 * per Master directive 2026-05-08 release-structure simplification
 * (canonical-doc-only single-target rule). Override either path with
 * `OPENSTARRY_DOC_EN_DIR` / `OPENSTARRY_DOC_TW_DIR` env vars for
 * non-default invocation contexts (e.g. agent_test sibling).
 *
 * The L3 operational mechanism (F-15 v3 §3 + §4) is research-team scope
 * (`tools/f15_check.py` extension, ~130-230 LOC). This Dev-side tool is the
 * narrower forward-only check: every `EN/<name>.md` MUST have a
 * corresponding `TW/<name>.md`, per the existing Dev convention codified
 * at cycle 03-14
 * audit #93.
 *
 * Default exit: 0 (informational). With `--strict`: exit non-zero on any gap.
 * With `--json`: line-delimited JSON output.
 *
 * Companion to Rule #75 §75.X / Rule #78 §78.6 layer-2 (pnpm build integration);
 * recommended invocation pre-commit / pre-tag.
 *
 * @see openstarry_doc/Reference/11_Rule_78_TW_Translation.md
 * @see openstarry_doc/Research_Methodology/16_F_15_v3_Third_Tier_Amendment.md
 */

import { readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const argv = process.argv.slice(2);
const strict = argv.includes('--strict');
const jsonMode = argv.includes('--json');

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
// REPO_ROOT = `agent_dev/openstarry/`; canonical lives at sibling-of-parent
// `share/openstarry_doc/Implementation_Reference/{EN,TW}/` per Master
// directive 2026-05-08 (single-source canonical-doc-only).
const REPO_ROOT = resolve(SCRIPT_DIR, '..');
const DEFAULT_EN_DIR = resolve(REPO_ROOT, '..', '..', 'share', 'openstarry_doc', 'Implementation_Reference', 'EN');
const DEFAULT_TW_DIR = resolve(REPO_ROOT, '..', '..', 'share', 'openstarry_doc', 'Implementation_Reference', 'TW');
const EN_DIR = process.env.OPENSTARRY_DOC_EN_DIR ?? DEFAULT_EN_DIR;
const TW_DIR = process.env.OPENSTARRY_DOC_TW_DIR ?? DEFAULT_TW_DIR;

function listMarkdown(dir) {
  try {
    return readdirSync(dir).filter((n) => n.endsWith('.md'));
  } catch {
    return [];
  }
}

function checkStructuralFidelity(en, tw) {
  // Plan51 R3 §78.4 sub-clause "Structural fidelity layer-bound" (22/1):
  // machine-checkable layer = heading hierarchy + table column count + code-block count.
  const headEN = (en.match(/^#{1,6}\s/gm) ?? []).length;
  const headTW = (tw.match(/^#{1,6}\s/gm) ?? []).length;
  const codeEN = (en.match(/```/g) ?? []).length;
  const codeTW = (tw.match(/```/g) ?? []).length;
  return {
    headings: { en: headEN, tw: headTW, match: headEN === headTW },
    code_fences: { en: codeEN, tw: codeTW, match: codeEN === codeTW },
  };
}

const findings = [];
const enFiles = listMarkdown(EN_DIR);
const twFiles = new Set(listMarkdown(TW_DIR));

for (const fileName of enFiles) {
  if (!twFiles.has(fileName)) {
    findings.push({
      severity: 'HIGH',
      kind: 'TW_MISSING',
      file: fileName,
      en_path: `Implementation_Reference/EN/${fileName}`,
    });
    continue;
  }
  const enContent = readFileSync(join(EN_DIR, fileName), 'utf-8');
  const twContent = readFileSync(join(TW_DIR, fileName), 'utf-8');
  const fidelity = checkStructuralFidelity(enContent, twContent);
  if (!fidelity.headings.match) {
    findings.push({
      severity: 'MED',
      kind: 'HEADING_COUNT_MISMATCH',
      file: fileName,
      detail: fidelity.headings,
    });
  }
  if (!fidelity.code_fences.match) {
    findings.push({
      severity: 'MED',
      kind: 'CODE_FENCE_COUNT_MISMATCH',
      file: fileName,
      detail: fidelity.code_fences,
    });
  }
}

// Reverse: TW siblings without EN canonical (suspicious — Rule #78 §78.7 EN canonical-first)
for (const tw of twFiles) {
  if (!enFiles.includes(tw)) {
    findings.push({
      severity: 'LOW',
      kind: 'TW_ORPHAN',
      file: tw,
      tw_path: `Implementation_Reference/TW/${tw}`,
    });
  }
}

let exitCode = 0;
for (const f of findings) {
  if (jsonMode) {
    process.stdout.write(JSON.stringify(f) + '\n');
  } else {
    process.stdout.write(`[${f.severity}] ${f.kind} ${f.file}` +
      (f.detail ? ` — ${JSON.stringify(f.detail)}` : '') + '\n');
  }
  if (strict && (f.severity === 'HIGH' || f.severity === 'MED')) exitCode = 1;
}

if (!jsonMode) {
  const counts = { HIGH: 0, MED: 0, LOW: 0 };
  for (const f of findings) counts[f.severity]++;
  process.stdout.write(
    `\nsibling-naming-check summary: HIGH=${counts.HIGH} MED=${counts.MED} LOW=${counts.LOW} ` +
    `(EN files: ${enFiles.length}; TW files: ${twFiles.size})\n`,
  );
}

process.exit(exitCode);
