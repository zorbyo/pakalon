import type { ModelMessage } from "ai";

declare module "ai" {
	export type CoreMessage = ModelMessage;
}
