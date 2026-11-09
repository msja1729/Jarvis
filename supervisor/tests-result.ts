/**
 * Reads test results from the output of a test command, so the supervisor can say
 * "Tests: 12 passed, 1 failed" without anyone reading the logs.
 */
export interface TestResult {
  ok: boolean;
  passed?: number;
  failed?: number;
  command: string;
}

export const TEST_COMMAND = /\b(test|tests|vitest|jest|pytest|mocha|ava|spec|unittest|go test|cargo test|dotnet test|mvn test|gradle\w* test|phpunit|rspec)\b/i;

const num = (re: RegExp, text: string): number | undefined => {
  let total: number | undefined;
  for (const m of text.matchAll(re)) total = (total ?? 0) + Number(m[1]);
  return total;
};

export function readTestOutput(command: string, output: string, isError: boolean): TestResult | null {
  if (!TEST_COMMAND.test(command)) return null;
  const t = output.replace(/\x1b\[[0-9;]*m/g, ''); // colours
  // vitest "Tests  2 failed | 10 passed (12)", jest "Tests: 1 failed, 2 passed", pytest "2 passed, 1 failed",
  // mocha "3 passing / 1 failing", node:test "# pass 3 / # fail 0", cargo "test result: ok. 3 passed; 0 failed"
  // the line that counts tests ("Tests  12 passed", "Tests: 3 passed"), not "Test Files  1 failed"
  const line = t.match(/^\s*Tests?:?\s+\d.*$/m)?.[0] ?? t;
  let passed = num(/(\d+)\s+(?:passed|passing)\b/gi, line) ?? num(/#\s*pass\s+(\d+)/gi, t);
  let failed = num(/(\d+)\s+(?:failed|failing)\b/gi, line) ?? num(/#\s*fail\s+(\d+)/gi, t);
  if (line !== t && passed === undefined && failed === undefined) {
    passed = num(/(\d+)\s+(?:passed|passing)\b/gi, t);
    failed = num(/(\d+)\s+(?:failed|failing)\b/gi, t);
  }
  if (passed === undefined && failed === undefined) {
    const bad = isError || /\bFAIL(ED)?\b|AssertionError|Error:|not ok\b/.test(t);
    return { ok: !bad, command };
  }
  return { ok: (failed ?? 0) === 0 && !(isError && !passed), passed, failed, command };
}

export function describeTests(r: TestResult): string {
  const parts = [r.passed !== undefined ? `${r.passed} passed` : '', r.failed ? `${r.failed} failed` : ''].filter(Boolean);
  return parts.length ? `Tests: ${parts.join(', ')}.` : r.ok ? 'Tests passed.' : 'Tests failed.';
}
