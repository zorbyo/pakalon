import fs from 'fs'
import path from 'path'
import Link from 'next/link'
import DocsSidebar from '@/components/DocsSidebar'
import MarkdownRenderer from '@/components/MarkdownRenderer'
import DiagramViewer from '@/components/DiagramViewer'

function extractHeadings(md: string) {
  const headingLines = md.split('\n')
  const headings: Array<{ id: string; text: string; level: number }> = []
  const seenIds = new Map<string, number>()

  for (const line of headingLines) {
    if (line.startsWith('#')) {
      const match = line.match(/^(#{1,6})\s+(.*)$/)
      if (match) {
        const level = match[1].length
        const text = match[2].trim()
        let id = text
          .toLowerCase()
          .replace(/[^\w\s-]/g, '')
          .replace(/\s+/g, '-')
        
        const count = seenIds.get(id) || 0
        seenIds.set(id, count + 1)
        if (count > 0) {
          id = `${id}-${count}`
        }
        headings.push({ id, text, level })
      }
    }
  }
  return headings
}

export default async function InitializedPage() {
  const filePath = path.join(process.cwd(), 'public/docs/pakalon-agents.md')
  const content = fs.readFileSync(filePath, 'utf8')
  const headings = extractHeadings(content)

  return (
    <div className="min-h-screen bg-[#0d0e0b] text-white flex flex-col lg:flex-row">
      {/* Navigation Sidebar */}
      <DocsSidebar headings={headings} currentMode="online" />

      {/* Main Documentation Content area */}
      <main className="flex-1 min-w-0 bg-[#0d0e0b] px-4 md:px-8 py-8 lg:py-12 overflow-y-auto max-w-4xl">
        <div className="space-y-8">
          {/* Back button */}
          <div>
            <Link
              href="/docs"
              className="inline-flex items-center gap-2 text-xs text-[#b1b4a2] hover:text-white transition-colors group mb-2"
            >
              <span className="material-symbols-outlined text-sm group-hover:-translate-x-0.5 transition-transform">
                arrow_back
              </span>
              Back to Reference Selector
            </Link>
          </div>

          {/* Top Breadcrumb Navigation */}
          <nav className="flex items-center gap-1.5 text-[11px] font-mono text-[#b1b4a2] uppercase tracking-wider">
            <Link href="/docs" className="hover:text-white transition-colors">Docs</Link>
            <span className="material-symbols-outlined text-xs text-[#b1b4a2]/40">chevron_right</span>
            <span className="text-white">Pakalon Agents (Initialized)</span>
          </nav>

          {/* Section banner */}
          <div className="flex items-center gap-4 bg-primary/5 border border-primary/10 rounded-2xl p-6 relative overflow-hidden">
            {/* Pulsing indicator light */}
            <div className="absolute top-3 right-4 flex items-center gap-1">
              <span className="flex h-2 w-2 rounded-full bg-primary animate-pulse" />
              <span className="text-[9px] font-mono text-primary uppercase tracking-wider">Agents Online</span>
            </div>
            <div className="size-12 rounded-xl bg-primary/10 border border-primary/20 flex items-center justify-center shrink-0">
              <span className="material-symbols-outlined text-primary text-2xl">check_circle</span>
            </div>
            <div>
              <h1 className="text-xl font-bold tracking-tight text-white">Pakalon Agents (Initialized)</h1>
              <p className="text-[#b1b4a2] mt-1 text-xs leading-relaxed font-light">
                Documentation of Pakalon multi-agent swarm architecture, specialized subagents, local tool layer, and persistent Mem0.
              </p>
            </div>
          </div>

          {/* Flowchart diagrams */}
          <DiagramViewer
            overallImage="/flowcharts/overall_structure.png"
            archImage="/flowcharts/Agents_initailised/Architecture_agents_initailised.png"
            structureImage="/flowcharts/Agents_initailised/file_structure_agents_initailsied.png"
            title="Workspace Flowcharts (Agents Initialized)"
            description="Explore the flowcharts detailing overall system configuration, execution flow, and workspace directories when agents are initialized."
          />

          {/* Render Markdown Content */}
          <div className="prose prose-invert max-w-none">
            <MarkdownRenderer content={content} />
          </div>
        </div>
      </main>
    </div>
  )
}
