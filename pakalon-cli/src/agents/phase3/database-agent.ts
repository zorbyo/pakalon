/**
 * Phase 3 Sub-Agent: Database Agent
 * Generates database schemas, migrations, and seed data
 * 
 * Supports: PostgreSQL, MySQL, MongoDB, SQLite
 * 
 * Enhanced with phase document context consumption
 */

import { BaseAgent } from '../base-agent.js';
import type { AgentConfig, AgentContext, AgentResult } from '../types.js';
import { generateText } from 'ai';
import { openrouter } from '@openrouter/ai-sdk-provider';
import { getToolsForAI } from '@/tools/registry-new.js';
import * as path from 'path';
import * as fs from 'fs/promises';
import logger from '@/utils/logger.js';

const DATABASE_AGENT_PROMPT_BASE = `You are the Database Schema Agent for Pakalon Phase 3.

Your responsibilities:
1. Analyze requirements to design database schema
2. Generate migration files
3. Create seed data for development
4. Support multiple database types
5. Follow best practices (indexes, constraints, normalization)

You must use natural language. Explain schema decisions clearly.`;

export interface DatabaseAgentOptions {
  dbType: 'postgresql' | 'mysql' | 'mongodb' | 'sqlite';
  outputDir: string;
  phaseContext?: string;     // NEW: Phase document context
  schemaContext?: string;    // NEW: Pre-defined schema from Phase 1
}

export class DatabaseAgent extends BaseAgent {
  private options: DatabaseAgentOptions;
  
  constructor(context: AgentContext, options: DatabaseAgentOptions) {
    // Build enhanced system prompt with phase context
    let systemPrompt = DATABASE_AGENT_PROMPT_BASE;
    
    if (options.schemaContext) {
      systemPrompt += `

=== EXISTING DATABASE SCHEMA FROM PHASE 1 ===
${options.schemaContext.substring(0, 3000)}
`;
    }
    
    if (options.phaseContext) {
      systemPrompt += `

=== PHASE CONTEXT ===
${options.phaseContext.substring(0, 2000)}
`;
    }
    
    const config: AgentConfig = {
      name: 'database-agent',
      model: context.apiKey ? 'anthropic/claude-3-5-sonnet' : 'anthropic/claude-3-5-haiku',
      systemPrompt,
      tools: getToolsForAI(),
      maxTokens: 8192,
      temperature: 0.3, // Lower temperature for structured output
    };
    
    super(config, context);
    this.options = options;
    
    logger.info(`[DatabaseAgent] Initialized for ${options.dbType}`);
    if (options.schemaContext) {
      logger.info('[DatabaseAgent] Schema context loaded from Phase 1');
    }
  }
  
  public async execute(): Promise<AgentResult> {
    const startTime = Date.now();
    
    try {
      logger.info('[DatabaseAgent] ========================================');
      logger.info(`[DatabaseAgent] Generating ${this.options.dbType} schema`);
      logger.info('[DatabaseAgent] ========================================');
      
      await fs.mkdir(this.options.outputDir, { recursive: true });
      
      // Step 1: Analyze requirements and design schema
      logger.info('[DatabaseAgent] Step 1/4: Schema Design');
      const schema = await this.designSchema();
      
      // Step 2: Generate migration files
      logger.info('[DatabaseAgent] Step 2/4: Migrations');
      const migrations = await this.generateMigrations(schema);
      
      // Step 3: Generate seed data
      logger.info('[DatabaseAgent] Step 3/4: Seed Data');
      const seedData = await this.generateSeedData(schema);
      
      // Step 4: Generate ORM models
      logger.info('[DatabaseAgent] Step 4/4: ORM Models');
      const models = await this.generateModels(schema);
      
      const duration = Date.now() - startTime;
      
      logger.info('[DatabaseAgent] ========================================');
      logger.info(`[DatabaseAgent] Complete in ${(duration / 1000).toFixed(1)}s`);
      logger.info('[DatabaseAgent] ========================================');
      
      return {
        success: true,
        message: `Database schema generated for ${this.options.dbType}`,
        filesCreated: [...migrations, ...seedData, ...models],
        duration,
      };
      
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      logger.error(`[DatabaseAgent] Failed: ${message}`);
      
      return {
        success: false,
        message: `Database agent failed: ${message}`,
        duration: Date.now() - startTime,
      };
    }
  }
  
