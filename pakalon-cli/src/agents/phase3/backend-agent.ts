/**
 * Phase 3 Sub-Agent: Backend Agent
 * Generates Node.js/Express/Fastify server code
 * 
 * Creates: Controllers, Services, Middleware, Routes
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

const BACKEND_AGENT_PROMPT_BASE = `You are the Backend Development Agent for Pakalon Phase 3.

Your responsibilities:
1. Generate Express/Fastify server code
2. Create controllers with business logic
3. Create services for data access
4. Generate middleware (auth, validation, error handling)
5. Follow MVC/layered architecture patterns

You must use natural language. Explain architectural decisions clearly.`;

export interface BackendAgentOptions {
  framework: 'express' | 'fastify';
  outputDir: string;
  useTypeScript: boolean;
  phaseContext?: string;    // NEW: Phase document context
  tasksContext?: string;  // NEW: Tasks from Phase 1
}

export class BackendAgent extends BaseAgent {
  private options: BackendAgentOptions;
  
  constructor(context: AgentContext, options: BackendAgentOptions) {
    // Build enhanced system prompt with phase context
    let systemPrompt = BACKEND_AGENT_PROMPT_BASE;
    
    if (options.tasksContext) {
      systemPrompt += `

=== TASKS FROM PHASE 1 ===
${options.tasksContext.substring(0, 3000)}
`;
    }
    
    if (options.phaseContext) {
      systemPrompt += `

=== PHASE CONTEXT ===
${options.phaseContext.substring(0, 2000)}
`;
    }
    
    const config: AgentConfig = {
      name: 'backend-agent',
      model: context.apiKey ? 'anthropic/claude-3-5-sonnet' : 'anthropic/claude-3-5-haiku',
      systemPrompt,
      tools: getToolsForAI(),
      maxTokens: 12288,
      temperature: 0.4,
    };
    
    super(config, context);
    this.options = options;
    
    logger.info(`[BackendAgent] Initialized with ${options.framework}`);
    if (options.tasksContext) {
      logger.info('[BackendAgent] Tasks context loaded from Phase 1');
    }
  }
  
  public async execute(): Promise<AgentResult> {
    const startTime = Date.now();
    const filesCreated: string[] = [];
    
    try {
      logger.info('[BackendAgent] ========================================');
      logger.info(`[BackendAgent] Generating ${this.options.framework} backend`);
      logger.info('[BackendAgent] ========================================');
      
      await fs.mkdir(this.options.outputDir, { recursive: true });
      
      // Step 1: Generate server entry point
      logger.info('[BackendAgent] Step 1/6: Server Entry Point');
      const serverFile = await this.generateServerFile();
      filesCreated.push(serverFile);
      
      // Step 2: Generate controllers
      logger.info('[BackendAgent] Step 2/6: Controllers');
      const controllers = await this.generateControllers();
      filesCreated.push(...controllers);
      
      // Step 3: Generate services
      logger.info('[BackendAgent] Step 3/6: Services');
      const services = await this.generateServices();
      filesCreated.push(...services);
      
      // Step 4: Generate middleware
      logger.info('[BackendAgent] Step 4/6: Middleware');
      const middleware = await this.generateMiddleware();
      filesCreated.push(...middleware);
      
      // Step 5: Generate routes
      logger.info('[BackendAgent] Step 5/6: Routes');
      const routes = await this.generateRoutes();
      filesCreated.push(...routes);
      
      // Step 6: Generate utilities
      logger.info('[BackendAgent] Step 6/6: Utilities');
      const utils = await this.generateUtilities();
      filesCreated.push(...utils);
      
      const duration = Date.now() - startTime;
      
      logger.info('[BackendAgent] ========================================');
      logger.info(`[BackendAgent] Complete in ${(duration / 1000).toFixed(1)}s`);
      logger.info(`[BackendAgent] Generated ${filesCreated.length} files`);
      logger.info('[BackendAgent] ========================================');
      
      return {
        success: true,
        message: `Backend generated with ${this.options.framework}`,
        filesCreated,
        duration,
      };
      
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      logger.error(`[BackendAgent] Failed: ${message}`);
      
      return {
        success: false,
        message: `Backend agent failed: ${message}`,
        duration: Date.now() - startTime,
      };
    }
  }
  
  private async generateServerFile(): Promise<string> {
    const serverPath = path.join(this.options.outputDir, 'server.ts');
    
    const code = this.options.framework === 'express'
      ? this.generateExpressServer()
      : this.generateFastifyServer();
    
    await fs.writeFile(serverPath, code, 'utf-8');
    logger.info(`[BackendAgent] [OK] Generated server.ts`);
    
    return serverPath;
  }
  
  private generateExpressServer(): string {
    return `/**
 * Express Server
 * Generated by Pakalon Backend Agent
 */

