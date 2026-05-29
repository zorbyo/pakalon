import { registerBundledSkill } from '../bundledSkills.js'

export function registerGitSkill(): void {
  registerBundledSkill({
    name: 'git',
    description: 'Help with git status, diffs, branches, commits, and history.',
    allowedTools: ['Bash(git *)', 'Read', 'Grep', 'Glob'],
    userInvocable: true,
    async getPromptForCommand(args) {
      return [{ type: 'text', text: `# Git Helper\n\n${args || 'Inspect the repository and summarize what changed.'}` }]
    },
  })
}
