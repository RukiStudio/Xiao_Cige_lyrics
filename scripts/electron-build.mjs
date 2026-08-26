// electron-build.mjs
// Next.js standalone 构建后处理脚本
// 1. 运行 next build
// 2. 复制 .next/static → .next/standalone/.next/static
// 3. 复制 public → .next/standalone/public

import { execSync } from "child_process";
import { cpSync, existsSync, mkdirSync, rmSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, "..");

const standaloneDir = join(root, ".next", "standalone");
const staticSrc = join(root, ".next", "static");
const staticDst = join(standaloneDir, ".next", "static");
const publicSrc = join(root, "public");
const publicDst = join(standaloneDir, "public");

function log(msg) {
  console.log(`\x1b[36m[electron-build]\x1b[0m ${msg}`);
}

function run() {
  // Step 1: next build
  log("执行 next build...");
  execSync("npx next build", { cwd: root, stdio: "inherit" });

  // 验证 standalone 目录存在
  if (!existsSync(standaloneDir)) {
    throw new Error("standalone 目录不存在，请检查 next.config.mjs 是否配置了 output: 'standalone'");
  }
  log("standalone 目录就绪");

  // Step 2: 复制 .next/static
  if (existsSync(staticDst)) {
    rmSync(staticDst, { recursive: true, force: true });
  }
  if (existsSync(staticSrc)) {
    mkdirSync(dirname(staticDst), { recursive: true });
    cpSync(staticSrc, staticDst, { recursive: true });
    log(`复制 .next/static → ${staticDst}`);
  } else {
    log("警告: .next/static 不存在，跳过");
  }

  // Step 3: 复制 public
  if (existsSync(publicDst)) {
    rmSync(publicDst, { recursive: true, force: true });
  }
  if (existsSync(publicSrc)) {
    cpSync(publicSrc, publicDst, { recursive: true });
    log(`复制 public → ${publicDst}`);
  } else {
    log("警告: public 目录不存在，跳过");
  }

  log("构建后处理完成，可运行 electron-builder 打包");
}

run();
