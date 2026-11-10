/**
 * Entry point for the Windows uninstaller only (built to dist/app/uninstall-cleanup.cjs):
 *   ELECTRON_RUN_AS_NODE=1 Jarvis.exe resources/app/dist/app/uninstall-cleanup.cjs [userData]
 * Kept apart from uninstall-cleanup.ts so that importing the cleanup never runs it.
 */
import os from 'node:os';
import { defaultUserData, uninstallCleanup } from './uninstall-cleanup.js';

const userData = process.argv[2] || defaultUserData();
uninstallCleanup({ home: os.homedir(), userData })
  .then((done) => {
    for (const d of done) console.log(d);
    process.exit(0);
  })
  .catch(() => process.exit(0)); // never block uninstalling
