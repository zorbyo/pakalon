import { tool } from "ai";
import { z } from "zod";
import { getLSPServerManager } from "./LSPServerManager.js";

const operationSchema = z.enum([
  "gotoDefinition",
  "findReferences",
  "hover",
  "documentSymbol",
  "workspaceSymbol",
  "workspaceDiagnostics",
  "codeAction",
  "semanticTokens",
  "goToImplementation",
  "prepareCallHierarchy",
  "incomingCalls",
  "outgoingCalls",
  "formatDocument",
  "typeHierarchy",
  "inlayHint",
  "signatureHelp",
]);

export const lspTool = tool({
  description: "IDE-like LSP tool for navigation, symbols, hover, and call hierarchy.",
  inputSchema: z.object({
    operation: operationSchema,
    filePath: z.string().optional(),
    line: z.number().int().nonnegative().optional(),
    character: z.number().int().nonnegative().optional(),
    query: z.string().optional(),
    workspaceDir: z.string().optional(),
    endLine: z.number().int().nonnegative().optional(),
    endCharacter: z.number().int().nonnegative().optional(),
    only: z.array(z.string()).optional(),
    maxFiles: z.number().int().positive().max(500).optional(),
  }),
  execute: async ({ operation, filePath, line = 0, character = 0, query = "", workspaceDir, endLine, endCharacter, only, maxFiles }) => {
    const manager = getLSPServerManager(workspaceDir);

    try {
      switch (operation) {
        case "gotoDefinition":
          return { success: true, result: filePath ? await manager.gotoDefinition(filePath, line, character) : null };
        case "findReferences":
          return { success: true, result: filePath ? await manager.findReferences(filePath, line, character) : [] };
        case "hover":
          return { success: true, result: filePath ? await manager.hover(filePath, line, character) : null };
        case "documentSymbol":
          return { success: true, result: filePath ? await manager.documentSymbol(filePath) : [] };
        case "workspaceSymbol":
          return { success: true, result: await manager.workspaceSymbol(query) };
        case "workspaceDiagnostics":
          return { success: true, result: await manager.workspaceDiagnostics(maxFiles) };
        case "codeAction":
          return {
            success: true,
            result: filePath
              ? await manager.codeActions(
                filePath,
                {
                  start: { line, character },
                  end: { line: endLine ?? line, character: endCharacter ?? character },
                },
                only,
              )
              : [],
          };
        case "semanticTokens":
          return { success: true, result: filePath ? await manager.semanticTokens(filePath) : null };
        case "goToImplementation":
          return { success: true, result: filePath ? await manager.goToImplementation(filePath, line, character) : null };
        case "prepareCallHierarchy":
          return { success: true, result: filePath ? await manager.prepareCallHierarchy(filePath, line, character) : null };
        case "incomingCalls":
          return { success: true, result: filePath ? await manager.incomingCalls(filePath, line, character) : [] };
        case "outgoingCalls":
          return { success: true, result: filePath ? await manager.outgoingCalls(filePath, line, character) : [] };
        case "formatDocument":
          return { success: true, result: filePath ? await manager.formatDocument(filePath) : null };
        case "typeHierarchy":
          return { success: true, result: filePath ? await manager.typeHierarchy(filePath, line, character) : null };
        case "inlayHint":
          return { success: true, result: filePath ? await manager.inlayHint(filePath, line, character) : null };
        case "signatureHelp":
          return { success: true, result: filePath ? await manager.signatureHelp(filePath, line, character) : null };
      }
    } catch (error) {
      return { success: false, error: String(error) };
    }
  },
});

export default { lspTool };
