import { Log } from "@/util/log"
import { Instance } from "./instance"
import { git } from "@/util/git"

const log = Log.create({ service: "git-status" })

export interface GitStatusIndicators {
  branch: string | undefined
  hasUnstaged: boolean
  hasStaged: boolean
  hasUntracked: boolean
  unstagedCount: number
  stagedCount: number
  untrackedCount: number
}

export namespace GitStatus {
  export async function getIndicators(): Promise<GitStatusIndicators> {
    const defaultResult: GitStatusIndicators = {
      branch: undefined,
      hasUnstaged: false,
      hasStaged: false,
      hasUntracked: false,
      unstagedCount: 0,
      stagedCount: 0,
      untrackedCount: 0,
    }

    if (Instance.project.vcs !== "git") {
      return defaultResult
    }

    try {
      const branchResult = await git(["rev-parse", "--abbrev-ref", "HEAD"], {
        cwd: Instance.worktree,
      })
      const branch = branchResult.exitCode === 0 ? branchResult.text().trim() : undefined

      const statusResult = await git(["status", "--porcelain", "-u"], {
        cwd: Instance.worktree,
      })

      if (statusResult.exitCode !== 0) {
        return { ...defaultResult, branch }
      }

      const lines = statusResult
        .text()
        .split("\n")
        .filter((l) => l.trim())

      let stagedCount = 0
      let unstagedCount = 0
      let untrackedCount = 0

      for (const line of lines) {
        if (line.length < 3) continue
        const index = line[0]
        const worktree = line[1]

        if (index === "?" && worktree === "?") {
          untrackedCount++
        } else {
          if (index && index !== " " && index !== "?") {
            stagedCount++
          }
          if (worktree && worktree !== " " && worktree !== "?") {
            unstagedCount++
          }
        }
      }

      return {
        branch,
        hasUnstaged: unstagedCount > 0,
        hasStaged: stagedCount > 0,
        hasUntracked: untrackedCount > 0,
        unstagedCount,
        stagedCount,
        untrackedCount,
      }
    } catch (error) {
      log.debug("failed to get git status", { error })
      return defaultResult
    }
  }

  export function formatIndicator(status: GitStatusIndicators): string {
    const parts: string[] = []

    if (status.branch) {
      parts.push(status.branch)
    }

    const indicators: string[] = []
    if (status.hasUnstaged) indicators.push("*")
    if (status.hasStaged) indicators.push("+")
    if (status.hasUntracked) indicators.push("%")

    if (indicators.length > 0) {
      parts.push(indicators.join(""))
    }

    return parts.join(" ")
  }

  export function formatDetailed(status: GitStatusIndicators): string {
    const parts: string[] = []

    if (status.branch) {
      parts.push(`branch: ${status.branch}`)
    }

    if (status.stagedCount > 0) {
      parts.push(`staged: ${status.stagedCount}`)
    }

    if (status.unstagedCount > 0) {
      parts.push(`modified: ${status.unstagedCount}`)
    }

    if (status.untrackedCount > 0) {
      parts.push(`untracked: ${status.untrackedCount}`)
    }

    return parts.join(", ") || "clean"
  }
}
