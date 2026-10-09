import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

/**
 * Register `/exit` as a graceful alias for Pi's built-in `/quit` command.
 */
export default function registerPiExit(pi: ExtensionAPI): void {
	pi.registerCommand("exit", {
		description: "Exit Pi cleanly",
		handler: async (_args, ctx) => {
			ctx.shutdown();
		},
	});
}
