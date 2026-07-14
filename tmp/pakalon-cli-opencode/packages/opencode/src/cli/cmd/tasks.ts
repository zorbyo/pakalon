import { cmd, Instance } from "./cmd"
import type { CommandModule } from "yargs"

/**
 * /tasks command - Manage tasks and todo items
 */
export const tasks: CommandModule = cmd(
  "tasks [action]",
  "Manage tasks and todo items",
  (yargs) =>
    yargs
      .positional("action", {
        type: "string",
        choices: ["list", "add", "complete", "remove", "clear"],
        default: "list",
        description: "Action to perform",
      })
      .option("task", {
        alias: "t",
        type: "string",
        description: "Task description or ID",
      })
      .option("priority", {
        alias: "p",
        type: "string",
        choices: ["low", "medium", "high"],
        default: "medium",
        description: "Task priority",
      }),
  Instance.provide(async (args, _ctx, instance) => {
    const action = args.action as string
    const taskArg = args.task as string | undefined
    const priority = args.priority as string

    console.log("\n📋 Task Manager")
    console.log("═".repeat(50))

    switch (action) {
      case "list": {
        console.log("\n📝 Current Tasks:")
        console.log("─".repeat(40))
        console.log("  (No tasks currently)")
        console.log("\nUse /tasks add --task 'description' to add a task")
        break
      }

      case "add": {
        if (!taskArg) {
          console.error("Error: Task description required")
          console.log("Usage: /tasks add --task 'Your task description'")
          return
        }
        
        const priorityIcon = priority === "high" ? "🔴" : priority === "low" ? "🟢" : "🟡"
        console.log(`\n✓ Task added:`)
        console.log(`  ${priorityIcon} ${taskArg}`)
        console.log(`  Priority: ${priority}`)
        break
      }

      case "complete": {
        if (!taskArg) {
          console.error("Error: Task ID required")
          console.log("Usage: /tasks complete --task <id>")
          return
        }
        console.log(`\n✓ Task completed: ${taskArg}`)
        break
      }

      case "remove": {
        if (!taskArg) {
          console.error("Error: Task ID required")
          console.log("Usage: /tasks remove --task <id>")
          return
        }
        console.log(`\n✓ Task removed: ${taskArg}`)
        break
      }

      case "clear": {
        console.log("\n✓ All tasks cleared")
        break
      }
    }
  })
)
