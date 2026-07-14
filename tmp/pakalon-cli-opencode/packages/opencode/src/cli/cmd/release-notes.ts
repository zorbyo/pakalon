import { cmd, Instance } from "./cmd"
import type { CommandModule } from "yargs"
import * as fs from "fs"
import * as path from "path"

/**
 * /release-notes command - View release notes
 */
export const releaseNotes: CommandModule = cmd(
  "release-notes [version]",
  "View release notes for CLI versions",
  (yargs) =>
    yargs
      .positional("version", {
        type: "string",
        description: "Specific version to view (e.g., '1.0.0')",
      })
      .option("latest", {
        alias: "l",
        type: "boolean",
        default: false,
        description: "Show only the latest version notes",
      }),
  Instance.provide(async (args, _ctx, instance) => {
    const version = args.version as string | undefined
    const showLatest = args.latest as boolean

    console.log("\n📋 Release Notes")
    console.log("═".repeat(50))

    // Sample release notes
    const releases = [
      {
        version: "1.0.0",
        date: "2024-01-15",
        notes: [
          "Initial release",
          "AI-powered code assistance",
          "Multi-model support",
          "MCP integration",
          "Vim mode support",
        ],
      },
      {
        version: "0.9.0",
        date: "2024-01-01",
        notes: [
          "Beta release",
          "Core functionality",
          "Basic CLI commands",
        ],
      },
    ]

    if (version) {
      const release = releases.find(r => r.version === version)
      if (!release) {
        console.error(`Version ${version} not found`)
        console.log("\nAvailable versions:")
        for (const r of releases) {
          console.log(`  • ${r.version}`)
        }
        return
      }
      
      console.log(`\n📦 Version ${release.version} (${release.date})`)
      console.log("─".repeat(40))
      for (const note of release.notes) {
        console.log(`  • ${note}`)
      }
    } else if (showLatest) {
      const latest = releases[0]!
      console.log(`\n📦 Version ${latest.version} (${latest.date})`)
      console.log("─".repeat(40))
      for (const note of latest.notes) {
        console.log(`  • ${note}`)
      }
    } else {
      // Show all releases
      for (const release of releases) {
        console.log(`\n📦 Version ${release.version} (${release.date})`)
        console.log("─".repeat(40))
        for (const note of release.notes) {
          console.log(`  • ${note}`)
        }
      }
    }

    console.log("\n💡 Use /release-notes <version> to view specific version")
  })
)
