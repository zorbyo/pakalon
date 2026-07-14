import { Log } from "../util/log"

const log = Log.create({ service: "pipeline:component-scraper" })

export interface ComponentMatch {
  name: string
  source: string
  url: string
  code: string
  description: string
  dependencies: string[]
}

export interface ComponentRegistry {
  description: string
  code: string
  dependencies: string[]
  category: string
}

const COMPONENT_SOURCES = [
  "https://lightswind.com/components",
  "https://reactbits.dev/",
  "https://daisyui.com/",
  "https://preline.co/index.html",
  "https://tailwindflex.com/",
  "https://dribbble.com/",
  "https://magicui.design/",
  "https://spline.design/",
  "https://shadcnstudio.com/",
  "https://tweakcn.com/",
]

// Registry of known high-quality components
const COMPONENT_REGISTRY: Record<string, ComponentRegistry> = {
  "hero-section": {
    description: "A responsive hero section with CTA buttons",
    code: `export function HeroSection() {
  return (
    <section className="py-20 px-4 text-center">
      <h1 className="text-4xl md:text-6xl font-bold mb-6">
        Welcome to Our Platform
      </h1>
      <p className="text-xl text-gray-600 mb-8 max-w-2xl mx-auto">
        Build amazing applications with modern tools and technologies.
      </p>
      <div className="flex gap-4 justify-center">
        <button className="bg-blue-600 text-white px-8 py-3 rounded-lg hover:bg-blue-700">
          Get Started
        </button>
        <button className="border border-gray-300 px-8 py-3 rounded-lg hover:bg-gray-50">
          Learn More
        </button>
      </div>
    </section>
  )
}`,
    dependencies: ["react", "tailwindcss"],
    category: "sections",
  },
  "navbar": {
    description: "Responsive navigation bar with mobile menu",
    code: `import { useState } from 'react'

export function Navbar() {
  const [isOpen, setIsOpen] = useState(false)

  return (
    <nav className="bg-white shadow-sm">
      <div className="max-w-7xl mx-auto px-4">
        <div className="flex justify-between h-16">
          <div className="flex items-center">
            <span className="text-xl font-bold">Logo</span>
          </div>
          
          {/* Desktop menu */}
          <div className="hidden md:flex items-center space-x-8">
            <a href="#" className="text-gray-700 hover:text-gray-900">Home</a>
            <a href="#" className="text-gray-700 hover:text-gray-900">Features</a>
            <a href="#" className="text-gray-700 hover:text-gray-900">Pricing</a>
            <button className="bg-blue-600 text-white px-4 py-2 rounded-lg">
              Sign Up
            </button>
          </div>

          {/* Mobile menu button */}
          <div className="md:hidden flex items-center">
            <button onClick={() => setIsOpen(!isOpen)}>
              {isOpen ? '✕' : '☰'}
            </button>
          </div>
        </div>

        {/* Mobile menu */}
        {isOpen && (
          <div className="md:hidden pb-4">
            <a href="#" className="block py-2 text-gray-700">Home</a>
            <a href="#" className="block py-2 text-gray-700">Features</a>
            <a href="#" className="block py-2 text-gray-700">Pricing</a>
          </div>
        )}
      </div>
    </nav>
  )
}`,
    dependencies: ["react", "tailwindcss"],
    category: "navigation",
  },
  "card": {
    description: "Reusable card component with image support",
    code: `interface CardProps {
  title: string
  description?: string
  image?: string
  actions?: React.ReactNode
}

export function Card({ title, description, image, actions }: CardProps) {
  return (
    <div className="bg-white rounded-xl shadow-md overflow-hidden">
      {image && (
        <img 
          src={image} 
          alt={title}
          className="w-full h-48 object-cover"
        />
      )}
      <div className="p-6">
        <h3 className="text-xl font-semibold mb-2">{title}</h3>
        {description && (
          <p className="text-gray-600 mb-4">{description}</p>
        )}
        {actions && <div className="flex gap-2">{actions}</div>}
      </div>
    </div>
  )
}`,
    dependencies: ["react", "tailwindcss"],
    category: "ui",
  },
  "modal": {
    description: "Accessible modal dialog component",
    code: `import { useEffect, useRef } from 'react'

interface ModalProps {
  isOpen: boolean
  onClose: () => void
  title: string
  children: React.ReactNode
}

export function Modal({ isOpen, onClose, title, children }: ModalProps) {
  const dialogRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (isOpen) {
      dialogRef.current?.focus()
      document.body.style.overflow = 'hidden'
    } else {
      document.body.style.overflow = ''
    }
    return () => { document.body.style.overflow = '' }
  }, [isOpen])

  if (!isOpen) return null

  return (
    <div 
      className="fixed inset-0 bg-black/50 flex items-center justify-center z-50"
      onClick={onClose}
    >
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="modal-title"
        className="bg-white rounded-xl p-6 max-w-md w-full mx-4 shadow-xl"
        onClick={(e) => e.stopPropagation()}
        tabIndex={-1}
      >
        <div className="flex justify-between items-center mb-4">
          <h2 id="modal-title" className="text-xl font-semibold">{title}</h2>
          <button 
            onClick={onClose}
            className="text-gray-500 hover:text-gray-700"
            aria-label="Close"
          >
            ✕
          </button>
        </div>
        {children}
      </div>
    </div>
  )
}`,
    dependencies: ["react", "tailwindcss"],
    category: "ui",
  },
  "footer": {
    description: "Responsive footer with links and social icons",
    code: `export function Footer() {
  return (
    <footer className="bg-gray-900 text-gray-300 py-12">
      <div className="max-w-7xl mx-auto px-4">
        <div className="grid grid-cols-2 md:grid-cols-4 gap-8">
          <div>
            <h3 className="text-white font-semibold mb-4">Product</h3>
            <ul className="space-y-2">
              <li><a href="#" className="hover:text-white">Features</a></li>
              <li><a href="#" className="hover:text-white">Pricing</a></li>
              <li><a href="#" className="hover:text-white">Documentation</a></li>
            </ul>
          </div>
          <div>
            <h3 className="text-white font-semibold mb-4">Company</h3>
            <ul className="space-y-2">
              <li><a href="#" className="hover:text-white">About</a></li>
              <li><a href="#" className="hover:text-white">Blog</a></li>
              <li><a href="#" className="hover:text-white">Careers</a></li>
            </ul>
          </div>
          <div>
            <h3 className="text-white font-semibold mb-4">Support</h3>
            <ul className="space-y-2">
              <li><a href="#" className="hover:text-white">Help Center</a></li>
              <li><a href="#" className="hover:text-white">Contact</a></li>
              <li><a href="#" className="hover:text-white">Status</a></li>
            </ul>
          </div>
          <div>
            <h3 className="text-white font-semibold mb-4">Legal</h3>
            <ul className="space-y-2">
              <li><a href="#" className="hover:text-white">Privacy</a></li>
              <li><a href="#" className="hover:text-white">Terms</a></li>
            </ul>
          </div>
        </div>
        <div className="border-t border-gray-800 mt-8 pt-8 text-center">
          <p>&copy; {new Date().getFullYear()} Your Company. All rights reserved.</p>
        </div>
      </div>
    </footer>
  )
}`,
    dependencies: ["react", "tailwindcss"],
    category: "layout",
  },
  "button": {
    description: "Versatile button component with variants",
    code: `interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: 'primary' | 'secondary' | 'outline' | 'ghost'
  size?: 'sm' | 'md' | 'lg'
  loading?: boolean
}

export function Button({ 
  variant = 'primary', 
  size = 'md', 
  loading, 
  children, 
  className = '',
  disabled,
  ...props 
}: ButtonProps) {
  const baseStyles = 'inline-flex items-center justify-center font-medium rounded-lg transition-colors'
  
  const variants = {
    primary: 'bg-blue-600 text-white hover:bg-blue-700 disabled:bg-blue-400',
    secondary: 'bg-gray-600 text-white hover:bg-gray-700 disabled:bg-gray-400',
    outline: 'border-2 border-gray-300 text-gray-700 hover:bg-gray-50',
    ghost: 'text-gray-700 hover:bg-gray-100',
  }

  const sizes = {
    sm: 'px-3 py-1.5 text-sm',
    md: 'px-4 py-2 text-base',
    lg: 'px-6 py-3 text-lg',
  }

  return (
    <button
      className={\`\${baseStyles} \${variants[variant]} \${sizes[size]} \${className}\`}
      disabled={disabled || loading}
      {...props}
    >
      {loading && (
        <svg className="animate-spin -ml-1 mr-2 h-4 w-4" fill="none" viewBox="0 0 24 24">
          <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/>
          <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"/>
        </svg>
      )}
      {children}
    </button>
  )
}`,
    dependencies: ["react", "tailwindcss"],
    category: "ui",
  },
  "input": {
    description: "Form input component with label and error states",
    code: `interface InputProps extends React.InputHTMLAttributes<HTMLInputElement> {
  label?: string
  error?: string
  helperText?: string
}

export function Input({ label, error, helperText, className = '', ...props }: InputProps) {
  return (
    <div className="w-full">
      {label && (
        <label className="block text-sm font-medium text-gray-700 mb-1">
          {label}
        </label>
      )}
      <input
        className={\`w-full px-4 py-2 border rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent outline-none transition-all \${
          error ? 'border-red-500' : 'border-gray-300'
        } \${className}\`}
        {...props}
      />
      {error && (
        <p className="mt-1 text-sm text-red-600">{error}</p>
      )}
      {helperText && !error && (
        <p className="mt-1 text-sm text-gray-500">{helperText}</p>
      )}
    </div>
  )
}`,
    dependencies: ["react", "tailwindcss"],
    category: "ui",
  },
  "dashboard-card": {
    description: "Dashboard statistics card with icon",
    code: `interface DashboardCardProps {
  title: string
  value: string | number
  change?: number
  icon?: React.ReactNode
}

export function DashboardCard({ title, value, change, icon }: DashboardCardProps) {
  return (
    <div className="bg-white rounded-xl p-6 shadow-sm border border-gray-100">
      <div className="flex items-center justify-between mb-4">
        <span className="text-gray-500 text-sm">{title}</span>
        {icon && <div className="text-gray-400">{icon}</div>}
      </div>
      <div className="flex items-end justify-between">
        <span className="text-3xl font-bold text-gray-900">{value}</span>
        {change !== undefined && (
          <span className={\`text-sm \${change >= 0 ? 'text-green-600' : 'text-red-600'}\`}>
            {change >= 0 ? '↑' : '↓'} {Math.abs(change)}%
          </span>
        )}
      </div>
    </div>
  )
}`,
    dependencies: ["react", "tailwindcss"],
    category: "dashboard",
  },
  "table": {
    description: "Data table with sorting and pagination",
    code: `interface Column<T> {
  key: keyof T
  header: string
  render?: (value: T[keyof T], row: T) => React.ReactNode
}

interface TableProps<T> {
  data: T[]
  columns: Column<T>[]
  onRowClick?: (row: T) => void
}

export function Table<T extends Record<string, unknown>>({ 
  data, 
  columns, 
  onRowClick 
}: TableProps<T>) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full">
        <thead>
          <tr className="border-b border-gray-200">
            {columns.map((col) => (
              <th 
                key={String(col.key)}
                className="px-4 py-3 text-left text-sm font-semibold text-gray-900"
              >
                {col.header}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {data.map((row, idx) => (
            <tr 
              key={idx}
              onClick={() => onRowClick?.(row)}
              className={\`border-b border-gray-100 \${onRowClick ? 'cursor-pointer hover:bg-gray-50' : ''}\`}
            >
              {columns.map((col) => (
                <td key={String(col.key)} className="px-4 py-3 text-sm text-gray-700">
                  {col.render ? col.render(row[col.key], row) : String(row[col.key])}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}`,
    dependencies: ["react", "tailwindcss"],
    category: "data",
  },
}

