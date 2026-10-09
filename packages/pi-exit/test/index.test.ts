import type {
	ExtensionAPI,
	ExtensionCommandContext,
} from "@earendil-works/pi-coding-agent";
import { describe, expect, it, vi } from "vitest";

import registerPiExit from "../index.js";

describe("pi-exit", () => {
	it("registers /exit", () => {
		const registerCommand = vi.fn<ExtensionAPI["registerCommand"]>();

		registerPiExit({ registerCommand } as unknown as ExtensionAPI);

		const [name, options] = registerCommand.mock.calls[0] as Parameters<
			ExtensionAPI["registerCommand"]
		>;

		expect(name).toBe("exit");
		expect(options.description).toBe("Exit Pi cleanly");
	});

	it("requests a graceful shutdown when /exit runs", async () => {
		const registerCommand = vi.fn<ExtensionAPI["registerCommand"]>();
		registerPiExit({ registerCommand } as unknown as ExtensionAPI);

		const [, options] = registerCommand.mock.calls[0] as Parameters<
			ExtensionAPI["registerCommand"]
		>;
		const shutdown = vi.fn();

		await options.handler(
			"",
			{ shutdown } as unknown as ExtensionCommandContext,
		);

		expect(shutdown).toHaveBeenCalledOnce();
	});
});
