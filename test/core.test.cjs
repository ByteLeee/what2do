'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const { task, modelUrl, httpUrl } = require('../app/core/domain.cjs');
const { Store } = require('../app/core/store.cjs');
const { Service } = require('../app/core/service.cjs');
const { Scheduler } = require('../app/core/scheduler.cjs');
const { payload, webhookUrl, send } = require('../app/core/dingtalk.cjs');
const { chat } = require('../app/core/ai.cjs');
const now = Date.parse('2026-10-15T08:00:00Z');
const future = new Date(now + 3600000).toISOString();
const basic = () => ({ title: '交周报', notes: '补充进展', reminders: [{ at: future, actions: [{ type: 'desktop' }] }] });
function fixture(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'what2do-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const store = new Store(path.join(dir, 'data.json'));
  const service = new Service({ store, seal: async v => `encrypted:${v}`, unseal: async v => v.slice(10) });
  return { store, service, dir };
}
function seed(store, actions = [{ type: 'desktop' }], at = future) {
  const input = { ...basic(), reminders: [{ at, actions }] };
  const result = task(input, [{ id: 'ding' }], now);
  store.change(s => { s.tasks.push(result); }); return result;
}
test('同一待办支持多个时间和多个动作，按绝对时间保存', () => {
  const input = basic(); input.reminders.push({ at: '2026-10-15T18:00:00+08:00', actions: [{ type: 'desktop' }, { type: 'open_url', url: 'https://example.com' }] });
  const result = task(input, [], now);
  assert.equal(result.reminders.length, 2); assert.equal(result.reminders[1].actions.length, 2); assert.equal(result.reminders[1].at, '2026-10-15T10:00:00.000Z');
});
test('拒绝过去时间、无时区时间、空动作与重复提醒', () => {
  for (const at of ['2026-10-14T08:00:00Z', '2026-10-15T18:00:00', '2027-02-30T18:00:00+08:00', '2027-01-01T24:00:00Z', 'invalid']) assert.throws(() => task({ ...basic(), reminders: [{ at, actions: [{ type: 'desktop' }] }] }, [], now));
  assert.throws(() => task({ ...basic(), reminders: [{ at: future, actions: [] }] }, [], now));
  const b = basic(); b.reminders.push(structuredClone(b.reminders[0])); assert.throws(() => task(b, [], now));
});
test('浏览器动作禁止任意协议及 URL 中的账号密码', () => {
  for (const url of ['file:///etc/passwd', 'javascript:alert(1)', 'https://user:pass@example.com', 'mailto:a@b.com']) assert.throws(() => httpUrl(url, { local: true }));
  assert.equal(httpUrl('http://192.168.2.17:3001', { local: true }), 'http://192.168.2.17:3001/');
});
test('模型允许本机 HTTP，远程必须 HTTPS', () => {
  assert.equal(modelUrl('http://localhost:11434/v1/'), 'http://localhost:11434/v1');
  assert.throws(() => modelUrl('http://example.com/v1'));
  assert.throws(() => modelUrl('https://example.com/v1?api_key=secret'));
  assert.throws(() => modelUrl('https://example.com/v1/chat/completions'));
});
test('执行后不允许改写或删除该提醒，仍可追加新时间', () => {
  const old = task(basic(), [], now); old.reminders[0].actions[0].status = 'sent';
  const later = now + 7200000;
  const input = structuredClone(old); input.reminders.push({ at: new Date(later + 3600000).toISOString(), actions: [{ type: 'desktop' }] });
  const result = task(input, [], later, old); assert.equal(result.reminders.length, 2);
  input.reminders[0].at = new Date(later + 100000).toISOString(); assert.throws(() => task(input, [], later, old));
  input.reminders.shift(); assert.throws(() => task(input, [], later, old));
});
test('原子持久化可重载；损坏文件不被静默覆盖', t => {
  const { store } = fixture(t); seed(store);
  assert.equal(new Store(store.file).state.tasks.length, 1);
  fs.writeFileSync(store.file, '{broken'); assert.throws(() => new Store(store.file), /未覆盖/);
  assert.equal(fs.readFileSync(store.file, 'utf8'), '{broken');
});
test('磁盘写入失败时内存不发生提交', t => {
  const { store } = fixture(t); fs.mkdirSync(`${store.file}.tmp`);
  assert.throws(() => store.change(s => { s.tasks.push({ title: 'x' }); })); assert.equal(store.state.tasks.length, 0);
});
test('配置不向界面暴露密钥；空白编辑保留已有密钥', async t => {
  const { store, service } = fixture(t);
  const id = await service.saveModel({ name: 'Local', baseUrl: 'http://localhost:11434/v1', model: 'test', apiKey: 'super-secret' });
  const dto = store.snapshot(); assert.equal(dto.settings.models[0].apiKeySet, true); assert.ok(!JSON.stringify(dto).includes('super-secret'));
  await service.saveModel({ id, name: 'renamed', baseUrl: 'http://localhost:11434/v1', model: 'test', apiKey: '' });
  assert.equal(store.state.settings.models[0].apiKeyCipher, 'encrypted:super-secret');
  await service.saveModel({ id, name: 'renamed', baseUrl: 'http://localhost:11434/v1', model: 'test', clearKey: true });
  assert.equal(store.state.settings.models[0].apiKeyCipher, '');
});
test('多个模型可切换与删除，自动选择剩余模型', async t => {
  const { store, service } = fixture(t);
  const a = await service.saveModel({ name: 'a', baseUrl: 'https://example.com/v1', model: 'a' });
  const b = await service.saveModel({ name: 'b', baseUrl: 'https://example.com/v1', model: 'b' });
  service.selectModel(b); assert.equal(store.state.settings.selectedModelId, b);
  service.deleteConfig('models', b); assert.equal(store.state.settings.selectedModelId, a);
});
test('钉钉凭据加密并验证 Webhook 主机，成员不能为空', async t => {
  const { store, service } = fixture(t);
  await assert.rejects(service.saveChannel({ name: 'bad', webhook: 'https://example.com', atMode: 'none' }));
  await assert.rejects(service.saveChannel({ name: 'bad', webhook: 'https://oapi.dingtalk.com/robot/send?access_token=t', atMode: 'members' }));
  await service.saveChannel({ name: 'work', webhook: 'https://oapi.dingtalk.com/robot/send?access_token=t', secret: 'SECxxx', atMode: 'all' });
  assert.ok(!JSON.stringify(store.snapshot()).includes('SECxxx')); assert.ok(!JSON.stringify(store.snapshot()).includes('access_token'));
  await service.saveChannel({ name: 'empty-members', webhook: 'https://oapi.dingtalk.com/robot/send?access_token=t', atMode: 'none', atMobiles: '', atUserIds: '' });
  assert.deepEqual(store.state.settings.channels[1].atMobiles, []);
});
test('已执行提醒保留已删除渠道引用时，仍可编辑标题与新增提醒', () => {
  const input = basic(); input.reminders[0].actions = [{ type: 'dingtalk', channelId: 'ding' }];
  const old = task(input, [{ id: 'ding' }], now); old.reminders[0].actions[0].status = 'sent';
  const edit = structuredClone(old); edit.title = '新的标题'; edit.reminders.push({ at: new Date(now + 10800000).toISOString(), actions: [{ type: 'desktop' }] });
  assert.equal(task(edit, [], now + 7200000, old).title, '新的标题');
});
test('提醒只在到期后执行，反复 tick 不会重复执行', async t => {
  const { store } = fixture(t); seed(store); let clock = now, calls = 0;
  const s = new Scheduler({ store, now: () => clock, execute: async () => { calls++; } });
  await s.tick(); assert.equal(calls, 0); clock += 3600000;
  await s.tick(); await s.tick(); assert.equal(calls, 1); assert.equal(store.state.logs[0].status, 'sent');
});
test('完成待办会停止后续提醒', async t => {
  const { store, service } = fixture(t); const task = seed(store); let calls = 0;
  service.completeTask(task.id, true);
  await new Scheduler({ store, now: () => now + 7200000, execute: async () => calls++ }).tick(); assert.equal(calls, 0);
});
test('多提醒多动作独立执行；一个失败不阻止另一个', async t => {
  const { store } = fixture(t); seed(store, [{ type: 'desktop' }, { type: 'open_url', url: 'https://example.com' }]);
  const s = new Scheduler({ store, now: () => now + 3600000, execute: async (_t, _r, a) => { if (a.type === 'desktop') throw new Error('denied'); } });
  await s.tick(); assert.deepEqual(store.state.tasks[0].reminders[0].actions.map(a => a.status), ['retry', 'sent']);
});
test('重叠 tick 有互斥保护；执行前持久化 running', async t => {
  const { store } = fixture(t); seed(store); let release, calls = 0;
  const s = new Scheduler({ store, now: () => now + 3600000, execute: async () => { calls++; assert.equal(new Store(store.file).state.tasks[0].reminders[0].actions[0].status, 'running'); await new Promise(r => { release = r; }); } });
  const first = s.tick(); await s.tick(); release(); await first; assert.equal(calls, 1);
});
test('明确失败退避重试，最多五次', async t => {
  const { store } = fixture(t); seed(store); let clock = now + 3600000, calls = 0;
  const s = new Scheduler({ store, now: () => clock, execute: async () => { calls++; throw new Error('拒绝'); } });
  await s.tick(); await s.tick(); assert.equal(calls, 1);
  for (let i = 0; i < 4; i++) { clock += 600000; await s.tick(); }
  assert.equal(calls, 5); assert.equal(store.state.tasks[0].reminders[0].actions[0].status, 'failed');
});
test('网络不确定状态禁止自动重试', async t => {
  const { store } = fixture(t); seed(store, [{ type: 'dingtalk', channelId: 'ding' }]); let calls = 0;
  const s = new Scheduler({ store, now: () => now + 3600000, execute: async () => { calls++; const e = new Error('unknown'); e.uncertain = true; throw e; } });
  await s.tick(); await s.tick(); assert.equal(calls, 1); assert.equal(store.state.tasks[0].reminders[0].actions[0].status, 'unknown');
});
test('崩溃恢复：外部副作用不自动重复，桌面动作可重试', t => {
  const { store } = fixture(t); seed(store, [{ type: 'desktop' }, { type: 'open_url', url: 'https://example.com' }]);
  store.change(s => s.tasks[0].reminders[0].actions.forEach(a => { a.status = 'running'; }));
  new Scheduler({ store, execute: async () => {} }).recover();
  assert.deepEqual(store.state.tasks[0].reminders[0].actions.map(a => a.status), ['pending', 'unknown']);
});
test('恢复后补发通知，超过十五分钟的网页不自动打开', async t => {
  const { store } = fixture(t); seed(store, [{ type: 'desktop' }, { type: 'open_url', url: 'https://example.com' }]); const types = [];
  await new Scheduler({ store, now: () => now + 7200000, execute: async (_t, _r, a) => types.push(a.type) }).tick();
  assert.deepEqual(types, ['desktop']); assert.equal(store.state.tasks[0].reminders[0].actions[1].status, 'skipped');
});
test('手动重试保留原时间和记录，并立即安排新动作', t => {
  const { store, service } = fixture(t); const task = seed(store, [{ type: 'open_url', url: 'https://example.com' }]);
  store.change(s => { s.tasks[0].reminders[0].actions[0].status = 'skipped'; });
  service.retryAction(task.id, task.reminders[0].actions[0].id);
  const current = store.state.tasks[0]; assert.equal(current.reminders.length, 2); assert.equal(current.reminders[0].at, future); assert.equal(current.reminders[0].actions[0].status, 'superseded'); assert.equal(current.reminders[1].actions[0].status, 'pending');
});
test('有运行中的动作时禁止完成或删除待办', t => {
  const { store, service } = fixture(t); const task = seed(store); store.change(s => { s.tasks[0].reminders[0].actions[0].status = 'running'; });
  assert.throws(() => service.completeTask(task.id, true)); assert.throws(() => service.deleteTask(task.id));
});
test('钉钉签名与 HMAC-SHA256 协议一致，旧签名被替换', () => {
  const secret = 'SECxxx', timestamp = 1700000000000;
  const url = new URL(webhookUrl('https://oapi.dingtalk.com/robot/send?access_token=t&timestamp=1&sign=old', secret, timestamp));
  assert.equal(url.searchParams.get('timestamp'), String(timestamp));
  assert.equal(url.searchParams.get('sign'), crypto.createHmac('sha256', secret).update(`${timestamp}\n${secret}`).digest('base64'));
});
test('钉钉 Markdown 同时传 at 字段并在正文含指定成员；每次动作可覆盖默认 @所有人', () => {
  const channel = { atMode: 'all', keyword: '提醒' };
  const p = payload(basic(), { at: future, timeZone: 'Asia/Shanghai' }, { atMode: 'members', atMobiles: ['13800000000'], atUserIds: ['user1'] }, channel, now);
  assert.equal(p.at.isAtAll, false); assert.deepEqual(p.at.atUserIds, ['user1']); assert.ok(p.markdown.text.includes('@13800000000')); assert.ok(p.markdown.title.includes('提醒'));
  const all = payload(basic(), { at: future }, { atMode: 'default' }, channel, now); assert.equal(all.at.isAtAll, true);
});
test('钉钉检查业务错误码；网络错误不泄漏 Webhook 并标为不确定', async () => {
  const args = { webhook: 'https://oapi.dingtalk.com/robot/send?access_token=SECRET', task: basic(), reminder: { at: future }, action: { atMode: 'none' }, channel: {} };
  await assert.rejects(send({ ...args, fetchImpl: async () => ({ ok: true, json: async () => ({ errcode: 310000 }) }) }), /310000/);
  await assert.rejects(send({ ...args, fetchImpl: async () => { throw new Error(args.webhook); } }), e => e.uncertain && !e.message.includes('SECRET'));
  assert.equal((await send({ ...args, fetchImpl: async () => ({ ok: true, json: async () => ({ errcode: 0 }) }) })).status, 'sent');
});
function aiArgs(output, messages = [{ role: 'user', content: '明天下午交周报，三点和四点提醒' }]) {
  return { now, model: { baseUrl: 'https://example.com/v1', model: 'test' }, apiKey: 'not-in-system-prompt', channels: [], timezone: 'Asia/Shanghai', messages, fetchImpl: async (_url, req) => {
    const body = JSON.parse(req.body); assert.ok(!body.messages[0].content.includes('not-in-system-prompt')); assert.equal(body.stream, false);
    return { ok: true, json: async () => ({ choices: [{ message: { content: typeof output === 'string' ? output : JSON.stringify(output) } }] }) };
  } };
}
test('AI 返回完整待办才创建，保留多时间与时区', async () => {
  const input = basic(); input.reminders.push({ at: new Date(now + 7200000).toISOString(), actions: [{ type: 'desktop' }] });
  const result = await chat(aiArgs({ reply: '已安排', todo: input })); assert.equal(result.todo.reminders.length, 2); assert.equal(result.todo.reminders[0].timeZone, 'Asia/Shanghai');
});
test('AI 追问不创建任务；非法 JSON 与过去时间返回错误', async () => {
  assert.equal((await chat(aiArgs({ reply: '具体几点？', todo: null }))).todo, null);
  await assert.rejects(chat(aiArgs('not json')), /格式/);
  const input = basic(); input.reminders[0].at = '2026-01-01T00:00:00Z'; await assert.rejects(chat(aiArgs({ reply: 'x', todo: input })), /晚于/);
});
test('AI 不能编造链接，明确提供的链接可以使用', async () => {
  const input = basic(); input.reminders[0].actions = [{ type: 'open_url', url: 'https://example.com' }];
  await assert.rejects(chat(aiArgs({ reply: 'x', todo: input })), /链接/);
  const result = await chat(aiArgs({ reply: 'x', todo: input }, [{ role: 'user', content: '一小时后打开 https://example.com。' }])); assert.equal(result.todo.reminders[0].actions[0].type, 'open_url');
});
test('AI 不允许未知渠道或未经说明的 @所有人', async () => {
  const input = basic(); input.reminders[0].actions = [{ type: 'dingtalk', channelId: 'ding', atMode: 'all' }];
  await assert.rejects(chat(aiArgs({ reply: 'x', todo: input })), /渠道/);
  await assert.rejects(chat({ ...aiArgs({ reply: 'x', todo: input }), channels: [{ id: 'ding' }] }), /所有人/);
});
test('AI 不把服务端错误详情或令牌显示给界面', async () => {
  await assert.rejects(chat({ ...aiArgs(''), fetchImpl: async () => { throw new Error('SECRET-KEY'); } }), e => !e.message.includes('SECRET-KEY'));
});