export namespace ComponentScraper {
  export function getRegistry(): Record<string, ComponentRegistry> {
    return COMPONENT_REGISTRY
  }

  export function getSources(): string[] {
    return COMPONENT_SOURCES
  }

  export async function findComponents(
    description: string,
    techStack: string[],
  ): Promise<ComponentMatch[]> {
    log.info("finding components", { description: description.slice(0, 50), techStack })

    const matches: ComponentMatch[] = []

    // Search local registry first
    for (const [name, component] of Object.entries(COMPONENT_REGISTRY)) {
      const relevance = calculateRelevance(description, name, component.description)
      if (relevance > 0.3) {
        matches.push({
          name,
          source: "registry",
          url: "",
          code: component.code,
          description: component.description,
          dependencies: component.dependencies,
        })
      }
    }

    // Sort by relevance
    matches.sort((a, b) => {
      const aScore = calculateRelevance(description, a.name, a.description)
      const bScore = calculateRelevance(description, b.name, b.description)
      return bScore - aScore
    })

    return matches.slice(0, 5)
  }

  export async function searchByCategory(category: string): Promise<ComponentMatch[]> {
    const matches: ComponentMatch[] = []

    for (const [name, component] of Object.entries(COMPONENT_REGISTRY)) {
      if (component.category === category || category === "all") {
        matches.push({
          name,
          source: "registry",
          url: "",
          code: component.code,
          description: component.description,
          dependencies: component.dependencies,
        })
      }
    }

    return matches
  }

