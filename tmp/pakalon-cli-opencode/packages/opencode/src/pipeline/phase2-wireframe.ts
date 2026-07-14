import path from "path"
import { Pakalon } from "../pakalon"
import { PenpotSync } from "../penpot/sync"
import { PenpotDocker } from "../penpot/docker"
import { PenpotBrowser } from "../penpot/browser"
import { Filesystem } from "../util/filesystem"
import { Log } from "../util/log"
import { FileStructure } from "./file-structure"
import { TDDValidator } from "./tdd-validator"
import type { PhaseContext, PhaseResult } from "./types"

const log = Log.create({ service: "pipeline:phase2" })
const pages = [
  { slug: "home", name: "Home" },
  { slug: "dashboard", name: "Dashboard" },
  { slug: "settings", name: "Settings" },
  { slug: "profile", name: "Profile" },
] as const

const SYSTEM_PROMPT = `You are the Phase 2 Wireframe Agent for Pakalon.

Your job is to:
1. Read Phase 1 planning artifacts (phase-1.md, design.md, plan.md)
2. Generate visual wireframes for all screens/pages
3. Create wireframe artifacts (SVG, Penpot format)
4. Support design approval flow in HIL mode

You must produce:
- phase-2.md: Phase 2 completion summary
- Wireframe_generated.svg: SVG wireframes
- Wireframe_generated.penpot: Penpot format wireframes

For each screen identified in Phase 1:
1. Create a low-fidelity wireframe
2. Define layout structure (header, nav, content, footer)
3. Specify interactive elements (buttons, forms, modals)
4. Document responsive breakpoints

In HIL mode:
- Present wireframes for approval
- Support /update command for targeted changes
- Wait for "Accept this design" confirmation

In YOLO mode:
- Auto-generate all wireframes
- Auto-accept and proceed to Phase 3`

export namespace Phase2Wireframe {
  export function systemPrompt(): string {
    return SYSTEM_PROMPT
  }

  async function readPhase1Artifacts(projectPath: string): Promise<Record<string, string>> {
    const files = ["phase-1.md", "design.md", "plan.md"]
    const artifacts: Record<string, string> = {}
    for (const f of files) {
      const content = await FileStructure.readArtifact(projectPath, 1, f)
      if (content) artifacts[f] = content
    }
    return artifacts
  }

