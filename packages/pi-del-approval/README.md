# pi-del-approval

`pi-del-approval` 在 Pi Agent 通过 shell 工具执行**文件删除命令**前弹出审批框，由用户决定放行或阻止。

删除审批逻辑提取自 [pi-op-approval](https://github.com/SeiyunSky/pi-op-approval)，只保留文件删除这一类，并增加了会话级授权。

## 拦截范围

拦截 `bash` 工具（以及扩展提供的 `powershell` 工具）中的以下命令：

| 类别 | 示例 |
| --- | --- |
| 删除命令 | `rm`、`rmdir`、`unlink`、`shred`、`srm` |
| Windows / PowerShell | `del`、`erase`、`rd`、`Remove-Item`、`Clear-Content` |
| 清空文件 | `truncate -s 0`、`truncate --size=0` |
| find 删除 | `find -delete`、`find -exec rm` |
| 内联脚本 | `python -c` / `node -e` / heredoc 等内联脚本中的 `os.remove`、`shutil.rmtree`、`Path.unlink`、`fs.rm(Sync)`、`fs.unlink(Sync)`、`FileUtils.rm_rf`、Perl `unlink` 等 |

识别会穿透这些写法：

- 复合命令：`&&`、`||`、`;`、`|`、`$(...)`、`if/then`、`for/do`
- 前缀与包装命令：`sudo`、`env`、`timeout`、`xargs`、`nice`，以及 `FOO=1` 这类环境变量前缀
- 路径与转义写法：`/bin/rm`、`\rm`
- 嵌套 shell：`bash -c '...'`、`eval "..."`、`pwsh -Command "..."`、`cmd /c ...`

识别时宁可多问，不可漏放：分段不考虑引号，所以 `echo "a; rm b"` 这类文本也会触发审批。

**不拦截**：

- 用户自己通过 `!` / `!!` 执行的命令
- Pi 的 `write` / `edit` 工具
- `git rm`、`docker rm`、`pnpm rm` 等子命令
- 磁盘上的脚本文件（如 `python cleanup.py`）里的删除逻辑

## 审批行为

命中删除命令时弹出选择框：

- **Allow once**：只放行本次调用。
- **Allow this exact command for this session**：本会话内，命令字符串完全相同的调用自动放行；切换或新建会话后失效。
- **Deny**：阻止执行，并告诉 agent 不要重试，也不要换其他方式删除同一份数据。按 Esc 取消或 agent 被中断时，同样按拒绝处理。

没有对话框 UI 时（`print` / `json` 模式），直接阻止。TUI 和 RPC 模式会正常弹窗。

## 审计日志

每次决策都会追加一行 JSON 到 `~/.pi/agent/pi-del-approval.jsonl`。如果设置了 `PI_CODING_AGENT_DIR`，日志写到对应目录。

```json
{"timestamp":"…","tool":"bash","command":"rm -rf dist","trigger":"rm -rf dist","cwd":"/repo","decision":"allow-once"}
```

`decision` 的取值有：

- `allow-once`：用户允许一次
- `allow-session`：用户授权本会话
- `session-allowed`：命中会话授权，自动放行
- `deny`：用户拒绝、取消或 agent 被中断
- `no-ui`：没有 UI，直接阻止

日志写入失败不会影响审批结果。

## 安装和使用

在本 monorepo 中直接试用：

```bash
pi --extension ./packages/pi-del-approval/index.ts
```

如果包已经发布到 npm：

```bash
pi install npm:pi-del-approval
```

## 开发验证

```bash
pnpm --filter pi-del-approval check
pnpm --filter pi-del-approval test
```

代码结构：

- [`detect.ts`](./detect.ts)：纯函数的删除命令识别
- [`index.ts`](./index.ts)：注册 `tool_call` 拦截、审批弹窗和审计日志
