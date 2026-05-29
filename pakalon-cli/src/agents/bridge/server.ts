/**
 * Phase Bridge Server
 * 
 * Pure TypeScript/Node.js replacement for python/server.py (FastAPI).
 * Runs the 6-phase agentic pipeline without any Python dependencies.
 * 
 * Endpoints:
 *   GET  /health            - Health check
 *   POST /phase/1          - Run Phase 1 (Planning)
 *   POST /phase/2          - Run Phase 2 (Wireframes)
 *   POST /phase/3          - Run Phase 3 (Development)
 *   POST /phase/4          - Run Phase 4 (Security)
 *   POST /phase/5          - Run Phase 5 (CI/CD)
 *   POST /phase/6          - Run Phase 6 (Documentation)
 *   POST /orchestrate      - Run all 6 phases sequentially
 *   POST /tools/analyze_image - Analyze an image file
 *   POST /tools/analyze_video - Analyze a video file
 */

import http from 'http';
import path from 'path';
import fs from 'fs/promises';
import { PhaseOrchestrator } from '../orchestrator.js';
import type { AgentContext } from '../types.js';
import logger from '../../utils/logger.js';
import type { BridgeRequest, BridgeResponse, HealthResponse, PhaseResult } from './types.js';
import { BRIDGE_DEFAULT_HOST, BRIDGE_DEFAULT_PORT } from './types.js';
import { cmdAnalyzeImage } from '../../commands/analyze-image.js';
import { cmdAnalyzeVideo, type AnalyzeVideoOptions } from '../../commands/analyze-video.js';

const HOST = process.env.PAKALON_BRIDGE_HOST ?? BRIDGE_DEFAULT_HOST;
const PORT = Number(process.env.PAKALON_BRIDGE_PORT ?? BRIDGE_DEFAULT_PORT);

/**
 * Send JSON response with CORS headers
 */
function sendJson(
  res: http.ServerResponse,
  status: number,
  payload: object
): void {
  const body = JSON.stringify(payload);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Access-Control-Allow-Origin': '*',
    'Content-Length': Buffer.byteLength(body),
  });
  res.end(body);
}

/**
 * Parse JSON body from request
 */
async function parseBody<T>(req: http.IncomingMessage): Promise<T> {
  return new Promise((resolve, reject) => {
    let data = '';
    req.on('data', chunk => (data += chunk));
    req.on('end', () => {
      try {
        resolve(JSON.parse(data || '{}') as T);
      } catch {
        reject(new Error('Invalid JSON'));
      }
    });
    req.on('error', reject);
  });
}

/**
 * Build AgentContext from BridgeRequest
 */
function buildContext(req: BridgeRequest): AgentContext {
  return {
    agentId: 'bridge',
    agentName: 'bridge',
    agentType: 'bridge',
    userPrompt: req.description ?? '',
    projectDir: req.project_root ?? process.cwd(),
    isYolo: false,
    permissionMode: 'default',
    tools: [],
    disallowedTools: [],
    background: false,
  };
}

function isSuccessfulToolResult(message: string): boolean {
  return !message.startsWith('Error:') && !message.startsWith('Analysis failed:');
}

/**
 * Create and start the bridge HTTP server
 */
