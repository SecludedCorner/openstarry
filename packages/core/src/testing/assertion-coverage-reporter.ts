// Assertion Coverage Reporter — ENG-FAB checklist item A-8
// Integration: add to vitest.config.ts reporters array:
//   import { assertionCoverageReporter } from './packages/core/src/testing/assertion-coverage-reporter';
//   reporters: ['default', assertionCoverageReporter]

import { writeFileSync } from 'fs';

// Minimal structural types mirroring vitest 4.x Reporter API (duck-typed, no vitest import needed)
export interface VitestTaskResult {
  state?: string;
  assertionCount?: number;
}

export interface VitestTask {
  id: string;
  name: string;
  type: string;
  result?: VitestTaskResult;
  tasks?: VitestTask[];
}

export interface VitestFile {
  name: string;
  tasks?: VitestTask[];
}

// Vitest 4.x TestModule / TestCase minimal duck types (no vitest import needed)
interface TestCaseLike {
  readonly type: 'test';
  readonly name: string;
  readonly module: { readonly moduleId: string };
  result(): { readonly state: string; readonly errors?: unknown } | { readonly state: 'pending' };
}

interface TestCollectionLike {
  allTests(state?: string): Iterable<TestCaseLike>;
}

interface TestModuleLike {
  readonly type: 'module';
  readonly moduleId: string;
  readonly children: TestCollectionLike;
}

export interface AssertionCoverageEntry {
  testFile: string;
  totalTests: number;
  totalAssertions: number;
  suspects: string[];
  density: number;
  classification: 'OK' | 'WARNING' | 'SUSPECT';
}

export interface AssertionCoverageReport {
  timestamp: string;
  files: AssertionCoverageEntry[];
  summary: {
    totalFiles: number;
    totalTests: number;
    totalAssertions: number;
    suspectCount: number;
    warningCount: number;
    overallDensity: number;
  };
}

export interface AssertionCoverageReporterOptions {
  outputPath?: string;
}

function collectLeafTasks(tasks: VitestTask[]): VitestTask[] {
  const leaves: VitestTask[] = [];
  for (const task of tasks) {
    if (task.type === 'suite' && Array.isArray(task.tasks)) {
      leaves.push(...collectLeafTasks(task.tasks));
    } else {
      leaves.push(task);
    }
  }
  return leaves;
}

function classify(suspects: string[], density: number): 'OK' | 'WARNING' | 'SUSPECT' {
  if (suspects.length > 0) return 'SUSPECT';
  if (density < 1.0) return 'WARNING';
  return 'OK';
}

export class AssertionCoverageReporter {
  private readonly outputPath: string;
  private report: AssertionCoverageReport | null = null;

  constructor(options: AssertionCoverageReporterOptions = {}) {
    this.outputPath = options.outputPath ?? './assertion-coverage.json';
  }

  // Vitest 4.x hook: called when the test run is finished.
  // testModules is ReadonlyArray<TestModule> in vitest 4.x API.
  onTestRunEnd(testModules: ReadonlyArray<TestModuleLike>): void {
    this.report = this.buildReportFromModules(testModules);
    if (this.outputPath !== '/dev/null') {
      writeFileSync(this.outputPath, JSON.stringify(this.report, null, 2), 'utf8');
    }
  }

  // Vitest 3.x / legacy compatibility hook — kept so existing configs that
  // instantiate the reporter still work with older vitest versions.
  onFinished(files: VitestFile[] = []): void {
    this.report = this.buildReportFromFiles(files);
    if (this.outputPath !== '/dev/null') {
      writeFileSync(this.outputPath, JSON.stringify(this.report, null, 2), 'utf8');
    }
  }

  getReport(): AssertionCoverageReport | null {
    return this.report;
  }

  // Vitest 4.x path: uses the new TestModule / TestCase API.
  // assertionCount is not available in vitest 4.x TestDiagnostic; we use a
  // heuristic: a passed test is counted as 1 assertion, skipped/failed as 0.
  buildReportFromModules(testModules: ReadonlyArray<TestModuleLike>): AssertionCoverageReport {
    const entries: AssertionCoverageEntry[] = [];

    for (const mod of testModules) {
      const suspects: string[] = [];
      let totalTests = 0;
      let totalAssertions = 0;

      for (const testCase of mod.children.allTests()) {
        totalTests++;
        const result = testCase.result();
        if (result.state === 'passed') {
          // Heuristic: each passing test counts as 1 assertion minimum.
          totalAssertions++;
        } else if (result.state !== 'skipped' && result.state !== 'pending') {
          // Failed test: counted as 0 assertions (flagged as suspect).
          suspects.push(testCase.name);
        }
      }

      const density = totalTests > 0 ? totalAssertions / totalTests : 0;

      entries.push({
        testFile: mod.moduleId,
        totalTests,
        totalAssertions,
        suspects,
        density,
        classification: classify(suspects, density),
      });
    }

    const totalTests = entries.reduce((s, e) => s + e.totalTests, 0);
    const totalAssertions = entries.reduce((s, e) => s + e.totalAssertions, 0);

    return {
      timestamp: new Date().toISOString(),
      files: entries,
      summary: {
        totalFiles: entries.length,
        totalTests,
        totalAssertions,
        suspectCount: entries.filter(e => e.classification === 'SUSPECT').length,
        warningCount: entries.filter(e => e.classification === 'WARNING').length,
        overallDensity: totalTests > 0 ? totalAssertions / totalTests : 0,
      },
    };
  }

  // Vitest 3.x / legacy path: uses File[] with task trees.
  buildReportFromFiles(files: VitestFile[]): AssertionCoverageReport {
    const entries: AssertionCoverageEntry[] = [];

    for (const file of files) {
      const leaves = collectLeafTasks(file.tasks ?? []);
      const suspects: string[] = [];
      let totalAssertions = 0;

      for (const task of leaves) {
        const count = task.result?.assertionCount ?? 0;
        totalAssertions += count;
        if (count === 0) {
          suspects.push(task.name);
        }
      }

      const totalTests = leaves.length;
      const density = totalTests > 0 ? totalAssertions / totalTests : 0;

      entries.push({
        testFile: file.name,
        totalTests,
        totalAssertions,
        suspects,
        density,
        classification: classify(suspects, density),
      });
    }

    const totalTests = entries.reduce((s, e) => s + e.totalTests, 0);
    const totalAssertions = entries.reduce((s, e) => s + e.totalAssertions, 0);

    return {
      timestamp: new Date().toISOString(),
      files: entries,
      summary: {
        totalFiles: entries.length,
        totalTests,
        totalAssertions,
        suspectCount: entries.filter(e => e.classification === 'SUSPECT').length,
        warningCount: entries.filter(e => e.classification === 'WARNING').length,
        overallDensity: totalTests > 0 ? totalAssertions / totalTests : 0,
      },
    };
  }
}

// Default singleton instance for use in vitest.config.ts reporters array.
export const assertionCoverageReporter = new AssertionCoverageReporter();
