'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { emptyState } = require('./domain.cjs');
class Store {
  constructor(file) {
    this.file = file;
    fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
    this.state = emptyState();
    if (fs.existsSync(file)) {
      try {
        this.state = JSON.parse(fs.readFileSync(file, 'utf8'));
        if (this.state.version !== 1 || !Array.isArray(this.state.tasks) || !Array.isArray(this.state.logs) || !Array.isArray(this.state.settings?.models) || !Array.isArray(this.state.settings?.channels)) throw new Error('schema');
      } catch { throw new Error(`无法读取数据文件，请先备份并检查 ${file}；未覆盖原文件。`); }
    }
    this.state.settings.theme ||= 'forest';
  }
  change(fn) {
    const draft = structuredClone(this.state);
    const result = fn(draft);
    const temp = `${this.file}.tmp`;
    let fd;
    try {
      fd = fs.openSync(temp, 'w', 0o600);
      fs.writeFileSync(fd, JSON.stringify(draft, null, 2));
      fs.fsyncSync(fd);
    } finally { if (fd !== undefined) fs.closeSync(fd); }
    fs.renameSync(temp, this.file);
    this.state = draft;
    return result;
  }
  snapshot() {
    const data = structuredClone(this.state);
    data.settings.models = data.settings.models.map(({ apiKeyCipher, ...m }) => ({ ...m, apiKeySet: !!apiKeyCipher }));
    data.settings.channels = data.settings.channels.map(({ webhookCipher, secretCipher, ...c }) => ({ ...c, webhookSet: !!webhookCipher, secretSet: !!secretCipher }));
    return data;
  }
}
module.exports = { Store };
