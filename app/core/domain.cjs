'use strict';
const { randomUUID } = require('node:crypto');
const assert = (condition, message) => { if (!condition) throw new Error(message); };
function text(value, label, max = 2000) {
  assert(typeof value === 'string' && value.trim().length > 0 && value.length <= max, `${label}不能为空，且不能超过 ${max} 字符`);
  return value.trim();
}
function httpUrl(value, { local = false } = {}) {
  let u;
  try { u = new URL(value); } catch { throw new Error('请输入完整的 http:// 或 https:// 地址'); }
  assert(['http:', 'https:'].includes(u.protocol) && !u.username && !u.password, '只支持不含账号密码的 HTTP / HTTPS 链接');
  assert(local || u.protocol === 'https:', '远程模型 API 必须使用 HTTPS；本机服务可使用 HTTP');
  return u.href;
}
function modelUrl(value) {
  const u = new URL(value);
  assert(!u.search && !u.hash, 'Base URL 不支持查询参数或片段；密钥请填入 API Key');
  assert(!u.pathname.replace(/\/$/, '').endsWith('/chat/completions'), 'Base URL 请填写接口根路径，不要包含 /chat/completions');
  const local = ['localhost', '127.0.0.1', '[::1]'].includes(u.hostname);
  return httpUrl(value, { local }).replace(/\/$/, '');
}
function iso(value, label) {
  const match = typeof value === 'string' && value.match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2})(?:\.\d{1,3})?)?(Z|[+-]\d{2}:\d{2})$/i);
  assert(match && Number.isFinite(Date.parse(value)), `${label}需要带时区的完整时间`);
  const [, year, month, day, hour, minute, second = '0'] = match;
  const calendar = new Date(Date.UTC(Number(year), Number(month) - 1, Number(day)));
  assert(calendar.getUTCFullYear() === Number(year) && calendar.getUTCMonth() + 1 === Number(month) && calendar.getUTCDate() === Number(day) && Number(hour) < 24 && Number(minute) < 60 && Number(second) < 60, `${label}包含不存在的日期或时间`);
  return new Date(value).toISOString();
}
function members(value) {
  if (typeof value === 'string') value = value.split(/[,，\s]+/).filter(Boolean);
  assert(Array.isArray(value || []) && (value || []).length <= 50, '指定成员最多 50 人');
  return [...new Set((value || []).map(v => text(v, '成员标识', 80)))];
}
function action(input, channels) {
  assert(input && ['desktop', 'dingtalk', 'open_url'].includes(input.type), '请选择有效的提醒动作');
  const result = { id: randomUUID(), type: input.type, status: 'pending', attempts: 0 };
  if (input.type === 'open_url') result.url = httpUrl(text(input.url, '网页链接', 2048), { local: true });
  if (input.type === 'dingtalk') {
    assert(channels.some(c => c.id === input.channelId), '钉钉渠道不存在，请先在设置中添加');
    result.channelId = input.channelId;
    result.atMode = input.atMode || 'default';
    assert(['default', 'none', 'all', 'members'].includes(result.atMode), '@ 方式无效');
    result.atMobiles = members(input.atMobiles);
    result.atUserIds = members(input.atUserIds);
    if (result.atMode === 'members') assert(result.atMobiles.length + result.atUserIds.length > 0, '请填写要 @ 的成员');
  }
  return result;
}
function cleanAction(a) {
  const { id, status, attempts, error, nextAttemptAt, executedAt, ...config } = a;
  return config;
}
function task(input, channels, now = Date.now(), old = null) {
  assert(input && typeof input === 'object', '待办格式无效');
  const result = {
    id: old?.id || randomUUID(), title: text(input.title, '待办标题', 160),
    notes: String(input.notes || '').slice(0, 10000),
    dueAt: input.dueAt ? iso(input.dueAt, '截止时间') : null,
    status: old?.status || 'pending', createdAt: old?.createdAt || new Date(now).toISOString(), updatedAt: new Date(now).toISOString()
  };
  assert(Array.isArray(input.reminders) && input.reminders.length > 0 && input.reminders.length <= 30, '每个待办需要 1～30 个提醒时间');
  const seenIds = new Set();
  result.reminders = input.reminders.map(r => {
    assert(r && Array.isArray(r.actions) && r.actions.length > 0 && r.actions.length <= 10, '每个提醒需要 1～10 个动作');
    const at = iso(r.at, '提醒时间');
    const existing = old?.reminders.find(x => x.id === r.id);
    assert(!r.id || !seenIds.has(r.id), '提醒 ID 不能重复');
    if (r.id) seenIds.add(r.id);
    // Unchanged executed records can retain a channel that has since been removed.
    if (existing && existing.at === at && JSON.stringify(existing.actions.map(cleanAction)) === JSON.stringify(r.actions.map(cleanAction))) return structuredClone(existing);
    const actions = r.actions.map(a => action(a, channels));
    if (existing && existing.at === at && JSON.stringify(existing.actions.map(cleanAction)) === JSON.stringify(actions.map(cleanAction))) return structuredClone(existing);
    if (existing) assert(existing.actions.every(a => a.status === 'pending' && a.attempts === 0), '已开始执行的提醒不可修改，请添加新的提醒');
    assert(Date.parse(at) > now, '新提醒必须晚于当前时间');
    return { id: randomUUID(), at, actions };
  });
  for (const r of old?.reminders || []) {
    if (r.actions.some(a => a.status !== 'pending' || a.attempts > 0)) assert(result.reminders.some(x => x.id === r.id), '已执行的提醒需保留为记录');
  }
  const duplicate = result.reminders.map(r => `${r.at}:${JSON.stringify(r.actions.map(cleanAction))}`);
  assert(new Set(duplicate).size === duplicate.length, '存在重复的提醒时间和动作');
  return result;
}
function emptyState() {
  return { version: 1, tasks: [], settings: { models: [], selectedModelId: '', channels: [], launchAtLogin: false }, logs: [] };
}
module.exports = { assert, text, httpUrl, modelUrl, iso, members, action, task, cleanAction, emptyState };
