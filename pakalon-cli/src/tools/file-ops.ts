/**
 * File Operations Tools - Copilot CLI Compatible
 * Implements create, edit, read, delete file operations with natural language output
 */
import * as fs from 'fs/promises';
import * as path from 'path';
import { z } from 'zod';

// ---------------------------------------------------------------------------
// CREATE FILE TOOL
// ---------------------------------------------------------------------------

export const createFileToolSchema = z.object({
  path: z.string().describe('Absolute path to the file to create'),
  content: z.string().describe('Content to write to the file'),
});

export const createFileTool = {
  name: 'create_file',
  description: 'Create a new file with specified content',
  parameters: createFileToolSchema,
  
  async execute({ path: filePath, content }: z.infer<typeof createFileToolSchema>) {
    try {
      // Validate path is absolute
      if (!path.isAbsolute(filePath)) {
        throw new Error(`Path must be absolute, got: ${filePath}`);
      }
      
      // Check if file already exists
      try {
        await fs.access(filePath);
        throw new Error(`File already exists: ${filePath}`);
      } catch (err: any) {
        if (err.code !== 'ENOENT') throw err;
      }
      
      // Create parent directories if needed
      const dirPath = path.dirname(filePath);
      await fs.mkdir(dirPath, { recursive: true });
      
      // Write file
      await fs.writeFile(filePath, content, 'utf-8');
      
      const lines = content.split('\n').length;
      const size = Buffer.byteLength(content, 'utf-8');
      
      return {
        success: true,
        path: filePath,
        size,
        lines,
        message: `Created file ${path.basename(filePath)} (${lines} line${lines === 1 ? '' : 's'}, ${size} bytes)`
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      throw new Error(`Failed to create file: ${message}`);
    }
  }
};

// ---------------------------------------------------------------------------
// EDIT FILE TOOL (Search & Replace)
// ---------------------------------------------------------------------------

export const editFileToolSchema = z.object({
  path: z.string().describe('Absolute path to file'),
  oldText: z.string().describe('Exact text to find and replace'),
  newText: z.string().describe('Text to replace with'),
});

export const editFileTool = {
  name: 'edit_file',
  description: 'Edit a file by replacing exact text match (search & replace)',
  parameters: editFileToolSchema,
  
  async execute({ path: filePath, oldText, newText }: z.infer<typeof editFileToolSchema>) {
    try {
      // Validate path is absolute
      if (!path.isAbsolute(filePath)) {
        throw new Error(`Path must be absolute, got: ${filePath}`);
      }
      
      // Read file
      const content = await fs.readFile(filePath, 'utf-8');
      
      // Check if old text exists
      if (!content.includes(oldText)) {
        throw new Error(`Text not found in file. Looking for: "${oldText.substring(0, 100)}${oldText.length > 100 ? '...' : ''}"`);
      }
      
      // Count occurrences
      const occurrences = (content.match(new RegExp(oldText.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g')) || []).length;
      
      // Replace (only first occurrence for safety)
      const updated = content.replace(oldText, newText);
      
      // Write back
      await fs.writeFile(filePath, updated, 'utf-8');
      
      const sizeDiff = Buffer.byteLength(newText, 'utf-8') - Buffer.byteLength(oldText, 'utf-8');
      
      return {
        success: true,
        path: filePath,
        oldLength: oldText.length,
        newLength: newText.length,
        sizeDiff,
        occurrences,
        message: `Edited file ${path.basename(filePath)} (replaced ${occurrences} occurrence${occurrences === 1 ? '' : 's'})`
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      throw new Error(`Failed to edit file: ${message}`);
    }
  }
};

// ---------------------------------------------------------------------------
// READ FILE TOOL
// ---------------------------------------------------------------------------

export const readFileToolSchema = z.object({
  path: z.string().describe('Absolute path to file'),
  maxBytes: z.number().optional().describe('Maximum bytes to read (default: 1MB)'),
});

export const readFileTool = {
  name: 'read_file',
  description: 'Read file contents',
  parameters: readFileToolSchema,
  
  async execute({ path: filePath, maxBytes = 1024 * 1024 }: z.infer<typeof readFileToolSchema>) {
    try {
      // Validate path is absolute
      if (!path.isAbsolute(filePath)) {
        throw new Error(`Path must be absolute, got: ${filePath}`);
      }
      
      const content = await fs.readFile(filePath, 'utf-8');
      const totalSize = Buffer.byteLength(content, 'utf-8');
      const lines = content.split('\n').length;
      
      if (totalSize > maxBytes) {
        const truncated = content.substring(0, maxBytes);
        return {
          content: truncated,
          truncated: true,
          totalSize,
          lines,
          message: `Read ${path.basename(filePath)} (${lines} lines, showing first ${maxBytes} bytes of ${totalSize})`
        };
      }
      
      return {
        content,
        truncated: false,
        totalSize,
        lines,
        message: `Read ${path.basename(filePath)} (${lines} lines, ${totalSize} bytes)`
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      throw new Error(`Failed to read file: ${message}`);
    }
  }
};

// ---------------------------------------------------------------------------
// DELETE FILE TOOL
// ---------------------------------------------------------------------------

export const deleteFileToolSchema = z.object({
  path: z.string().describe('Absolute path to file to delete'),
});

export const deleteFileTool = {
  name: 'delete_file',
  description: 'Delete a file',
  parameters: deleteFileToolSchema,
  
  async execute({ path: filePath }: z.infer<typeof deleteFileToolSchema>) {
    try {
      // Validate path is absolute
      if (!path.isAbsolute(filePath)) {
        throw new Error(`Path must be absolute, got: ${filePath}`);
      }
      
      // Get file stats before deleting
      const stats = await fs.stat(filePath);
      const size = stats.size;
      
      // Delete file
      await fs.unlink(filePath);
      
      return {
        success: true,
        path: filePath,
        size,
        message: `Deleted file ${path.basename(filePath)} (${size} bytes)`
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      throw new Error(`Failed to delete file: ${message}`);
    }
  }
};

// ---------------------------------------------------------------------------
// CREATE DIRECTORY TOOL
// ---------------------------------------------------------------------------

export const createDirectoryToolSchema = z.object({
  path: z.string().describe('Absolute path to directory'),
});

export const createDirectoryTool = {
  name: 'create_directory',
  description: 'Create a directory (including parent directories)',
  parameters: createDirectoryToolSchema,
  
  async execute({ path: dirPath }: z.infer<typeof createDirectoryToolSchema>) {
    try {
      // Validate path is absolute
      if (!path.isAbsolute(dirPath)) {
        throw new Error(`Path must be absolute, got: ${dirPath}`);
      }
      
      // Create directory with recursive option
      await fs.mkdir(dirPath, { recursive: true });
      
      return {
        success: true,
        path: dirPath,
        message: `Created directory ${path.basename(dirPath)}`
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      throw new Error(`Failed to create directory: ${message}`);
    }
  }
};

// ---------------------------------------------------------------------------
// LIST DIRECTORY TOOL
// ---------------------------------------------------------------------------

export const listDirectoryToolSchema = z.object({
  path: z.string().describe('Absolute path to directory'),
  recursive: z.boolean().optional().describe('List recursively (default: false)'),
});

export const listDirectoryTool = {
  name: 'list_directory',
  description: 'List contents of a directory',
  parameters: listDirectoryToolSchema,
  
  async execute({ path: dirPath, recursive = false }: z.infer<typeof listDirectoryToolSchema>) {
    try {
      // Validate path is absolute
      if (!path.isAbsolute(dirPath)) {
        throw new Error(`Path must be absolute, got: ${dirPath}`);
      }
      
      const entries = await fs.readdir(dirPath, { withFileTypes: true });
      
      const results = await Promise.all(
        entries.map(async (entry) => {
          const entryPath = path.join(dirPath, entry.name);
          const stats = await fs.stat(entryPath);
          
          return {
            name: entry.name,
            type: entry.isDirectory() ? 'directory' : 'file',
            path: entryPath,
            size: stats.size,
          };
        })
      );
      
      const fileCount = results.filter(r => r.type === 'file').length;
      const dirCount = results.filter(r => r.type === 'directory').length;
      
      return {
        path: dirPath,
        entries: results,
        count: results.length,
        fileCount,
        dirCount,
        message: `Listed directory ${path.basename(dirPath)} (${fileCount} file${fileCount === 1 ? '' : 's'}, ${dirCount} director${dirCount === 1 ? 'y' : 'ies'})`
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      throw new Error(`Failed to list directory: ${message}`);
    }
  }
};

// ---------------------------------------------------------------------------
// Export all tools
// ---------------------------------------------------------------------------

export const fileOpsTools = {
  create_file: createFileTool,
  edit_file: editFileTool,
  read_file: readFileTool,
  delete_file: deleteFileTool,
  create_directory: createDirectoryTool,
  list_directory: listDirectoryTool,
};