  private async designSchema(): Promise<any> {
    logger.info('[DatabaseAgent] Analyzing requirements for schema design...');
    
    // Read Phase 1 database schema if exists
    const phase1Dir = path.join(this.context.projectDir, '.pakalon-agents', 'phase-1');
    let phase1Schema = '';
    
    try {
      phase1Schema = await fs.readFile(path.join(phase1Dir, 'Database_schema.md'), 'utf-8');
    } catch (error) {
      logger.warn('[DatabaseAgent] No Phase 1 schema found, will generate from scratch');
    }
    
    const prompt = `Design a ${this.options.dbType} database schema for: "${this.context.userPrompt}"

${phase1Schema ? `Use this schema specification:\n${phase1Schema}` : ''}

Generate a comprehensive schema with:
1. All tables/collections with proper naming
2. Columns/fields with appropriate data types
3. Primary keys and foreign keys
4. Indexes for performance
5. Constraints (unique, not null, check)

Return as JSON with this structure:
{
  "tables": [
    {
      "name": "users",
      "columns": [
        { "name": "id", "type": "uuid", "primaryKey": true },
        { "name": "email", "type": "varchar(255)", "unique": true, "notNull": true }
      ],
      "indexes": [
        { "name": "idx_users_email", "columns": ["email"] }
      ]
    }
  ]
}`;
    
    const result = await generateText({
      model: openrouter(this.config.model),
      prompt,
      maxTokens: 4096,
    });
    
    // Parse JSON from response
    const jsonMatch = result.text.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      const schema = JSON.parse(jsonMatch[0]);
      logger.info(`[DatabaseAgent] [OK] Designed schema with ${schema.tables?.length || 0} tables`);
      return schema;
    }
    
