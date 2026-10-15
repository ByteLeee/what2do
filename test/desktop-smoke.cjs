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
  res.writeHead(200, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ choices: [{ message: { content: JSON.stringify(output) } }] }));
});
async function main() {
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  desktop = await electron.launch({ args: ['--no-sandbox', path.join(__dirname, '..')], env: { ...process.env, WHAT2DO_TEST_DATA: dir }, timeout: 60000 });
  const page = await desktop.firstWindow(); await page.waitForSelector('#date-label:not(:empty)');
  const errors = []; page.on('pageerror', error => errors.push(error.message));
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
  assert.deepEqual(errors, []);
  fs.mkdirSync(path.join(__dirname, '../test-results'), { recursive: true });
  await page.screenshot({ path: path.join(__dirname, '../test-results/desktop.png') });
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