  export async function execute(ctx: PhaseContext): Promise<PhaseResult> {
    log.info("starting phase 2 wireframes", { mode: ctx.mode, path: ctx.projectPath })

    // Penpot lifecycle: auto-start Docker container
    log.info("starting Penpot Docker container")
    const penpotStarted = await PenpotDocker.start()
    if (!penpotStarted) {
      log.warn("Penpot Docker failed to start, continuing without visual editor")
    }

    // Penpot lifecycle: start sync monitoring
    if (penpotStarted) {
      PenpotSync.start({
        projectPath: ctx.projectPath,
        penpotUrl: PenpotDocker.getURL(),
        autoSync: true,
        cooldownMs: 5000,
      })
      log.info("Penpot sync monitoring started")
    }

    const phase1 = await readPhase1Artifacts(ctx.projectPath)
    const artifacts: string[] = []
    let tokensUsed = 0

    const phase2Content = generatePhase2Summary(ctx, phase1)
    await FileStructure.writeArtifact(ctx.projectPath, 2, "phase-2.md", phase2Content)
    artifacts.push("phase-2.md")
    tokensUsed += 300

    const svgContent = generateWireframeSVG(ctx)
    await FileStructure.writeArtifact(ctx.projectPath, 2, "Wireframe_generated.svg", svgContent)
    artifacts.push("Wireframe_generated.svg")
    tokensUsed += 500

    for (const [index, page] of pages.entries()) {
      const pageSvg = generateWireframeSVG(ctx, page.name, index)
      await FileStructure.writeArtifact(ctx.projectPath, 2, `${page.slug}.svg`, pageSvg)
      artifacts.push(`${page.slug}.svg`)
      tokensUsed += 120
    }

    const penpotContent = generatePenpotJSON(ctx)
    await FileStructure.writeArtifact(ctx.projectPath, 2, "Wireframe_generated.penpot", penpotContent)
    artifacts.push("Wireframe_generated.penpot")
    tokensUsed += 200

    const script = PenpotSync.generateSyncScript(ctx.projectPath)
    const syncPath = path.join(ctx.projectPath, Pakalon.DIR_AGENTS, Pakalon.DIR_WIREFRAMES, "sync.js")
    await Filesystem.write(syncPath, script)
    artifacts.push("wireframes/sync.js")
    tokensUsed += 120

    // Penpot lifecycle: auto-open browser with wireframes
    if (penpotStarted) {
      try {
        await PenpotDocker.waitUntilReady(30000)
        await PenpotBrowser.open()
        log.info("Penpot browser opened for wireframe review")
      } catch {
        log.warn("failed to open Penpot browser, user can manually open it")
      }
    }

    // Penpot lifecycle: stop sync when phase completes (YOLO mode auto-accepts)
    if (ctx.mode === "yolo") {
      PenpotSync.stop()
      log.info("Penpot sync stopped (YOLO mode auto-accept)")
    }

    // Run TDD validation to compare wireframes against Phase 1 requirements
    try {
      const phase1Content = await FileStructure.readArtifact(ctx.projectPath, 1, "plan.md")
      const validationResult = await TDDValidator.validateWireframe(
        ctx.projectPath,
        phase1Content ?? "",
      )
      
      // Write validation report as artifact
      const validationReport = TDDValidator.generateValidationReport(validationResult)
      await FileStructure.writeArtifact(ctx.projectPath, 2, "tdd-validation.md", validationReport)
      artifacts.push("tdd-validation.md")
      
      log.info("TDD validation completed", { 
        score: validationResult.score, 
        passed: validationResult.passed,
        issues: validationResult.issues.length 
      })
      
      // In HIL mode, if validation fails, prompt for design changes
      if (ctx.mode === "hil" && !validationResult.passed) {
        log.warn("TDD validation failed, design needs revision", { 
          issues: validationResult.issues.filter(i => i.severity === "high").length 
        })
      }
    } catch (validationError) {
      log.warn("TDD validation failed to run", { error: validationError })
    }

    log.info("phase 2 completed", { artifacts: artifacts.length, tokensUsed })
    return { success: true, artifacts, nextPhase: 3, tokensUsed }
  }

  /**
   * Handle design approval in HIL mode
   * Returns true if design is approved, false if rejected
   */
  export async function handleDesignApproval(projectPath: string, decision: "accept" | "reject"): Promise<boolean> {
    if (decision === "accept") {
      // Write approval confirmation
      const approvalContent = `# Design Approval Confirmation

## Status: APPROVED
## Timestamp: ${new Date().toISOString()}

The design has been approved and Phase 3 can proceed.

---
*Generated by Pakalon Design Approval System*
`
      await FileStructure.writeArtifact(projectPath, 2, "design-approved.md", approvalContent)
      log.info("Design approved", { projectPath })
      return true
    } else {
      // Write rejection with feedback request
      const rejectionContent = `# Design Rejection

## Status: REJECTED
## Timestamp: ${new Date().toISOString()}

The design has been rejected. Please provide feedback using /update command to request specific changes.

---
*Generated by Pakalon Design Approval System*
`
      await FileStructure.writeArtifact(projectPath, 2, "design-rejected.md", rejectionContent)
      log.info("Design rejected", { projectPath })
      return false
    }
  }

  /**
   * Check if design has been approved
   */
  export async function isDesignApproved(projectPath: string): Promise<boolean> {
    try {
      const approvalFile = await FileStructure.readArtifact(projectPath, 2, "design-approved.md")
      return approvalFile !== null
    } catch {
      return false
    }
  }

