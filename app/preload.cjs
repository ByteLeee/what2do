'use strict';
const { contextBridge, ipcRenderer } = require('electron');
// An explicit, narrow bridge. Never expose ipcRenderer, shell or arbitrary channel names.
const invoke = channel => async (...args) => {
  const result = await ipcRenderer.invoke(channel, ...args);
  if (!result.ok) throw new Error(result.error);
  return result.data;
};
contextBridge.exposeInMainWorld('what2do', {
  snapshot: invoke('snapshot'), saveTask: invoke('task:save'), completeTask: invoke('task:complete'),
  deleteTask: invoke('task:delete'), retryAction: invoke('action:retry'), chat: invoke('ai:chat'),
  saveModel: invoke('model:save'), selectModel: invoke('model:select'), testModel: invoke('model:test'),
  saveChannel: invoke('channel:save'), testChannel: invoke('channel:test'), deleteConfig: invoke('config:delete'),
  setLogin: invoke('login:set'), exportTasks: invoke('tasks:export'),
  onChange: callback => { const listener = () => callback(); ipcRenderer.on('changed', listener); return () => ipcRenderer.removeListener('changed', listener); }
});
