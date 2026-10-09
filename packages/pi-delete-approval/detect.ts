/**
 * 删除命令识别：纯函数，不依赖 Pi 运行时，便于单独测试。
 *
 * 设计取向是“宁可多问，不可漏放”：分段时不尊重引号，
 * 因此 `echo "a; rm b"` 这类文本也会触发审批，这是有意接受的误报。
 */

/** 直接删除或清空文件的命令（统一小写比较，兼容 PowerShell 的大小写不敏感）。 */
const DELETE_COMMANDS = new Set([
	"rm",
	"rmdir",
	"unlink",
	"shred",
	"srm",
	// cmd.exe / PowerShell 别名
	"del",
	"erase",
	"rd",
	"remove-item",
	"clear-content",
]);

/** 包装器：真正执行的命令在其参数之后，需要剥掉后继续识别。 */
type Wrapper = {
	/** 需要额外吞掉一个值的选项，如 `sudo -u root` */
	optionsWithValue?: readonly string[];
	/** 选项之后还需跳过的位置参数个数，如 `timeout 10 rm x` 中的 `10` */
	positional?: number;
};

const WRAPPERS: Record<string, Wrapper> = {
	sudo: { optionsWithValue: ["-u", "-g", "-C", "-D", "-h", "-p", "-r", "-t", "-U"] },
	doas: { optionsWithValue: ["-u", "-C"] },
	env: { optionsWithValue: ["-u", "-C", "--unset", "--chdir"] },
	nice: { optionsWithValue: ["-n"] },
	ionice: { optionsWithValue: ["-c", "-n", "-p"] },
	timeout: { optionsWithValue: ["-s", "-k", "--signal", "--kill-after"], positional: 1 },
	xargs: { optionsWithValue: ["-I", "-n", "-P", "-L", "-d", "-s", "-E", "-a"] },
	nohup: {},
	stdbuf: {},
	time: {},
	command: {},
	builtin: {},
	exec: {},
	// shell 控制结构关键字后面紧跟的就是命令
	if: {},
	then: {},
	elif: {},
	else: {},
	do: {},
	while: {},
	until: {},
	"!": {},
};

/** 把参数当作脚本字符串再执行的 shell，需要对其参数递归识别。 */
const SHELL_RUNNERS = new Set(["sh", "bash", "zsh", "dash", "ksh", "fish", "eval", "cmd", "powershell", "pwsh"]);

/**
 * 命令分隔符：`&&`、`||`、`;`、`&`、`|`、换行，以及子 shell / 命令替换 / 代码块边界。
 * `find -exec rm {} \;` 被切开后 find 段仍保留 `-exec rm`，不影响识别。
 */