import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import compression from 'compression';
import { errorHandler } from './middleware/error-handler.js';
import { logger } from './utils/logger.js';
import routes from './routes/index.js';

const app = express();
const PORT = process.env.PORT || 3000;

// Security middleware
app.use(helmet());
app.use(cors({
  origin: process.env.CORS_ORIGIN || '*',
  credentials: true,
}));

// Body parsing
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Compression
app.use(compression());

// Request logging
app.use((req, res, next) => {
  logger.info(\`\${req.method} \${req.path}\`);
  next();
});

// Health check
app.get('/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// API routes
app.use('/api', routes);

// Error handling
app.use(errorHandler);

// Start server
app.listen(PORT, () => {
  logger.info(\`[Rocket] Server running on port \${PORT}\`);
  logger.info(\`[Memo] Environment: \${process.env.NODE_ENV || 'development'}\`);
});

export default app;
`;
  }
  
  private generateFastifyServer(): string {
    return `/**
 * Fastify Server
 * Generated by Pakalon Backend Agent
 */

import Fastify from 'fastify';
import cors from '@fastify/cors';
import helmet from '@fastify/helmet';
import compress from '@fastify/compress';
import { logger } from './utils/logger.js';
import routes from './routes/index.js';

const fastify = Fastify({
  logger: true,
});

const PORT = parseInt(process.env.PORT || '3000', 10);

// Register plugins
await fastify.register(helmet);
await fastify.register(cors, {
  origin: process.env.CORS_ORIGIN || '*',
  credentials: true,
});
await fastify.register(compress);

// Health check
fastify.get('/health', async (request, reply) => {
  return { status: 'ok', timestamp: new Date().toISOString() };
});

// Register routes
await fastify.register(routes, { prefix: '/api' });

// Start server
try {
  await fastify.listen({ port: PORT, host: '0.0.0.0' });
  logger.info(\`[Rocket] Server running on port \${PORT}\`);
  logger.info(\`[Memo] Environment: \${process.env.NODE_ENV || 'development'}\`);
} catch (err) {
  fastify.log.error(err);
  process.exit(1);
}

export default fastify;
`;
  }
  
  private async generateControllers(): Promise<string[]> {
    const controllersDir = path.join(this.options.outputDir, 'controllers');
    await fs.mkdir(controllersDir, { recursive: true });
    
    const controllers = ['users', 'auth'];
    const files: string[] = [];
    
    for (const name of controllers) {
      const filePath = path.join(controllersDir, `${name}.controller.ts`);
      const code = this.generateControllerTemplate(name);
      await fs.writeFile(filePath, code, 'utf-8');
      files.push(filePath);
      logger.info(`[BackendAgent] [OK] Generated ${name}.controller.ts`);
    }
    
    return files;
  }
  
  private generateControllerTemplate(name: string): string {
    const className = this.toPascalCase(name);
    
    return `/**
 * ${className} Controller
 * Generated by Pakalon Backend Agent
 */

import { Request, Response, NextFunction } from 'express';
import { ${className}Service } from '../services/${name}.service.js';
import { logger } from '../utils/logger.js';

export class ${className}Controller {
  private service: ${className}Service;
  
  constructor() {
    this.service = new ${className}Service();
  }
  
  async getAll(req: Request, res: Response, next: NextFunction) {
    try {
      const items = await this.service.findAll();
      res.json({ success: true, data: items });
    } catch (error) {
      logger.error(\`Error in ${className}Controller.getAll: \${error}\`);
      next(error);
    }
  }
  
  async getById(req: Request, res: Response, next: NextFunction) {
    try {
      const { id } = req.params;
      const item = await this.service.findById(id);
      
      if (!item) {
        return res.status(404).json({ 
          success: false, 
          message: '${className} not found' 
        });
      }
      
      res.json({ success: true, data: item });
    } catch (error) {
      logger.error(\`Error in ${className}Controller.getById: \${error}\`);
      next(error);
    }
  }
  
  async create(req: Request, res: Response, next: NextFunction) {
    try {
      const item = await this.service.create(req.body);
      res.status(201).json({ success: true, data: item });
    } catch (error) {
      logger.error(\`Error in ${className}Controller.create: \${error}\`);
      next(error);
    }
  }
  
  async update(req: Request, res: Response, next: NextFunction) {
    try {
      const { id } = req.params;
      const item = await this.service.update(id, req.body);
      res.json({ success: true, data: item });
    } catch (error) {
      logger.error(\`Error in ${className}Controller.update: \${error}\`);
      next(error);
    }
  }
  
  async delete(req: Request, res: Response, next: NextFunction) {
    try {
      const { id } = req.params;
      await this.service.delete(id);
      res.json({ success: true, message: '${className} deleted' });
    } catch (error) {
      logger.error(\`Error in ${className}Controller.delete: \${error}\`);
      next(error);
    }
  }
}
`;
  }
  
  private async generateServices(): Promise<string[]> {
    const servicesDir = path.join(this.options.outputDir, 'services');
    await fs.mkdir(servicesDir, { recursive: true });
    
    const services = ['users', 'auth'];
    const files: string[] = [];
    
    for (const name of services) {
      const filePath = path.join(servicesDir, `${name}.service.ts`);
      const code = this.generateServiceTemplate(name);
      await fs.writeFile(filePath, code, 'utf-8');
      files.push(filePath);
      logger.info(`[BackendAgent] [OK] Generated ${name}.service.ts`);
    }
    
    return files;
  }
  
  private generateServiceTemplate(name: string): string {
    const className = this.toPascalCase(name);
    const lowercaseName = name.toLowerCase();
    
    return `/**
 * ${className} Service
 * Generated by Pakalon Backend Agent
 * 
 * NOTE: This is a template service. Connect to your database adapter
 * (e.g., Prisma, Drizzle, Knex) in the db/ directory to enable full CRUD.
 */

import { logger } from '../utils/logger.js';
import { db } from '../db/index.js';

export class ${className}Service {
  /**
   * Find all ${lowercaseName} records
   */
  async findAll(): Promise<${className}[]> {
    logger.debug('${className}Service.findAll called');
    try {
      return await db.${lowercaseName}.findMany();
    } catch (error) {
      logger.error('${className}Service.findAll error:', error);
      return [];
    }
  }
  
  /**
   * Find a single ${lowercaseName} by ID
   */
  async findById(id: string): Promise<${className} | null> {
    logger.debug(\`${className}Service.findById called with id: \${id}\`);
    try {
      return await db.${lowercaseName}.findUnique({ where: { id } });
    } catch (error) {
      logger.error('${className}Service.findById error:', error);
      return null;
    }
  }
  
  /**
   * Create a new ${lowercaseName} record
   */
  async create(data: Omit<${className}, 'id' | 'createdAt' | 'updatedAt'>): Promise<${className}> {
    logger.debug('${className}Service.create called', data);
    try {
      return await db.${lowercaseName}.create({ data });
    } catch (error) {
      logger.error('${className}Service.create error:', error);
      throw error;
    }
  }
  
  /**
   * Update an existing ${lowercaseName} record
   */
  async update(id: string, data: Partial<${className}>): Promise<${className}> {
    logger.debug(\`${className}Service.update called with id: \${id}\`, data);
    try {
      return await db.${lowercaseName}.update({ where: { id }, data });
    } catch (error) {
      logger.error('${className}Service.update error:', error);
      throw error;
    }
  }
  
  /**
   * Delete a ${lowercaseName} record by ID
   */
  async delete(id: string): Promise<void> {
    logger.debug(\`${className}Service.delete called with id: \${id}\`);
    try {
      await db.${lowercaseName}.delete({ where: { id } });
    } catch (error) {
      logger.error('${className}Service.delete error:', error);
      throw error;
    }
  }
}
`;
  }
  
  private async generateMiddleware(): Promise<string[]> {
    const middlewareDir = path.join(this.options.outputDir, 'middleware');
    await fs.mkdir(middlewareDir, { recursive: true });
    
    const files: string[] = [];
    
    // Error handler
    const errorHandler = path.join(middlewareDir, 'error-handler.ts');
    await fs.writeFile(errorHandler, this.generateErrorHandler(), 'utf-8');
    files.push(errorHandler);
    
    // Auth middleware
    const authMiddleware = path.join(middlewareDir, 'auth.ts');
    await fs.writeFile(authMiddleware, this.generateAuthMiddleware(), 'utf-8');
    files.push(authMiddleware);
    
    // Validation middleware
    const validation = path.join(middlewareDir, 'validation.ts');
    await fs.writeFile(validation, this.generateValidationMiddleware(), 'utf-8');
    files.push(validation);
    
    logger.info(`[BackendAgent] [OK] Generated ${files.length} middleware files`);
    
    return files;
  }
  
  private generateErrorHandler(): string {
    return `/**
 * Error Handler Middleware
 * Generated by Pakalon Backend Agent
 */

import { Request, Response, NextFunction } from 'express';
import { logger } from '../utils/logger.js';

export function errorHandler(
  err: any,
  req: Request,
  res: Response,
  next: NextFunction
) {
  logger.error('Error caught by error handler:', err);
  
  const statusCode = err.statusCode || 500;
  const message = err.message || 'Internal Server Error';
  
  res.status(statusCode).json({
    success: false,
    message,
    ...(process.env.NODE_ENV === 'development' && { stack: err.stack }),
  });
}
`;
  }
  
  private generateAuthMiddleware(): string {
    return `/**
 * Authentication Middleware
 * Generated by Pakalon Backend Agent
 */

import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import { logger } from '../utils/logger.js';

const JWT_SECRET = process.env.JWT_SECRET || 'your-secret-key';

export function authenticate(req: Request, res: Response, next: NextFunction) {
  const authHeader = req.headers.authorization;
  
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({
      success: false,
      message: 'No token provided',
    });
  }
  
  const token = authHeader.substring(7);
  
  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    (req as any).user = decoded;
    next();
  } catch (error) {
    logger.warn('Invalid token:', error);
    res.status(401).json({
      success: false,
      message: 'Invalid token',
    });
  }
}
`;
  }
  
  private generateValidationMiddleware(): string {
    return `/**
 * Validation Middleware
 * Generated by Pakalon Backend Agent
 */

import { Request, Response, NextFunction } from 'express';
import { z, ZodSchema } from 'zod';
import { logger } from '../utils/logger.js';

export function validate(schema: ZodSchema) {
  return (req: Request, res: Response, next: NextFunction) => {
    try {
      schema.parse(req.body);
      next();
    } catch (error) {
      logger.warn('Validation error:', error);
      
      if (error instanceof z.ZodError) {
        return res.status(400).json({
          success: false,
          message: 'Validation error',
          errors: error.errors,
        });
      }
      
      next(error);
    }
  };
}
`;
  }
  
  private async generateRoutes(): Promise<string[]> {
    const routesDir = path.join(this.options.outputDir, 'routes');
    await fs.mkdir(routesDir, { recursive: true });
    
    const indexPath = path.join(routesDir, 'index.ts');
    await fs.writeFile(indexPath, this.generateRoutesIndex(), 'utf-8');
    
    logger.info(`[BackendAgent] [OK] Generated routes/index.ts`);
    
    return [indexPath];
  }
  
  private generateRoutesIndex(): string {
    return `/**
 * Routes Index
 * Generated by Pakalon Backend Agent
 */

import { Router } from 'express';
import { UsersController } from '../controllers/users.controller.js';
import { AuthController } from '../controllers/auth.controller.js';
import { authenticate } from '../middleware/auth.js';

const router = Router();

const usersController = new UsersController();
const authController = new AuthController();

// Auth routes (public)
router.post('/auth/login', authController.create.bind(authController));
router.post('/auth/register', authController.create.bind(authController));

// Users routes (protected)
router.get('/users', authenticate, usersController.getAll.bind(usersController));
router.get('/users/:id', authenticate, usersController.getById.bind(usersController));
router.post('/users', authenticate, usersController.create.bind(usersController));
router.put('/users/:id', authenticate, usersController.update.bind(usersController));
router.delete('/users/:id', authenticate, usersController.delete.bind(usersController));

export default router;
`;
  }
  
  private async generateUtilities(): Promise<string[]> {
    const utilsDir = path.join(this.options.outputDir, 'utils');
    await fs.mkdir(utilsDir, { recursive: true });
    
    const loggerPath = path.join(utilsDir, 'logger.ts');
    await fs.writeFile(loggerPath, this.generateLogger(), 'utf-8');
    
    logger.info(`[BackendAgent] [OK] Generated utils/logger.ts`);
    
    return [loggerPath];
  }
  
  private generateLogger(): string {
    return `/**
 * Logger Utility
 * Generated by Pakalon Backend Agent
 */

class Logger {
  info(message: string, ...args: any[]) {
    console.log(\`[INFO] \${message}\`, ...args);
  }
  
  debug(message: string, ...args: any[]) {
    if (process.env.NODE_ENV === 'development') {
      console.log(\`[DEBUG] \${message}\`, ...args);
    }
  }
  
  warn(message: string, ...args: any[]) {
    console.warn(\`[WARN] \${message}\`, ...args);
  }
  
  error(message: string, ...args: any[]) {
    console.error(\`[ERROR] \${message}\`, ...args);
  }
}

export const logger = new Logger();
`;
  }
  
  private toPascalCase(str: string): string {
    return str.split(/[-_]/).map(word => 
      word.charAt(0).toUpperCase() + word.slice(1)
    ).join('');
  }
}
