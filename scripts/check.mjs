import fs from 'node:fs';
import { spawnSync } from 'node:child_process';
const files = ['server.js', 'lambda.js', 'public/app.js', 'scripts/check.mjs', 'scripts/build.mjs', 'test/api.test.js'];
for (const file of files) {
  if (!fs.existsSync(file) || fs.statSync(file).size === 0) throw new Error(`Missing or empty file: ${file}`);
  const result = spawnSync(process.execPath, ['--check', file], { encoding: 'utf8' });
  if (result.status !== 0) { process.stderr.write(result.stderr || `Syntax error in ${file}\n`); process.exit(result.status || 1); }
}
console.log('FirstFlush syntax and required-file checks passed.');
