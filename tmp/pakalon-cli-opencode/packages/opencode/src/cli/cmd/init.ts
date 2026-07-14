import { cmd } from "./cmd"
import { Instance } from "@/project/instance"
import { UI } from "../ui"
import path from "path"
import fs from "fs/promises"
import { Filesystem } from "@/util/filesystem"

const PAKALON_FOLDER = ".pakalon"

// Template content for files
const TEMPLATES = {
  "agents/skills.md": `---
name: Agent Skills
description: Skills and capabilities of the AI agents
---

# Agent Skills

## Available Skills
1. **Skill 1**: [Description]
2. **Skill 2**: [Description]

## Skill Details

### Skill 1
- **Name**: [Skill name]
- **Description**: [What it does]
- **Use Cases**: [Where to use]

### Skill 2
- **Name**: [Skill name]
- **Description**: [What it does]
- **Use Cases**: [Where to use]

## Agent Configuration
| Agent | Primary Skills | Secondary Skills |
|-------|---------------|------------------|
| - | - | - |

## Notes
[Additional notes about skills]
`,

  "plan.md": `---
name: Project Plan
description: Overall project plan and milestones
---

# Project Plan

## Overview
[Description of the project]

## Project Goals
1. [Goal 1]
2. [Goal 2]
3. [Goal 3]

## Milestones
1. [ ] Milestone 1
2. [ ] Milestone 2
3. [ ] Milestone 3

## Timeline
| Phase | Start Date | End Date | Status |
|-------|------------|----------|--------|
| Phase 1 | - | - | Not Started |
| Phase 2 | - | - | Not Started |
| Phase 3 | - | - | Not Started |
| Phase 4 | - | - | Not Started |
| Phase 5 | - | - | Not Started |
| Phase 6 | - | - | Not Started |

## Key Deliverables
- [ ] Deliverable 1
- [ ] Deliverable 2

## Risks and Mitigations
| Risk | Impact | Mitigation |
|------|--------|------------|
| - | - | - |

## Notes
[Additional notes]
`,

  "task.md": `---
name: Tasks
description: List of tasks to be completed
---

# Tasks

## Overview
[Overview of the task list]

## Phase 1: Planning
- [ ] Task 1.1
- [ ] Task 1.2

## Phase 2: Design
- [ ] Task 2.1
- [ ] Task 2.2

## Phase 3: Implementation
- [ ] Task 3.1
- [ ] Task 3.2

## Phase 4: Testing
- [ ] Task 4.1
- [ ] Task 4.2

## Phase 5: Deployment
- [ ] Task 5.1
- [ ] Task 5.2

## Phase 6: Maintenance
- [ ] Task 6.1
- [ ] Task 6.2

## Completed Tasks
- [Completed task 1]
- [Completed task 2]

## Notes
[Additional notes]
`,

  "user-stories.md": `---
name: User Stories
description: User stories and acceptance criteria
---

# User Stories

## Epic 1: [Epic Name]
### User Story 1
**As a**: [User type]
**I want**: [Feature]
**So that**: [Benefit]

**Acceptance Criteria**:
- [ ] Criterion 1
- [ ] Criterion 2

**Story Points**: [Number]

### User Story 2
**As a**: [User type]
**I want**: [Feature]
**So that**: [Benefit]

**Acceptance Criteria**:
- [ ] Criterion 1
- [ ] Criterion 2

**Story Points**: [Number]

## Epic 2: [Epic Name]
### User Story 3
**As a**: [User type]
**I want**: [Feature]
**So that**: [Benefit]

**Acceptance Criteria**:
- [ ] Criterion 1
- [ ] Criterion 2

**Story Points**: [Number]

## User Roles
| Role | Description | Primary Goals |
|------|-------------|---------------|
| - | - | - |

## Notes
[Additional notes]
`,

  "context-management.md": `---
name: Context Management
description: Document that captures and maintains project context across phases
---

# Context Management

## Project Overview
[Project name and brief description]

## Key Context Items
1. **Project Goals**: [Description]
2. **Constraints**: [Time, budget, technology constraints]
3. **Stakeholders**: [List of stakeholders]
4. **Technical Stack**: [Technologies being used]
5. **Team Composition**: [Team members and roles]

## Context Boundaries
- **In Scope**: [What's included]
- **Out of Scope**: [What's excluded]

## Decisions Log
| Date | Decision | Rationale | Decision Maker |
|------|----------|-----------|----------------|
| - | - | - | - |

## Important Notes
[Critical information to remember]

## Context Updates Log
| Date | Update | Updated By |
|------|--------|------------|
| - | - | - |

## Notes
[Additional context notes]
`,
}

interface InitArgs {
  force?: boolean
}

export const InitCommand = cmd({
  command: "init",
  describe: "Initialize .pakalon folder structure",
  builder: (yargs) =>
    yargs.option("force", {
      type: "boolean",
      describe: "Overwrite existing files",
      alias: "f",
    }),
  async handler(args: InitArgs) {
    await Instance.provide({
      directory: process.cwd(),
      async fn() {
        const worktree = Instance.worktree
        const baseDir = path.join(worktree, PAKALON_FOLDER)

        UI.println(UI.Style.TEXT_INFO + "Creating .pakalon/ folder structure...")

        // Define the folder structure
        const structure: Record<string, string[]> = {
          agents: ["skills.md"],
          "": ["plan.md", "task.md", "user-stories.md", "context-management.md"],
        }

        // Create folders and files
        let createdCount = 0
        let skippedCount = 0

        for (const [folder, files] of Object.entries(structure)) {
          const folderPath = path.join(baseDir, folder)

          // Create folder if it doesn't exist
          await fs.mkdir(folderPath, { recursive: true })

          // Create files in the folder
          for (const file of files) {
            const filePath = path.join(folderPath, file)

            // Check if file exists
            const exists = await Filesystem.exists(filePath)

            if (exists && !args.force) {
              skippedCount++
              continue
            }

            // Determine the template key
            const templateKey = folder ? `${folder}/${file}` : file

            // Create the file with template content
            if (TEMPLATES[templateKey as keyof typeof TEMPLATES]) {
              await fs.writeFile(filePath, TEMPLATES[templateKey as keyof typeof TEMPLATES], "utf-8")
            } else {
              // For files without templates, create empty content
              await fs.writeFile(filePath, "", "utf-8")
            }

            createdCount++
          }
        }

        UI.empty()
        UI.println(UI.Style.TEXT_SUCCESS + `✓ Created ${createdCount} files/folders`)
        if (skippedCount > 0) {
          UI.println(UI.Style.TEXT_DIM + `  (${skippedCount} files skipped - use --force to overwrite)`)
        }
        UI.empty()
        UI.println("Folder structure created at: " + UI.Style.TEXT_HIGHLIGHT + baseDir)
      },
    })
  },
})
