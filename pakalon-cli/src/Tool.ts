/**
 * Re-export Tool types from the canonical location.
 * This file bridges imports from `../../Tool.js` used by lspTools and others
 * to the actual definitions in tools/tool-types.ts.
 */
export { buildTool } from "@/tools/tool-types.js";
export type { ToolDef, ToolResult, InputSchema, OutputSchema, ToolMetadata, PermissionResult } from "@/tools/tool-types.js";
