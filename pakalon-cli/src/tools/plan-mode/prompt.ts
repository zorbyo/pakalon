/**
 * Plan Mode Tool Prompts
 */

export const ENTER_PLAN_MODE_TOOL_PROMPT = `Use this tool proactively when you're about to start a non-trivial implementation task. Getting user sign-off on your approach before writing code prevents wasted effort and ensures alignment. This tool transitions you into plan mode where you can explore the codebase and design an implementation approach for user approval.

## When to Use This Tool

**Prefer using EnterPlanMode** for implementation tasks unless they're simple. Use it when ANY of these conditions apply:

1. **New Feature Implementation**: Adding meaningful new functionality
   - Example: "Add a logout button" - where should it go? What should happen on click?
   - Example: "Add form validation" - what rules? What error messages?

2. **Multiple Valid Approaches**: The task can be solved in several different ways
   - Example: "Add caching to the API" - could use Redis, in-memory, file-based, etc.
   - Example: "Improve performance" - many optimization strategies possible

3. **Code Modifications**: Changes that affect existing behavior or structure
   - Example: "Update the login flow" - what exactly should change?
   - Example: "Refactor this component" - what's the target architecture?

4. **Architectural Decisions**: The task requires choosing between patterns or technologies
   - Example: "Add real-time updates" - WebSockets vs SSE vs polling
   - Example: "Implement state management" - Redux vs Context vs custom solution

5. **Multi-File Changes**: The task will likely touch more than 2-3 files
   - Example: "Refactor the authentication system"
   - Example: "Add a new API endpoint with tests"

6. **Unclear Requirements**: You need to explore before understanding the full scope
   - Example: "Make the app faster" - need to profile and identify bottlenecks
   - Example: "Fix the bug in checkout" - need to investigate root cause

7. **User Preferences Matter**: The implementation could reasonably go multiple ways
   - Plan mode lets you explore first, then present options with context

## When NOT to Use This Tool

Only skip EnterPlanMode for simple tasks:
- Single-line or few-line fixes (typos, obvious bugs, small tweaks)
- Adding a single function with clear requirements
- Tasks where the user has given very specific, detailed instructions
- Pure research/exploration tasks

## What Happens in Plan Mode

In plan mode, you'll:
1. Thoroughly explore the codebase using Glob, Grep, and Read tools
2. Understand existing patterns and architecture
3. Design an implementation approach
4. Present your plan to the user for approval
5. Exit plan mode with ExitPlanMode when ready to implement

## Examples

### GOOD - Use EnterPlanMode:
User: "Add user authentication to the app"
- Requires architectural decisions (session vs JWT, where to store tokens, middleware structure)

User: "Optimize the database queries"
- Multiple approaches possible, need to profile first, significant impact

User: "Implement dark mode"
- Architectural decision on theme system, affects many components

### BAD - Don't use EnterPlanMode:
User: "Fix the typo in the README"
- Straightforward, no planning needed

User: "Add a console.log to debug this function"
- Simple, obvious implementation

User: "What files handle routing?"
- Research task, not implementation planning

## Important Notes

- This tool REQUIRES user approval - they must consent to entering plan mode
- If unsure whether to use it, err on the side of planning - it's better to get alignment upfront than to redo work
- Users appreciate being consulted before significant changes are made to their codebase
`;

export const EXIT_PLAN_MODE_TOOL_PROMPT = `Use this tool when you have completed your plan and are ready to exit plan mode to start implementing. This tool presents your plan to the user for approval before exiting plan mode.

## When to Use This Tool

Use ExitPlanMode when ALL of these conditions are met:

1. **You have explored the codebase** and understand the existing patterns
2. **You have designed an implementation approach** that addresses the user's request
3. **You have written a clear plan** that explains:
   - What files need to be modified
   - What the changes will do
   - Why this approach was chosen over alternatives
4. **You are ready for user feedback** before starting implementation

## What Happens When You Call This Tool

1. Your plan is presented to the user for review
2. The user can:
   - **Approve** the plan and let you proceed with implementation
   - **Request changes** to the plan before approving
   - **Reject** the plan and ask for a different approach
3. If approved, you exit plan mode and can use all tools including file modifications

## Plan Mode Reminder

Remember: In plan mode, you should:
1. Thoroughly explore the codebase to understand existing patterns
2. Identify similar features and architectural approaches
3. Consider multiple approaches and their trade-offs
4. Design a concrete implementation strategy
5. When ready, use ExitPlanMode to present your plan for approval

DO NOT write or edit any files yet. This is a read-only exploration and planning phase.

## Important Notes

- Always write a clear, detailed plan before calling ExitPlanMode
- Include specific file paths and the changes you intend to make
- Explain why you chose your approach over alternatives
- If your plan is complex, consider breaking it into steps
- The user may have suggestions that improve the approach
`;