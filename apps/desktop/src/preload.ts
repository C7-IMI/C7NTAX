import { contextBridge, ipcRenderer } from "electron";

/**
 * Preload script — exposes a safe API to the renderer process.
 * All communication goes through this narrow bridge.
 */
contextBridge.exposeInMainWorld("c7Desktop", {
  /** Get app version */
  getVersion: (): Promise<string> => ipcRenderer.invoke("get-version"),

  /** Open a file dialog */
  openFile: async (): Promise<string | null> => {
    const result = await ipcRenderer.invoke("open-file-dialog");
    return result?.filePath || null;
  },

  /** Listen for navigation commands from the menu bar */
  onNavigate: (callback: (path: string) => void): (() => void) => {
    const handler = (_event: Electron.IpcRendererEvent, path: string) => callback(path);
    ipcRenderer.on("navigate", handler);
    return () => ipcRenderer.removeListener("navigate", handler);
  },

  /** Check if running in desktop wrapper */
  isDesktop: true,
});

// Declare the global type for TypeScript
declare global {
  interface Window {
    c7Desktop: {
      getVersion: () => Promise<string>;
      openFile: () => Promise<string | null>;
      onNavigate: (cb: (path: string) => void) => () => void;
      isDesktop: boolean;
    };
  }
}
