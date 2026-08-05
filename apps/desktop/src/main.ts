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
    title: "C7 Overwatch",
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

  // In production, load the bundled web app or remote URL.
  // For development, load the Vite dev server.
  if (isDev) {
    mainWindow.loadURL("http://localhost:5173");
    mainWindow.webContents.openDevTools({ mode: "detach" });
  } else {
    // Load the built React app (bundled with the Electron app)
    const indexPath = path.join(__dirname, "../../web/dist/index.html");
    if (fs.existsSync(indexPath)) {
      mainWindow.loadFile(indexPath);
    } else {
      // Fallback to hosted version
      mainWindow.loadURL("https://app.c7overwatch.com");
    }
  }

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
      label: "C7 Overwatch",
      submenu: [
        { label: "About C7 Overwatch", role: "about" },
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
        { label: "Documentation", click: () => shell.openExternal("https://docs.c7overwatch.com") },
        { label: "Report Issue", click: () => shell.openExternal("https://github.com/cyber7group/c7-overwatch/issues") },
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
