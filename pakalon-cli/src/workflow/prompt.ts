export const PROMPT = `Use this tool to execute predefined workflow scripts. Workflows allow you to automate complex sequences of operations by defining them once and executing them on demand.

## When to Use Workflows

1. **Repetitive Tasks** - When you need to perform the same sequence of operations multiple times
2. **Complex Multi-Step Processes** - When a task requires multiple steps that should be executed together
3. **Standardized Procedures** - When you have established procedures that should be followed consistently
4. **Batch Operations** - When you need to execute multiple related operations in sequence

## Workflow Structure

Workflows are defined with:
- **Name** - Unique identifier for the workflow
- **Description** - Human-readable description of what the workflow does
- **Steps** - Ordered list of operations to execute
- **Variables** - Optional context values that can be passed to the workflow

## Workflow Steps

Each step in a workflow specifies:
- **Tool** - The tool or command to execute (e.g., Bash, Read, Edit, Agent)
- **Arguments** - Parameters passed to the tool
- **Condition** - Optional condition that must be true for the step to execute
- **On Error** - What to do if the step fails (continue, stop, or retry)

## Examples

<example>
User: Run the "setup-development" workflow to initialize my development environment
Assistant: I'll execute the setup-development workflow to initialize your development environment.

*Uses the Workflow tool with workflow="setup-development"*

The workflow "setup-development" completed successfully:
- Step 1/5: Install dependencies [OK]
- Step 2/5: Setup environment variables [OK]
- Step 3/5: Initialize database [OK]
- Step 4/5: Build project [OK]
- Step 5/5: Run tests [OK]

Your development environment is ready!
</example>

<example>
User: I need to deploy my application to staging
Assistant: I'll run the "deploy-staging" workflow which handles the complete deployment process.

*Uses the Workflow tool with workflow="deploy-staging" and context={env: "staging"}*

Deployment workflow completed:
- Built application successfully
- Ran test suite: 42 passed, 0 failed
- Deployed to staging environment
- Health check passed

[OK] Deployment to staging complete
</example>

## Listing Available Workflows

Use the ListWorkflows tool to see all available workflows and their descriptions. This helps you discover what workflows are available for your tasks.

## Execution Context

When executing a workflow, you can pass context variables that will be available to all steps in the workflow. This allows you to customize workflow execution based on input parameters.

## Error Handling

Workflows support error handling at both the workflow and step levels:
- Step-level "on error" settings control what happens when a specific step fails
- Workflow-level settings control the overall behavior on errors

If a step fails and on-error is "continue", the workflow will continue to the next step.
If on-error is "stop", the workflow will halt execution.
If on-error is "retry", the step will be retried up to the specified number of times.
`;

export const DESCRIPTION = 'Execute a predefined workflow script with specified parameters and context.';

export const LIST_WORKFLOWS_PROMPT = `Use this tool to list all available workflows. This tool returns the names, descriptions, and step counts of all defined workflows.

## When to Use This Tool

1. **Discovering Available Workflows** - Find out what workflows are available in the system
2. **Before Running a Workflow** - Verify a workflow exists before attempting to run it
3. **Workflow Management** - Get an overview of all available automation scripts

## Information Returned

For each workflow, you'll see:
- **Name** - The workflow's unique identifier
- **Description** - What the workflow does (when includeDescription is true)
- **Version** - Optional version string (when available)
- **Steps** - Number of steps in the workflow

## Examples

<example>
User: What workflows are available?
Assistant: Let me check what workflows are available.

*Uses the ListWorkflows tool*

Available workflows (5):
1. setup-development - Initialize development environment (4 steps)
2. deploy-staging - Deploy to staging environment (6 steps)
3. deploy-production - Deploy to production environment (8 steps)
4. run-tests - Execute test suite (3 steps)
5. backup-database - Create database backup (2 steps)
</example>
`;

export const LIST_WORKFLOWS_DESCRIPTION = 'List all available workflows with their names and descriptions.';

export const SHOW_WORKFLOW_PROMPT = `Use this tool to show detailed information about a specific workflow, including all its steps and configuration.

## When to Use This Tool

1. **Before Executing a Workflow** - Review exactly what a workflow will do before running it
2. **Understanding Workflow Logic** - Learn how a workflow accomplishes its task
3. **Debugging** - Inspect workflow configuration when something isn't working as expected
4. **Modifying Workflows** - Understand the structure before making changes

## Information Returned

The tool returns:
- **Name and Description** - Basic workflow information
- **Version** - Optional version string
- **Variables** - Any variables the workflow expects
- **Timeout** - Maximum execution time (if specified)
- **Steps** - Detailed list of each step including:
  - Step ID and name
  - Tool to be executed
  - Arguments passed to the tool
  - Condition (if any)
  - On Error handling (if specified)

## Examples

<example>
User: Show me the details of the deploy-staging workflow
Assistant: Let me get the details of the deploy-staging workflow.

*Uses the ShowWorkflow tool with workflow="deploy-staging"*

Workflow: deploy-staging
Description: Deploy application to staging environment
Version: 1.2.0
Variables: env=staging, region=us-west-2
Timeout: 300000ms (5 minutes)

Steps:
1. [build] - Build application with environment variables
2. [test] - Run test suite with coverage
3. [deploy] - Deploy to staging server
4. [health-check] - Verify deployment health
5. [notify] - Send deployment notification
</example>
`;

export const SHOW_WORKFLOW_DESCRIPTION = 'Show detailed information about a specific workflow including all its steps.';