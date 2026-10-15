'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { supportedNode, desktopEnvironment, childEnvironment } = require('../scripts/start.cjs');
test('启动器明确拒绝过旧 Node，而不是在依赖内部崩溃', () => {
  for (const version of ['v18.20.0', 'v20.19.0', 'v22.11.0']) assert.equal(supportedNode(version), false);
  for (const version of ['v22.12.0', 'v24.0.0', 'v26.1.0']) assert.equal(supportedNode(version), true);
});
test('启动器识别 root 和无图形环境，不关闭生产沙箱', () => {
  assert.match(desktopEnvironment({ DISPLAY: ':1' }, 'linux', 0), /root/);
  assert.match(desktopEnvironment({}, 'linux', 1000), /图形桌面/);
  assert.equal(desktopEnvironment({ DISPLAY: ':1' }, 'linux', 1000), '');
  assert.equal(desktopEnvironment({ WAYLAND_DISPLAY: 'wayland-0' }, 'linux', 1000), '');
  assert.equal(desktopEnvironment({}, 'win32', undefined), '');
  assert.equal(desktopEnvironment({}, 'darwin', 0), '');
});
test('源码启动清除外部 Electron 工具泄漏的 RunAsNode 标志，其余环境不变', () => {
  const env = { ELECTRON_RUN_AS_NODE: '1', PATH: '/bin', ELECTRON_MIRROR: 'https://example.test' };
  const clean = childEnvironment(env);
  assert.equal(clean.ELECTRON_RUN_AS_NODE, undefined); assert.equal(env.ELECTRON_RUN_AS_NODE, '1');
  assert.equal(clean.PATH, env.PATH); assert.equal(clean.ELECTRON_MIRROR, env.ELECTRON_MIRROR);
});
