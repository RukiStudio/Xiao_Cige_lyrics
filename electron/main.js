const { app, BrowserWindow, Menu, shell, dialog } = require("electron");
const { spawn } = require("child_process");
const path = require("path");
const http = require("http");
const fs = require("fs");

// 哔哩哔哩个人主页
const BILIBILI_URL =
  "https://space.bilibili.com/527121484?spm_id_from=333.1007.0.0";
const GITHUB_URL = "https://github.com/trae-cn/xiaocige";

const BASE_PORT = 3456;

let mainWindow = null;
let serverProcess = null;
let serverPort = BASE_PORT;

// ============ 路径解析 ============

// 开发模式：__dirname = project/electron
// 打包模式：__dirname = resources/app/electron
function getAppRoot() {
  return path.resolve(__dirname, "..");
}

function getServerPath() {
  const root = getAppRoot();
  const p = path.join(root, ".next", "standalone", "server.js");
  return p;
}

function getServerCwd() {
  return path.dirname(getServerPath());
}

// ============ 端口检测 ============

function checkPortAvailable(port) {
  return new Promise((resolve) => {
    const tester = http
      .createServer()
      .once("error", () => resolve(false))
      .once("listening", () => {
        tester.close(() => resolve(true));
      })
      .listen(port);
  });
}

async function findAvailablePort(startPort) {
  for (let port = startPort; port < startPort + 20; port++) {
    if (await checkPortAvailable(port)) return port;
  }
  return startPort;
}

// ============ 服务器就绪检测 ============

function waitForServer(url, maxRetries = 40) {
  return new Promise((resolve, reject) => {
    let retries = 0;
    const check = () => {
      http
        .get(url, (res) => {
          if (res.statusCode) resolve(true);
          else retry();
        })
        .on("error", () => retry());
    };
    const retry = () => {
      retries++;
      if (retries >= maxRetries) {
        reject(new Error("服务器启动超时"));
        return;
      }
      setTimeout(check, 500);
    };
    check();
  });
}

// ============ 启动 Next.js standalone server ============

async function startServer() {
  const serverPath = getServerPath();

  if (!fs.existsSync(serverPath)) {
    const root = getAppRoot();
    throw new Error(
      `未找到 Next.js standalone server.js\n\n` +
        `期望位置: ${serverPath}\n` +
        `应用根目录: ${root}\n` +
        `文件列表: ${fs.readdirSync(root).join(", ")}\n\n` +
        `开发模式请运行: npm run build:electron`
    );
  }

  serverPort = await findAvailablePort(BASE_PORT);
  const serverCwd = getServerCwd();

  console.log(`[小词格] 启动服务器: ${serverPath}`);
  console.log(`[小词格] 工作目录: ${serverCwd}`);
  console.log(`[小词格] 端口: ${serverPort}`);

  serverProcess = spawn(process.execPath, [serverPath], {
    cwd: serverCwd,
    env: {
      ...process.env,
      ELECTRON_RUN_AS_NODE: "1",
      PORT: String(serverPort),
      NODE_ENV: "production",
      HOSTNAME: "127.0.0.1",
    },
    stdio: ["pipe", "pipe", "pipe"],
  });

  serverProcess.stdout.on("data", (data) => {
    const msg = data.toString().trim();
    if (msg) console.log(`[server] ${msg}`);
  });

  serverProcess.stderr.on("data", (data) => {
    const msg = data.toString().trim();
    if (msg) console.error(`[server:err] ${msg}`);
  });

  serverProcess.on("exit", (code) => {
    console.log(`[server] 进程退出 code=${code}`);
  });

  const healthUrl = `http://127.0.0.1:${serverPort}/api/health`;
  await waitForServer(healthUrl, 60);
  console.log(`[小词格] 服务器就绪: ${healthUrl}`);
}

// ============ 菜单 ============

