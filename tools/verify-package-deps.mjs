#!/usr/bin/env node
/**
 * verify-package-deps — Plan52 cycle 03-14 supporting Dev tool.
 *
 * Static dependency-declaration auditor for pnpm workspaces. Walks each
 * package's source files (.ts / .tsx / .mjs / .cjs / .js), extracts bare
 * import specifiers, and compares against the package's declared
 * dependencies / devDependencies / peerDependencies / workspace siblings.
 *
 * Findings:
 *   - MISSING (HIGH)     — bare import not declared anywhere; would fail at
 *                          fresh `pnpm install --production && build`
 *   - MISDECLARED (MED)  — runtime-only import declared in devDependencies
 *                          (production install would drop it)
 *   - UNUSED (LOW)       — declared dependency not referenced by any source
 *                          file (cosmetic; no runtime impact)
 *
 * Default exit: 0 (informational). With `--strict`: exit non-zero on
 * MISSING / MISDECLARED. With `--json`: line-delimited JSON output.
 *
 * Companion gate to Rule #75 §75.X (pnpm build at release tag) — running
 * this pre-commit / pre-tag catches the dependency-drift class that would
 * otherwise surface as a fresh-build failure.
 *
 * Usage:
 *   node tools/verify-package-deps.mjs           # informational
 *   node tools/verify-package-deps.mjs --strict  # CI / pre-tag gate
 *   node tools/verify-package-deps.mjs --json    # machine-readable
 *   node tools/verify-package-deps.mjs --package packages/sdk
 *
 * @see openstarry_doc/Reference/10_Rule_75_Section_75_X_pnpm_build.md
 * @see research record/cycle03-14/deliver/O4_R_input_5_candidates_final.md §6
 */

import { readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

// ─── CLI argument parsing ────────────────────────────────────────────────

const argv = process.argv.slice(2);
const strict = argv.includes('--strict');
const jsonMode = argv.includes('--json');
const pkgFilterIdx = argv.indexOf('--package');
const pkgFilter = pkgFilterIdx >= 0 ? argv[pkgFilterIdx + 1] : null;

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(SCRIPT_DIR, '..');

// ─── Workspace discovery ─────────────────────────────────────────────────

function readWorkspacePackages() {
  let raw;
  try {
    raw = readFileSync(join(REPO_ROOT, 'pnpm-workspace.yaml'), 'utf-8');
  } catch {
    fail(`pnpm-workspace.yaml not found at repo root ${REPO_ROOT}`);
  }
  // Minimal YAML parsing — pnpm-workspace.yaml has only `packages: [list]`
  // form in this monorepo. Extract list entries with a focused scanner so
  // we do not pull in a YAML dependency.
  const patterns = parseSimpleYamlPackagesList(raw);
  const dirs = [];
  for (const pat of patterns) {
    // pnpm workspace patterns are simple globs — apps/*, packages/*, ../foo/*
    const expanded = expandGlob(pat);
    for (const d of expanded) {
      try {
        const pkgPath = join(d, 'package.json');
        const pkg = JSON.parse(readFileSync(pkgPath, 'utf-8'));
        dirs.push({ dir: d, name: pkg.name, pkg });
      } catch {
        // skip directories without package.json
      }
    }
  }
  return dirs;
}

function parseSimpleYamlPackagesList(raw) {
  const lines = raw.split(/\r?\n/);
  let inPackages = false;
  const out = [];
  for (const lineRaw of lines) {
    const line = lineRaw.replace(/#.*$/, ''); // strip line comments
    if (/^packages\s*:/.test(line)) {
      inPackages = true;
      continue;
    }
    if (inPackages) {
      // List entry form: `  - 'apps/*'` or `  - apps/*`
      const m = line.match(/^\s*-\s*['"]?([^'"#\s]+)['"]?/);
      if (m) {
        out.push(m[1]);
        continue;
      }
      // Section ended (next top-level key)
      if (/^\S/.test(line)) inPackages = false;
    }
  }
  return out;
}

function expandGlob(pattern) {
  // Only handles single trailing '*' (matches pnpm-workspace common case).
  const base = resolve(REPO_ROOT, pattern.replace(/\/\*$/, ''));
  const isStar = pattern.endsWith('/*');
  if (!isStar) {
    try {
      if (statSync(base).isDirectory()) return [base];
    } catch {}
    return [];
  }
  let entries;
  try {
    entries = readdirSync(base);
  } catch {
    return [];
  }
  const out = [];
  for (const e of entries) {
    const p = join(base, e);
    try {
      if (statSync(p).isDirectory()) out.push(p);
    } catch {}
  }
  return out;
}

// ─── Source walking ──────────────────────────────────────────────────────

const SOURCE_EXTENSIONS = new Set(['.ts', '.tsx', '.mjs', '.cjs', '.js']);
const SKIP_DIRS = new Set(['node_modules', 'dist', 'build', '.git', '__pycache__', '.turbo', 'coverage']);

function* walkSourceFiles(dir) {
  let entries;
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const ent of entries) {
    const p = join(dir, ent.name);
    if (ent.isDirectory()) {
      if (SKIP_DIRS.has(ent.name)) continue;
      yield* walkSourceFiles(p);
    } else if (ent.isFile()) {
      const dot = ent.name.lastIndexOf('.');
      if (dot < 0) continue;
      const ext = ent.name.slice(dot);
      if (SOURCE_EXTENSIONS.has(ext)) yield p;
    }
  }
}

// Captures bare specifiers from `import x from 'pkg'`, `import 'pkg'`,
// `from 'pkg'`, `require('pkg')`, dynamic `import('pkg')`. Skips relative
// paths (./ ../), absolute paths (/), and node: builtins.
const IMPORT_PATTERNS = [
  /(?:^|\s|;)import\s+[^'"]*?from\s+['"]([^'"]+)['"]/g,
  /(?:^|\s|;)import\s*\(\s*['"]([^'"]+)['"]\s*\)/g,
  /(?:^|\s|;)import\s+['"]([^'"]+)['"]/g,
  /(?:^|\s|=|\()require\s*\(\s*['"]([^'"]+)['"]\s*\)/g,
  /(?:^|\s|;)export\s+[^'"]*?from\s+['"]([^'"]+)['"]/g,
];

function extractImports(src) {
  const found = new Set();
  for (const re of IMPORT_PATTERNS) {
    re.lastIndex = 0;
    let m;
    while ((m = re.exec(src)) !== null) found.add(m[1]);
  }
  return [...found];
}

function packageNameOf(specifier) {
  if (specifier.startsWith('.') || specifier.startsWith('/')) return null;
  if (specifier.startsWith('node:')) return null;
  if (specifier.startsWith('@')) {
    // @scope/name[/subpath]
    const parts = specifier.split('/');
    if (parts.length < 2) return null;
    return `${parts[0]}/${parts[1]}`;
  }
  // bare or with subpath
  return specifier.split('/')[0];
}

const NODE_BUILTINS = new Set([
  'fs', 'path', 'os', 'crypto', 'http', 'https', 'url', 'util', 'stream',
  'events', 'child_process', 'cluster', 'net', 'tls', 'zlib', 'buffer',
  'querystring', 'string_decoder', 'readline', 'repl', 'tty', 'dgram',
  'dns', 'assert', 'process', 'worker_threads', 'perf_hooks', 'inspector',
  'async_hooks', 'fs/promises', 'timers', 'timers/promises', 'module',
  'v8', 'vm', 'console', 'string_decoder',
]);

function isTemplatePlaceholder(spec) {
  return spec.includes('{{') || spec.includes('}}') || spec.includes('${');
}

// ─── Dependency comparison ───────────────────────────────────────────────

function auditPackage(entry, workspaceNames) {
  const { dir, name, pkg } = entry;
  const declaredRuntime = new Set([
    ...Object.keys(pkg.dependencies ?? {}),
    ...Object.keys(pkg.peerDependencies ?? {}),
  ]);
  const declaredDev = new Set(Object.keys(pkg.devDependencies ?? {}));
  const declaredAll = new Set([...declaredRuntime, ...declaredDev]);

  const importsByFile = new Map();
  const allImports = new Set();
  const testImports = new Set();
  for (const file of walkSourceFiles(dir)) {
    let src;
    try {
      src = readFileSync(file, 'utf-8');
    } catch {
      continue;
    }
    const isTest = isTestPath(file);
    const importerImports = [];
    for (const spec of extractImports(src)) {
      if (isTemplatePlaceholder(spec)) continue;
      const pkgName = packageNameOf(spec);
      if (!pkgName) continue;
      if (NODE_BUILTINS.has(pkgName)) continue;
      importerImports.push(pkgName);
      allImports.add(pkgName);
      if (isTest) testImports.add(pkgName);
    }
    if (importerImports.length > 0) importsByFile.set(file, importerImports);
  }

  const findings = [];
  for (const imp of allImports) {
    const isWorkspace = workspaceNames.has(imp);
    const isDeclared = declaredAll.has(imp);
    if (!isDeclared && !isWorkspace) {
      findings.push({ severity: 'HIGH', kind: 'MISSING', package: name, dependency: imp });
      continue;
    }
    // Runtime-only import declared in devDependencies?
    const isRuntimeImport = !testImports.has(imp) || importedFromRuntime(importsByFile, imp);
    if (isRuntimeImport && !declaredRuntime.has(imp) && declaredDev.has(imp) && !isWorkspace) {
      findings.push({
        severity: 'MED',
        kind: 'MISDECLARED',
        package: name,
        dependency: imp,
        note: 'used at runtime but only in devDependencies',
      });
    }
  }
  for (const dep of declaredAll) {
    if (!allImports.has(dep)) {
      findings.push({ severity: 'LOW', kind: 'UNUSED', package: name, dependency: dep });
    }
  }
  return { name, dir: relative(REPO_ROOT, dir), findings };
}

function importedFromRuntime(importsByFile, dep) {
  for (const [file, imps] of importsByFile) {
    if (!imps.includes(dep)) continue;
    if (!isTestPath(file)) return true;
  }
  return false;
}

function isTestPath(file) {
  const norm = file.replace(/\\/g, '/');
  if (norm.includes('/__tests__/')) return true;
  if (norm.includes('/tests/')) return true;
  if (norm.includes('/test/')) return true;
  if (/\.test\.[jt]sx?$/.test(norm)) return true;
  if (/\.spec\.[jt]sx?$/.test(norm)) return true;
  // Tooling config files (vitest.config.ts, vite.config.ts, jest.config.js, ...)
  // are build-time, same lifecycle as tests; treat as test-side imports.
  if (/\/(vitest|vite|jest|rollup|webpack|tsup|tsdown)\.config\.[cm]?[jt]s$/.test(norm)) return true;
  return false;
}

// ─── Output ──────────────────────────────────────────────────────────────

function fail(msg) {
  process.stderr.write(`verify-package-deps: ${msg}\n`);
  process.exit(2);
}

const packages = readWorkspacePackages();
const workspaceNames = new Set(packages.map((p) => p.name).filter(Boolean));

let exitCode = 0;
const allFindings = [];
for (const entry of packages) {
  if (pkgFilter && !entry.dir.endsWith(pkgFilter) && entry.name !== pkgFilter) continue;
  const result = auditPackage(entry, workspaceNames);
  for (const f of result.findings) {
    allFindings.push({ ...f, dir: result.dir });
    if (jsonMode) {
      process.stdout.write(JSON.stringify({ ...f, dir: result.dir }) + '\n');
    } else {
      process.stdout.write(
        `[${f.severity}] ${f.kind} ${result.dir} → ${f.dependency}` +
        (f.note ? ` (${f.note})` : '') + '\n',
      );
    }
    if (strict && (f.severity === 'HIGH' || f.severity === 'MED')) exitCode = 1;
  }
}

if (!jsonMode) {
  const counts = { HIGH: 0, MED: 0, LOW: 0 };
  for (const f of allFindings) counts[f.severity]++;
  process.stdout.write(
    `\nverify-package-deps summary: HIGH=${counts.HIGH} MED=${counts.MED} LOW=${counts.LOW}` +
    ` (packages scanned: ${packages.length})\n`,
  );
}

process.exit(exitCode);
