import { describe, expect, it } from "vitest";

import { detectDeleteCommand } from "../detect.ts";

describe("detectDeleteCommand", () => {
	// 应触发审批的删除命令，覆盖直接调用、包装器、复合命令、shell 嵌套和内联脚本
	it.each([
		"rm file.txt",
		"rm -rf dist",
		"/bin/rm -f a",
		"\\rm a",
		"rmdir empty",
		"unlink a.lock",
		"shred -u secret.txt",
		"truncate -s 0 app.log",
		"truncate --size=0 app.log",
		"find . -name '*.tmp' -delete",
		"find . -type f -exec rm {} \\;",
		"find . | xargs rm -f",
		"find . -print0 | xargs -0 -I {} rm {}",
		"sudo rm -rf /var/cache/app",
		"sudo -u root rm a",
		"FOO=1 rm a",
		"env -i rm a",
		"timeout 10 rm a",
		"cd build && rm -rf out",
		"pnpm build; rm -rf .cache",
		"false || rm a",
		"echo $(rm a)",
		"if [ -f a ]; then rm a; fi",
		"for f in *.log; do rm \"$f\"; done",
		"bash -c 'rm -rf tmp'",
		"sh -lc \"cd /tmp && rm x\"",
		"eval \"rm a\"",
		"Remove-Item -Recurse -Force build",
		"pwsh -NoProfile -Command \"Remove-Item a\"",
		"cmd /c del a.txt",
		"Clear-Content log.txt",
		"python -c \"import shutil; shutil.rmtree('build')\"",
		"python3 -c 'import os; os.remove(\"a\")'",
		"python3 - <<'EOF'\nfrom pathlib import Path\nPath('a').unlink()\nEOF",
		"node -e \"require('fs').rmSync('dist', { recursive: true })\"",
		"node -e \"fs.unlinkSync('a')\"",
		"perl -e 'unlink \"a\"'",
		"ruby -e 'FileUtils.rm_rf(\"tmp\")'",
	])("flags %j", (command) => {
		expect(detectDeleteCommand(command)).toBeDefined();
	});

	// 不应触发审批的常见命令，防止误报打扰正常工作流
	it.each([
		"ls -la",
		"git rm --cached a",
		"git status",
		"pnpm rm lodash",
		"docker rm abc",
		"grep -rn 'fs.rm(' src",
		"grep -rn unlink src",
		"command -v rm",
		"truncate -s 10M disk.img",
		"find . -name '*.ts'",
		"bash ./scripts/build.sh",
		"python -m pytest -k test_unlink",
		"node scripts/build.js",
		"cat README.md",
		"echo remove",
	])("ignores %j", (command) => {
		expect(detectDeleteCommand(command)).toBeUndefined();
	});

	it("returns the matched segment instead of the whole command", () => {
		expect(detectDeleteCommand("pnpm build && rm -rf dist")).toBe("rm -rf dist");
		expect(detectDeleteCommand("python -c \"import shutil; shutil.rmtree('x')\"")).toBe("shutil.rmtree(");
	});
});
