/**
 * Phase 3 Sub-Agent: API Agent
 * Generates REST/GraphQL/tRPC endpoints
 * 
 * Creates: OpenAPI specs, API documentation, validators
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

const API_AGENT_PROMPT_BASE = `You are the API Development Agent for Pakalon Phase 3.

Your responsibilities:
1. Generate REST/GraphQL/tRPC API endpoints
2. Create OpenAPI/Swagger specifications
3. Generate request/response validators
4. Add proper error handling
5. Follow RESTful/GraphQL best practices

You must use natural language. Explain API design decisions clearly.`;

export interface APIAgentOptions {
  apiType: 'rest' | 'graphql' | 'trpc';
  outputDir: string;
  phaseContext?: string;   // NEW: Phase document context
  apiSpec?: string;       // NEW: API spec from Phase 1
}

export class APIAgent extends BaseAgent {
  private options: APIAgentOptions;
  
  constructor(context: AgentContext, options: APIAgentOptions) {
    // Build enhanced system prompt with phase context
    let systemPrompt = API_AGENT_PROMPT_BASE;
    
    if (options.apiSpec) {
      systemPrompt += `

=== EXISTING API SPECIFICATION FROM PHASE 1 ===
${options.apiSpec.substring(0, 3000)}
`;
    }
    
    if (options.phaseContext) {
      systemPrompt += `

=== PHASE CONTEXT ===
${options.phaseContext.substring(0, 2000)}
`;
    }
    
    const config: AgentConfig = {
      name: 'api-agent',
      model: context.apiKey ? 'anthropic/claude-3-5-sonnet' : 'anthropic/claude-3-5-haiku',
      systemPrompt,
      tools: getToolsForAI(),
      maxTokens: 10240,
      temperature: 0.3,
    };
    
    super(config, context);
    this.options = options;
    
    logger.info(`[APIAgent] Initialized for ${options.apiType}`);
    if (options.apiSpec) {
      logger.info('[APIAgent] API spec loaded from Phase 1');
    }
  }
  
  public async execute(): Promise<AgentResult> {
    const startTime = Date.now();
    const filesCreated: string[] = [];
    
    try {
      logger.info('[APIAgent] ========================================');
      logger.info(`[APIAgent] Generating ${this.options.apiType.toUpperCase()} API`);
      logger.info('[APIAgent] ========================================');
      
      await fs.mkdir(this.options.outputDir, { recursive: true });
      
      if (this.options.apiType === 'rest') {
        const restFiles = await this.generateRESTAPI();
        filesCreated.push(...restFiles);
      } else if (this.options.apiType === 'graphql') {
        const gqlFiles = await this.generateGraphQLAPI();
        filesCreated.push(...gqlFiles);
      } else if (this.options.apiType === 'trpc') {
        const trpcFiles = await this.generateTRPCAPI();
        filesCreated.push(...trpcFiles);
      }
      
      const duration = Date.now() - startTime;
      
      logger.info('[APIAgent] ========================================');
      logger.info(`[APIAgent] Complete in ${(duration / 1000).toFixed(1)}s`);
      logger.info(`[APIAgent] Generated ${filesCreated.length} files`);
      logger.info('[APIAgent] ========================================');
      
      return {
        success: true,
        message: `${this.options.apiType.toUpperCase()} API generated`,
        filesCreated,
        duration,
      };
      
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      logger.error(`[APIAgent] Failed: ${message}`);
      
      return {
        success: false,
        message: `API agent failed: ${message}`,
        duration: Date.now() - startTime,
      };
    }
  }
  
  private async generateRESTAPI(): Promise<string[]> {
    const files: string[] = [];
    
    // Generate OpenAPI spec
    logger.info('[APIAgent] Step 1/3: OpenAPI Specification');
    const openApiPath = path.join(this.options.outputDir, 'openapi.yaml');
    await fs.writeFile(openApiPath, this.generateOpenAPISpec(), 'utf-8');
    files.push(openApiPath);
    
    // Generate Zod validators
    logger.info('[APIAgent] Step 2/3: Request Validators');
    const validatorsPath = path.join(this.options.outputDir, 'validators.ts');
    await fs.writeFile(validatorsPath, this.generateValidators(), 'utf-8');
    files.push(validatorsPath);
    
    // Generate API documentation
    logger.info('[APIAgent] Step 3/3: API Documentation');
    const docsPath = path.join(this.options.outputDir, 'API.md');
    await fs.writeFile(docsPath, this.generateAPIDocs(), 'utf-8');
    files.push(docsPath);
    
    logger.info(`[APIAgent] [OK] Generated REST API (${files.length} files)`);
    
    return files;
  }
  
  private generateOpenAPISpec(): string {
    return `openapi: 3.0.0
info:
  title: Generated API
  description: API generated by Pakalon API Agent
  version: 1.0.0
  contact:
    name: API Support
    email: support@example.com

servers:
  - url: http://localhost:3000/api
    description: Development server
  - url: https://api.production.com
    description: Production server

paths:
  /users:
    get:
      summary: Get all users
      tags:
        - Users
      security:
        - bearerAuth: []
      responses:
        '200':
          description: List of users
          content:
            application/json:
              schema:
                type: object
                properties:
                  success:
                    type: boolean
                  data:
                    type: array
                    items:
                      $ref: '#/components/schemas/User'
        '401':
          $ref: '#/components/responses/Unauthorized'
    
    post:
      summary: Create a new user
      tags:
        - Users
      security:
        - bearerAuth: []
      requestBody:
        required: true
        content:
          application/json:
            schema:
              $ref: '#/components/schemas/CreateUserInput'
      responses:
        '201':
          description: User created
          content:
            application/json:
              schema:
                type: object
                properties:
                  success:
                    type: boolean
                  data:
                    $ref: '#/components/schemas/User'
        '400':
          $ref: '#/components/responses/BadRequest'
        '401':
          $ref: '#/components/responses/Unauthorized'
  
  /users/{id}:
    get:
      summary: Get user by ID
      tags:
        - Users
      security:
        - bearerAuth: []
      parameters:
        - name: id
          in: path
          required: true
          schema:
            type: string
            format: uuid
      responses:
        '200':
          description: User details
          content:
            application/json:
              schema:
                type: object
                properties:
                  success:
                    type: boolean
                  data:
                    $ref: '#/components/schemas/User'
        '404':
          $ref: '#/components/responses/NotFound'
        '401':
          $ref: '#/components/responses/Unauthorized'
    
    put:
      summary: Update user
      tags:
        - Users
      security:
        - bearerAuth: []
      parameters:
        - name: id
          in: path
          required: true
          schema:
            type: string
            format: uuid
      requestBody:
        required: true
        content:
          application/json:
            schema:
              $ref: '#/components/schemas/UpdateUserInput'
      responses:
        '200':
          description: User updated
          content:
            application/json:
              schema:
                type: object
                properties:
                  success:
                    type: boolean
                  data:
                    $ref: '#/components/schemas/User'
        '400':
          $ref: '#/components/responses/BadRequest'
        '404':
          $ref: '#/components/responses/NotFound'
        '401':
          $ref: '#/components/responses/Unauthorized'
    
    delete:
      summary: Delete user
      tags:
        - Users
      security:
        - bearerAuth: []
      parameters:
        - name: id
          in: path
          required: true
          schema:
            type: string
            format: uuid
      responses:
        '200':
          description: User deleted
          content:
            application/json:
              schema:
                type: object
                properties:
                  success:
                    type: boolean
                  message:
                    type: string
        '404':
          $ref: '#/components/responses/NotFound'
        '401':
          $ref: '#/components/responses/Unauthorized'
  
  /auth/login:
    post:
      summary: Login user
      tags:
        - Authentication
      requestBody:
        required: true
        content:
          application/json:
            schema:
              type: object
              required:
                - email
                - password
              properties:
                email:
                  type: string
                  format: email
                password:
                  type: string
                  format: password
      responses:
        '200':
          description: Login successful
          content:
            application/json:
              schema:
                type: object
                properties:
                  success:
                    type: boolean
                  data:
                    type: object
                    properties:
                      token:
                        type: string
                      user:
                        $ref: '#/components/schemas/User'
        '401':
          $ref: '#/components/responses/Unauthorized'

components:
  securitySchemes:
    bearerAuth:
      type: http
      scheme: bearer
      bearerFormat: JWT
  
  schemas:
    User:
      type: object
      properties:
        id:
          type: string
          format: uuid
        email:
          type: string
          format: email
        name:
          type: string
        createdAt:
          type: string
          format: date-time
        updatedAt:
          type: string
          format: date-time
    
    CreateUserInput:
      type: object
      required:
        - email
        - password
        - name
      properties:
        email:
          type: string
          format: email
        password:
          type: string
          format: password
          minLength: 8
        name:
          type: string
          minLength: 1
    
    UpdateUserInput:
      type: object
      properties:
        email:
          type: string
          format: email
        name:
          type: string
          minLength: 1
  
  responses:
    BadRequest:
      description: Bad request
      content:
        application/json:
          schema:
            type: object
            properties:
              success:
                type: boolean
                example: false
              message:
                type: string
                example: Validation error
              errors:
                type: array
                items:
                  type: object
    
    Unauthorized:
      description: Unauthorized
      content:
        application/json:
          schema:
            type: object
            properties:
              success:
                type: boolean
                example: false
              message:
                type: string
                example: Unauthorized
    
    NotFound:
      description: Not found
      content:
        application/json:
          schema:
            type: object
            properties:
              success:
                type: boolean
                example: false
              message:
                type: string
                example: Resource not found
`;
  }
  
  private generateValidators(): string {
    return `/**
 * API Request Validators
 * Generated by Pakalon API Agent
 */