    // Fallback: basic schema
    return {
      tables: [
        {
          name: 'users',
          columns: [
            { name: 'id', type: 'uuid', primaryKey: true },
            { name: 'email', type: 'varchar(255)', unique: true, notNull: true },
            { name: 'created_at', type: 'timestamp', notNull: true },
          ],
        },
      ],
    };
  }
  
  private async generateMigrations(schema: any): Promise<string[]> {
    logger.info('[DatabaseAgent] Generating migration files...');
    
    const migrations: string[] = [];
    const timestamp = new Date().toISOString().replace(/[-:T.]/g, '').slice(0, 14);
    
    for (const table of schema.tables || []) {
      const migrationFile = path.join(
        this.options.outputDir,
        `${timestamp}_create_${table.name}.sql`
      );
      
      let sql = '';
      
      if (this.options.dbType === 'postgresql' || this.options.dbType === 'mysql') {
        sql = this.generateSQLMigration(table);
      } else if (this.options.dbType === 'mongodb') {
        sql = this.generateMongoMigration(table);
      } else if (this.options.dbType === 'sqlite') {
        sql = this.generateSQLiteMigration(table);
      }
      
      await fs.writeFile(migrationFile, sql, 'utf-8');
      migrations.push(migrationFile);
      
      logger.info(`[DatabaseAgent] [OK] Generated migration: ${path.basename(migrationFile)}`);
    }
    
    return migrations;
  }
  
  private generateSQLMigration(table: any): string {
    const columns = table.columns.map((col: any) => {
      let def = `  ${col.name} ${col.type}`;
      if (col.primaryKey) def += ' PRIMARY KEY';
      if (col.unique) def += ' UNIQUE';
      if (col.notNull) def += ' NOT NULL';
      if (col.default) def += ` DEFAULT ${col.default}`;
      return def;
    });
    
    let sql = `-- Migration: Create ${table.name} table\n\n`;
    sql += `CREATE TABLE ${table.name} (\n`;
    sql += columns.join(',\n');
    sql += `\n);\n\n`;
    
    // Add indexes
    if (table.indexes) {
      for (const idx of table.indexes) {
        sql += `CREATE INDEX ${idx.name} ON ${table.name} (${idx.columns.join(', ')});\n`;
      }
    }
    
    return sql;
  }
  
  private generateMongoMigration(table: any): string {
    // MongoDB uses JSON schema validation
    const schema = {
      bsonType: 'object',
      required: table.columns.filter((c: any) => c.notNull).map((c: any) => c.name),
      properties: table.columns.reduce((acc: any, col: any) => {
        acc[col.name] = { bsonType: this.mapToMongoType(col.type) };
        return acc;
      }, {}),
    };
    
    return `// Migration: Create ${table.name} collection

db.createCollection("${table.name}", {
  validator: {
    $jsonSchema: ${JSON.stringify(schema, null, 2)}
  }
});

// Create indexes
${table.indexes?.map((idx: any) => 
  `db.${table.name}.createIndex({ ${idx.columns.map((c: string) => `${c}: 1`).join(', ')} });`
).join('\n') || ''}`;
  }
  
  private generateSQLiteMigration(table: any): string {
    return this.generateSQLMigration(table); // SQLite uses similar syntax
  }
  
  private mapToMongoType(sqlType: string): string {
    if (sqlType.includes('uuid')) return 'string';
    if (sqlType.includes('varchar')) return 'string';
    if (sqlType.includes('text')) return 'string';
    if (sqlType.includes('int')) return 'number';
    if (sqlType.includes('timestamp')) return 'date';
    if (sqlType.includes('boolean')) return 'bool';
    return 'string';
  }
  
  private async generateSeedData(schema: any): Promise<string[]> {
    logger.info('[DatabaseAgent] Generating seed data...');
    
    const seedFiles: string[] = [];
    
    for (const table of schema.tables || []) {
      const seedFile = path.join(this.options.outputDir, `seed_${table.name}.sql`);
      
      // Generate sample data
      const samples = this.generateSampleData(table);
      
      await fs.writeFile(seedFile, samples, 'utf-8');
      seedFiles.push(seedFile);
      
      logger.info(`[DatabaseAgent] [OK] Generated seed: ${path.basename(seedFile)}`);
    }
    
    return seedFiles;
  }
  
  private generateSampleData(table: any): string {
    // Generate 3-5 sample rows
    const rows = [];
    
    for (let i = 1; i <= 3; i++) {
      const values = table.columns.map((col: any) => {
        if (col.name === 'id') return `'${crypto.randomUUID()}'`;
        if (col.name === 'email') return `'user${i}@example.com'`;
        if (col.name === 'created_at') return 'NOW()';
        if (col.type.includes('varchar')) return `'Sample ${i}'`;
        if (col.type.includes('int')) return i;
        if (col.type.includes('boolean')) return i % 2 === 0;
        return 'NULL';
      });
      
      rows.push(`(${values.join(', ')})`);
    }
    
    const columns = table.columns.map((c: any) => c.name).join(', ');
    
    return `-- Seed data for ${table.name}\n\nINSERT INTO ${table.name} (${columns})\nVALUES\n${rows.join(',\n')};\n`;
  }
  
  private async generateModels(schema: any): Promise<string[]> {
    logger.info('[DatabaseAgent] Generating ORM models...');
    
    const modelFiles: string[] = [];
    
    for (const table of schema.tables || []) {
      const modelFile = path.join(this.options.outputDir, `${table.name}.model.ts`);
      
      const model = this.generateTypeScriptModel(table);
      
      await fs.writeFile(modelFile, model, 'utf-8');
      modelFiles.push(modelFile);
      
      logger.info(`[DatabaseAgent] [OK] Generated model: ${path.basename(modelFile)}`);
    }
    
    return modelFiles;
  }
  
  private generateTypeScriptModel(table: any): string {
    const className = this.toPascalCase(table.name);
    
    const fields = table.columns.map((col: any) => {
      const tsType = this.mapToTypeScriptType(col.type);
      const optional = !col.notNull ? '?' : '';
      return `  ${col.name}${optional}: ${tsType};`;
    });
    
    return `/**
 * ${className} Model
 * Generated by Pakalon Database Agent
 * 
 * NOTE: This is a template repository. Connect to your database 
 * adapter in db/ to enable full CRUD operations.
 */

export interface ${className} {
${fields.join('\n')}
}

/**
 * Database repository for ${className}
 * Provides type-safe CRUD operations against the database
 */
export class ${className}Repository {
  /**
   * Find all ${className} records
   */
  async findAll(): Promise<${className}[]> {
    // TODO: Connect to database adapter (e.g., db.${this.toCamelCase(className)}.findMany())
    return [];
  }
  
  /**
   * Find a single ${className} by ID
   */
  async findById(id: string): Promise<${className} | null> {
    // TODO: Connect to database adapter (e.g., db.${this.toCamelCase(className)}.findUnique({ where: { id } }))
    return null;
  }
  
  /**
   * Create a new ${className} record
   */
  async create(data: Omit<${className}, 'id' | 'created_at' | 'updated_at'>): Promise<${className}> {
    // TODO: Connect to database adapter (e.g., db.${this.toCamelCase(className)}.create({ data }))
    return data as ${className};
  }
  
  /**
   * Update an existing ${className} record
   */
  async update(id: string, data: Partial<${className}>): Promise<${className}> {
    // TODO: Connect to database adapter (e.g., db.${this.toCamelCase(className)}.update({ where: { id }, data }))
    return data as ${className};
  }
  
  /**
   * Delete a ${className} record by ID
   */
  async delete(id: string): Promise<void> {
    // TODO: Connect to database adapter (e.g., db.${this.toCamelCase(className)}.delete({ where: { id } }))
  }
}
`;
  }
  
  private mapToTypeScriptType(sqlType: string): string {
    if (sqlType.includes('uuid')) return 'string';
    if (sqlType.includes('varchar')) return 'string';
    if (sqlType.includes('text')) return 'string';
    if (sqlType.includes('int')) return 'number';
    if (sqlType.includes('timestamp')) return 'Date';
    if (sqlType.includes('boolean')) return 'boolean';
    return 'any';
  }
  
  private toPascalCase(str: string): string {
    return str.split('_').map(word => 
      word.charAt(0).toUpperCase() + word.slice(1)
    ).join('');
  }
}