function createMenu() {
  const template = [
    {
      label: "文件",
      submenu: [
        {
          label: "退出",
          accelerator: process.platform === "darwin" ? "Cmd+Q" : "Ctrl+Q",
          click: () => app.quit(),
        },
      ],
    },
    {
      label: "视图",
      submenu: [
        { role: "reload", label: "刷新" },
        { role: "toggleDevTools", label: "开发者工具" },
        { type: "separator" },
        { role: "resetZoom", label: "重置缩放" },
        { role: "zoomIn", label: "放大" },
        { role: "zoomOut", label: "缩小" },
        { type: "separator" },
        { role: "togglefullscreen", label: "全屏" },
      ],
    },
    {
      label: "帮助",
      submenu: [
        {
          label: "关于小词格",
          click: () => showAboutDialog(),
        },
        {
          label: "作者哔哩哔哩主页",
          click: () => shell.openExternal(BILIBILI_URL),
        },
        {
          label: "项目 GitHub",
          click: () => shell.openExternal(GITHUB_URL),
        },
      ],
    },
  ];

  const menu = Menu.buildFromTemplate(template);
  Menu.setApplicationMenu(menu);
}

function showAboutDialog() {
  dialog.showMessageBox(mainWindow, {
    type: "info",
    title: "关于小词格",
    message: "小词格 · AI 歌词生成器",
    detail:
      "纯大模型驱动 · 多轮自我迭代 · 对抗评审修改\n\n" +
      "作者哔哩哔哩主页：\n" +
      BILIBILI_URL +
      "\n\n" +
      "版本：" + app.getVersion(),
    buttons: ["打开主页", "关闭"],
    cancelId: 1,
  }).then((result) => {
    if (result.response === 0) {
      shell.openExternal(BILIBILI_URL);
    }
  });
}

// ============ 创建窗口 ============

async function createWindow() {
  // 加载窗口
  const loadingWin = new BrowserWindow({
    width: 420,
    height: 280,
    frame: false,
    transparent: true,
    resizable: false,
    alwaysOnTop: true,
    skipTaskbar: false,
  });

  loadingWin.loadURL(
    "data:text/html;charset=utf-8," +
      encodeURIComponent(`
    <html>
    <body style="margin:0;display:flex;align-items:center;justify-content:center;height:100vh;background:rgba(30,41,59,0.96);border-radius:12px;font-family:-apple-system,'Segoe UI',sans-serif;">
      <div style="text-align:center;">
        <div style="font-size:30px;font-weight:bold;color:#818cf8;margin-bottom:16px;">小词格</div>
        <div style="color:#94a3b8;font-size:14px;margin-bottom:8px;">AI 歌词生成器</div>
        <div style="color:#64748b;font-size:12px;">正在启动服务...</div>
      </div>
    </body>
    </html>
  `)
  );

  try {
    await startServer();
  } catch (err) {
    loadingWin.close();
    dialog.showErrorBox("启动失败", String(err.message || err));
    app.quit();
    return;
  }

  // 主窗口
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 900,
    minWidth: 800,
    minHeight: 600,
    title: "小词格 · AI 歌词生成器",
    show: false,
    backgroundColor: "#0f172a",
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith("http://127.0.0.1") || url.startsWith("http://localhost")) {
      return { action: "allow" };
    }
    shell.openExternal(url);
    return { action: "deny" };
  });

  try {
    await mainWindow.loadURL(`http://127.0.0.1:${serverPort}`);
    loadingWin.close();
    mainWindow.show();
  } catch (err) {
    loadingWin.close();
    dialog.showErrorBox("加载页面失败", String(err.message || err));
    app.quit();
    return;
  }

  mainWindow.on("closed", () => {
    mainWindow = null;
  });
}

// ============ 生命周期 ============

app.whenReady().then(() => {
  createMenu();
  createWindow();

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on("window-all-closed", () => {
  if (serverProcess) {
    try {
      serverProcess.kill();
    } catch {}
    serverProcess = null;
  }
  if (process.platform !== "darwin") {
    app.quit();
  }
});

app.on("before-quit", () => {
  if (serverProcess) {
    try {
      serverProcess.kill("SIGTERM");
    } catch {}
    serverProcess = null;
  }
});
