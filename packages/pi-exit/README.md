# pi-exit

`pi-exit` 为 Pi Agent 增加 `/exit` 命令。

## 行为

执行 `/exit` 时，扩展命令处理器调用 Pi 的 `ctx.shutdown()`。这是 Pi 提供的优雅退出入口，因此行为与内置 `/quit` 一致，并会保留 Pi 的正常清理流程。

扩展不直接调用 `process.exit()`，也不注册工具；它只增加一个命令别名。

## 安装和使用

在本 monorepo 中直接试用：

```bash
pi --extension ./packages/pi-exit/index.ts
```

如果包已经发布到 npm，可以通过 Pi Package 安装：

```bash
pi install npm:pi-exit
```

安装后启动 Pi，输入：

```text
/exit
```

## 开发验证

在仓库根目录执行：

```bash
pnpm --filter pi-exit check
pnpm --filter pi-exit test
```

入口文件是 [`index.ts`](./index.ts)，包通过 `package.json` 中的 `pi.extensions` 字段声明该入口。
