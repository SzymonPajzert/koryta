import { spawn } from 'node:child_process';

const [, , command, ...args] = process.argv;

if (!command) {
  console.error('Usage: node scripts/run-with-emulators.mjs <command> [args...]');
  process.exit(1);
}

const isWindows = process.platform === 'win32';

// On Windows, npm-installed executables (e.g. nuxt, firebase) are .cmd wrappers
// and cannot be spawned directly without the extension.
const resolvedCommand = isWindows ? `${command}.cmd` : command;

const child = spawn(resolvedCommand, args, {
  stdio: 'inherit',
  env: {
    ...process.env,
    USE_EMULATORS: 'true',
    FIRESTORE_EMULATOR_HOST: '127.0.0.1:8080',
    FIREBASE_AUTH_EMULATOR_HOST: '127.0.0.1:9099',
  },
});

child.on('exit', (code, signal) => {
  if (signal) {
    process.kill(process.pid, signal);
    return;
  }

  process.exit(code ?? 1);
});

child.on('error', (error) => {
  console.error(error);
  process.exit(1);
});
