/**
 * SQLite Reader
 * 
 * Reads and queries SQLite databases.
 * Based on OMP's sqlite-reader tool.
 */

import { z } from 'zod';
import { buildTool, type ToolUseContext, type ToolResult } from '@/tools/tool-types.js';
import { exec } from 'child_process';
import { promisify } from 'util';
import logger from '@/utils/logger.js';

const execAsync = promisify(exec);

// ============================================================================
// Types
// ============================================================================

interface SqliteSchema {
  tables: Array<{
    name: string;
    sql: string;
  }>;
}

interface SqliteQueryResult {
  columns: string[];
  rows: unknown[][];
  rowCount: number;
}

// ============================================================================
// SQLite Reader
// ============================================================================

class SqliteReader {
  /**
   * Get database schema
   */
  async getSchema(dbPath: string): Promise<SqliteSchema> {
    try {
      const { stdout } = await execAsync(
        `sqlite3 "${dbPath}" ".schema"`,
        { timeout: 10000 }
      );

      const tables: Array<{ name: string; sql: string }> = [];
      const tableMatches = stdout.matchAll(/CREATE TABLE\s+(\w+)\s*\(([\s\S]*?)\)/gi);
      
      for (const match of tableMatches) {
        tables.push({
          name: match[1],
          sql: match[0],
        });
      }

      return { tables };
    } catch (error) {
      logger.error('[sqlite-reader] Failed to get schema', { error: String(error) });
      return { tables: [] };
    }
  }

  /**
   * List tables
   */
  async listTables(dbPath: string): Promise<string[]> {
    try {
      const { stdout } = await execAsync(
        `sqlite3 "${dbPath}" ".tables"`,
        { timeout: 10000 }
      );

      return stdout.trim().split(/\s+/).filter(t => t.length > 0);
    } catch (error) {
      logger.error('[sqlite-reader] Failed to list tables', { error: String(error) });
      return [];
    }
  }

  /**
   * Query the database
   */
  async query(
    dbPath: string,
    sql: string,
    limit: number = 100
  ): Promise<SqliteQueryResult> {
    try {
      // Add LIMIT if not present
      let querySql = sql;
      if (!querySql.toLowerCase().includes('limit')) {
        querySql += ` LIMIT ${limit}`;
      }

      const { stdout } = await execAsync(
        `sqlite3 -header -csv "${dbPath}" "${querySql.replace(/"/g, '\\"')}"`,
        { timeout: 30000 }
      );

      const lines = stdout.trim().split('\n');
      if (lines.length === 0) {
        return { columns: [], rows: [], rowCount: 0 };
      }

      const columns = this.parseCSVLine(lines[0]);
      const rows = lines.slice(1).map(line => this.parseCSVLine(line));

      return { columns, rows, rowCount: rows.length };
    } catch (error) {
      logger.error('[sqlite-reader] Query failed', { error: String(error) });
      throw error;
    }
  }

  /**
   * Get table info
   */
  async getTableInfo(
    dbPath: string,
    tableName: string
  ): Promise<Array<{
    cid: number;
    name: string;
    type: string;
    notnull: number;
    dflt_value: unknown;
    pk: number;
  }>> {
    try {
      const { stdout } = await execAsync(
        `sqlite3 "${dbPath}" "PRAGMA table_info(${tableName})"`,
        { timeout: 10000 }
      );

      const rows = stdout.trim().split('\n').map(line => {
        const parts = line.split('|');
        return {
          cid: parseInt(parts[0], 10),
          name: parts[1],
          type: parts[2],
          notnull: parseInt(parts[3], 10),
          dflt_value: parts[4] === 'NULL' ? null : parts[4],
          pk: parseInt(parts[5], 10),
        };
      });

      return rows;
    } catch (error) {
      logger.error('[sqlite-reader] Failed to get table info', { error: String(error) });
      return [];
    }
  }

  /**
   * Get row count
   */
  async getRowCount(dbPath: string, tableName: string): Promise<number> {
    try {
      const { stdout } = await execAsync(
        `sqlite3 "${dbPath}" "SELECT COUNT(*) FROM ${tableName}"`,
        { timeout: 10000 }
      );

      return parseInt(stdout.trim(), 10) || 0;
    } catch (error) {
      logger.error('[sqlite-reader] Failed to get row count', { error: String(error) });
      return 0;
    }
  }

