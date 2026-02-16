/**
 * Static analysis import restrictions for sandboxed plugins.
 * Parses plugin entry points with @babel/parser and checks for forbidden module imports.
 */

import { parse } from "@babel/parser";
import { readFile } from "node:fs/promises";
import { SandboxError } from "@openstarry/sdk";
import { createLogger } from "@openstarry/shared";

const logger = createLogger("ImportAnalyzer");

/** Default list of forbidden Node.js built-in modules */
const DEFAULT_BLOCKED_MODULES = [
  "fs", "fs/promises", "node:fs", "node:fs/promises",
  "child_process", "node:child_process",
  "net", "node:net",
  "dgram", "node:dgram",
  "http", "https", "http2", "node:http", "node:https", "node:http2",
  "cluster", "node:cluster",
  "worker_threads", "node:worker_threads",
  "inspector", "node:inspector",
  "v8", "node:v8",
];

export interface ImportAnalysisOptions {
  /** List of module names to block (extends defaults) */
  blockedModules?: string[];

  /** List of module names to allow (overrides blockedModules) */
  allowedModules?: string[];
}

interface ImportViolation {
  module: string;
  line: number;
  column: number;
  importType: "esm" | "require" | "dynamic";
}

/**
 * Normalize module name by stripping 'node:' prefix for consistent comparison.
 */
function normalizeModuleName(name: string): string {
  return name.replace(/^node:/, "");
}

/**
 * Build the effective blocklist by merging defaults with custom blocked and allowed modules.
 */
function buildBlocklist(options: ImportAnalysisOptions): Set<string> {
  const blocked = new Set<string>();

  // Add all default blocked modules (normalized)
  for (const mod of DEFAULT_BLOCKED_MODULES) {
    blocked.add(normalizeModuleName(mod));
  }

  // Add custom blocked modules (normalized)
  if (options.blockedModules) {
    for (const mod of options.blockedModules) {
      blocked.add(normalizeModuleName(mod));
    }
  }

  // Remove allowed modules from blocklist
  if (options.allowedModules) {
    for (const mod of options.allowedModules) {
      blocked.delete(normalizeModuleName(mod));
    }
  }

  return blocked;
}

/**
 * Check if a module name is forbidden.
 */
function isModuleForbidden(moduleName: string, blocklist: Set<string>): boolean {
  const normalized = normalizeModuleName(moduleName);
  return blocklist.has(normalized);
}

/**
 * Simple AST walker — recursively visits all nodes.
 */
function walkAst(node: unknown, visitor: (node: Record<string, unknown>) => void): void {
  if (!node || typeof node !== "object") return;

  if (Array.isArray(node)) {
    for (const child of node) {
      walkAst(child, visitor);
    }
    return;
  }

  const obj = node as Record<string, unknown>;
  if (typeof obj.type === "string") {
    visitor(obj);
  }

  for (const key of Object.keys(obj)) {
    if (key === "loc" || key === "start" || key === "end" || key === "leadingComments" || key === "trailingComments") continue;
    const val = obj[key];
    if (val && typeof val === "object") {
      walkAst(val, visitor);
    }
  }
}

/**
 * Validate plugin source code for forbidden imports.
 * Parses plugin entry point with @babel/parser and checks for forbidden modules.
 * @throws {SandboxError} if plugin imports blocked module
 */
export async function validatePluginImports(
  pluginPath: string,
  options: ImportAnalysisOptions,
): Promise<void> {
  const blocklist = buildBlocklist(options);

  // Read plugin source code
  let sourceCode: string;
  try {
    sourceCode = await readFile(pluginPath, "utf-8");
  } catch (err) {
    throw new SandboxError(
      pluginPath,
      `Cannot read plugin source for import analysis: ${err instanceof Error ? err.message : String(err)}`,
    );
  }

  // Parse with @babel/parser
  let ast: ReturnType<typeof parse>;
  try {
    ast = parse(sourceCode, {
      sourceType: "unambiguous",
      plugins: ["typescript", "jsx"],
      errorRecovery: true,
    });
  } catch (err) {
    throw new SandboxError(
      pluginPath,
      `Plugin code is invalid JavaScript/TypeScript: ${err instanceof Error ? err.message : String(err)}`,
    );
  }

  // Find all import violations by walking the AST
  const violations: ImportViolation[] = [];

  walkAst(ast.program, (node: Record<string, unknown>) => {
    // ESM: import fs from 'fs'
    if (node.type === "ImportDeclaration") {
      const source = node.source as { value: string; loc?: { start: { line: number; column: number } } };
      if (isModuleForbidden(source.value, blocklist)) {
        const loc = (node.loc as { start: { line: number; column: number } } | undefined);
        violations.push({
          module: source.value,
          line: loc?.start.line ?? 0,
          column: loc?.start.column ?? 0,
          importType: "esm",
        });
      }
    }

    // CallExpression: require('fs') or import('fs')
    if (node.type === "CallExpression") {
      const callee = node.callee as { type: string; name?: string };
      const args = node.arguments as Array<{ type: string; value?: string }>;
      const loc = (node.loc as { start: { line: number; column: number } } | undefined);

      // require('module')
      if (callee.type === "Identifier" && callee.name === "require") {
        if (args.length > 0 && args[0].type === "StringLiteral" && args[0].value) {
          if (isModuleForbidden(args[0].value, blocklist)) {
            violations.push({
              module: args[0].value,
              line: loc?.start.line ?? 0,
              column: loc?.start.column ?? 0,
              importType: "require",
            });
          }
        }
      }

      // Dynamic import('module')
      if (callee.type === "Import") {
        if (args.length > 0 && args[0].type === "StringLiteral" && args[0].value) {
          if (isModuleForbidden(args[0].value, blocklist)) {
            violations.push({
              module: args[0].value,
              line: loc?.start.line ?? 0,
              column: loc?.start.column ?? 0,
              importType: "dynamic",
            });
          }
        } else if (args.length > 0 && args[0].type !== "StringLiteral") {
          logger.warn("Computed dynamic import detected — cannot validate statically", {
            file: pluginPath,
            line: loc?.start.line ?? 0,
          });
        }
      }
    }
  });

  if (violations.length > 0) {
    const details = violations
      .map((v) => `  - ${v.importType} import of "${v.module}" at line ${v.line}:${v.column}`)
      .join("\n");

    throw new SandboxError(
      pluginPath,
      `Plugin imports forbidden module${violations.length > 1 ? "s" : ""}:\n${details}`,
    );
  }
}
