import { app, BrowserWindow, shell, Menu, protocol, net, session } from "electron";
import * as path from "path";
import * as fs from "fs";
import { pathToFileURL } from "url";

// Ports mirror packages/shared/src/constants.ts (WEB_PORT / API_PORT) —
// kept inline so the desktop build stays self-contained (rootDir=src).
const WEB_ORIGIN = "http://localhost:3010";
const API_ORIGIN = "http://localhost:4000";

const APP_SCHEME = "app";
const APP_HOST = "c7ntax";

// Must be registered before app is ready
protocol.registerSchemesAsPrivileged([
  {
    scheme: APP_SCHEME,
    privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true },
  },
]);

const isDev = process.env.NODE_ENV === "development" || process.argv.includes("--dev");

let mainWindow: BrowserWindow | null = null;

/** Location of the built WebUI (the source of truth the desktop replicates). */
function webDistDir(): string {
  if (app.isPackaged) {
    return path.join(process.resourcesPath, "webui");
  }
  return path.join(__dirname, "../../web/dist");
}

const MIME_TYPES: Record<string, string> = {
  ".html": "text/html",
  ".js": "text/javascript",
  ".mjs": "text/javascript",
  ".css": "text/css",
  ".json": "application/json",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon",
  ".webp": "image/webp",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
  ".ttf": "font/ttf",
  ".md": "text/markdown",
};

/** Serve one static file from the WebUI dist, with SPA fallback to index.html. */
function serveStatic(pathname: string): Response {
  const dist = webDistDir();
  let rel = decodeURIComponent(pathname.replace(/^\/+/, "")) || "index.html";
  // SPA fallback: any missing path returns index.html so client routing works
  let filePath = path.join(dist, rel);
  if (!fs.existsSync(filePath) || fs.statSync(filePath).isDirectory()) {
    filePath = path.join(dist, "index.html");
    if (!fs.existsSync(filePath)) {
      return new Response("C7NTAX WebUI not built. Run: pnpm --filter @C7NTAX/web build", {
        status: 500,
        headers: { "Content-Type": "text/plain" },
      });
    }
  }
  const ext = path.extname(filePath).toLowerCase();
  const mime = MIME_TYPES[ext] || "application/octet-stream";
  const body = fs.readFileSync(filePath);
  return new Response(body, { status: 200, headers: { "Content-Type": mime } });
}

/** Proxy app://c7ntax/api/* to the C7NTAX API server (same origin contract as the WebUI dev proxy). */
function serveApi(pathname: string, search: string, method: string, headers: Headers, body: BodyInit | null): Promise<Response> {
  const target = API_ORIGIN + pathname + (search || "");
  const outHeaders: Record<string, string> = {};
  headers.forEach((value, key) => {
    // Strip browser hop-by-hop / origin headers
    const lower = key.toLowerCase();
    if (lower === "host" || lower === "origin" || lower === "connection" || lower === "content-length" || lower === "sec-fetch-site") return;
    outHeaders[key] = value;
  });
  return net.fetch(target, {
    method,
    headers: outHeaders,
    body: method === "GET" || method === "HEAD" ? undefined : body,
  });
}

function registerAppProtocol(): void {
  protocol.handle(APP_SCHEME, async (request) => {
    try {
      const url = new URL(request.url);
      if (url.host !== APP_HOST) {
        return new Response("Not found", { status: 404 });
      }
      // API traffic uses the same relative /api base the WebUI uses
      if (url.pathname.startsWith("/api/")) {
        return await serveApi(url.pathname, url.search, request.method, request.headers, request.body);
      }
      return serveStatic(url.pathname);
    } catch (e) {
      console.error("[C7NTAX] Protocol handler error:", e);
      return new Response("Internal error", { status: 500 });
    }
  });
}

// ── Window state persistence (replicates the WebUI session state reliably) ──
function windowStateFile(): string {
  return path.join(app.getPath("userData"), "window-state.json");
}

function loadWindowBounds(): { width: number; height: number } {
  try {
    const raw = fs.readFileSync(windowStateFile(), "utf-8");
    const parsed = JSON.parse(raw);
    if (parsed?.width >= 800 && parsed?.height >= 600) {
      return { width: parsed.width, height: parsed.height };
    }
  } catch { /* first run */ }
  return { width: 1400, height: 900 };
}

function saveWindowBounds(): void {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  try {
    const bounds = mainWindow.getBounds();
    fs.writeFileSync(windowStateFile(), JSON.stringify({ width: bounds.width, height: bounds.height }));
  } catch { /* ignore */ }
}

function createWindow(): void {
  const bounds = loadWindowBounds();
  mainWindow = new BrowserWindow({
    width: bounds.width,
    height: bounds.height,
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

  // Dev: use the Vite dev server (hot reload, identical to the browser WebUI).
  // Production: serve the exact built WebUI from app://c7ntax with API proxied.
  if (isDev) {
    mainWindow.loadURL(WEB_ORIGIN).catch(() => {
      mainWindow?.loadURL(`${APP_SCHEME}://${APP_HOST}/`);
    });
  } else {
    mainWindow.loadURL(`${APP_SCHEME}://${APP_HOST}/`);
  }

  // Persist window bounds so the desktop session resumes where it left off
  mainWindow.on("resize", saveWindowBounds);
  mainWindow.on("move", saveWindowBounds);

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
  registerAppProtocol();
  buildMenu();
  createWindow();

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});