  /**
   * Parse CSV line
   */
  private parseCSVLine(line: string): string[] {
    const result: string[] = [];
    let current = '';
    let inQuotes = false;

    for (let i = 0; i < line.length; i++) {
      const char = line[i];
      
      if (char === '"') {
        inQuotes = !inQuotes;
      } else if (char === ',' && !inQuotes) {
        result.push(current.trim());
        current = '';
      } else {
        current += char;
      }
    }
    
    result.push(current.trim());
    return result;
  }
}

// ============================================================================
// Singleton
// ============================================================================

let readerInstance: SqliteReader | null = null;

function getSqliteReader(): SqliteReader {
  if (!readerInstance) {
    readerInstance = new SqliteReader();
  }
  return readerInstance;
}

// ============================================================================
// SQLite Reader Tool
// ============================================================================

const sqliteReaderInputSchema = z.object({
  action: z.enum(['schema', 'tables', 'query', 'table-info', 'row-count']).describe('SQLite action'),
  db_path: z.string().describe('Path to SQLite database'),
  table: z.string().optional().describe('Table name'),
  sql: z.string().optional().describe('SQL query'),
  limit: z.number().optional().default(100).describe('Query row limit'),
});

export const sqliteReaderTool = buildTool({
  name: 'sqlite_reader',
  description: 'Read and query SQLite databases.',
  inputSchema: sqliteReaderInputSchema,
  isReadOnly: true,
  isConcurrencySafe: true,
  
  async call(args, ctx): Promise<ToolResult<string>> {
    const { action, db_path, table, sql, limit } = args;
    
    try {
      const reader = getSqliteReader();
      
      switch (action) {
        case 'schema': {
          const schema = await reader.getSchema(db_path);
          if (schema.tables.length === 0) {
            return { data: 'No tables found in database' };
          }
          const tables = schema.tables.map(t => `${t.name}:\n${t.sql}`).join('\n\n');
          return { data: `Database schema:\n${tables}` };
        }
        
        case 'tables': {
          const tables = await reader.listTables(db_path);
          if (tables.length === 0) {
            return { data: 'No tables found in database' };
          }
          return { data: `Tables:\n${tables.join('\n')}` };
        }
        
        case 'query': {
          if (!sql) {
            return { data: 'sql is required for query action' };
          }
          const result = await reader.query(db_path, sql, limit);
          if (result.rowCount === 0) {
            return { data: 'No rows returned' };
          }
          const header = result.columns.join(' | ');
          const rows = result.rows.map(r => r.join(' | ')).join('\n');
          return { data: `${header}\n${'-'.repeat(header.length)}\n${rows}\n\n(${result.rowCount} rows)` };
        }
        
        case 'table-info': {
          if (!table) {
            return { data: 'table is required for table-info action' };
          }
          const info = await reader.getTableInfo(db_path, table);
          if (info.length === 0) {
            return { data: `Table ${table} not found` };
          }
          const columns = info.map(c => `${c.name} (${c.type})${c.pk ? ' [PK]' : ''}`).join('\n');
          return { data: `Table ${table} columns:\n${columns}` };
        }
        
        case 'row-count': {
          if (!table) {
            return { data: 'table is required for row-count action' };
          }
          const count = await reader.getRowCount(db_path, table);
          return { data: `Table ${table} has ${count} rows` };
        }
        
        default:
          return { data: `Unknown action: ${action}` };
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      logger.error('[sqlite-reader] Tool failed', { error: message });
      return { data: `SQLite reader failed: ${message}` };
    }
  },
  
  userFacingName: () => 'SQLite Reader',
  
  renderToolUseMessage: (input) => {
    const action = typeof input.action === 'string' ? input.action : 'unknown';
    const dbPath = typeof input.db_path === 'string' ? input.db_path : '';
    return `SQLite ${action}: ${dbPath}`;
  },
  
  renderToolResultMessage: (result) => {
    return typeof result === 'string' ? result : JSON.stringify(result);
  },
});
