'use client'

import React, { useState } from 'react'
import Image from 'next/image'

interface DiagramViewerProps {
  overallImage: string
  archImage: string
  structureImage: string
  title: string
  description: string
}

export default function DiagramViewer({
  overallImage,
  archImage,
  structureImage,
  title,
  description
}: DiagramViewerProps) {
  const [activeTab, setActiveTab] = useState<'overall' | 'arch' | 'structure'>('overall')
  const [isZoomed, setIsZoomed] = useState(false)

  const tabs = [
    { id: 'overall', label: 'Overall Structure', path: overallImage },
    { id: 'arch', label: 'System Architecture', path: archImage },
    { id: 'structure', label: 'File Structure', path: structureImage },
  ] as const

  const currentTab = tabs.find((t) => t.id === activeTab) || tabs[0]

  return (
    <div className="bg-[#1d1e18]/40 border border-border-dark rounded-2xl p-6 space-y-6 relative overflow-hidden">
      {/* Header */}
      <div className="space-y-1">
        <h3 className="text-lg font-bold text-white tracking-tight flex items-center gap-2">
          <span className="material-symbols-outlined text-primary text-xl">schema</span>
          {title}
        </h3>
        <p className="text-xs text-[#b1b4a2] leading-relaxed font-light">{description}</p>
      </div>

      {/* Tabs Switcher */}
      <div className="bg-[#11120d] border border-border-dark p-1 rounded-xl flex items-center gap-1 w-fit max-w-full overflow-x-auto scrollbar-none">
        {tabs.map((tab) => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id)}
            className={`py-1.5 px-3.5 rounded-lg text-[11px] font-mono whitespace-nowrap transition-all ${
              activeTab === tab.id
                ? 'bg-primary text-background-dark font-semibold shadow-sm'
                : 'text-[#b1b4a2] hover:text-white'
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* Image Preview Container */}
      <div className="relative group border border-border-dark bg-[#11120d] rounded-xl overflow-hidden min-h-[300px] md:min-h-[400px] flex items-center justify-center p-4 transition-all hover:border-white/10">
        {/* Background grid pattern */}
        <div className="absolute inset-0 bg-[linear-gradient(to_right,#34362b_1px,transparent_1px),linear-gradient(to_bottom,#34362b_1px,transparent_1px)] bg-[size:24px_24px] opacity-10 pointer-events-none" />

        <div className="relative w-full h-[280px] md:h-[360px] flex items-center justify-center">
          <img
            src={currentTab.path}
            alt={currentTab.label}
            className="max-w-full max-h-full object-contain rounded-lg transition-transform duration-300 group-hover:scale-[1.01]"
          />
        </div>

        {/* Action Overlay */}
        <div className="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 transition-opacity duration-300 flex items-center justify-center pointer-events-none">
          <button
            onClick={() => setIsZoomed(true)}
            className="pointer-events-auto px-4 py-2 bg-primary text-background-dark font-bold text-xs rounded-xl flex items-center gap-1.5 shadow-lg transform translate-y-2 group-hover:translate-y-0 transition-all duration-300 hover:brightness-110"
          >
            <span className="material-symbols-outlined text-sm font-bold">zoom_in</span>
            Zoom Diagram
          </button>
        </div>
      </div>

      {/* Full-Screen Zoom Modal */}
      {isZoomed && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/95 backdrop-blur-md p-4">
          {/* Close trigger boundary */}
          <div className="absolute inset-0" onClick={() => setIsZoomed(false)} />

          <div className="relative z-10 max-w-7xl max-h-[90vh] w-full flex flex-col gap-4">
            <div className="flex items-center justify-between text-white border-b border-white/10 pb-3">
              <div>
                <h4 className="font-bold tracking-tight text-sm">{currentTab.label}</h4>
                <p className="text-[10px] text-[#b1b4a2] font-mono mt-0.5">{currentTab.path}</p>
              </div>
              <button
                onClick={() => setIsZoomed(false)}
                className="p-1.5 rounded-lg border border-white/10 hover:border-white bg-white/5 hover:bg-white/10 text-white transition-all flex items-center"
                aria-label="Close zoomed view"
              >
                <span className="material-symbols-outlined text-lg">close</span>
              </button>
            </div>

            <div className="flex-1 flex items-center justify-center overflow-auto min-h-0">
              <img
                src={currentTab.path}
                alt={currentTab.label}
                className="max-w-full max-h-[75vh] object-contain rounded-lg"
              />
            </div>

            <div className="text-center text-[10px] text-[#b1b4a2]/60 font-light italic">
              Click anywhere outside or use the close button to return to the docs page
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
