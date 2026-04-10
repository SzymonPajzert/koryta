import { mkdir, rm } from 'node:fs/promises';
import { spawn } from 'node:child_process';

const bucketPrefix = 'gs://koryta-pl-crawled/hostname=koryta.pl/';
const exportDir = '.firebase/firestore_export';

function run(command, args, options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      stdio: ['ignore', 'pipe', 'inherit'],
      ...options,
    });

    let stdout = '';

    child.stdout.on('data', (chunk) => {
      const text = chunk.toString();
      stdout += text;
      process.stdout.write(text);
    });

    child.on('error', (error) => {
      if (error.code === 'ENOENT') {
        reject(new Error(`Required command not found: ${command}. Install Google Cloud SDK and ensure gsutil is on PATH.`));
        return;
      }

      reject(error);
    });
    child.on('exit', (code) => {
      if (code === 0) {
        resolve(stdout);
        return;
      }

      reject(new Error(`${command} exited with code ${code ?? 'unknown'}`));
    });
  });
}

try {
  console.log(`Fetching the latest backup path from ${bucketPrefix}...`);

  const listing = await run('gsutil', ['ls', bucketPrefix]);
  const latestBackupPath = listing
    .split(/\r?\n/u)
    .map((line) => line.trim())
    .filter((line) => line.includes('date='))
    .sort()
    .at(-1);

  if (!latestBackupPath) {
    console.error(`Error: Could not find any backups in ${bucketPrefix}`);
    process.exit(1);
  }

  console.log(`Latest backup found at: ${latestBackupPath}`);
  console.log(`Cleaning up old backup directory (${exportDir})...`);

  await rm(exportDir, { recursive: true, force: true });
  await mkdir(exportDir, { recursive: true });

  console.log(`Downloading backup to ${exportDir}...`);
  await run('gsutil', ['-m', 'cp', '-r', `${latestBackupPath}*`, `${exportDir}/`], { shell: true });

  console.log(`Backup successfully downloaded to ${exportDir}`);
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
}
