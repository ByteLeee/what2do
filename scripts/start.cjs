'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { spawn } = require('node:child_process');
const root = path.join(__dirname, '..');
function supportedNode(version) {
  const [major, minor] = version.replace(/^v/, '').split('.').map(Number);
  return major > 22 || major === 22 && minor >= 12;
}
function desktopEnvironment(env = process.env, platform = process.platform, uid = process.getuid?.()) {
  if (platform === 'linux' && uid === 0) return 'Electron 桌面应用不能以 root 运行。请使用普通用户的图形桌面会话；不要用 sudo npm start。';
  if (platform === 'linux' && !env.DISPLAY && !env.WAYLAND_DISPLAY) return '没有检测到图形桌面（DISPLAY / WAYLAND_DISPLAY）。纯 SSH / 无头容器不能显示此桌面应用；请在 Windows、macOS 或 Linux 图形桌面运行。';
  return '';
}
function childEnvironment(env = process.env) {
  const result = { ...env };
  // VS Code / other Electron tools can leak this flag into their terminal.
  // It makes the Electron executable run as plain Node and removes app APIs.
  delete result.ELECTRON_RUN_AS_NODE;
  return result;
}
function electronPath() {
  const packagePath = path.join(root, 'node_modules/electron/package.json');
  if (!fs.existsSync(packagePath)) throw new Error('没有安装 Electron 开发依赖。请在项目根目录运行 npm ci（不要使用 --omit=dev），然后 npm start。');
  const marker = path.join(root, 'node_modules/electron/path.txt');
  if (!fs.existsSync(marker)) console.log('[What2Do] 首次运行正在下载 Electron 桌面运行时；这与 npm 依赖下载是两步，需要能访问 GitHub。');
  let executable;
  try { executable = require('electron'); }
  catch { throw new Error('Electron 运行时下载或解压失败。请检查到 GitHub Releases 的网络连接，再运行 npm run setup 重试；只有 npm install 成功并不代表运行时已下载完成。'); }
  if (typeof executable !== 'string' || !fs.existsSync(executable)) throw new Error('Electron 可执行文件缺失，请运行 npm run setup 重新准备运行时。');
  return executable;
}
function main(args = process.argv.slice(2)) {
  try {
    if (!supportedNode(process.version)) throw new Error(`当前 Node.js ${process.version} 太旧；需要 Node.js 22.12+，建议使用 Node.js 24 LTS，再运行 npm ci。`);
    console.log(`[What2Do] Node ${process.version} · ${process.platform}/${process.arch}`);
    if (!args.includes('--setup')) {
      const problem = desktopEnvironment(); if (problem) throw new Error(problem);
    }
    const executable = electronPath();
    if (args.includes('--setup')) { console.log('[What2Do] Electron 运行时已就绪。使用 npm start 打开桌面应用。'); return; }
    console.log('[What2Do] 正在打开桌面窗口…');
    const child = spawn(executable, [root], { cwd: root, stdio: 'inherit', env: childEnvironment(), windowsHide: false });
    child.once('error', error => { console.error(`[What2Do] 无法启动 Electron（${error.code || '未知错误'}）。请运行 npm run doctor 检查环境。`); process.exitCode = 1; });
    child.once('exit', (code, signal) => {
      if (code || signal) console.error(`[What2Do] 应用异常退出（${signal || code}）。请运行 npm run doctor，并保留此终端中的完整报错。`);
      process.exitCode = code ?? (signal ? 1 : 0);
    });
    for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => { if (child.exitCode === null) child.kill(signal); });
  } catch (error) { console.error(`[What2Do] ${error.message}`); process.exitCode = 1; }
}
if (require.main === module) main();
module.exports = { supportedNode, desktopEnvironment, childEnvironment, electronPath };
