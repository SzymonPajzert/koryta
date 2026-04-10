import { spawn } from 'node:child_process';

const [, , ...args] = process.argv;

if (args.length === 0) {
  console.error('Usage: node scripts/run-with-emulators.mjs <command> [args...]');
  process.exit(1);
}

const command = args
  .map((arg) => {
    if (/[\s"]/u.test(arg)) {
      return `"${arg.replaceAll('"', '\\"')}"`;
    }

    return arg;
  })
  .join(' ');

const isWindows = process.platform === 'win32';

const child = spawn(isWindows ? 'cmd.exe' : '/bin/sh', isWindows ? ['/s', '/c', `"${command}"`] : ['-c', command], {
  stdio: 'inherit',
  windowsVerbatimArguments: isWindows,
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
