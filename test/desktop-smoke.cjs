'use strict';
const { _electron: electron } = require('playwright');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const http = require('node:http');
const assert = require('node:assert/strict');
const localInput = value => { const d = new Date(value); return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 19); };
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'what2do-desktop-'));
let desktop;
let lastRequest;
const server = http.createServer(async (req, res) => {
  let raw = ''; for await (const data of req) raw += data;
  const body = JSON.parse(raw); lastRequest = body;
  const input = body.messages.at(-1).content;
  let output = { reply: '你想在哪一天、几点提醒？', todo: null };
  if (input.includes('连接测试')) output = { reply: '连接成功', todo: null };
  if (input.includes('周报')) output = { reply: '已安排两个提醒时间，提前半小时桌面提醒，到点再提醒一次。', todo: { title: '整理并提交本周周报', notes: '把本周完成的事情、遇到的问题和下一步计划整理好。', reminders: [20, 50].map(minutes => ({ at: new Date(Date.now() + minutes * 60000).toISOString(), actions: [{ type: 'desktop' }] })) } };
  if (body.messages[0].content.startsWith('你是对话压缩器')) output = { summary: '当前还在补充阅读要求，没有新的待办已经创建。' };
  res.writeHead(200, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ choices: [{ message: { content: JSON.stringify(output) } }] }));
});
async function main() {
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  desktop = await electron.launch({ args: ['--no-sandbox', path.join(__dirname, '..')], env: { ...process.env, WHAT2DO_TEST_DATA: dir }, timeout: 60000 });
  const page = await desktop.firstWindow(); await page.waitForSelector('#date-label:not(:empty)');
  const errors = []; page.on('pageerror', error => errors.push(error.message));
  assert.equal(await desktop.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].isMenuBarVisible()), false);
  assert.equal(await desktop.evaluate(({ Menu }) => Menu.getApplicationMenu()), null);
  // Real preload + IPC + file persistence, not a browser-only mock.
  await page.click('#new-task'); await page.fill('[name="title"]', '晚上留一点时间读书');
  await page.fill('[name="notes"]', '读二十页，给今天留一段安静的时间。');
  await page.click('#add-reminder');
  const inputs = page.locator('[name="reminder-at"]');
  await inputs.nth(1).fill(localInput(Date.now() + 7200000));
  await page.locator('[data-add-action]').nth(1).click();
  await page.locator('[name="action-type"]').nth(2).selectOption('open_url');
  await page.fill('[name="url"]', 'https://example.com/reading');
  await page.click('#save-editor'); await page.waitForSelector('#editor', { state: 'hidden' });
  assert.equal(await page.locator('.task-card').count(), 1);
  await page.locator('[data-command="edit"]').click(); await page.fill('[name="title"]', '晚上读书，留一点时间给自己'); await page.click('#save-editor'); await page.waitForSelector('#editor', { state: 'hidden' });
  assert.match(await page.locator('.task-title').innerText(), /留一点时间给自己/);
  const saved = JSON.parse(fs.readFileSync(path.join(dir, 'what2do.json'))); assert.equal(saved.tasks[0].reminders.length, 2); assert.equal(saved.tasks[0].reminders[1].actions.length, 2);
  await page.locator('[data-command="complete"]').click(); await page.waitForSelector('#stat-done:text("1")');
  await page.click('[data-filter="completed"]'); await page.waitForSelector('.task-card.completed');
  await page.locator('[data-command="complete"]').click(); await page.click('#confirm-yes'); await page.click('[data-filter="pending"]');
  await page.click('[data-view="settings"]'); await page.click('#add-model');
  await page.fill('[name="name"]', '本地测试模型'); await page.fill('[name="baseUrl"]', `http://127.0.0.1:${server.address().port}/v1`); await page.fill('[name="model"]', 'test-model');
  await page.click('#save-editor'); await page.waitForSelector('#editor', { state: 'hidden' });
  await page.click('[data-config="test-model"]'); await page.waitForSelector('#toast:text("模型连接成功")');
  await page.click('[data-view="tasks"]');
  await page.fill('#chat-input', '提醒我读书'); await page.click('#send-chat'); await page.waitForSelector('.assistant:text("你想在哪一天")');
  const before = (await page.evaluate(() => window.what2do.snapshot())).tasks.length; assert.equal(before, 1);
  await page.click('#clear-chat');
  await page.fill('#chat-input', '明天下午 3 点交周报，提前半小时和到点分别桌面提醒。'); await page.click('#send-chat');
  await page.waitForSelector('.message-task'); assert.equal(await page.locator('.task-card').count(), 2);
  assert.ok(lastRequest.messages[0].content.includes('IANA 时区'));
  const snapshot = await page.evaluate(() => window.what2do.snapshot()); assert.equal(snapshot.tasks.find(t => t.title.includes('周报')).reminders.length, 2);
  // HTML-like user content must remain text, never run in the renderer.
  await page.evaluate(() => window.what2do.saveTask({ title: '<img src=x onerror="window.injected=true">', reminders: [{ at: new Date(Date.now() + 86400000).toISOString(), actions: [{ type: 'desktop' }] }] }));
  await page.waitForSelector('.task-title:text("<img")'); assert.equal(await page.locator('.task-title img').count(), 0);
  assert.equal(await page.evaluate(() => window.injected), undefined);
  const xss = (await page.evaluate(() => window.what2do.snapshot())).tasks.find(t => t.title.includes('<img'));
  await page.evaluate(id => window.what2do.deleteTask(id), xss.id);
  await page.waitForFunction(() => document.querySelectorAll('.task-card').length === 2);
  // Long chats go through the actual main-process compressor instead of a client turn cap.
  await page.click('#clear-chat'); await page.waitForSelector('#context-status:text("新的对话")');
  for (let i = 0; i < 15; i++) {
    await page.fill('#chat-input', `继续补充阅读计划 ${i}，时间稍后再定。`);
    await page.click('#send-chat'); await page.waitForFunction(() => !document.querySelector('#send-chat').disabled);
  }
  assert.match(await page.locator('#context-status').innerText(), /已自动压缩/);
  assert.ok(await page.locator('#chat-messages > div').count() <= 60);
  // Seed a channel only after shutdown; no credentials are decrypted and no webhook is called.
  await desktop.close();
  const fixtureFile = path.join(dir, 'what2do.json');
  const fixtureState = JSON.parse(fs.readFileSync(fixtureFile, 'utf8'));
  fixtureState.settings.channels.push({ id: 'test-channel', type: 'dingtalk', name: '测试工作群', atMode: 'all', atMobiles: [], atUserIds: [], contacts: [{ name: '小张', mobile: '13800000000', userId: 'zhang' }, { name: '小李', mobile: '13900000000', userId: 'li' }], webhookCipher: 'not-a-real-webhook', secretCipher: '' });
  fs.writeFileSync(fixtureFile, JSON.stringify(fixtureState));
  desktop = await electron.launch({ args: ['--no-sandbox', path.join(__dirname, '..')], env: { ...process.env, WHAT2DO_TEST_DATA: dir }, timeout: 60000 });
  const resumed = await desktop.firstWindow(); resumed.on('pageerror', error => errors.push(error.message)); await resumed.waitForSelector('#date-label:not(:empty)');
  await resumed.click('#new-task'); await resumed.fill('[name="title"]', '只提醒指定成员');
  await resumed.selectOption('[name="action-type"]', 'dingtalk');
  await resumed.selectOption('[name="channelId"]', 'test-channel');
  await resumed.selectOption('[name="atMode"]', 'members');
  await resumed.locator('[data-contact][data-user-id="zhang"]').check();
  await resumed.click('#save-editor'); await resumed.waitForSelector('#editor', { state: 'hidden' });
  const mentionTask = (await resumed.evaluate(() => window.what2do.snapshot())).tasks.find(t => t.title === '只提醒指定成员');
  assert.deepEqual(mentionTask.reminders[0].actions[0].atUserIds, ['zhang']);
  assert.equal(mentionTask.reminders[0].actions[0].atMode, 'members');
  assert.match(await resumed.locator('.task-card').filter({ hasText: '只提醒指定成员' }).innerText(), /@小张/);
  await resumed.click('[data-view="settings"]');
  await resumed.locator('#channels-list [data-config="edit-channel"]').click();
  await resumed.selectOption('[name="atMode"]', 'members');
  await resumed.locator('[data-contact][data-user-id="li"]').check();
  await resumed.click('#save-editor'); await resumed.waitForSelector('#editor', { state: 'hidden' });
  let savedChannel = (await resumed.evaluate(() => window.what2do.snapshot())).settings.channels[0];
  assert.deepEqual(savedChannel.atUserIds, ['li']);
  await resumed.locator('#channels-list [data-config="edit-channel"]').click();
  await resumed.locator('[data-contact][data-user-id="li"]').uncheck();
  await resumed.locator('[data-contact][data-user-id="zhang"]').check();
  await resumed.click('#save-editor'); await resumed.waitForSelector('#editor', { state: 'hidden' });
  savedChannel = (await resumed.evaluate(() => window.what2do.snapshot())).settings.channels[0];
  assert.deepEqual(savedChannel.atUserIds, ['zhang']);
  fs.mkdirSync(path.join(__dirname, '../test-results'), { recursive: true });
  for (const theme of ['forest', 'ocean', 'apricot', 'lavender', 'night']) {
    await resumed.click(`[data-theme-choice="${theme}"]`);
    await resumed.waitForFunction(t => document.documentElement.dataset.theme === t, theme);
    assert.equal((await resumed.evaluate(() => window.what2do.snapshot())).settings.theme, theme);
    await resumed.screenshot({ path: path.join(__dirname, `../test-results/theme-${theme}.png`) });
  }
  await resumed.reload(); await resumed.waitForSelector('#date-label:not(:empty)');
  assert.equal(await resumed.evaluate(() => document.documentElement.dataset.theme), 'night');
  await resumed.click('#new-task');
  const dialogColor = await resumed.locator('#editor').evaluate(el => getComputedStyle(el).backgroundColor);
  assert.notEqual(dialogColor, 'rgb(255, 255, 255)'); await resumed.click('#cancel-editor');
  await resumed.click('[data-view="tasks"]');
  assert.deepEqual(errors, []);
  fs.mkdirSync(path.join(__dirname, '../test-results'), { recursive: true });
  await resumed.screenshot({ path: path.join(__dirname, '../test-results/desktop.png') });
  // Single instance and tray behavior are real Electron lifecycle checks.
  await desktop.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].close());
  assert.equal(await desktop.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().length), 1);
  assert.equal(await desktop.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].isVisible()), false);
  await desktop.evaluate(({ app }) => app.emit('activate'));
  await desktop.firstWindow();
  console.log('Desktop smoke passed: manual CRUD, multi-reminder actions, model config, real AI HTTP/IPC, clarification, automatic creation, XSS escaping, tray lifecycle.');
}
const watchdog = setTimeout(() => { console.error('Desktop smoke timed out after 180 seconds'); process.exit(1); }, 180000);
watchdog.unref();
main().catch(async error => {
  console.error(error); process.exitCode = 1;
  if (desktop) {
    fs.mkdirSync(path.join(__dirname, '../test-results'), { recursive: true });
    const pages = desktop.windows();
    if (pages[0]) await pages[0].screenshot({ path: path.join(__dirname, '../test-results/failure.png'), timeout: 5000 }).catch(() => {});
  }
}).finally(async () => {
  clearTimeout(watchdog);
  if (desktop) await desktop.close();
  server.closeAllConnections(); await new Promise(resolve => server.close(resolve));
  fs.rmSync(dir, { recursive: true, force: true });
});
