import { describe, it, expect } from 'vitest';
import {
  AssertionCoverageReporter,
  type VitestFile,
  type VitestTask,
} from '../../src/testing/assertion-coverage-reporter';

function makeTask(name: string, assertionCount: number): VitestTask {
  return {
    id: name,
    name,
    type: 'test',
    result: { state: 'pass', assertionCount },
  };
}

function makeFile(name: string, tasks: VitestTask[]): VitestFile {
  return { name, tasks };
}

describe('AssertionCoverageReporter', () => {
  it('classifies test with 0 assertions as SUSPECT', () => {
    const reporter = new AssertionCoverageReporter({ outputPath: '/dev/null' });
    const file = makeFile('empty.test.ts', [
      makeTask('does something', 0),
      makeTask('also does something', 3),
    ]);

    reporter.onFinished([file]);
    const report = reporter.getReport()!;

    expect(report.files[0].suspects).toContain('does something');
    expect(report.files[0].classification).toBe('SUSPECT');
  });

  it('classifies file with density < 1.0 as WARNING when no 0-assertion tests', () => {
    // A file with no tasks has density 0 and no suspects → WARNING
    const reporter = new AssertionCoverageReporter({ outputPath: '/dev/null' });
    const file = makeFile('empty-file.test.ts', []);

    reporter.onFinished([file]);
    const report = reporter.getReport()!;

    expect(report.files[0].density).toBe(0);
    expect(report.files[0].suspects).toHaveLength(0);
    expect(report.files[0].classification).toBe('WARNING');
  });

  it('classifies file with density >= 1.0 and no suspects as OK', () => {
    const reporter = new AssertionCoverageReporter({ outputPath: '/dev/null' });
    const file = makeFile('good.test.ts', [
      makeTask('validates input', 2),
      makeTask('validates output', 3),
    ]);

    reporter.onFinished([file]);
    const report = reporter.getReport()!;

    expect(report.files[0].density).toBeGreaterThanOrEqual(1.0);
    expect(report.files[0].suspects).toHaveLength(0);
    expect(report.files[0].classification).toBe('OK');
  });

  it('generates valid JSON output with required fields', () => {
    const reporter = new AssertionCoverageReporter({ outputPath: '/dev/null' });
    const file = makeFile('sample.test.ts', [makeTask('test A', 1)]);

    reporter.onFinished([file]);
    const report = reporter.getReport()!;

    expect(typeof report.timestamp).toBe('string');
    expect(Array.isArray(report.files)).toBe(true);
    expect(typeof report.summary).toBe('object');

    // Verify round-trip through JSON
    const parsed = JSON.parse(JSON.stringify(report)) as typeof report;
    expect(parsed.summary.totalFiles).toBe(1);
  });

  it('summary counts are correct across multiple files', () => {
    const reporter = new AssertionCoverageReporter({ outputPath: '/dev/null' });
    const files = [
      makeFile('a.test.ts', [makeTask('ok test', 2)]),
      makeFile('b.test.ts', [makeTask('suspect test', 0)]),
      makeFile('c.test.ts', []),
    ];

    reporter.onFinished(files);
    const report = reporter.getReport()!;
    const { summary } = report;

    expect(summary.totalFiles).toBe(3);
    expect(summary.totalTests).toBe(2);      // a:1 test, b:1 test, c:0 tests
    expect(summary.totalAssertions).toBe(2); // a:2, b:0, c:0
    expect(summary.suspectCount).toBe(1);    // b has a 0-assertion test → SUSPECT
    expect(summary.warningCount).toBe(1);    // c is empty → WARNING (density=0, no suspects)
    expect(summary.overallDensity).toBe(1);  // 2 assertions / 2 tests
  });
});
