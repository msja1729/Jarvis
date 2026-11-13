import { describe, expect, it } from 'vitest';
import { plainCommand } from '../supervisor/plain.js';

// commands Claude actually ran in a real coding task (PowerShell on Windows)
describe('plain words for real PowerShell commands', () => {
  it.each([
    ['git --version; gh --version', 'check which version of a tool is installed'],
    ['Get-ChildItem | ForEach-Object { $_.Name } | Select-Object -First 5', 'look at files'],
    ['gh auth status; echo "exit: $LASTEXITCODE"', 'check your GitHub sign-in'],
    ['$o = npm install left-pad 2>&1 | Out-Null; echo "exit: $LASTEXITCODE"', 'install the add-on left-pad from the internet'],
    ['$o = npm test; [$o]; exit $LASTEXITCODE', "run the project's tests"],
    ['gh repo create tiny --public --source . --push; echo "exit: $LASTEXITCODE"', 'publish the code online on GitHub'],
    ['git init; git add .; git commit -m "first"', 'start keeping track of code changes, look at or organise the code changes and then save a checkpoint of the code changes'],
    ['echo hello', 'look at files'],
  ])('%s → %s', (cmd, said) => {
    expect(plainCommand(cmd)).toBe(said);
  });
});
