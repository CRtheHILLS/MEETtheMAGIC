'use strict';

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('magic', {
  startCapture: () => ipcRenderer.send('start-capture'),
  stopCapture: () => ipcRenderer.send('stop-capture'),
  sendAudio: (arrayBuffer) => ipcRenderer.send('audio-chunk', arrayBuffer),
  requestTranslate: (payload) => ipcRenderer.send('request-translate', payload),
  toggleOnTop: () => ipcRenderer.invoke('toggle-on-top'),

  onStatus: (cb) => ipcRenderer.on('status', (_e, p) => cb(p)),
  onSpeech: (cb) => ipcRenderer.on('speech', (_e, p) => cb(p)),
  onTranscriptDelta: (cb) => ipcRenderer.on('transcript-delta', (_e, p) => cb(p)),
  onTranscriptFinal: (cb) => ipcRenderer.on('transcript-final', (_e, p) => cb(p)),
  onTranslationStart: (cb) => ipcRenderer.on('translation-start', (_e, p) => cb(p)),
  onTranslationDelta: (cb) => ipcRenderer.on('translation-delta', (_e, p) => cb(p)),
  onTranslationDone: (cb) => ipcRenderer.on('translation-done', (_e, p) => cb(p))
});
