/**
 * Task Tools Module
 * Task management tools: Create, List, Get, Stop, Output, Update, Graph, Compose
 */
export { default as TaskCreate } from './task-create-tool.js';
export { default as TaskList } from './task-list-tool.js';
export { default as TaskGet } from './task-get-tool.js';
export { default as TaskStop } from './task-stop-tool.js';
export { default as TaskOutput } from './task-output-tool.js';
export { default as TaskUpdate } from './task-update-tool.js';
export { default as TaskGraph } from './task-graph-tool.js';
export { TaskComposeTool, TaskChainAdvanceTool } from './task-compose-tool.js';

import TaskCreate from './task-create-tool.js';
import TaskList from './task-list-tool.js';
import TaskGet from './task-get-tool.js';
import TaskStop from './task-stop-tool.js';
import TaskOutput from './task-output-tool.js';
import TaskUpdate from './task-update-tool.js';
import TaskGraph from './task-graph-tool.js';
import { TaskComposeTool, TaskChainAdvanceTool } from './task-compose-tool.js';

export const taskTools = {
  TaskCreate,
  TaskList,
  TaskGet,
  TaskStop,
  TaskOutput,
  TaskUpdate,
  TaskGraph,
  TaskCompose: TaskComposeTool,
  TaskChainAdvance: TaskChainAdvanceTool,
};

export default taskTools;

export type { Output as TaskCreateOutput } from './task-create-tool.js';
export type { Output as TaskListOutput } from './task-list-tool.js';
export type { Output as TaskGetOutput } from './task-get-tool.js';
export type { Output as TaskStopOutput } from './task-stop-tool.js';
export type { Output as TaskOutputOutput } from './task-output-tool.js';
export type { Output as TaskUpdateOutput } from './task-update-tool.js';
export type { Output as TaskGraphOutput } from './task-graph-tool.js';
export type { Output as TaskComposeOutput } from './task-compose-tool.js';