  export async function integrateComponent(
    projectPath: string,
    component: ComponentMatch,
    targetDir: string = "components",
  ): Promise<{ success: boolean; path?: string; error?: string }> {
    log.info("integrating component", { name: component.name, targetDir })

    try {
      const fs = await import("fs/promises")
      const path = await import("path")

      const dir = path.join(projectPath, targetDir)
      await fs.mkdir(dir, { recursive: true })

      const fileName = `${component.name.replace(/-/g, "-")}.tsx`
      const filePath = path.join(dir, fileName)

      await fs.writeFile(filePath, component.code, "utf-8")

      return { success: true, path: filePath }
    } catch (err) {
      const error = err instanceof Error ? err.message : String(err)
      log.error("failed to integrate component", { error })
      return { success: false, error }
    }
  }

  export function generateComponentIndex(components: ComponentMatch[]): string {
    const lines = [
      "// Auto-generated component index",
      "// Generated by Pakalon Component Scraper",
      "",
    ]

    for (const component of components) {
      const name = component.name.replace(/-/g, "-")
      lines.push(`export { ${toPascalCase(name)} } from './${name}'`)
    }

    lines.push("")
    return lines.join("\n")
  }

  function calculateRelevance(
    query: string,
    name: string,
    description: string,
  ): number {
    const queryLower = query.toLowerCase()
    const nameLower = name.toLowerCase()
    const descLower = description.toLowerCase()

    let score = 0

    // Exact name match
    if (nameLower === queryLower) score += 1

    // Name contains query
    if (nameLower.includes(queryLower)) score += 0.5

    // Query contains name
    if (queryLower.includes(nameLower)) score += 0.3

    // Description matches
    const queryWords = queryLower.split(/\s+/)
    const descWords = descLower.split(/\s+/)

    for (const word of queryWords) {
      if (word.length > 3 && descWords.some((dw) => dw.includes(word))) {
        score += 0.1
      }
    }

    return Math.min(score, 1)
  }

  function toPascalCase(str: string): string {
    return str
      .split("-")
      .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
      .join("")
  }
}
