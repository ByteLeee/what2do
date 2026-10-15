'use strict';
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');
const assert = require('node:assert/strict');
const root = path.join(__dirname, '..');
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'what2do-npm-start-'));
const marker = path.join(dir, 'startup-probe.json');
let output = '';
// Run the exact user-facing npm start path, with a leaked Electron flag on purpose.
const child = spawn(process.execPath, [process.env.npm_execpath, 'start'], { cwd: root, env: { ...process.env, ELECTRON_RUN_AS_NODE: '1', WHAT2DO_TEST_DATA: dir, WHAT2DO_STARTUP_PROBE: '1' } });
child.stdout.on('data', data => { output += data; process.stdout.write(data); });
child.stderr.on('data', data => { output += data; process.stderr.write(data); });
const timeout = setTimeout(() => { console.error('npm start did not complete the renderer handshake in 90 seconds'); child.kill(); process.exit(1); }, 90000);
child.on('error', error => { clearTimeout(timeout); console.error(error); process.exitCode = 1; });
child.on('exit', code => {
  clearTimeout(timeout);
  try {
    assert.equal(code, 0, output);
    assert.ok(fs.existsSync(marker), 'Renderer did not complete the real preload / IPC handshake');
    const probe = JSON.parse(fs.readFileSync(marker, 'utf8'));
    assert.equal(probe.bridgeReady, true); assert.equal(probe.visible, true);
    assert.equal(probe.platform, process.platform);
    console.log(`SOURCE STARTUP PASSED: npm start on ${probe.platform}/${probe.arch}; real window + preload/IPC ready; clean exit.`);
  } catch (error) { console.error(error); process.exitCode = 1; }
  finally { fs.rmSync(dir, { recursive: true, force: true }); }
});
