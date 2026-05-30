/**
 * Tool Search Module
 *
 * Provides deferred tool loading and schema caching for prompt optimization.
 */

export { ToolSearchIndex, getToolSearchIndex, searchTools, shouldDeferTool, getDeferredToolSchemas } from './ToolSearch.js';
export { ToolSchemaCache, getToolSchemaCache, cacheToolSchema, getCachedToolSchema, type CacheStats } from './toolSchemaCache.js';
