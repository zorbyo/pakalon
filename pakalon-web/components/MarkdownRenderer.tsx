'use client'

import React, { useState } from 'react'
import InteractiveDiagram from './InteractiveDiagram'

interface MarkdownRendererProps {
  content: string
}

type Block =
  | { type: 'heading'; level: number; text: string; id: string }
  | { type: 'paragraph'; text: string }
  | { type: 'list'; ordered: boolean; items: string[] }
  | { type: 'code'; language: string; code: string }
  | { type: 'blockquote'; alertType: string; lines: string[] }
  | { type: 'table'; headers: string[]; rows: string[][] }
  | { type: 'horizontal-rule' }

export default function MarkdownRenderer({ content }: MarkdownRendererProps) {
  // Parse markdown into blocks
  const blocks = parseMarkdown(content)

  return (
    <div className="space-y-6 text-[#b1b4a2] leading-relaxed text-base max-w-none">
      {blocks.map((block, idx) => {
        switch (block.type) {
          case 'heading': {
            const Tag = `h${Math.min(block.level, 6)}` as 'h1' | 'h2' | 'h3' | 'h4' | 'h5' | 'h6'
            const baseClass =
              block.level === 1
                ? 'text-3xl font-extrabold text-white mt-12 mb-6 border-b border-white/10 pb-4 tracking-tight'
                : block.level === 2
                ? 'text-2xl font-bold text-white mt-10 mb-4 border-b border-white/5 pb-2 tracking-tight flex items-center group scroll-mt-20'
                : 'text-xl font-bold text-white mt-8 mb-3 flex items-center group scroll-mt-20'

            return (
              <Tag key={idx} id={block.id} className={baseClass}>
                {block.level > 1 && (
                  <a
                    href={`#${block.id}`}
                    className="mr-2 text-primary opacity-0 group-hover:opacity-100 transition-opacity font-mono font-light text-sm"
                    aria-hidden="true"
                  >
                    #
                  </a>
                )}
                {renderInline(block.text)}
              </Tag>
            )
          }

          case 'paragraph':
            // Check if it is a simple separator or empty
            if (!block.text.trim()) return null
            return (
              <p key={idx} className="my-4 font-light text-[15px] leading-relaxed text-[#c4c7b8]">
                {renderInline(block.text)}
              </p>
            )

          case 'list': {
            const ListTag = block.ordered ? 'ol' : 'ul'
            const listClass = block.ordered
              ? 'list-decimal list-inside space-y-2 my-4 pl-4 font-light text-[15px]'
              : 'list-disc list-inside space-y-2 my-4 pl-4 font-light text-[15px]'
            return (
              <ListTag key={idx} className={listClass}>
                {block.items.map((item, itemIdx) => (
                  <li key={itemIdx} className="text-[#c4c7b8] marker:text-primary">
                    <span className="pl-1.5">{renderInline(item)}</span>
                  </li>
                ))}
              </ListTag>
            )
          }

          case 'code':
            return <CodeBlockBlock key={idx} block={block} />

          case 'blockquote': {
            const alertThemes: Record<string, { border: string; bg: string; text: string; icon: string; title: string }> = {
              NOTE: {
                border: 'border-l-4 border-primary',
                bg: 'bg-primary/5',
                text: 'text-[#c4c7b8]',
                icon: 'info',
                title: 'Note',
              },
              TIP: {
                border: 'border-l-4 border-emerald-500',
                bg: 'bg-emerald-500/5',
                text: 'text-[#c4c7b8]',
                icon: 'lightbulb',
                title: 'Tip',
              },
              IMPORTANT: {
                border: 'border-l-4 border-cyan-500',
                bg: 'bg-cyan-500/5',
                text: 'text-[#c4c7b8]',
                icon: 'priority_high',
                title: 'Important',
              },
              WARNING: {
                border: 'border-l-4 border-amber-500',
                bg: 'bg-amber-500/5',
                text: 'text-[#c4c7b8]',
                icon: 'warning',
                title: 'Warning',
              },
              CAUTION: {
                border: 'border-l-4 border-rose-500',
                bg: 'bg-rose-500/5',
                text: 'text-[#c4c7b8]',
                icon: 'dangerous',
                title: 'Caution',
              },
              DEFAULT: {
                border: 'border-l-4 border-border-dark',
                bg: 'bg-[#1b1c16]',
                text: 'text-[#b1b4a2] italic',
                icon: 'format_quote',
                title: '',
              },
            }

            const theme = alertThemes[block.alertType] || alertThemes.DEFAULT
            return (
              <div key={idx} className={`p-4 my-6 rounded-r-xl ${theme.border} ${theme.bg} text-[14px]`}>
                {theme.title && (
                  <div className="flex items-center gap-2 mb-1.5 font-bold tracking-wide uppercase text-xs text-white">
                    <span className="material-symbols-outlined text-sm text-primary">{theme.icon}</span>
                    {theme.title}
                  </div>
                )}
                <div className={`space-y-1.5 ${theme.text}`}>
                  {block.lines.map((line, lineIdx) => (
                    <p key={lineIdx}>{renderInline(line)}</p>
                  ))}
                </div>
              </div>
            )
          }

          case 'table':
            return (
              <div key={idx} className="overflow-x-auto my-6 border border-border-dark rounded-xl bg-[#1b1c16]/30 backdrop-blur-sm">
                <table className="w-full text-left border-collapse text-xs">
                  <thead>
                    <tr className="border-b border-border-dark bg-[#1b1c16]/70">
                      {block.headers.map((h, hIdx) => (
                        <th key={hIdx} className="p-3.5 font-semibold text-white tracking-wide uppercase text-[11px] border-r border-border-dark last:border-r-0">
                          {renderInline(h)}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border-dark">
                    {block.rows.map((row, rIdx) => (
                      <tr key={rIdx} className="hover:bg-white/2 transition-colors">
                        {row.map((cell, cIdx) => (
                          <td key={cIdx} className="p-3.5 font-light border-r border-border-dark last:border-r-0 text-[#c4c7b8]">
                            {renderInline(cell)}
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )

          case 'horizontal-rule':
            return <hr key={idx} className="my-8 border-t border-border-dark" />

          default:
            return null
        }
      })}
    </div>
  )
}

// Separate component for copy and line numbers state
function CodeBlockBlock({ block }: { block: { language: string; code: string } }) {
  const [copied, setCopied] = useState(false)

  // ASCII-art pattern matcher to render interactive diagrams instead of raw ascii
  const isAsciiDiagram = (code: string): 'core-arch' | 'agent-arch' | 'pipeline' | 'security-loop' | null => {
    if (code.includes('pakalon-web') && code.includes('pakalon-backend') && code.includes('Python Bridge')) {
      return 'core-arch'
    }
    if (code.includes('Orchestrator') && code.includes('Main Agent (TUI)') && code.includes('Agent Tool Layer')) {
      return 'agent-arch'
    }
    if (code.includes('Phase 1') && code.includes('Phase 2') && code.includes('Phase 3') && code.includes('Phase 6')) {
      return 'pipeline'
    }
    if (code.includes('Phase 3 (Frontend)') && code.includes('Phase 4 (Security QA)') && code.includes('Security Issues Found')) {
      return 'security-loop'
    }
    return null
  }

  const diagramType = isAsciiDiagram(block.code)
  if (diagramType) {
    return <InteractiveDiagram type={diagramType} />
  }

  const handleCopy = () => {
    navigator.clipboard.writeText(block.code)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  const lines = block.code.trim().split('\n')

  return (
    <div className="my-6 border border-border-dark rounded-xl bg-black overflow-hidden relative group text-[13px] font-mono">
      {/* Code header bar */}
      <div className="flex items-center justify-between px-4 py-2 border-b border-border-dark bg-[#11120d]">
        <div className="flex items-center gap-2">
          <div className="flex gap-1.5">
            <div className="size-2.5 rounded-full bg-red-500/40" />
            <div className="size-2.5 rounded-full bg-yellow-500/40" />
            <div className="size-2.5 rounded-full bg-green-500/40" />
          </div>
          <span className="text-[10px] text-[#b1b4a2] uppercase tracking-wider pl-2">{block.language || 'code'}</span>
        </div>

        <button
          onClick={handleCopy}
          className="text-xs text-[#b1b4a2] hover:text-white flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity bg-surface-dark px-2 py-0.5 rounded border border-border-dark"
        >
          <span className="material-symbols-outlined text-xs">
            {copied ? 'check' : 'content_copy'}
          </span>
          {copied ? 'Copied' : 'Copy'}
        </button>
      </div>

      {/* Code contents viewport */}
      <div className="overflow-x-auto p-4 flex gap-4 max-h-[480px]">
        {/* Line Numbers */}
        <div className="text-right text-[#b1b4a2]/30 select-none hidden md:block">
          {lines.map((_, i) => (
            <div key={i}>{i + 1}</div>
          ))}
        </div>
        {/* Preformatted code */}
        <pre className="flex-1 text-[#e1e2d6] whitespace-pre select-text">
          <code>{block.code}</code>
        </pre>
      </div>
    </div>
  )
}

function parseMarkdown(md: string): Block[] {
  const lines = md.split('\n')
  const blocks: Block[] = []
  const seenIds = new Map<string, number>()
  let i = 0

  while (i < lines.length) {
    const line = lines[i]

    // Empty line check
    if (!line.trim()) {
      blocks.push({ type: 'paragraph', text: '' })
      i++
      continue
    }

    // Horizontal rule check
    if (line.trim() === '---' || line.trim() === '***' || line.trim() === '___') {
      blocks.push({ type: 'horizontal-rule' })
      i++
      continue
    }

    // Code block parsing
    if (line.trim().startsWith('```')) {
      const language = line.trim().slice(3).trim()
      let codeLines: string[] = []
      i++
      while (i < lines.length && !lines[i].trim().startsWith('```')) {
        codeLines.push(lines[i])
        i++
      }
      i++ // Skip ending ```
      blocks.push({ type: 'code', language, code: codeLines.join('\n') })
      continue
    }

    // Heading parsing
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
        blocks.push({ type: 'heading', level, text, id })
        i++
        continue
      }
    }

    // Blockquote & Github-style alert parsing
    if (line.startsWith('>')) {
      let blockquoteLines: string[] = []
      let alertType = ''

      // Parse the first line for github style alerts like > [!NOTE]
      const firstLineContent = line.slice(1).trim()
      const alertMatch = firstLineContent.match(/^\[!(NOTE|TIP|IMPORTANT|WARNING|CAUTION)\]$/i)
      if (alertMatch) {
        alertType = alertMatch[1].toUpperCase()
      } else {
        blockquoteLines.push(firstLineContent)
      }

      i++
      while (i < lines.length && lines[i].startsWith('>')) {
        blockquoteLines.push(lines[i].slice(1).trim())
        i++
      }

      blocks.push({ type: 'blockquote', alertType, lines: blockquoteLines })
      continue
    }

    // Table parsing
    if (line.trim().startsWith('|')) {
      const parseRow = (rowStr: string) => {
        return rowStr
          .split('|')
          .slice(1, -1)
          .map((cell) => cell.trim())
      }

      const headers = parseRow(line)
      i++

      // Read spacer row (e.g. |---|---|)
      if (i < lines.length && lines[i].trim().startsWith('|') && lines[i].includes('-')) {
        i++
      }

      const rows: string[][] = []
      while (i < lines.length && lines[i].trim().startsWith('|')) {
        rows.push(parseRow(lines[i]))
        i++
      }

      blocks.push({ type: 'table', headers, rows })
      continue
    }

    // Unordered List parsing
    if (line.trim().startsWith('- ') || line.trim().startsWith('* ')) {
      const items: string[] = []
      while (i < lines.length && (lines[i].trim().startsWith('- ') || lines[i].trim().startsWith('* '))) {
        items.push(lines[i].trim().slice(2))
        i++
      }
      blocks.push({ type: 'list', ordered: false, items })
      continue
    }

    // Ordered List parsing
    if (/^\d+\.\s+/.test(line.trim())) {
      const items: string[] = []
      while (i < lines.length && /^\d+\.\s+/.test(lines[i].trim())) {
        const match = lines[i].trim().match(/^\d+\.\s+(.*)$/)
        if (match) items.push(match[1])
        i++
      }
      blocks.push({ type: 'list', ordered: true, items })
      continue
    }

    // Paragraph parsing
    blocks.push({ type: 'paragraph', text: line })
    i++
  }

  return blocks
}

// Inline formatting parser to return React elements recursively
function renderInline(text: string): React.ReactNode {
  if (!text) return ''

  // Process links: [label](href)
  const linkRegex = /\[([^\]]+)\]\(([^)]+)\)/
  const linkMatch = text.match(linkRegex)
  if (linkMatch && linkMatch.index !== undefined) {
    const before = text.slice(0, linkMatch.index)
    const label = linkMatch[1]
    const href = linkMatch[2]
    const after = text.slice(linkMatch.index + linkMatch[0].length)

    // Check if the link starts with # (anchor link)
    const isAnchor = href.startsWith('#')
    return (
      <>
        {renderInline(before)}
        <a
          href={href}
          className="text-primary hover:text-primary-hover hover:underline transition-colors font-medium decoration-primary/40 underline-offset-4"
          {...(!isAnchor ? { target: '_blank', rel: 'noopener noreferrer' } : {})}
        >
          {label}
        </a>
        {renderInline(after)}
      </>
    )
  }

  // Process bold: **text**
  const boldRegex = /\*\*([^*]+)\*\*/
  const boldMatch = text.match(boldRegex)
  if (boldMatch && boldMatch.index !== undefined) {
    const before = text.slice(0, boldMatch.index)
    const inner = boldMatch[1]
    const after = text.slice(boldMatch.index + boldMatch[0].length)

    return (
      <>
        {renderInline(before)}
        <strong className="font-semibold text-white">{inner}</strong>
        {renderInline(after)}
      </>
    )
  }

  // Process italic: *text*
  const italicRegex = /\*([^*]+)\*/
  const italicMatch = text.match(italicRegex)
  if (italicMatch && italicMatch.index !== undefined) {
    const before = text.slice(0, italicMatch.index)
    const inner = italicMatch[1]
    const after = text.slice(italicMatch.index + italicMatch[0].length)

    return (
      <>
        {renderInline(before)}
        <em className="italic text-white/90">{inner}</em>
        {renderInline(after)}
      </>
    )
  }

  // Process inline code: `code`
  const codeRegex = /`([^`]+)`/
  const codeMatch = text.match(codeRegex)
  if (codeMatch && codeMatch.index !== undefined) {
    const before = text.slice(0, codeMatch.index)
    const inner = codeMatch[1]
    const after = text.slice(codeMatch.index + codeMatch[0].length)

    return (
      <>
        {renderInline(before)}
        <code className="px-1.5 py-0.5 rounded bg-primary/10 border border-primary/20 text-primary text-[13px] font-mono whitespace-nowrap">
          {inner}
        </code>
        {renderInline(after)}
      </>
    )
  }

  return text
}
