'use strict';
const { app, BrowserWindow, ipcMain, Notification, shell, safeStorage, Tray, Menu, nativeImage, powerMonitor, dialog } = require('electron');
const path = require('node:path');
const fs = require('node:fs');
const { pathToFileURL } = require('node:url');
const { Store } = require('./core/store.cjs');
const { Service } = require('./core/service.cjs');
const { Scheduler } = require('./core/scheduler.cjs');
const { assert, httpUrl } = require('./core/domain.cjs');
const dingtalk = require('./core/dingtalk.cjs');
const ai = require('./core/ai.cjs');
const entry = path.join(__dirname, 'ui/index.html');
let win, tray, store, service, scheduler, interval, quitting = false, aiBusy = false;
let rendererReady = false, probed = false;
if (process.env.WHAT2DO_TEST_DATA) app.setPath('userData', process.env.WHAT2DO_TEST_DATA);
function startupLog(event, error) {
  try {
    const dir = path.join(app.getPath('userData'), 'logs'); fs.mkdirSync(dir, { recursive: true });
    const file = path.join(dir, 'startup.log');
    if (fs.existsSync(file) && fs.statSync(file).size > 262144) fs.renameSync(file, `${file}.1`);
    const detail = String(error?.message || error || '').replace(/https?:\/\/[^\s]+/gi, '[URL]').slice(0, 1200);
    fs.appendFileSync(file, `${new Date().toISOString()} ${event} ${detail}\n`, { mode: 0o600 });
  } catch { /* Logging must never prevent launch. */ }
}
process.on('uncaughtExceptionMonitor', error => startupLog('uncaught-exception', error));
function startupProbe() {
  if (probed || !rendererReady || !win?.isVisible() || process.env.WHAT2DO_STARTUP_PROBE !== '1' || !process.env.WHAT2DO_TEST_DATA) return;
  probed = true;
  fs.writeFileSync(path.join(app.getPath('userData'), 'startup-probe.json'), JSON.stringify({ platform: process.platform, arch: process.arch, bridgeReady: true, visible: true }));
  setTimeout(() => app.quit(), 500);
}
const singleInstance = app.requestSingleInstanceLock();
if (!singleInstance) app.quit();
app.setAppUserModelId('com.byteleee.what2do');
function changed() { if (win && !win.isDestroyed()) win.webContents.send('changed'); }
function show() { if (!win || win.isDestroyed()) createWindow(); win.show(); win.focus(); }
function createWindow() {
  win = new BrowserWindow({ width: 1280, height: 850, minWidth: 940, minHeight: 650, backgroundColor: '#f7f8f6', title: 'What2Do', icon: path.join(__dirname, 'ui/icon.png'), show: false, webPreferences: { preload: path.join(__dirname, 'preload.cjs'), contextIsolation: true, nodeIntegration: false, sandbox: true, webSecurity: true } });
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  win.webContents.on('will-navigate', event => event.preventDefault());
  win.webContents.session.setPermissionRequestHandler((_wc, _permission, callback) => callback(false));
  win.webContents.session.setPermissionCheckHandler(() => false);
  win.webContents.on('did-fail-load', (_event, code, description) => startupLog('renderer-load-failed', `${code}: ${description}`));
  win.webContents.on('render-process-gone', (_event, detail) => startupLog('renderer-gone', `${detail.reason}: ${detail.exitCode}`));
  win.loadFile(entry).catch(error => { startupLog('load-file-error', error); dialog.showErrorBox('What2Do 页面加载失败', `${error.message}\n请查看用户数据目录下 logs/startup.log。`); app.quit(); });
  win.once('ready-to-show', () => { win.show(); startupLog('window-visible'); startupProbe(); });
  win.on('close', event => { if (!quitting && tray) { event.preventDefault(); win.hide(); } });
}
async function seal(value) {
  assert(await safeStorage.isAsyncEncryptionAvailable(), '系统密钥存储不可用，未保存凭据；请解锁系统钥匙串后重试');
  return (await safeStorage.encryptStringAsync(value)).toString('base64');
}
async function unseal(cipher) {
  if (!cipher) return '';
  try { return (await safeStorage.decryptStringAsync(Buffer.from(cipher, 'base64'))).result; }
  catch { throw new Error('无法解密凭据，请在设置中重新填写；凭据不能跨设备复制'); }
}
function register(channel, handler) {
  ipcMain.handle(channel, async (event, ...args) => {
    try {
      assert(win && event.sender === win.webContents && event.senderFrame === win.webContents.mainFrame && event.senderFrame.url === pathToFileURL(entry).href, '不受信任的请求来源');
      assert(JSON.stringify(args).length <= 500000, '请求过大');
      return { ok: true, data: await handler(...args) };
    } catch (error) { return { ok: false, error: String(error.message || '操作失败').slice(0, 500) }; }
  });
}
async function execute(task, reminder, action) {
  if (action.type === 'desktop') {
    assert(Notification.isSupported(), '系统不支持桌面通知');
    const n = new Notification({ title: task.title, body: `${task.notes || '到时间了，该处理这件事了。'}\n原定：${new Date(reminder.at).toLocaleString()}`, silent: false });
    await new Promise((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error('系统未确认接收桌面通知，请检查系统通知权限')), 8000);
      n.once('show', () => { clearTimeout(timeout); resolve(); });
      n.once('failed', () => { clearTimeout(timeout); reject(new Error('桌面通知失败，请检查系统通知权限')); });
      n.on('click', show); n.show();
    });
    return { status: 'sent' };
  }
  if (action.type === 'open_url') {
    try { await shell.openExternal(httpUrl(action.url, { local: true })); }
    catch { const error = new Error('浏览器未确认打开链接，请核对后手动重试'); error.uncertain = true; throw error; }
    return { status: 'sent' };
  }
  const channel = store.state.settings.channels.find(c => c.id === action.channelId);
  assert(channel, '钉钉渠道不存在');
  return dingtalk.send({ webhook: await unseal(channel.webhookCipher), secret: await unseal(channel.secretCipher), task, reminder, action, channel });
}
function handlers() {
  register('snapshot', () => {
    if (!rendererReady) { rendererReady = true; startupLog('renderer-bridge-ready'); startupProbe(); }
    return { ...store.snapshot(), runtime: { version: app.getVersion(), timezone: Intl.DateTimeFormat().resolvedOptions().timeZone, platform: process.platform, loginAvailable: app.isPackaged && ['win32', 'darwin'].includes(process.platform) } };
  });
  register('task:save', input => service.saveTask(input));
  register('task:complete', (id, completed) => service.completeTask(id, completed));
  register('task:delete', id => service.deleteTask(id));
  register('action:retry', (taskId, actionId) => service.retryAction(taskId, actionId));
  register('model:save', input => service.saveModel(input));
  register('model:select', id => service.selectModel(id));
  register('channel:save', input => service.saveChannel(input));
  register('config:delete', (kind, id) => service.deleteConfig(kind, id));
  register('ai:chat', async messages => {
    assert(!aiBusy, 'AI 正在处理上一条消息'); aiBusy = true;
    try {
      const m = store.state.settings.models.find(m => m.id === store.state.settings.selectedModelId);
      assert(m, '请先在设置中添加并选择大模型');
      const result = await ai.chat({ model: m, apiKey: await unseal(m.apiKeyCipher), messages, channels: store.state.settings.channels, timezone: Intl.DateTimeFormat().resolvedOptions().timeZone });
      if (result.todo) {
        // Validate against current settings and time again after the network request.
        const id = service.saveTask(result.todo && { ...result.todo, id: undefined });
        return { reply: result.reply, taskId: id };
      }
      return { reply: result.reply };
    } finally { aiBusy = false; }
  });
  register('model:test', async id => {
    const m = store.state.settings.models.find(m => m.id === id); assert(m, '模型不存在');
    await ai.chat({ model: m, apiKey: await unseal(m.apiKeyCipher), channels: [], timezone: 'Asia/Shanghai', messages: [{ role: 'user', content: '这是连接测试。请只回复 {"reply":"连接成功","todo":null}，不要创建待办。' }] });
    return '模型连接成功';
  });
  register('channel:test', async id => {
    const c = store.state.settings.channels.find(c => c.id === id); assert(c, '渠道不存在');
    await dingtalk.send({ webhook: await unseal(c.webhookCipher), secret: await unseal(c.secretCipher), channel: c, task: { title: 'What2Do 测试通知', notes: '这是一条由你主动发送的测试消息。测试不会 @ 群成员。' }, reminder: { at: new Date().toISOString() }, action: { atMode: 'none' } });
    return '钉钉测试消息已发送（不 @ 成员）';
  });
  register('login:set', enabled => {
    assert(typeof enabled === 'boolean' && app.isPackaged && ['win32', 'darwin'].includes(process.platform), '请在安装后的 Windows / macOS 应用中设置开机启动');
    app.setLoginItemSettings({ openAtLogin: enabled });
    const actual = app.getLoginItemSettings().openAtLogin;
    store.change(s => { s.settings.launchAtLogin = actual; }); changed();
    assert(actual === enabled, '系统未接受开机启动设置，请检查系统登录项');
  });
  register('tasks:export', async () => {
    const target = await dialog.showSaveDialog(win, { title: '导出待办（不含模型和机器人凭据）', defaultPath: 'what2do-tasks.json', filters: [{ name: 'JSON', extensions: ['json'] }] });
    if (target.canceled || !target.filePath) return false;
    fs.writeFileSync(target.filePath, JSON.stringify({ version: 1, exportedAt: new Date().toISOString(), tasks: store.state.tasks, logs: store.state.logs }, null, 2), { mode: 0o600 }); return true;
  });
}
app.on('second-instance', show);
app.on('before-quit', () => { quitting = true; clearInterval(interval); });
app.on('window-all-closed', () => { if (!tray) app.quit(); });
app.on('activate', () => show());
if (singleInstance) app.whenReady().then(() => {
  startupLog('starting', `version=${app.getVersion()} platform=${process.platform}/${process.arch} packaged=${app.isPackaged}`);
  store = new Store(path.join(app.getPath('userData'), 'what2do.json'));
  service = new Service({ store, seal, unseal, onChange: changed });
  scheduler = new Scheduler({ store, execute, onChange: changed }); scheduler.recover();
  handlers(); createWindow();
  try {
    const image = nativeImage.createFromPath(path.join(__dirname, 'ui/icon.png')).resize({ width: 20, height: 20 });
    tray = new Tray(image); tray.setToolTip('What2Do · 待办提醒运行中');
    tray.setContextMenu(Menu.buildFromTemplate([{ label: '打开 What2Do', click: show }, { type: 'separator' }, { label: '退出（停止提醒）', click: () => app.quit() }]));
    tray.on('click', show);
  } catch { tray = null; }
  const tick = () => scheduler.tick().catch(() => { dialog.showErrorBox('提醒引擎异常', '无法写入提醒记录，请检查磁盘空间和数据目录权限。'); });
  interval = setInterval(tick, 1000); tick(); powerMonitor.on('resume', tick);
}).catch(error => { startupLog('startup-failed', error); dialog.showErrorBox('What2Do 无法启动', `${error.message}\n请查看用户数据目录下 logs/startup.log。`); app.quit(); });
