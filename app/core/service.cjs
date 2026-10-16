'use strict';
const { randomUUID } = require('node:crypto');
const { assert, text, members, modelUrl, task } = require('./domain.cjs');
const { webhookUrl } = require('./dingtalk.cjs');
const { contacts } = require('./contacts.cjs');
class Service {
  constructor({ store, seal, unseal, onChange = () => {} }) { Object.assign(this, { store, seal, unseal, onChange }); }
  saveTask(input) {
    const old = input.id ? this.store.state.tasks.find(t => t.id === input.id) : null;
    assert(!input.id || old, '待办已不存在');
    const result = task(input, this.store.state.settings.channels, Date.now(), old);
    const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone;
    for (const r of result.reminders) r.timeZone ||= timezone;
    this.store.change(s => { s.tasks = [result, ...s.tasks.filter(t => t.id !== result.id)]; });
    this.onChange(); return result.id;
  }
  completeTask(id, completed) {
    assert(typeof completed === 'boolean', '完成状态无效');
    this.store.change(s => {
      const t = s.tasks.find(t => t.id === id); assert(t, '待办不存在');
      assert(!t.reminders.some(r => r.actions.some(a => a.status === 'running')), '提醒正在执行，请稍后再操作');
      t.status = completed ? 'completed' : 'pending'; t.updatedAt = new Date().toISOString();
    }); this.onChange();
  }
  deleteTask(id) {
    this.store.change(s => {
      const t = s.tasks.find(t => t.id === id); assert(t, '待办不存在');
      assert(!t.reminders.some(r => r.actions.some(a => a.status === 'running')), '提醒正在执行，请稍后再操作');
      s.tasks = s.tasks.filter(t => t.id !== id);
    }); this.onChange();
  }
  retryAction(taskId, actionId) {
    this.store.change(s => {
      const t = s.tasks.find(t => t.id === taskId); assert(t?.status === 'pending', '请先恢复该待办');
      const r = t.reminders.find(r => r.actions.some(a => a.id === actionId));
      const a = r?.actions.find(a => a.id === actionId);
      assert(a && ['failed', 'unknown', 'skipped', 'retry'].includes(a.status), '该动作无需重试');
      // Retry uses a new reminder, keeping the original schedule and execution history intact.
      const { cleanAction, action } = require('./domain.cjs');
      t.reminders.push({ id: randomUUID(), at: new Date().toISOString(), timeZone: r.timeZone, actions: [action(cleanAction(a), s.settings.channels)] });
      a.status = 'superseded'; a.error = '已创建手动重试';
    }); this.onChange();
  }
  async saveModel(input) {
    const old = this.store.state.settings.models.find(m => m.id === input.id);
    assert(!input.id || old, '模型配置不存在');
    const m = { id: old?.id || randomUUID(), name: text(input.name, '配置名称', 80), baseUrl: modelUrl(text(input.baseUrl, 'Base URL', 2048)), model: text(input.model, '模型标识', 160), apiKeyCipher: old?.apiKeyCipher || '' };
    m.contextWindow = Number(input.contextWindow || old?.contextWindow || 8192);
    assert(Number.isInteger(m.contextWindow) && m.contextWindow >= 4096 && m.contextWindow <= 131072, '上下文窗口需为 4096～131072 的整数，请与服务商设置保持一致');
    if (input.clearKey) m.apiKeyCipher = '';
    if (input.apiKey) m.apiKeyCipher = await this.seal(text(input.apiKey, 'API Key', 4096));
    this.store.change(s => { s.settings.models = [...s.settings.models.filter(x => x.id !== m.id), m]; s.settings.selectedModelId ||= m.id; });
    this.onChange(); return m.id;
  }
  async saveChannel(input) {
    const old = this.store.state.settings.channels.find(c => c.id === input.id);
    assert(!input.id || old, '通知渠道不存在');
    const c = { id: old?.id || randomUUID(), type: 'dingtalk', name: text(input.name, '渠道名称', 80), keyword: String(input.keyword || '').slice(0, 80), atMode: input.atMode || 'none', atMobiles: members(input.atMobiles), atUserIds: members(input.atUserIds), webhookCipher: old?.webhookCipher || '', secretCipher: old?.secretCipher || '' };
    c.contacts = contacts(input.contacts ?? old?.contacts ?? []);
    assert(['none', 'all', 'members'].includes(c.atMode), '@ 方式无效');
    if (c.atMode === 'members') assert(c.atMobiles.length + c.atUserIds.length > 0, '请填写指定成员手机号或用户 ID');
    if (input.webhook) { webhookUrl(input.webhook); c.webhookCipher = await this.seal(input.webhook); }
    assert(c.webhookCipher, '请填写机器人 Webhook');
    if (input.clearSecret) c.secretCipher = '';
    if (input.secret) c.secretCipher = await this.seal(text(input.secret, '签名密钥', 4096));
    this.store.change(s => { s.settings.channels = [...s.settings.channels.filter(x => x.id !== c.id), c]; });
    this.onChange(); return c.id;
  }
  deleteConfig(kind, id) {
    assert(['models', 'channels'].includes(kind), '配置类型无效');
    this.store.change(s => {
      if (kind === 'channels') assert(!s.tasks.some(t => t.status === 'pending' && t.reminders.some(r => r.actions.some(a => a.channelId === id && ['pending', 'retry', 'running', 'unknown', 'failed', 'skipped'].includes(a.status)))), '该渠道仍被未完成待办使用，请先修改或完成待办');
      s.settings[kind] = s.settings[kind].filter(x => x.id !== id);
      if (kind === 'models' && s.settings.selectedModelId === id) s.settings.selectedModelId = s.settings.models[0]?.id || '';
    }); this.onChange();
  }
  selectModel(id) {
    this.store.change(s => { assert(s.settings.models.some(m => m.id === id), '模型配置不存在'); s.settings.selectedModelId = id; }); this.onChange();
  }
  setTheme(theme) {
    assert(['forest', 'ocean', 'apricot', 'lavender', 'night'].includes(theme), '主题不存在');
    this.store.change(s => { s.settings.theme = theme; }); this.onChange();
  }
}
module.exports = { Service };