export function createBridgeServer(): http.Server {
  // Orchestrator is instantiated once; context is baked in at construction
  const orchestratorByContext: Map<string, PhaseOrchestrator> = new Map();

  function getOrchestrator(context: AgentContext): PhaseOrchestrator {
    const key = context.projectDir;
    if (!orchestratorByContext.has(key)) {
      orchestratorByContext.set(key, new PhaseOrchestrator(context));
    }
    return orchestratorByContext.get(key)!;
  }

  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url ?? '/', `http://${HOST}:${PORT}`);

    // CORS preflight
    if (req.method === 'OPTIONS') {
      res.writeHead(204, {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Headers': 'Content-Type',
        'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      });
      res.end();
      return;
    }

    // Health check - GET /health
    if (url.pathname === '/health' && req.method === 'GET') {
      const health: HealthResponse = {
        status: 'ok',
        service: 'pakalon-ts-bridge',
      };
      sendJson(res, 200, health);
      return;
    }

    // Media tools - POST /tools/analyze_image
    if (url.pathname === '/tools/analyze_image' && req.method === 'POST') {
      try {
        const body = await parseBody<{ path?: string; image_path?: string }>(req);
        const targetPath = body.path ?? body.image_path ?? '';
        const result = await cmdAnalyzeImage(targetPath);
        const success = isSuccessfulToolResult(result);
        sendJson(res, success ? 200 : 400, {
          status: success ? 'success' : 'error',
          result,
          description: success ? result : undefined,
          error: success ? undefined : result,
        });
      } catch (err) {
        logger.error('[Bridge] Image analysis failed:', err);
        sendJson(res, 500, {
          status: 'error',
          message: String(err),
        });
      }
      return;
    }

    // Media tools - POST /tools/analyze_video
    if (url.pathname === '/tools/analyze_video' && req.method === 'POST') {
      try {
        const body = await parseBody<{
          path?: string;
          video_path?: string;
          maxFrames?: number;
          frameInterval?: number;
          prompt?: string;
          summarize?: boolean;
        }>(req);
        const targetPath = body.path ?? body.video_path ?? '';
        const options: AnalyzeVideoOptions = {
          maxFrames: body.maxFrames,
          frameInterval: body.frameInterval,
          prompt: body.prompt,
          summarize: body.summarize,
        };
        const result = await cmdAnalyzeVideo(targetPath, options);
        const success = isSuccessfulToolResult(result);
        sendJson(res, success ? 200 : 400, {
          status: success ? 'success' : 'error',
          result,
          description: success ? result : undefined,
          error: success ? undefined : result,
        });
      } catch (err) {
        logger.error('[Bridge] Video analysis failed:', err);
        sendJson(res, 500, {
          status: 'error',
          message: String(err),
        });
      }
      return;
    }

    // Orchestrate all phases - POST /orchestrate
    if (url.pathname === '/orchestrate' && req.method === 'POST') {
      try {
        const body = await parseBody<BridgeRequest>(req);
        const context = buildContext(body);
        const orchestrator = getOrchestrator(context);

        logger.info('[Bridge] Starting full pipeline orchestration');

        const result = await orchestrator.executeAll();

        const response: BridgeResponse = {
          status: result.success ? 'success' : 'error',
          message: result.message,
          artifacts: result.phasesCompleted.map(String),
          duration: result.totalDuration,
        };

        sendJson(res, 200, response);
      } catch (err) {
        logger.error('[Bridge] Orchestration failed:', err);
        sendJson(res, 500, {
          status: 'error',
          message: String(err),
        });
      }
      return;
    }

    // Individual phase - POST /phase/{1-6}
    const phaseMatch = url.pathname.match(/^\/phase\/(\d+)$/);
    if (phaseMatch && req.method === 'POST') {
      try {
        const phase = Number(phaseMatch[1]);
        const body = await parseBody<BridgeRequest>(req);
        const context = buildContext(body);
        const orchestrator = getOrchestrator(context);

        logger.info(`[Bridge] Starting Phase ${phase}`);

        const result = await orchestrator.executePhase(phase);

        const phaseResult: PhaseResult = {
          status: result.success ? 'success' : 'error',
          phase,
          artifacts: result.filesCreated,
          error: result.success ? undefined : result.message,
        };

        sendJson(res, 200, phaseResult);
      } catch (err) {
        logger.error(`[Bridge] Phase execution failed:`, err);
        sendJson(res, 500, {
          status: 'error',
          message: String(err),
        });
      }
      return;
    }

    // Workflow management - GET /workflow/list
    if (url.pathname === '/workflow/list' && req.method === 'GET') {
      try {
        const workflowsDir = path.join(process.env.HOME ?? process.env.USERPROFILE ?? '', '.config', 'pakalon', 'workflows');
        await fs.mkdir(workflowsDir, { recursive: true });
        const files = await fs.readdir(workflowsDir);
        const workflows = files
          .filter(f => f.endsWith('.json'))
          .map(f => {
            const filePath = path.join(workflowsDir, f);
            const stat = require('fs').statSync(filePath);
            return {
              name: f.replace('.json', ''),
              file: filePath,
              updated_at: stat.mtime.toISOString(),
            };
          });
        sendJson(res, 200, { workflows });
      } catch (err) {
        sendJson(res, 200, { workflows: [] });
      }
      return;
    }

    // Workflow create - POST /workflow/create
    if (url.pathname === '/workflow/create' && req.method === 'POST') {
      try {
        const body = await parseBody<{ name: string; description?: string }>(req);
        const workflowsDir = path.join(process.env.HOME ?? process.env.USERPROFILE ?? '', '.config', 'pakalon', 'workflows');
        await fs.mkdir(workflowsDir, { recursive: true });
        const filePath = path.join(workflowsDir, `${body.name}.json`);
        const workflow = {
          name: body.name,
          description: body.description ?? '',
          created_at: new Date().toISOString(),
          phases: [],
        };
        await fs.writeFile(filePath, JSON.stringify(workflow, null, 2));
        sendJson(res, 200, { status: 'created', workflow: body.name, file: filePath });
      } catch (err) {
        sendJson(res, 500, { status: 'error', message: String(err) });
      }
      return;
    }

    // Workflow generate from template - POST /workflow/generate
    if (url.pathname === '/workflow/generate' && req.method === 'POST') {
      try {
        const body = await parseBody<{ template: string }>(req);
        const workflowsDir = path.join(process.env.HOME ?? process.env.USERPROFILE ?? '', '.config', 'pakalon', 'workflows');
        await fs.mkdir(workflowsDir, { recursive: true });

        const templates: Record<string, object> = {
          node: { name: 'node-template', phases: [1, 2, 3, 4, 5, 6], stack: 'Node.js' },
          fullstack: { name: 'fullstack-template', phases: [1, 2, 3, 4, 5, 6], stack: 'Fullstack' },
          deploy: { name: 'deploy-template', phases: [1, 2, 3, 4, 5, 6], stack: 'Deploy' },
        };

        const tmpl = templates[body.template] ?? templates['node'];
        const filePath = path.join(workflowsDir, `${tmpl.name}.json`);
        await fs.writeFile(filePath, JSON.stringify(tmpl, null, 2));
        sendJson(res, 200, { status: 'generated', workflow: tmpl.name, file: filePath });
      } catch (err) {
        sendJson(res, 500, { status: 'error', message: String(err) });
      }
      return;
    }

    // Workflow validate - POST /workflow/validate
    if (url.pathname === '/workflow/validate' && req.method === 'POST') {
      try {
        const body = await parseBody<{ filename: string }>(req);
        const filePath = path.join(process.env.HOME ?? process.env.USERPROFILE ?? '', '.config', 'pakalon', 'workflows', body.filename);
        const content = await fs.readFile(filePath, 'utf-8');
        JSON.parse(content); // validate JSON
        sendJson(res, 200, { valid: true, errors: [] });
      } catch {
        sendJson(res, 200, { valid: false, errors: ['Invalid workflow file'] });
      }
      return;
    }

    // Workflow dry-run - POST /workflow/dry-run
    if (url.pathname === '/workflow/dry-run' && req.method === 'POST') {
      try {
        const body = await parseBody<{ filename: string }>(req);
        const filePath = path.join(process.env.HOME ?? process.env.USERPROFILE ?? '', '.config', 'pakalon', 'workflows', body.filename);
        const content = await fs.readFile(filePath, 'utf-8');
        const workflow = JSON.parse(content);
        sendJson(res, 200, {
          workflow: body.filename,
          preview: `Workflow: ${workflow.name}\nPhases: ${(workflow.phases ?? []).join(' → ')}`,
        });
      } catch (err) {
        sendJson(res, 500, { workflow: body.filename, preview: '', error: String(err) });
      }
      return;
    }

    // 404 for unknown routes
    sendJson(res, 404, { status: 'error', message: 'not found' });
  });

  return server;
}

