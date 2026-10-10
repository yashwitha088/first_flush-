import fs from 'node:fs';
import { spawnSync } from 'node:child_process';
const required = ['package.json', 'server.js', 'lambda.js', 'public/index.html', 'public/app.js', 'public/styles.css', 'data/locations.json'];
for (const file of required) if (!fs.existsSync(file)) throw new Error(`Missing required file: ${file}`);
for (const file of ['server.js', 'lambda.js', 'public/app.js']) { const result = spawnSync(process.execPath, ['--check', file], { encoding: 'utf8' }); if (result.status !== 0) throw new Error(result.stderr); }
fs.rmSync('dist', { recursive: true, force: true }); fs.mkdirSync('dist', { recursive: true }); fs.cpSync('public', 'dist', { recursive: true });
console.log('FirstFlush frontend build written to dist/.');
