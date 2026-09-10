/** The tiny test harness every device-free check script shares: `check` lines, one verdict. */
let failures = 0;

export function check(label: string, actual: unknown, expected: unknown): void {
  const ok = actual === expected;
  if (!ok) failures++;
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${label}`);
  if (!ok) console.log(`       expected ${expected}\n       actual   ${actual}`);
}

/** Print the verdict and exit with it. */
export function finish(): never {
  console.log(failures === 0 ? '\nall checks passed' : `\n${failures} check(s) failed`);
  process.exit(failures === 0 ? 0 : 1);
}

export const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));
