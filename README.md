# pi-exts

`pi-exts` 是一个使用 pnpm 管理的 Pi Agent Extensions monorepo。每个扩展都是一个独立的 Pi Package，可以单独开发、测试和安装。

## 当前包

| 包 | 作用 |
| --- | --- |
| [`pi-exit`](./packages/pi-exit) | 为 Pi 增加 `/exit` 命令，并以与 `/quit` 相同的方式优雅退出 |
| [`pi-del-approval`](./packages/pi-del-approval) | agent 执行文件删除命令前弹窗审批，支持单次 / 会话级授权与审计日志 |

## 环境要求

- Node.js `>=22.19.0`
- pnpm `>=10`
- 已安装 Pi coding agent CLI

## 开发

```bash
pnpm install
pnpm check
pnpm test
```

也可以只操作某个包：

```bash
pnpm --filter pi-exit check
pnpm --filter pi-exit test
```

## 本地试用扩展

无需安装到全局即可直接加载入口文件：

```bash
pi --extension ./packages/pi-exit/index.ts
```

启动后输入 `/exit`，Pi 会通过扩展 API 请求优雅退出。

## 添加新扩展

在 `packages/` 下创建目录，并至少提供：

- `package.json`：声明包元数据和 `pi.extensions` 清单；
- `index.ts`：导出默认的 `ExtensionAPI` 工厂函数；
- `README.md`：说明扩展用途、安装方式和开发验证方式。

扩展依赖的 Pi 核心包应放在 `peerDependencies` 中，避免把 Pi 运行时重复打包进扩展。可执行检查和测试脚本后，根目录的递归脚本会自动包含该包。
