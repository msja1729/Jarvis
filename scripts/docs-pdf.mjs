// Launches the PDF script with Electron (clearing ELECTRON_RUN_AS_NODE, which VS Code terminals set).
import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import electron from 'electron';

const env = { ...process.env };
delete env.ELECTRON_RUN_AS_NODE;
const script = path.join(path.dirname(fileURLToPath(import.meta.url)), 'docs-pdf.cjs');
spawn(electron, [script, ...process.argv.slice(2)], { stdio: 'inherit', env }).on('close', (code) => process.exit(code ?? 0));
