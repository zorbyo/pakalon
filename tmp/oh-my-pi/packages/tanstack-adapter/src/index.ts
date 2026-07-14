/**
 * @pakalon/tanstack-adapter
 *
 * Public surface — re-exports the chat client and model utilities.
 */
export { createPakalonChatClient, type PakalonChatClientOptions } from "./chat";
export {
	listPakalonModels,
	type PakalonModelSummary,
	type PakalonTier,
	resolveAutoModel,
} from "./models";
