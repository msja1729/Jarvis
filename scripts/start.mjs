// Launch Electron without ELECTRON_RUN_AS_NODE (VS Code terminals set it, which
// makes Electron behave like plain Node and the app fails to start).
import { spawn } from 'node:child_process';
import electron from 'electron';

const env = { ...process.env };
delete env.ELECTRON_RUN_AS_NODE;
const child = spawn(electron, ['.', ...process.argv.slice(2)], { stdio: 'inherit', env });
child.on('close', (code) => process.exit(code ?? 0));