import { z } from 'zod';

// User schemas
export const CreateUserSchema = z.object({
  email: z.string().email('Invalid email format'),
  password: z.string().min(8, 'Password must be at least 8 characters'),
  name: z.string().min(1, 'Name is required'),
});

export const UpdateUserSchema = z.object({
  email: z.string().email('Invalid email format').optional(),
  name: z.string().min(1, 'Name cannot be empty').optional(),
});

export const LoginSchema = z.object({
  email: z.string().email('Invalid email format'),
  password: z.string().min(1, 'Password is required'),
});

// ID validation
export const UUIDSchema = z.string().uuid('Invalid UUID format');

// Pagination schemas
export const PaginationSchema = z.object({
  page: z.coerce.number().int().positive().default(1),
  limit: z.coerce.number().int().positive().max(100).default(10),
});

export type CreateUserInput = z.infer<typeof CreateUserSchema>;
export type UpdateUserInput = z.infer<typeof UpdateUserSchema>;
export type LoginInput = z.infer<typeof LoginSchema>;
export type PaginationInput = z.infer<typeof PaginationSchema>;
`;
  }
  
  private generateAPIDocs(): string {
    return `# API Documentation

Generated by Pakalon API Agent

## Base URL

- **Development**: \`http://localhost:3000/api\`
- **Production**: \`https://api.production.com\`

## Authentication

All protected endpoints require a Bearer token in the Authorization header:

\`\`\`
Authorization: Bearer <your-jwt-token>
\`\`\`

## Endpoints

### Authentication

#### POST /auth/login

Login with email and password.

**Request:**
\`\`\`json
{
  "email": "user@example.com",
  "password": "password123"
}
\`\`\`

**Response:**
\`\`\`json
{
  "success": true,
  "data": {
    "token": "eyJhbGciOiJIUzI1NiIs...",
    "user": {
      "id": "123e4567-e89b-12d3-a456-426614174000",
      "email": "user@example.com",
      "name": "John Doe"
    }
  }
}
\`\`\`

### Users

#### GET /users

Get all users (protected).

**Response:**
\`\`\`json
{
  "success": true,
  "data": [
    {
      "id": "123e4567-e89b-12d3-a456-426614174000",
      "email": "user@example.com",
      "name": "John Doe",
      "createdAt": "2024-01-01T00:00:00Z"
    }
  ]
}
\`\`\`

#### POST /users

Create a new user (protected).

**Request:**
\`\`\`json
{
  "email": "new@example.com",
  "password": "password123",
  "name": "Jane Doe"
}
\`\`\`

#### GET /users/:id

Get user by ID (protected).

#### PUT /users/:id

Update user (protected).

#### DELETE /users/:id

Delete user (protected).

## Error Responses

All errors follow this format:

\`\`\`json
{
  "success": false,
  "message": "Error description",
  "errors": [
    {
      "field": "email",
      "message": "Invalid email format"
    }
  ]
}
\`\`\`

## Status Codes

- \`200\` - Success
- \`201\` - Created
- \`400\` - Bad Request (validation error)
- \`401\` - Unauthorized
- \`404\` - Not Found
- \`500\` - Internal Server Error
`;
  }
  
  private async generateGraphQLAPI(): Promise<string[]> {
    // GraphQL implementation would go here
    logger.info('[APIAgent] GraphQL API generation not yet implemented');
    return [];
  }
  
  private async generateTRPCAPI(): Promise<string[]> {
    // tRPC implementation would go here
    logger.info('[APIAgent] tRPC API generation not yet implemented');
    return [];
  }
}