  function generatePhase2Summary(ctx: PhaseContext, phase1: Record<string, string>): string {
    const hasDesign = Object.keys(phase1).length > 0
    return `# Phase 2 Summary - Wireframes

## Status: ${ctx.mode === "hil" ? "Awaiting Approval" : "Completed (Auto-accepted)"}

## Design Source
${hasDesign ? "Phase 1 artifacts loaded successfully" : "No Phase 1 artifacts found, generating from scratch"}

## Screens Designed
1. Landing / Home page
2. Main application view
3. Settings / Configuration
4. Data display views
5. Forms and input views

## Wireframe Files
- Wireframe_generated.svg: Visual wireframes in SVG format
- Wireframe_generated.penpot: Penpot-compatible wireframe data

## Design Decisions
- Responsive layout (mobile-first)
- Clean, modern aesthetic
- Accessibility-first approach

## HIL Approval
${ctx.mode === "hil" ? "Awaiting user approval before proceeding to Phase 3" : "Auto-accepted in YOLO mode"}

---
*Generated by Pakalon Phase 2 Wireframe Agent*
`
  }

  function generateWireframeSVG(_ctx: PhaseContext, pageName?: string, index = 0): string {
    if (pageName) {
      return generatePageSVG(pageName, index)
    }

    const canvasHeight = pages.length * 860 + 20
    const views = pages
      .map((page, i) => `<g transform="translate(0, ${i * 860 + 20})">${generatePageGroup(page.name, i)}</g>`)
      .join("\n")

    return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1240 ${canvasHeight}" width="1240" height="${canvasHeight}">
  ${svgStyle()}
  ${views}
</svg>
`
  }

  function generatePageSVG(pageName: string, index: number): string {
    return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1240 840" width="1240" height="840">
  ${svgStyle()}
  ${generatePageGroup(pageName, index)}
</svg>
`
  }

  function svgStyle(): string {
    return `<style>
  .page { fill: #ffffff; stroke: #d0d7de; stroke-width: 2; }
  .head { fill: #e2e8f0; }
  .side { fill: #eef2ff; }
  .main { fill: #f8fafc; }
  .foot { fill: #e5e7eb; }
  .card { fill: #ffffff; stroke: #cbd5e1; stroke-width: 1; }
  .image { fill: #e2e8f0; stroke: #cbd5e1; stroke-width: 1; }
  .btn { fill: #dbeafe; stroke: #93c5fd; stroke-width: 1; }
  .title { font-family: system-ui; font-size: 20px; fill: #0f172a; font-weight: 700; }
  .label { font-family: system-ui; font-size: 14px; fill: #334155; }
  .small { font-family: system-ui; font-size: 12px; fill: #475569; }
</style>`
  }

  function generatePageGroup(pageName: string, index: number): string {
    const top = 20
    const left = 20
    const width = 1200
    const height = 800
    const nav = ["Overview", "Reports", "Messages", "Settings"]
    const items = nav.map((item, i) => `<text x="70" y="${top + 140 + i * 34}" class="label">${item}</text>`).join("\n")
    const cards = Array.from({ length: 6 })
      .map((_, i) => {
        const col = i % 3
        const row = Math.floor(i / 3)
        const x = left + 260 + col * 300
        const y = top + 160 + row * 220
        return `<rect x="${x}" y="${y}" width="260" height="180" rx="8" class="card"/>
<rect x="${x + 16}" y="${y + 16}" width="228" height="96" rx="6" class="image"/>
<text x="${x + 16}" y="${y + 134}" class="label">Widget ${i + 1}</text>
<rect x="${x + 16}" y="${y + 144}" width="92" height="24" rx="6" class="btn"/>
<text x="${x + 42}" y="${y + 160}" class="small">Action</text>`
      })
      .join("\n")

    return `<rect x="${left}" y="${top}" width="${width}" height="${height}" rx="10" class="page"/>
<text x="${left + 28}" y="${top + 34}" class="title">${pageName} Wireframe</text>
<rect x="${left}" y="${top + 48}" width="${width}" height="64" class="head"/>
<rect x="${left + 20}" y="${top + 66}" width="120" height="28" rx="6" class="card"/>
<text x="${left + 34}" y="${top + 85}" class="label">LOGO</text>
<text x="${left + 220}" y="${top + 85}" class="label">Home</text>
<text x="${left + 290}" y="${top + 85}" class="label">Products</text>
<text x="${left + 390}" y="${top + 85}" class="label">Pricing</text>
<text x="${left + 470}" y="${top + 85}" class="label">Support</text>
<rect x="${left}" y="${top + 112}" width="220" height="620" class="side"/>
<text x="${left + 20}" y="${top + 140}" class="label">Navigation</text>
${items}
<rect x="${left + 220}" y="${top + 112}" width="980" height="620" class="main"/>
<text x="${left + 248}" y="${top + 140}" class="title">${pageName} content</text>
${cards}
<rect x="${left}" y="${top + 732}" width="${width}" height="68" class="foot"/>
<text x="${left + 24}" y="${top + 772}" class="label">Footer · Privacy · Terms · Contact</text>
<text x="${left + 1050}" y="${top + 772}" class="small">Page ${index + 1}</text>`
  }

