import { app, BrowserWindow, shell, Menu, dialog } from "electron";
import * as path from "path";
import * as fs from "fs";

const isDev = process.env.NODE_ENV === "development" || process.argv.includes("--dev");

let mainWindow: BrowserWindow | null = null;

function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 800,
    minHeight: 600,
    title: "C7NTAX",
    icon: path.join(__dirname, "../assets/icon.png"),
    backgroundColor: "#0a1628",
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: path.join(__dirname, "preload.js"),
    },
    autoHideMenuBar: true,
    show: false,
  });

  mainWindow.once("ready-to-show", () => {
    mainWindow?.show();
  });

  // Always load from dev server or try local file
  const webUrl = "http://localhost:3003";
  mainWindow.loadURL(webUrl).catch(() => {
    if (!mainWindow) return;
    const indexPath = path.join(__dirname, "../../web/dist/index.html");
    if (fs.existsSync(indexPath)) {
      mainWindow.loadFile(indexPath);
    } else {
      mainWindow.loadURL("data:text/html,<h1 style='color:white;background:#0a1628;text-align:center;padding-top:40vh;font-family:sans-serif'>C7NTAX<br><small>Start the web server: pnpm dev</small></h1>");
    }
  });

  // Open external links in the system browser
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith("https:") || url.startsWith("http:")) {
      shell.openExternal(url);
    }
    return { action: "deny" };
  });

  mainWindow.on("closed", () => { mainWindow = null; });
}

// ── Application Menu ──
function buildMenu(): void {
  const template: Electron.MenuItemConstructorOptions[] = [
    {
      label: "C7NTAX",
      submenu: [
        { label: "About C7NTAX", role: "about" },
        { type: "separator" },
        { label: "Settings", accelerator: "CmdOrCtrl+,", click: () => mainWindow?.webContents.send("navigate", "/settings") },
        { type: "separator" },
        { label: "Quit", accelerator: "CmdOrCtrl+Q", click: () => app.quit() },
      ],
    },
    {
      label: "File",
      submenu: [
        { label: "New Ticket", accelerator: "CmdOrCtrl+N", click: () => mainWindow?.webContents.send("navigate", "/tickets?new=true") },
        { label: "New Invoice", accelerator: "CmdOrCtrl+Shift+N", click: () => mainWindow?.webContents.send("navigate", "/billing?new=true") },
        { type: "separator" },
        { label: "Print", accelerator: "CmdOrCtrl+P", click: () => mainWindow?.webContents.print() },
      ],
    },
    {
      label: "View",
      submenu: [
        { label: "Reload", accelerator: "CmdOrCtrl+R", click: () => mainWindow?.webContents.reload() },
        { label: "Toggle Developer Tools", accelerator: "F12", click: () => mainWindow?.webContents.toggleDevTools() },
        { type: "separator" },
        { label: "Zoom In", role: "zoomIn" },
        { label: "Zoom Out", role: "zoomOut" },
        { label: "Reset Zoom", role: "resetZoom" },
      ],
    },
    {
      label: "Help",
      submenu: [
        { label: "Documentation", click: () => shell.openExternal("https://docs.C7NTAX.com") },
        { label: "Report Issue", click: () => shell.openExternal("https://github.com/cyber7group/C7NTAX/issues") },
      ],
    },
  ];

  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

// ── App Lifecycle ──

app.whenReady().then(() => {
  buildMenu();
  createWindow();

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});
