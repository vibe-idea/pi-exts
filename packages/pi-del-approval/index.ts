import { appendFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";

import { getAgentDir, type ExtensionAPI } from "@earendil-works/pi-coding-agent";

import { detectDeleteCommand } from "./detect.ts";

export { detectDeleteCommand } from "./detect.ts";

/** 审批弹窗选项；文案即返回值，顺序即展示顺序。 */
export const CHOICES = {
	allowOnce: "Allow once",
	allowSession: "Allow this exact command for this session",
	deny: "Deny",
} as const;

/** 审计日志中的决策类型。`session-allowed` 表示命中会话白名单而自动放行。 */
export type AuditDecision = "allow-once" | "allow-session" | "session-allowed" | "deny" | "no-ui";

export type AuditEntry = {
	timestamp: string;
	tool: string;
	command: string;
	trigger: string;
	cwd: string;
	decision: AuditDecision;
};

export type DeleteApprovalOptions = {
	/** 审计日志路径；默认 `<agentDir>/pi-del-approval.jsonl`（尊重 Pi 的 agent 目录环境变量）。 */
	auditFile?: string;
};

/** 会携带 shell 命令字符串的工具：Pi 内置 `bash`，以及部分扩展提供的 `powershell`。 */
const SHELL_TOOLS = new Set(["bash", "powershell"]);

const DENY_REASON =
	"Blocked by pi-del-approval: the user denied this delete operation. " +
	"Do not retry it or delete the same data another way; ask the user how to proceed if deletion is still required.";

const NO_UI_REASON =
	"Blocked by pi-del-approval: delete operations require interactive approval, but no UI is available in this mode.";

function writeAudit(file: string, entry: AuditEntry): void {
	try {
		mkdirSync(dirname(file), { recursive: true });
		appendFileSync(file, `${JSON.stringify(entry)}\n`, "utf8");
	} catch {
		// 审计失败不能影响审批结果本身
	}
}

/**
 * 创建删除审批扩展：在 agent 调用 shell 工具执行删除命令前弹窗，由用户决定放行或阻止。
 * 用户自己通过 `!` / `!!` 执行的命令走 `user_bash` 事件，不在拦截范围内。
 */
export function createDeleteApproval(options: DeleteApprovalOptions = {}): (pi: ExtensionAPI) => void {
	return (pi) => {
		// 会话级白名单：按完整命令字符串精确匹配，切换会话时清空
		const sessionAllowed = new Set<string>();

		pi.on("session_start", () => {
			sessionAllowed.clear();
		});

		pi.on("tool_call", async (event, ctx) => {
			if (!SHELL_TOOLS.has(event.toolName)) return undefined;
			const command = (event.input as { command?: unknown }).command;
			if (typeof command !== "string") return undefined;

			const trigger = detectDeleteCommand(command);
			if (!trigger) return undefined;

			// 延迟到真正写日志时才解析默认路径，避免模块加载时固化 agent 目录
			const audit = (decision: AuditDecision) =>
				writeAudit(options.auditFile ?? join(getAgentDir(), "pi-del-approval.jsonl"), {
					timestamp: new Date().toISOString(),
					tool: event.toolName,
					command,
					trigger,
					cwd: ctx.cwd,
					decision,
				});

			if (sessionAllowed.has(command)) {
				audit("session-allowed");
				return undefined;
			}

			// hasUI 在 TUI 与 RPC 模式下为 true；print/json 模式无法弹窗，只能阻止
			if (!ctx.hasUI) {
				audit("no-ui");
				return { block: true, reason: NO_UI_REASON };
			}

			const choice = await ctx.ui.select(
				`⚠ Delete operation requires approval\n\n` +
					`Matched: ${trigger}\n\n` +
					`Proposed ${event.toolName} command:\n${command}\n\n` +
					`Deleted local data may be unrecoverable.`,
				[CHOICES.allowOnce, CHOICES.allowSession, CHOICES.deny],
				// agent 被中断时自动关闭弹窗，按拒绝处理
				{ signal: ctx.signal },
			);

			if (choice === CHOICES.allowOnce) {
				audit("allow-once");
				return undefined;
			}
			if (choice === CHOICES.allowSession) {
				sessionAllowed.add(command);
				audit("allow-session");
				return undefined;
			}
			// 显式拒绝、Esc 取消、中断都视为拒绝
			audit("deny");
			return { block: true, reason: DENY_REASON };
		});
	};
}

export default createDeleteApproval();
