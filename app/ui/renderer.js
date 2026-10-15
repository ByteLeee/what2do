'use strict';
const api = window.what2do;
const $ = (selector, parent = document) => parent.querySelector(selector);
const $$ = (selector, parent = document) => [...parent.querySelectorAll(selector)];
const escape = value => String(value ?? '').replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));
const fmt = value => new Date(value).toLocaleString('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false });
const localInput = value => { const d = new Date(value); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}T${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}:${String(d.getSeconds()).padStart(2, '0')}`; };
const toISO = value => { const d = new Date(value); if (!value || !Number.isFinite(d.getTime())) throw new Error('请填写完整的提醒日期和时间'); return d.toISOString(); };
const statusNames = { pending: '待执行', running: '执行中', sent: '已提交', retry: '等待重试', failed: '失败', unknown: '状态未知', skipped: '已跳过', superseded: '已安排重试' };
const actionNames = { desktop: '桌面通知', dingtalk: '钉钉', open_url: '打开网页' };
let state, currentView = 'tasks', filter = 'pending', history = [], busy = false, editorKind, editing, reminderDrafts = [], refreshId = 0, toastTimeout;
function toast(message) { $('#toast').textContent = message; $('#toast').hidden = false; clearTimeout(toastTimeout); toastTimeout = setTimeout(() => { $('#toast').hidden = true; }, 4500); }
function fail(error) { toast(error.message || String(error)); }
async function refresh() {
  const id = ++refreshId;
  try {
    const next = await api.snapshot(); if (id !== refreshId) return;
    state = next; $('#error-banner').hidden = true; render();
  } catch (error) { $('#error-banner').textContent = `无法加载数据：${error.message}`; $('#error-banner').hidden = false; }
}
function view(name) {
  currentView = name;
  $$('.view').forEach(el => { el.hidden = el.id !== `view-${name}`; });
  $$('.nav').forEach(el => el.classList.toggle('active', el.dataset.view === name));
  $('#view-label').textContent = { tasks: '我的待办', logs: '执行记录', settings: '模型与通知' }[name];
}
function render() {
  const pending = state.tasks.filter(t => t.status === 'pending');
  $('#nav-count').textContent = pending.length; $('#stat-pending').textContent = pending.length;
  $('#stat-done').textContent = state.tasks.length - pending.length;
  const today = new Date().toDateString();
  $('#stat-today').textContent = pending.reduce((n, t) => n + t.reminders.filter(r => new Date(r.at).toDateString() === today).length, 0);
  $('#timezone').textContent = state.runtime.timezone;
  $('#date-label').textContent = new Date().toLocaleDateString('zh-CN', { year: 'numeric', month: 'long', day: 'numeric', weekday: 'long' });
  const models = state.settings.models;
  $('#active-model').innerHTML = models.length ? models.map(m => `<option value="${escape(m.id)}">${escape(m.name)} · ${escape(m.model)}</option>`).join('') : '<option value="">请先配置模型 →</option>';
  $('#active-model').value = state.settings.selectedModelId;
  renderTasks(); renderSettings(); renderLogs();
}
function reminderHTML(r) {
  return `<div class="reminder-line"><time class="${Date.parse(r.at) < Date.now() ? 'overdue' : ''}">◷ ${escape(fmt(r.at))}</time>${r.actions.map(a => `<span class="pill ${['failed', 'unknown', 'skipped', 'retry'].includes(a.status) ? 'problem' : ''}" title="${escape(a.error || '')}">${actionNames[a.type]} · ${statusNames[a.status] || '未知'}</span>`).join('')}</div>${r.actions.filter(a => a.type === 'open_url').map(a => `<div class="task-url">↗ ${escape(a.url)}</div>`).join('')}`;
}
function renderTasks() {
  const query = $('#search').value.trim().toLowerCase();
  const list = state.tasks.filter(t => (filter === 'all' || t.status === filter) && `${t.title} ${t.notes}`.toLowerCase().includes(query));
  const nextAt = t => Math.min(...t.reminders.filter(r => r.actions.some(a => ['pending', 'retry'].includes(a.status))).map(r => Date.parse(r.at)), Infinity);
  list.sort((a, b) => nextAt(a) - nextAt(b) || Date.parse(b.createdAt) - Date.parse(a.createdAt));
  $('#task-list').innerHTML = list.length ? list.map(t => `<article class="task-card ${t.status}" data-id="${escape(t.id)}"><div class="task-top"><button class="task-check" data-command="complete" aria-label="${t.status === 'completed' ? '恢复' : '完成'} ${escape(t.title)}">${t.status === 'completed' ? '✓' : ''}</button><div class="task-content"><h3 class="task-title">${escape(t.title)}</h3>${t.notes ? `<p class="task-note">${escape(t.notes)}</p>` : ''}${t.reminders.slice().sort((a, b) => Date.parse(a.at) - Date.parse(b.at)).map(reminderHTML).join('')}</div></div><div class="task-footer"><span>${t.dueAt ? `截止 ${escape(fmt(t.dueAt))}` : `${t.reminders.length} 个提醒时间`}</span><div>${t.status === 'pending' ? '<button data-command="edit">编辑</button>' : ''}<button data-command="detail">执行详情</button><button data-command="delete">删除</button></div></div></article>`).join('') : `<div class="empty"><div class="empty-icon">◷</div><strong>${query ? '没有找到这件事' : filter === 'completed' ? '做完的事，会留在这里' : '给下一件事，留一个时间'}</strong>${query ? '换个关键词试试。' : '可以在右侧说出来，也可以手动新建。'}</div>`;
}
function renderSettings() {
  $('#models-list').innerHTML = state.settings.models.map(m => `<div class="config-item" data-id="${escape(m.id)}"><div class="config-title"><strong>${escape(m.name)}</strong>${m.id === state.settings.selectedModelId ? '<span class="pill">正在使用</span>' : ''}</div><small>${escape(m.model)} · ${m.apiKeySet ? '密钥已加密' : '未设置密钥'}</small><small>${escape(m.baseUrl)}</small><div class="config-actions"><button data-config="select">使用</button><button data-config="test-model">测试连接</button><button data-config="edit-model">编辑</button><button data-config="delete-model">删除</button></div></div>`).join('') || '<p class="hint">还没有模型。添加 API 地址、模型标识和密钥后，就可以用对话创建待办。</p>';
  $('#channels-list').innerHTML = state.settings.channels.map(c => `<div class="config-item" data-id="${escape(c.id)}"><div class="config-title"><strong>${escape(c.name)}</strong><span class="pill">钉钉</span></div><small>${({ none: '不 @ 成员', all: '@所有人', members: `@指定成员（${c.atMobiles.length + c.atUserIds.length} 人）` })[c.atMode]} · ${c.secretSet ? '已加签' : '未加签'}${c.keyword ? ` · 关键词 ${escape(c.keyword)}` : ''}</small><div class="config-actions"><button data-config="test-channel">发送测试消息</button><button data-config="edit-channel">编辑</button><button data-config="delete-channel">删除</button></div></div>`).join('') || '<p class="hint">添加群自定义机器人后，AI 和手动待办都可以使用钉钉提醒。</p>';
  $('#login-toggle').checked = state.settings.launchAtLogin;
  $('#login-toggle').disabled = !state.runtime.loginAvailable;
  $('#login-hint').textContent = state.runtime.loginAvailable ? '' : '安装版可用';
}
let logTaskId = '';
function renderLogs() {
  const list = state.logs.filter(l => !logTaskId || l.taskId === logTaskId);
  $('#logs-list').innerHTML = (logTaskId ? '<button class="button" data-all-logs>查看全部记录</button><p></p>' : '') + (list.length ? list.map(l => {
    const task = state.tasks.find(t => t.id === l.taskId);
    const action = task?.reminders.flatMap(r => r.actions).find(a => a.id === l.actionId);
    const retry = task?.status === 'pending' && ['failed', 'unknown', 'skipped', 'retry'].includes(action?.status) && state.logs.find(x => x.actionId === l.actionId)?.id === l.id;
    return `<div class="log-row"><time>${escape(fmt(l.at))}</time><div>${escape(l.title)}<br><small>${actionNames[l.type]}</small></div><span class="pill ${['failed', 'unknown', 'retry', 'skipped'].includes(l.status) ? 'problem' : ''}">${statusNames[l.status] || l.status}</span><div class="log-message">${escape(l.message || '已提交给系统或通知渠道；不代表收件人已阅读。')}${retry ? `<button class="button" data-retry="${escape(l.actionId)}" data-task="${escape(l.taskId)}">手动重试</button>` : ''}</div></div>`;
  }).join('') : '<div class="empty"><strong>还没有执行记录</strong>到达提醒时间后，结果会出现在这里。</div>');
}
function confirm(message) {
  $('#confirm-text').textContent = message;
  const el = $('#confirm-dialog'); el.showModal();
  return new Promise(resolve => {
    const done = result => { el.close(); $('#confirm-yes').onclick = null; $('#confirm-no').onclick = null; el.oncancel = null; resolve(result); };
    $('#confirm-yes').onclick = () => done(true); $('#confirm-no').onclick = () => done(false); el.oncancel = event => { event.preventDefault(); done(false); };
  });
}
const field = (label, name, value = '', type = 'text', extra = '') => `<label class="field">${label}<input name="${name}" type="${type}" value="${escape(value)}" ${extra}></label>`;
const options = (entries, selected) => entries.map(([value, title]) => `<option value="${escape(value)}" ${value === selected ? 'selected' : ''}>${escape(title)}</option>`).join('');
const select = (label, name, entries, selected) => `<label class="field">${label}<select name="${name}">${options(entries, selected)}</select></label>`;
const atOptions = [['default', '遵循渠道默认'], ['none', '不 @ 成员'], ['all', '@所有人'], ['members', '@指定成员']];
function openEditor(kind, item = null) {
  editorKind = kind; editing = item ? structuredClone(item) : null;
  $('#editor-error').hidden = true; $('#save-editor').disabled = false;
  $('#editor-title').textContent = `${item ? '编辑' : '添加'}${({ task: '待办', model: '大模型', channel: '钉钉机器人' })[kind]}`;
  $('#editor-eyebrow').textContent = ({ task: 'MAKE A LITTLE PLAN', model: 'YOUR AI, YOUR CHOICE', channel: 'A GENTLE NUDGE, WHERE YOU ARE' })[kind];
  const b = $('#editor-body');
  if (kind === 'task') {
    reminderDrafts = item ? structuredClone(item.reminders) : [{ at: new Date(Date.now() + 3600000).toISOString(), actions: [{ type: 'desktop' }] }];
    b.innerHTML = field('待办事项', 'title', item?.title, 'text', 'required maxlength="160" placeholder="例如：交周报"') + `<label class="field">补充说明<textarea name="notes" rows="2" maxlength="10000">${escape(item?.notes)}</textarea></label>` + field('截止时间（可选，不会自动增加提醒）', 'dueAt', item?.dueAt ? localInput(item.dueAt) : '', 'datetime-local', 'step="1"') + '<div class="section-head"><h2>提醒安排</h2><span class="hint">每个时间可执行多个动作</span></div><div id="reminders-edit"></div><button type="button" class="button" id="add-reminder">＋ 添加提醒时间</button><p class="hint">按当前系统时区填写。单次待办可以设置多个具体时间，暂不支持无限循环提醒。</p>';
    renderReminders();
  } else if (kind === 'model') {
    b.innerHTML = field('配置名称', 'name', item?.name, 'text', 'required maxlength="80" placeholder="例如：我的模型"') + field('Base URL', 'baseUrl', item?.baseUrl || 'https://api.openai.com/v1', 'url', 'required placeholder="https://服务地址/v1"') + '<p class="hint">填写服务提供方给出的兼容接口根地址；本机服务可用 http://localhost:端口/v1。</p>' + field('模型标识', 'model', item?.model, 'text', 'required placeholder="填写服务商提供的准确模型名称"') + field(`API Key（${item?.apiKeySet ? '已保存，留空保留' : '本机服务可留空'}）`, 'apiKey', '', 'password', 'autocomplete="new-password"') + (item?.apiKeySet ? '<label class="check"><input name="clearKey" type="checkbox">清除已保存的 API Key</label>' : '') + '<p class="hint">支持兼容 OpenAI Chat Completions 的服务。不同服务的协议扩展不一定兼容，可保存后测试连接。</p>';
  } else {
    b.innerHTML = field('渠道名称', 'name', item?.name, 'text', 'required placeholder="例如：工作群" maxlength="80"') + field(`Webhook（${item?.webhookSet ? '已保存，留空保留' : '必填'}）`, 'webhook', '', 'password', `${item?.webhookSet ? '' : 'required'} placeholder="https://oapi.dingtalk.com/robot/send?access_token=…" autocomplete="new-password"`) + field(`加签密钥 Secret（${item?.secretSet ? '已保存，留空保留' : '使用加签安全设置时填写'}）`, 'secret', '', 'password', 'placeholder="SEC…" autocomplete="new-password"') + (item?.secretSet ? '<label class="check"><input name="clearSecret" type="checkbox">清除已保存的签名密钥</label>' : '') + field('关键词（机器人安全设置要求时填写）', 'keyword', item?.keyword, 'text', 'maxlength="80"') + select('默认 @ 方式', 'atMode', atOptions.slice(1), item?.atMode || 'none') + `<div id="channel-members" ${item?.atMode === 'members' ? '' : 'hidden'}>` + field('手机号（多个用逗号分隔）', 'atMobiles', item?.atMobiles?.join(', ')) + field('用户 ID（多个用逗号分隔）', 'atUserIds', item?.atUserIds?.join(', ')) + '</div><p class="hint">仅支持钉钉群自定义机器人。请将应用配置与机器人安全设置保持一致。手机号或用户 ID 必须属于该群，不能直接填写姓名。</p>';
  }
  $('#editor').showModal();
}
function locked(r) { return r.actions.some(a => a.status && a.status !== 'pending' || a.attempts > 0); }
function renderReminders() {
  $('#reminders-edit').innerHTML = reminderDrafts.map((r, index) => {
    if (locked(r)) return `<div class="saved-reminder">已执行记录（保留）${reminderHTML(r)}</div>`;
    return `<div class="reminder-editor" data-reminder="${index}"><div class="reminder-head"><strong>提醒 ${index + 1}</strong><button type="button" data-remove-reminder="${index}">移除时间</button></div><label class="field">时间<input name="reminder-at" type="datetime-local" step="1" required value="${escape(localInput(r.at))}"></label>${r.actions.map((a, ai) => `<div class="action-editor" data-action-index="${ai}"><div class="action-heading"><select name="action-type" aria-label="提醒动作">${options(Object.entries(actionNames), a.type)}</select><button type="button" data-remove-action="${index}:${ai}">移除动作</button></div>${a.type === 'open_url' ? field('到期打开此链接', 'url', a.url, 'url', 'required placeholder="https://…"') : ''}${a.type === 'dingtalk' ? (select('发送到', 'channelId', [['', '请选择渠道'], ...state.settings.channels.map(c => [c.id, c.name])], a.channelId || '') + select('@ 方式', 'atMode', atOptions, a.atMode || 'default') + (a.atMode === 'members' ? field('手机号（逗号分隔）', 'atMobiles', Array.isArray(a.atMobiles) ? a.atMobiles.join(', ') : a.atMobiles) + field('用户 ID（逗号分隔）', 'atUserIds', Array.isArray(a.atUserIds) ? a.atUserIds.join(', ') : a.atUserIds) : '')) : ''}</div>`).join('')}<div class="actions-add"><button type="button" data-add-action="${index}">＋ 添加动作</button></div></div>`;
  }).join('');
}
function readReminders() {
  $$('.reminder-editor').forEach(el => {
    const r = reminderDrafts[Number(el.dataset.reminder)]; const value = $('[name="reminder-at"]', el).value;
    r.at = value ? toISO(value) : '';
    r.actions = $$('.action-editor', el).map(a => {
      const get = name => $(`[name="${name}"]`, a)?.value;
      const type = get('action-type');
      if (type === 'open_url') return { type, url: get('url') || '' };
      if (type === 'dingtalk') return { type, channelId: get('channelId') || '', atMode: get('atMode') || 'default', atMobiles: (get('atMobiles') || '').split(/[,，\s]+/).filter(Boolean), atUserIds: (get('atUserIds') || '').split(/[,，\s]+/).filter(Boolean) };
      return { type };
    });
  });
}
function editorError(error) { $('#editor-error').textContent = error.message || String(error); $('#editor-error').hidden = false; }
$('#editor-body').addEventListener('click', event => {
  const button = event.target.closest('button'); if (!button || editorKind !== 'task') return;
  try {
    readReminders();
    if (button.id === 'add-reminder') reminderDrafts.push({ at: new Date(Date.now() + 3600000).toISOString(), actions: [{ type: 'desktop' }] });
    if (button.dataset.removeReminder !== undefined) reminderDrafts.splice(Number(button.dataset.removeReminder), 1);
    if (button.dataset.addAction !== undefined) reminderDrafts[Number(button.dataset.addAction)].actions.push({ type: 'desktop' });
    if (button.dataset.removeAction) { const [ri, ai] = button.dataset.removeAction.split(':').map(Number); reminderDrafts[ri].actions.splice(ai, 1); }
    renderReminders();
  } catch (error) { editorError(error); }
});
$('#editor-body').addEventListener('change', event => {
  if (editorKind === 'task' && ['action-type', 'atMode'].includes(event.target.name)) { try { readReminders(); renderReminders(); } catch (e) { editorError(e); } }
  if (editorKind === 'channel' && event.target.name === 'atMode') $('#channel-members').hidden = event.target.value !== 'members';
});
$('#editor-form').addEventListener('submit', async event => {
  event.preventDefault(); $('#save-editor').disabled = true; $('#editor-error').hidden = true;
  try {
    const data = Object.fromEntries(new FormData(event.target));
    data.id = editing?.id;
    if (editorKind === 'task') { readReminders(); await api.saveTask({ id: data.id, title: data.title, notes: data.notes, dueAt: data.dueAt ? toISO(data.dueAt) : null, reminders: reminderDrafts }); }
    if (editorKind === 'model') await api.saveModel({ ...data, clearKey: data.clearKey === 'on' });
    if (editorKind === 'channel') await api.saveChannel({ ...data, clearSecret: data.clearSecret === 'on' });
    $('#editor').close(); await refresh(); toast('已保存');
  } catch (error) { editorError(error); } finally { $('#save-editor').disabled = false; }
});
$('#close-editor').onclick = $('#cancel-editor').onclick = () => $('#editor').close();
$('#new-task').onclick = () => { if (state) openEditor('task'); };
$('#add-model').onclick = () => openEditor('model'); $('#add-channel').onclick = () => openEditor('channel');
$$('.nav').forEach(button => { button.onclick = () => { logTaskId = ''; renderLogs(); view(button.dataset.view); }; });
$$('[data-filter]').forEach(button => { button.onclick = () => { filter = button.dataset.filter; $$('[data-filter]').forEach(b => b.classList.toggle('selected', b === button)); renderTasks(); }; });
$('#search').oninput = renderTasks;
$('#task-list').addEventListener('click', async event => {
  const button = event.target.closest('[data-command]'); if (!button) return;
  const task = state.tasks.find(t => t.id === button.closest('[data-id]').dataset.id); if (!task) return;
  try {
    if (button.dataset.command === 'edit') openEditor('task', task);
    if (button.dataset.command === 'complete') { if (task.status === 'completed' && !await confirm('恢复后，已经到期且尚未执行的提醒会开始补发。确认恢复？')) return; await api.completeTask(task.id, task.status !== 'completed'); await refresh(); }
    if (button.dataset.command === 'delete' && await confirm(`删除“${task.title}”及其后续提醒？执行记录仍会保留。`)) { await api.deleteTask(task.id); await refresh(); }
    if (button.dataset.command === 'detail') { logTaskId = task.id; renderLogs(); view('logs'); }
  } catch (error) { fail(error); }
});
document.addEventListener('click', async event => {
  const button = event.target.closest('[data-config]'); if (!button) return;
  const id = button.closest('[data-id]').dataset.id, command = button.dataset.config;
  try {
    if (command === 'edit-model') return openEditor('model', state.settings.models.find(m => m.id === id));
    if (command === 'edit-channel') return openEditor('channel', state.settings.channels.find(c => c.id === id));
    if (command.startsWith('delete') && !await confirm('确认删除此配置？')) return;
    button.disabled = true;
    if (command === 'select') await api.selectModel(id);
    if (command === 'test-model') toast(await api.testModel(id));
    if (command === 'test-channel') toast(await api.testChannel(id));
    if (command === 'delete-model') await api.deleteConfig('models', id);
    if (command === 'delete-channel') await api.deleteConfig('channels', id);
    await refresh();
  } catch (error) { fail(error); } finally { button.disabled = false; }
});
$('#active-model').onchange = async event => { try { await api.selectModel(event.target.value); } catch (error) { fail(error); } };
$('#active-model').onclick = () => { if (!state.settings.models.length) { view('settings'); openEditor('model'); } };
$('#login-toggle').onchange = async event => { try { await api.setLogin(event.target.checked); await refresh(); } catch (error) { fail(error); await refresh(); } };
$('#export-tasks').onclick = async () => { try { if (await api.exportTasks()) toast('已导出，不含 API Key 和机器人凭据'); } catch (error) { fail(error); } };
$('#logs-list').addEventListener('click', async event => {
  if (event.target.closest('[data-all-logs]')) { logTaskId = ''; renderLogs(); return; }
  const button = event.target.closest('[data-retry]'); if (!button) return;
  if (!await confirm('请先核对通知或网页是否已执行。重试会立即再执行一次，可能产生重复消息。确认重试？')) return;
  try { await api.retryAction(button.dataset.task, button.dataset.retry); await refresh(); toast('已安排重试'); } catch (error) { fail(error); }
});
function bubble(role, content, taskId) {
  const div = document.createElement('div'); div.className = role; div.textContent = content;
  if (taskId) { const b = document.createElement('button'); b.className = 'message-task'; b.textContent = '✓ 已创建待办 · 查看与编辑'; b.onclick = () => { const t = state.tasks.find(t => t.id === taskId); if (t) openEditor('task', t); else toast('此待办已删除'); }; div.appendChild(b); }
  $('#chat-messages').appendChild(div); $('#chat-messages').scrollTop = $('#chat-messages').scrollHeight; return div;
}
$('#chat-form').addEventListener('submit', async event => {
  event.preventDefault(); if (busy) return;
  const content = $('#chat-input').value.trim(); if (!content) return;
  if (!state.settings.models.length) { view('settings'); openEditor('model'); return; }
  if (history.length >= 28) { toast('对话较长，请开始新对话后继续'); return; }
  busy = true; $('#send-chat').disabled = true; $('#clear-chat').disabled = true; $('#chat-input').value = '';
  bubble('user', content); history.push({ role: 'user', content });
  const loading = bubble('assistant', '正在理解事项、时间和提醒方式…');
  try {
    const result = await api.chat(history); loading.remove();
    await refresh(); bubble('assistant', result.reply, result.taskId);
    if (result.taskId) { history = []; toast('待办已自动创建，可以在列表中修改'); }
    else history.push({ role: 'assistant', content: result.reply });
  } catch (error) { history.pop(); loading.textContent = error.message; loading.classList.add('message-error'); $('#chat-input').value = content; }
  finally { busy = false; $('#send-chat').disabled = false; $('#clear-chat').disabled = false; $('#chat-input').focus(); }
});
$('#chat-input').addEventListener('keydown', event => { if (event.key === 'Enter' && !event.shiftKey && !event.isComposing) { event.preventDefault(); $('#chat-form').requestSubmit(); } });
$('#clear-chat').onclick = () => { if (busy) return; history = []; $('#chat-messages').replaceChildren(); bubble('assistant', '新的对话开始了。告诉我事项、时间和提醒方式吧。'); };
$$('[data-example]').forEach(button => { button.onclick = () => { $('#chat-input').value = button.dataset.example; $('#chat-input').focus(); }; });
if (api) { api.onChange(refresh); refresh(); } else { $('#error-banner').textContent = '请通过桌面应用打开；浏览器预览不能执行提醒。'; $('#error-banner').hidden = false; }
