'use strict';
const { randomUUID } = require('node:crypto');
class Scheduler {
  constructor({ store, execute, onChange = () => {}, now = Date.now }) {
    Object.assign(this, { store, execute, onChange, now });
    this.running = false;
  }
  recover() {
    this.store.change(s => {
      for (const task of s.tasks) for (const r of task.reminders) for (const a of r.actions) {
        if (a.status === 'running') {
          a.status = a.type === 'desktop' ? 'pending' : 'unknown';
          a.error = '上次执行时应用中断，请核对是否已执行';
          this.log(s, task, r, a);
        }
      }
    });
  }
  log(s, task, r, a) {
    s.logs.unshift({ id: randomUUID(), taskId: task.id, title: task.title, reminderId: r.id, actionId: a.id, type: a.type, status: a.status, message: a.error || '', at: new Date(this.now()).toISOString() });
    s.logs = s.logs.slice(0, 1000);
  }
  async tick() {
    if (this.running) return;
    this.running = true;
    try {
      const jobs = this.store.state.tasks.filter(t => t.status === 'pending').flatMap(t => t.reminders.flatMap(r => r.actions.map(a => ({ taskId: t.id, reminderId: r.id, actionId: a.id, at: r.at })))).sort((a, b) => Date.parse(a.at) - Date.parse(b.at));
      let processed = 0;
      for (const job of jobs) {
        if (processed >= 30) break;
        const task = this.store.state.tasks.find(t => t.id === job.taskId);
        const r = task?.reminders.find(x => x.id === job.reminderId);
        const a = r?.actions.find(x => x.id === job.actionId);
        if (!a || task.status !== 'pending' || !['pending', 'retry'].includes(a.status) || Date.parse(r.at) > this.now() || (a.nextAttemptAt && Date.parse(a.nextAttemptAt) > this.now())) continue;
        processed++;
        // Persist the claim BEFORE the side effect. Restarted requests are never silently repeated.
        this.store.change(s => {
          const target = s.tasks.find(t => t.id === task.id).reminders.find(x => x.id === r.id).actions.find(x => x.id === a.id);
          target.status = 'running'; target.attempts++; delete target.nextAttemptAt;
        });
        this.onChange();
        let status = 'sent', error = '';
        try {
          if (a.type === 'open_url' && this.now() - Date.parse(r.at) > 15 * 60 * 1000) {
            status = 'skipped'; error = '已迟到超过 15 分钟，未自动打开网页；可手动重试';
          } else status = (await this.execute(structuredClone(task), structuredClone(r), structuredClone(a)))?.status || 'sent';
        } catch (e) { status = e.uncertain ? 'unknown' : a.attempts + 1 >= 5 ? 'failed' : 'retry'; error = String(e.message || '执行失败').slice(0, 300); }
        this.store.change(s => {
          const currentTask = s.tasks.find(t => t.id === task.id);
          const currentReminder = currentTask?.reminders.find(x => x.id === r.id);
          const target = currentReminder?.actions.find(x => x.id === a.id);
          if (!target) return;
          target.status = status; target.error = error;
          if (status === 'retry') target.nextAttemptAt = new Date(this.now() + Math.min(30_000 * 2 ** (target.attempts - 1), 480_000)).toISOString();
          if (status === 'sent') target.executedAt = new Date(this.now()).toISOString();
          this.log(s, currentTask, currentReminder, target);
        });
        this.onChange();
      }
    } finally { this.running = false; }
  }
}
module.exports = { Scheduler };