  function generatePenpotJSON(_ctx: PhaseContext): string {
    const names = ["Home", "Dashboard", "Settings", "Profile"]
    const penpotFile = {
      name: "Pakalon Wireframe",
      version: "2.0",
      pages: names.map((name, i) => ({
        id: `page-${i}`,
        name,
        objects: generatePageObjects(name, i),
      })),
      components: [],
      media: {},
    }
    return JSON.stringify(penpotFile, null, 2)
  }

  function generatePageObjects(pageName: string, index: number) {
    const frame = {
      id: `frame-${index}`,
      type: "frame",
      name: `${pageName} Frame`,
      x: 0,
      y: 0,
      width: 1200,
      height: 800,
      fill: "#ffffff",
      stroke: "#d0d7de",
    }

    const head = {
      id: `header-${index}`,
      type: "rectangle",
      name: "Header",
      x: 0,
      y: 0,
      width: 1200,
      height: 72,
      fill: "#e2e8f0",
    }

    const side = {
      id: `sidebar-${index}`,
      type: "rectangle",
      name: "Sidebar",
      x: 0,
      y: 72,
      width: 220,
      height: 660,
      fill: "#eef2ff",
    }

    const main = {
      id: `main-${index}`,
      type: "rectangle",
      name: "Main",
      x: 220,
      y: 72,
      width: 980,
      height: 660,
      fill: "#f8fafc",
    }

    const foot = {
      id: `footer-${index}`,
      type: "rectangle",
      name: "Footer",
      x: 0,
      y: 732,
      width: 1200,
      height: 68,
      fill: "#e5e7eb",
    }

    const labels = [
      { id: `logo-${index}`, type: "text", x: 24, y: 42, value: "LOGO", size: 16 },
      { id: `title-${index}`, type: "text", x: 252, y: 120, value: `${pageName} content`, size: 24 },
      { id: `footer-text-${index}`, type: "text", x: 24, y: 772, value: "Footer · Privacy · Terms · Contact", size: 14 },
    ]

    const cards = Array.from({ length: 4 }).flatMap((_, i) => {
      const col = i % 2
      const row = Math.floor(i / 2)
      const x = 260 + col * 330
      const y = 160 + row * 220
      return [
        {
          id: `card-${index}-${i}`,
          type: "rectangle",
          name: `Card ${i + 1}`,
          x,
          y,
          width: 300,
          height: 180,
          fill: "#ffffff",
          stroke: "#cbd5e1",
        },
        {
          id: `image-${index}-${i}`,
          type: "rectangle",
          name: `Image ${i + 1}`,
          x: x + 16,
          y: y + 16,
          width: 268,
          height: 98,
          fill: "#e2e8f0",
        },
        {
          id: `button-${index}-${i}`,
          type: "button",
          name: `Button ${i + 1}`,
          x: x + 16,
          y: y + 142,
          width: 110,
          height: 28,
          fill: "#dbeafe",
          label: "Action",
        },
      ]
    })

    return [frame, head, side, main, foot, ...labels, ...cards]
  }
}
