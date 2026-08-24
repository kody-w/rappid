const { contextBridge, ipcRenderer } = require("electron");

const invoke = (channel) => (...args) => ipcRenderer.invoke(channel, ...args);

contextBridge.exposeInMainWorld("zoo", Object.freeze({
  getState: invoke("zoo:state"),
  partyState: invoke("zoo:party-state"),
  partyAdd: invoke("zoo:party-add"),
  partyPC: invoke("zoo:party-pc"),
  partyCry: invoke("zoo:party-cry"),
  attach: invoke("zoo:attach"),
  detach: invoke("zoo:detach"),
  health: invoke("zoo:health"),
  chat: invoke("zoo:chat"),
  loadGlobal: invoke("zoo:global-load"),
  saveGlobal: invoke("zoo:global-save"),
  loadMonorepo: invoke("zoo:monorepo-load"),
  drill: invoke("zoo:drill"),
  dial: invoke("zoo:library-dial"),
  importCatalog: invoke("zoo:library-import"),
  approveSummon: invoke("zoo:library-approve"),
  preparePrototype: invoke("zoo:prototype-prepare"),
  exportPrototype: invoke("zoo:prototype-export"),
  generateReport: invoke("zoo:report-generate"),
  printReport: invoke("zoo:report-print"),
  saveReportConfig: invoke("zoo:report-config-save"),
  hatchChild: invoke("zoo:child-hatch"),
  stopChild: invoke("zoo:child-stop"),
  onState(callback) {
    const listener = (_event, state) => callback(state);
    ipcRenderer.on("zoo:state-changed", listener);
    return () => ipcRenderer.removeListener("zoo:state-changed", listener);
  },
  onAutopilotCommand(callback) {
    const listener = async (_event, requestId, command) => {
      try {
        const value = await callback(command);
        ipcRenderer.send("zoo:autopilot-result", requestId, {
          ok: true,
          value,
        });
      } catch (error) {
        ipcRenderer.send("zoo:autopilot-result", requestId, {
          ok: false,
          code: error?.code || null,
          error: String(error?.message || error),
        });
      }
    };
    ipcRenderer.on("zoo:autopilot-command", listener);
    return () => ipcRenderer.removeListener("zoo:autopilot-command", listener);
  },
}));
