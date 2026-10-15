'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { supportedNode, desktopEnvironment } = require('./start.cjs');
const root = path.join(__dirname, '..');
let failures = 0;
function check(name, ok, detail) { console.log(`${ok ? 'OK  ' : 'FAIL'} ${name}: ${detail}`); if (!ok) failures++; }
console.log('What2Do 启动诊断（不会下载运行时、读取密钥或发送网络请求）\n');
check('Node.js', supportedNode(process.version), `${process.version}，需要 22.12+，建议 24 LTS`);
console.log(`INFO 系统: ${process.platform}/${process.arch}`);
const problem = desktopEnvironment(); check('桌面会话', !problem, problem || '可启动桌面应用');
if (process.env.ELECTRON_RUN_AS_NODE) console.log('INFO 检测到 ELECTRON_RUN_AS_NODE；npm start 将在子进程中清除它。');
const pkg = path.join(root, 'node_modules/electron/package.json');
check('Electron 依赖', fs.existsSync(pkg), fs.existsSync(pkg) ? '已安装' : '缺失，请运行 npm ci（需包含 devDependencies）');
let ready = false;
try {
  const dir = path.dirname(pkg), relative = fs.readFileSync(path.join(dir, 'path.txt'), 'utf8').trim();
  const executable = path.join(dir, 'dist', relative);
  ready = !!relative && fs.existsSync(executable);
  check('Electron 运行时', ready, ready ? '已下载' : '缺失，请运行 npm run setup');
} catch { check('Electron 运行时', false, '未下载或未解压，请运行 npm run setup；此步骤需要访问 GitHub Releases'); }
check('应用入口', fs.existsSync(path.join(root, 'app/main.cjs')), 'app/main.cjs');
console.log(`\n${failures ? `发现 ${failures} 项问题。请保留以上输出及 npm start 的报错。` : '基础检查通过。若仍无法打开，请保留 npm start 完整输出，并查看系统用户数据目录下的 logs/startup.log。'}`);
process.exitCode = failures ? 1 : 0;