/**
 * Start the bridge server
 */
export function startBridgeServer(): void {
  const server = createBridgeServer();
  
  server.listen(PORT, HOST, () => {
    logger.info(`[Bridge] Pakalon TS bridge listening on http://${HOST}:${PORT}`);
    logger.info(`[Bridge] Endpoints:`);
    logger.info(`[Bridge]   GET  /health`);
    logger.info(`[Bridge]   POST /phase/1 through /phase/6`);
    logger.info(`[Bridge]   POST /orchestrate`);
    logger.info(`[Bridge]   POST /tools/analyze_image, /tools/analyze_video`);
    logger.info(`[Bridge]   GET  /workflow/list`);
    logger.info(`[Bridge]   POST /workflow/create, /workflow/generate, /workflow/validate, /workflow/dry-run`);
  });

  server.on('error', (err) => {
    logger.error(`[Bridge] Server error: ${err}`);
  });
}

/**
 * Check if bridge is running
 */
export async function checkBridgeHealth(): Promise<boolean> {
  try {
    const res = await fetch(`http://${HOST}:${PORT}/health`, {
      method: 'GET',
      signal: AbortSignal.timeout(5_000),
    });
    return res.ok;
  } catch {
    return false;
  }
}

// Start server if run directly
if (import.meta.url === `file://${process.argv[1]}`) {
  startBridgeServer();
}

export default { createBridgeServer, startBridgeServer, checkBridgeHealth };
