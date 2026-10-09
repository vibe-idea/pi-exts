import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { ExtensionAPI, ExtensionContext, ToolCallEvent } from "@earendil-works/pi-coding-agent";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { CHOICES, createDeleteApproval, type AuditEntry } from "../index.ts";

type Handler = (event: unknown, ctx: ExtensionContext) => unknown;

/** 用最小 mock 加载扩展，收集注册的事件处理器。 */
function load(auditFile: string) {
	const handlers = new Map<string, Handler>();
	const on = vi.fn((name: string, handler: Handler) => {
		handlers.set(name, handler);
	});
	createDeleteApproval({ auditFile })({ on } as unknown as ExtensionAPI);

	const select = vi.fn<(title: string, options: string[]) => Promise<string | undefined>>();
	const ctx = { cwd: "/repo", hasUI: true, signal: undefined, ui: { select } } as unknown as ExtensionContext;

	const toolCall = (command: string, toolName = "bash") =>
		handlers.get("tool_call")!({ type: "tool_call", toolCallId: "1", toolName, input: { command } } as ToolCallEvent, ctx);
	const startSession = () => handlers.get("session_start")!({ type: "session_start", reason: "new" }, ctx);

	return { ctx, select, toolCall, startSession };
}

describe("pi-delete-approval", () => {
	let dir: string;
	let auditFile: string;

	const readAudit = (): AuditEntry[] =>
		readFileSync(auditFile, "utf8")
			.trim()
			.split("\n")
			.map((line) => JSON.parse(line) as AuditEntry);

	beforeEach(() => {
		dir = mkdtempSync(join(tmpdir(), "pi-delete-approval-"));
		auditFile = join(dir, "nested", "audit.jsonl");
	});

	afterEach(() => {
		rmSync(dir, { recursive: true, force: true });
	});

	it("lets non-delete commands and non-shell tools through without prompting", async () => {
		const { select, toolCall } = load(auditFile);

		await expect(toolCall("ls -la")).resolves.toBeUndefined();
		await expect(toolCall("rm -rf dist", "read")).resolves.toBeUndefined();
		expect(select).not.toHaveBeenCalled();
	});

	it("allows a delete command once when approved", async () => {
		const { select, toolCall } = load(auditFile);
		select.mockResolvedValue(CHOICES.allowOnce);

		await expect(toolCall("rm -rf dist")).resolves.toBeUndefined();
		// 仅允许一次：再次执行同一命令仍需审批
		await expect(toolCall("rm -rf dist")).resolves.toBeUndefined();

		expect(select).toHaveBeenCalledTimes(2);
		expect(select.mock.calls[0]![0]).toContain("rm -rf dist");
		expect(select.mock.calls[0]![1]).toEqual([CHOICES.allowOnce, CHOICES.allowSession, CHOICES.deny]);
		expect(readAudit().map((e) => e.decision)).toEqual(["allow-once", "allow-once"]);
	});

	it("blocks with a do-not-retry reason when denied or dismissed", async () => {
		const { select, toolCall } = load(auditFile);
		select.mockResolvedValueOnce(CHOICES.deny).mockResolvedValueOnce(undefined);

		const denied = (await toolCall("rm a")) as { block: boolean; reason: string };
		const dismissed = await toolCall("rm a");

		expect(denied.block).toBe(true);
		expect(denied.reason).toMatch(/Do not retry/);
		expect(dismissed).toEqual(denied);
		expect(readAudit()).toMatchObject([
			{ tool: "bash", command: "rm a", trigger: "rm a", cwd: "/repo", decision: "deny" },
			{ decision: "deny" },
		]);
	});

	it("remembers session approvals per exact command until the session changes", async () => {
		const { select, toolCall, startSession } = load(auditFile);
		select.mockResolvedValue(CHOICES.allowSession);

		await toolCall("rm -rf dist");
		await toolCall("rm -rf dist");
		expect(select).toHaveBeenCalledTimes(1);

		// 不同命令不共享会话授权
		await toolCall("rm -rf build");
		expect(select).toHaveBeenCalledTimes(2);

		// 切换会话后授权失效
		startSession();
		await toolCall("rm -rf dist");
		expect(select).toHaveBeenCalledTimes(3);

		expect(readAudit().map((e) => e.decision)).toEqual([
			"allow-session",
			"session-allowed",
			"allow-session",
			"allow-session",
		]);
	});

	it("blocks without prompting when no UI is available", async () => {
		const { ctx, select, toolCall } = load(auditFile);
		(ctx as { hasUI: boolean }).hasUI = false;

		await expect(toolCall("rm a")).resolves.toMatchObject({ block: true, reason: expect.stringMatching(/no UI/) });
		expect(select).not.toHaveBeenCalled();
		expect(readAudit()[0]!.decision).toBe("no-ui");
	});

	it("also guards the powershell tool", async () => {
		const { select, toolCall } = load(auditFile);
		select.mockResolvedValue(CHOICES.deny);

		await expect(toolCall("Remove-Item -Recurse build", "powershell")).resolves.toMatchObject({ block: true });
		expect(readAudit()[0]!.tool).toBe("powershell");
	});
});