const SEGMENT_SEPARATOR = /&&|\|\||\$\(|[;&|\n(){}`]/;

const ENV_ASSIGNMENT = /^[A-Za-z_][A-Za-z0-9_]*=/;

/** 命令里出现这些解释器时，才检查内联脚本的删除 API，避免 `grep "fs.rm("` 之类误报。 */
const INLINE_INTERPRETER = /\b(?:python[\d.]*|node|nodejs|bun|deno|ruby|perl|php|tsx|ts-node)\b/;

/** 常见脚本语言的文件删除 API（Python / Node / Deno / Ruby / Perl）。 */
const SCRIPT_DELETE_API =
	/\b(?:os\.(?:remove|removedirs)|shutil\.rmtree|FileUtils\.(?:rm|rm_r|rm_rf|rm_f|remove_dir|remove_entry|remove_entry_secure)|File\.delete|Deno\.remove(?:Sync)?|(?:rm|rmdir|unlink)(?:Sync)?)\s*\(|\b(?:unlink|rmtree|remove_tree)\b/;

/** 单个 token 归一化：去引号、去 `\rm` 的反斜杠、取 `/bin/rm` 的 basename、转小写。 */
function normalizeToken(token: string): string {
	const unquoted = token.replace(/^["']+|["']+$/g, "").replace(/^\\/, "");
	return unquoted.slice(unquoted.lastIndexOf("/") + 1).toLowerCase();
}

/** 跳过包装器自身的选项与位置参数，返回真实命令所在的下标。 */
function skipWrapperArgs(tokens: string[], start: number, wrapper: Wrapper): number {
	let i = start;
	while (i < tokens.length) {
		const token = tokens[i]!;
		if (token === "--") return i + 1;
		if (!token.startsWith("-")) break;
		i += wrapper.optionsWithValue?.includes(token) ? 2 : 1;
	}
	return i + (wrapper.positional ?? 0);
}

/** 去掉开头的环境变量赋值与包装器，返回 [命令名, 剩余参数]；没有命令时返回 undefined。 */
function resolveCommand(tokens: string[]): [string, string[]] | undefined {
	let i = 0;
	while (i < tokens.length) {
		const token = tokens[i]!;
		if (ENV_ASSIGNMENT.test(token)) {
			i += 1;
			continue;
		}
		const name = normalizeToken(token);
		// `command -v rm` / `command -V rm` 只是查询命令位置，不会执行
		if (name === "command" && /^-[vV]$/.test(tokens[i + 1] ?? "")) return undefined;
		const wrapper = WRAPPERS[name];
		if (wrapper) {
			i = skipWrapperArgs(tokens, i + 1, wrapper);
			continue;
		}
		return [name, tokens.slice(i + 1)];
	}
	return undefined;
}

/** `truncate -s 0` / `--size=0` 会清空文件，视同删除。 */
function isTruncateToZero(args: string[]): boolean {
	const joined = ` ${args.join(" ")} `;
	return /\s(?:-s\s*|--size[=\s]+)0\s/.test(joined);
}

/** `find -delete`，或通过 `-exec`/`-execdir`/`-ok`/`-okdir` 调用删除命令。 */
function isFindDelete(args: string[]): boolean {
	return args.some((arg, i) => {
		if (arg === "-delete") return true;
		if (!/^-(?:exec|execdir|ok|okdir)$/.test(arg)) return false;
		const next = args[i + 1];
		return next !== undefined && DELETE_COMMANDS.has(normalizeToken(next));
	});
}

/**
 * 对 `bash -c "..."`、`eval '...'`、`pwsh -Command "..."`、`cmd /c ...` 的脚本参数递归识别：
 * 去掉引号和前导选项后当作一条新命令处理。
 */
function shellRunnerPayload(args: string[]): string {
	const rest = args.join(" ").replace(/["']/g, " ").trim().split(/\s+/);
	let i = 0;
	while (i < rest.length && /^[-/]/.test(rest[i]!)) i += 1;
	return rest.slice(i).join(" ");
}

function detectSegment(segment: string): string | undefined {
	const tokens = segment.trim().split(/\s+/).filter(Boolean);
	const resolved = resolveCommand(tokens);
	if (!resolved) return undefined;
	const [name, args] = resolved;

	if (DELETE_COMMANDS.has(name)) return segment.trim();
	if (name === "truncate" && isTruncateToZero(args)) return segment.trim();
	if (name === "find" && isFindDelete(args)) return segment.trim();
	if (SHELL_RUNNERS.has(name)) {
		const payload = shellRunnerPayload(args);
		return payload ? detectDeleteCommand(payload) : undefined;
	}
	return undefined;
}

/**
 * 识别 shell 命令中的文件删除操作。
 *
 * @returns 命中时返回触发审批的命令片段或脚本 API（用于弹窗提示与审计），未命中返回 undefined。
 */
export function detectDeleteCommand(command: string): string | undefined {
	for (const segment of command.split(SEGMENT_SEPARATOR)) {
		const hit = detectSegment(segment);
		if (hit) return hit;
	}
	if (INLINE_INTERPRETER.test(command)) {
		const match = SCRIPT_DELETE_API.exec(command);
		if (match) return match[0];
	}
	return undefined;
}
