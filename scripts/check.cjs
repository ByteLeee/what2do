'use strict';
const { execFileSync } = require('node:child_process');
const { readdirSync } = require('node:fs');
const { join } = require('node:path');
function check(dir) { for (const f of readdirSync(dir, { withFileTypes: true })) { const p = join(dir, f.name); if (f.isDirectory()) check(p); else if (/\.(cjs|js)$/.test(p)) execFileSync(process.execPath, ['--check', p], { stdio: 'inherit' }); } }
for (const dir of ['app', 'test', 'scripts']) check(dir);
console.log('JavaScript syntax OK');
