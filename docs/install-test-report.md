# install.sh 测试报告

> 测试日期：2026-06-12
> 测试平台：macOS Darwin 25.5.0 (arm64 / Apple Silicon)
> 测试方式：删除 ffmpeg、ffprobe、yt-dlp 后运行 install.sh

## 测试环境

| 项目 | 值 |
|------|-----|
| OS | macOS Darwin 25.5.0 |
| Arch | arm64 (Apple Silicon) |
| Node.js | v25.7.0 (nvm) |
| Shell | zsh |
| 测试命令 | `bash install.sh --package <local-tarball> --install-dir /tmp/revideo-test-install --port 3002 --non-interactive` |

## 测试结果：✅ 通过

安装脚本成功完成全部步骤，服务在 ~30 秒内启动并通过健康检查。

### 逐步验证

| 步骤 | 结果 | 耗时 |
|------|------|------|
| OS/架构检测 | ✅ `darwin-arm64` | <1s |
| Node.js 检查 | ✅ v25.7.0 已存在 | <1s |
| yt-dlp 安装 | ✅ 从 GitHub 下载二进制到 `~/.local/bin/` | ~3s |
| ffmpeg + ffprobe 安装 | ✅ 从 evermeet.cx 下载 macOS 静态编译包 | ~5s |
| Chrome 检测 | ✅ 系统 Chrome 已安装 | <1s |
| 解压预打包 | ✅ 435MB tar.gz 解压 | ~8s |
| 设置初始化 | ✅ 使用 `data/settings.json` | <1s |
| launchd 服务 | ✅ 注册并启动 | ~2s |
| 健康检查 | ✅ `/api/health` 返回 `{"ok": true}` | ~10s |

### Health Check 响应

```json
{
    "ok": true,
    "dependencies": [
        { "name": "yt-dlp", "ok": true, "version": "2026.06.09" },
        { "name": "ffmpeg", "ok": true, "version": "ffmpeg version 8.1.1-tessus" },
        { "name": "ffprobe", "ok": true, "version": "ffprobe version 8.1.1-tessus" }
    ]
}
```

### 卸载测试

```
bash install.sh --uninstall
```

- ✅ launchd 服务停止并移除
- ✅ 端口进程被清理
- ✅ 安装目录可选删除

## 测试中发现并修复的 Bug

### Bug 1: OS 变量不匹配（严重）

- **问题**：`detect_os()` 设置 `OS="darwin"`，但 `install_yt_dlp()`、`install_ffmpeg()`、`check_chrome()` 等函数检查 `[[ "$OS" == "macos" ]]`，导致 macOS 上所有平台相关逻辑被跳过
- **影响**：macOS 上 ffmpeg/yt-dlp 安装代码完全不会执行，直接跳到 chmod 报错
- **修复**：统一所有检查为 `"darwin"`

### Bug 2: ffmpeg/ffprobe 安装解压路径问题

- **问题**：`unzip` 直接解压到 `/tmp`，可能与其他文件冲突，导致 mv 失败
- **修复**：使用 `mktemp -d` 创建独立子目录

### Bug 3: `src/dependencies.ts` 缺少 `~/.local/bin` 路径回退

- **问题**：`resolveCommand("ffmpeg")` 只检查 `FFMPEG_BIN` 环境变量，不搜索 `~/.local/bin/`。而 yt-dlp 有完整候选路径列表
- **影响**：安装脚本将 ffmpeg 放到 `~/.local/bin/ffmpeg`，但运行时 `spawn("ffmpeg")` 找不到
- **修复**：给 ffmpeg/ffprobe 也加上 `path.join(os.homedir(), ".local", "bin", name)` 候选路径

### Bug 4: launchd plist 缺少 `~/.local/bin` PATH

- **问题**：plist 模板的 PATH 不包含 `~/.local/bin`，导致 launchd 启动的进程找不到 ffmpeg
- **修复**：在 PATH 中添加 `{{HOME}}/.local/bin`，sed 替换时处理 `{{HOME}}`

### Bug 5: `--package` 模式下 tmpdir 未定义

- **问题**：使用 `--package` 本地文件时跳过下载分支，`tmpdir` 未定义，后续 `rm -rf "$tmpdir"` 触发 `set -u` 报错
- **修复**：使用 `cleanup_dir` 变量统一处理

### Bug 6: macOS 上 yt-dlp 不应走 brew

- **问题**：macOS 上优先用 `brew install yt-dlp`，会拉取 Python、deno 等 12 个依赖，下载量大且不稳定（测试中 deno 下载失败）
- **修复**：所有平台统一使用直接下载二进制方式，不依赖包管理器

## 待验证项

| 项目 | 状态 |
|------|------|
| Linux (Ubuntu x64) 实机测试 | ❌ 未测（需要 VM） |
| Windows install.ps1 测试 | ❌ 未测（需要 Windows） |
| 从 Gitee/GitHub Releases 下载（非 --package） | ❌ 未测（需先发布 release） |
| `npm run build` 后 `node dist/server.js` 正常运行 | ✅ 已验证 |
| tsc 编译通过 | ✅ 已验证 |
| `bash -n install.sh` 语法检查 | ✅ 已验证 |
| 升级安装（已有 data 目录时覆盖） | ⚠️ 部分验证（逻辑存在但未覆盖复杂场景） |

## 文件清单

### 新增文件

| 文件 | 用途 |
|------|------|
| `install.sh` | Unix 一键安装脚本 (Linux + macOS) |
| `install.ps1` | Windows 一键安装脚本 (PowerShell) |
| `scripts/systemd/revideo-server.service` | Linux systemd 服务模板 |
| `scripts/launchd/com.revideo.server.plist` | macOS launchd 服务模板 |
| `.github/workflows/release.yml` | CI 自动构建发布 workflow |
| `src/lib/cover-templates.ts` | 从 dashboard 复制的封面模板（解决跨 rootDir 引用） |

### 修改文件

| 文件 | 修改内容 |
|------|----------|
| `tsconfig.json` | `noEmit: true` → 编译输出到 `dist/` |
| `package.json` | 添加 `build`/`start` scripts、`engines`、`license: MIT` |
| `src/settings.ts` | 使用 `data/settings.json` 保存运行配置 |
| `.gitignore` | 添加 `dist/`、release 包 |
| `README.md` | Quick Install section |
| `scripts/restart-ui.sh` | `tsx src/server.ts` → `node dist/server.js` |
| `src/jobs/generate-cover.ts` | cover-templates import 路径修复 |
| `src/publish.ts` | null 检查修复 |
| `src/dependencies.ts` | ffmpeg/ffprobe 添加 `~/.local/bin` 候选路径 |
