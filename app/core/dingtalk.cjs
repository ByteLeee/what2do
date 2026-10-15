'use strict';
const { createHmac } = require('node:crypto');
const { assert } = require('./domain.cjs');
function webhookUrl(value, secret, now = Date.now()) {
  const u = new URL(value);
  assert(u.protocol === 'https:' && u.hostname === 'oapi.dingtalk.com' && u.pathname === '/robot/send' && !u.username && !u.password && u.searchParams.get('access_token'), '请输入钉钉自定义机器人 Webhook（https://oapi.dingtalk.com/robot/send?access_token=…）');
  u.searchParams.delete('sign'); u.searchParams.delete('timestamp');
  if (secret) {
    const timestamp = String(now);
    u.searchParams.set('timestamp', timestamp);
    u.searchParams.set('sign', createHmac('sha256', secret).update(`${timestamp}\n${secret}`).digest('base64'));
  }
  return u.href;
}
function payload(task, reminder, action, channel, now = Date.now()) {
  const mode = action.atMode === 'default' || !action.atMode ? channel.atMode : action.atMode;
  const atMobiles = mode === 'members' ? (action.atMode === 'default' ? channel.atMobiles : action.atMobiles) || [] : [];
  const atUserIds = mode === 'members' ? (action.atMode === 'default' ? channel.atUserIds : action.atUserIds) || [] : [];
  const mention = [...atMobiles, ...atUserIds].map(x => `@${x}`).join(' ');
  const timezone = reminder.timeZone || Intl.DateTimeFormat().resolvedOptions().timeZone;
  const when = new Date(reminder.at).toLocaleString('zh-CN', { timeZone: timezone, hour12: false });
  const late = now - Date.parse(reminder.at) > 60000 ? '\n\n> 此消息为恢复运行后的补发。' : '';
  const keyword = channel.keyword ? `【${channel.keyword}】` : '';
  return {
    msgtype: 'markdown',
    markdown: { title: `${keyword}${task.title}`, text: `### ${keyword}${task.title}\n\n${task.notes || '该处理这件事了。'}\n\n**原定提醒：** ${when} (${timezone})${late}${mention ? `\n\n${mention}` : ''}` },
    at: { atMobiles, atUserIds, isAtAll: mode === 'all' }
  };
}
async function send({ webhook, secret, task, reminder, action, channel, fetchImpl = fetch }) {
  const url = webhookUrl(webhook, secret);
  let res;
  try {
    res = await fetchImpl(url, { method: 'POST', redirect: 'error', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload(task, reminder, action, channel)), signal: AbortSignal.timeout(15000) });
  } catch {
    const error = new Error('钉钉网络中断或超时，送达状态未知；请核对群消息后手动重试');
    error.uncertain = true;
    throw error;
  }
  if (!res.ok) {
    const error = new Error(`钉钉 HTTP ${res.status}`);
    if (res.status >= 500) error.uncertain = true;
    throw error;
  }
  let body;
  try { body = await res.json(); } catch {
    const error = new Error('钉钉响应无法识别，请核对群消息'); error.uncertain = true; throw error;
  }
  if (body.errcode !== 0) throw new Error(`钉钉拒绝消息（错误码 ${Number(body.errcode) || '未知'}），请检查机器人安全设置、成员标识或限流`);
  return { status: 'sent' };
}
module.exports = { webhookUrl, payload, send };
