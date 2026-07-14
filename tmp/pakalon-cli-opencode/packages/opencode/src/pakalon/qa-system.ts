import { Log } from "../util/log"
const log = Log.create({ service: "pakalon:qa" })

export interface Question {
  id: string
  text: string
  type: "choice" | "text" | "confirm"
  options?: Array<{ id: string; text: string; description?: string }>
  category: string
  required: boolean
  // Dynamic planning features
  followUp?: Record<string, string[]> // Map answer -> follow-up question IDs
  skipIf?: (responses: Record<string, string>) => boolean
  minPromptLength?: number // Only ask if prompt is shorter than this
}

export interface QASession {
  projectPath: string
  mode: "hil" | "yolo"
  currentIndex: number
  questions: Question[]
  responses: Record<string, string>
  complete: boolean
  prompt: string
  promptComplexity: "simple" | "moderate" | "complex"
}

export namespace QASystem {
  const sessions = new Map<string, QASession>()

  /**
   * Analyze prompt complexity to determine question flow
   */
  function analyzePromptComplexity(prompt: string): "simple" | "moderate" | "complex" {
    const wordCount = prompt.split(/\s+/).length
    const hasDetails = /with|using|include|feature|require|need/i.test(prompt)
    const hasTechStack = /react|vue|angular|node|python|fast|express|next|nuxt/i.test(prompt)
    
    if (wordCount < 10 && !hasDetails) return "simple"
    if (wordCount > 30 || (hasDetails && hasTechStack)) return "complex"
    return "moderate"
  }

  export function init(projectPath: string, mode: "hil" | "yolo", prompt: string): QASession {
    const complexity = analyzePromptComplexity(prompt)
    const questions = mode === "yolo" 
      ? generateYoloQuestions() 
      : generateDynamicQuestions(prompt, complexity)
    
    const session: QASession = { 
      projectPath, 
      mode, 
      currentIndex: 0, 
      questions, 
      responses: {}, 
      complete: false,
      prompt,
      promptComplexity: complexity,
    }
    
    sessions.set(projectPath, session)
    log.info("Q&A initialized", { projectPath, mode, complexity, count: questions.length })
    return session
  }

  export function get(projectPath: string): QASession | undefined {
    return sessions.get(projectPath)
  }

  export function current(projectPath: string): Question | null {
    const s = sessions.get(projectPath)
    return s && !s.complete ? s.questions[s.currentIndex] ?? null : null
  }

  export function answer(projectPath: string, value: string): Question | null {
    const s = sessions.get(projectPath)
    if (!s) return null
    
    const q = s.questions[s.currentIndex]
    if (!q) return null
    
    // Record response
    s.responses[q.id] = value
    
    // Handle end/skip phase
    if (value === "end_phase" || value === "skip_phase") {
      s.complete = true
      sessions.set(projectPath, s)
      return null
    }
    
    // Handle branching follow-up questions
    if (q.followUp && q.followUp[value]) {
      const followUpIds = q.followUp[value]
      // Insert follow-up questions after current position
      const followUpQuestions = generateFollowUpQuestions(followUpIds, s)
      s.questions.splice(s.currentIndex + 1, 0, ...followUpQuestions)
    }
    
    // Move to next question
    s.currentIndex++
    
    // Skip questions based on skipIf conditions
    while (s.currentIndex < s.questions.length) {
      const nextQ = s.questions[s.currentIndex]
      if (!nextQ) break
      
      // Check if we should skip this question
      if (nextQ.skipIf && nextQ.skipIf(s.responses)) {
        s.currentIndex++
        continue
      }
      
      // Check minimum prompt length requirement
      if (nextQ.minPromptLength && s.prompt.length >= nextQ.minPromptLength) {
        s.currentIndex++
        continue
      }
      
      break
    }
    
    // Check if we've completed all questions
    if (s.currentIndex >= s.questions.length) {
      s.complete = true
      sessions.set(projectPath, s)
      return null
    }
    
    sessions.set(projectPath, s)
    return s.questions[s.currentIndex] ?? null
  }

  export function isComplete(projectPath: string): boolean {
    return sessions.get(projectPath)?.complete ?? false
  }

  export function getResponses(projectPath: string): Record<string, string> {
    return sessions.get(projectPath)?.responses ?? {}
  }

  export function format(q: Question): string {
    let out = `\n## ${q.text}\n\n`
    if (q.type === "choice" && q.options) {
      q.options.forEach((o, i) => { out += `**${i + 1}.** ${o.text}${o.description ? " - " + o.description : ""}\n` })
      // Add end phase option to every choice question
      out += `\n**${q.options.length + 1}.** End Phase 1 (skip remaining questions)\n`
    } else if (q.type === "text") {
      out += "Please type your answer below.\n"
      out += "\nOr type **end** to end Phase 1.\n"
    } else {
      out += "**1.** Yes\n**2.** No\n"
      out += "\n**3.** End Phase 1\n"
    }
    return out
  }

  export function summary(responses: Record<string, string>): string {
    let out = "# Q&A Session Summary\n\n"
    for (const [k, v] of Object.entries(responses)) {
      out += `- **${k.split("_").map(w => w[0].toUpperCase() + w.slice(1)).join(" ")}**: ${v}\n`
    }
    return out
  }
}

function generateYoloQuestions(): Question[] {
  return [{ id: "confirm_yolo", text: "YOLO mode: AI decides everything. Proceed?", type: "confirm", category: "general", required: true }]
}

/**
 * Generate questions dynamically based on prompt and complexity
 */
function generateDynamicQuestions(prompt: string, complexity: "simple" | "moderate" | "complex"): Question[] {
  const baseQuestions = getBaseQuestions()
  
  if (complexity === "complex") {
    // For complex prompts, ask fewer clarifying questions
    return baseQuestions.filter(q => q.required || q.category === "navigation")
  }
  
  if (complexity === "moderate") {
    // For moderate prompts, ask core questions
    return baseQuestions.filter(q => {
      if (q.category === "navigation") return true
      if (q.required) return true
      // Skip optional questions about things already mentioned in prompt
      if (q.id === "frontend" && /react|vue|angular|svelte/i.test(prompt)) return false
      if (q.id === "backend" && /node|python|fast|express/i.test(prompt)) return false
      if (q.id === "database" && /postgres|mysql|mongo|sqlite/i.test(prompt)) return false
      return true
    })
  }
  
  // Simple prompts get all questions
  return baseQuestions
}

/**
 * Get base question set
 */
function getBaseQuestions(): Question[] {
  return [
    { 
      id: "project_type", 
      text: "What type of application are you building?", 
      type: "choice", 
      category: "general", 
      required: true,
      options: [
        { id: "web_app", text: "Web Application", description: "Full-stack with frontend and backend" },
        { id: "saas", text: "SaaS Application", description: "Software as a Service" },
        { id: "ecommerce", text: "E-Commerce", description: "Online store" },
        { id: "dashboard", text: "Dashboard/Admin Panel", description: "Data visualization" },
        { id: "landing_page", text: "Landing Page", description: "Marketing website" },
        { id: "api_only", text: "API Only", description: "Backend without frontend" },
      ],
      followUp: {
        "saas": ["billing", "multi_tenancy"],
        "ecommerce": ["payment", "inventory"],
        "dashboard": ["charts", "realtime"],
      },
    },
    { 
      id: "frontend", 
      text: "Which frontend technology?", 
      type: "choice", 
      category: "tech_stack", 
      required: true,
      skipIf: (responses) => responses.project_type === "api_only",
      options: [
        { id: "react_next", text: "React + Next.js + Shadcn UI" },
        { id: "html_css_js", text: "HTML, CSS, JavaScript" },
        { id: "vue", text: "Vue.js + Nuxt" },
        { id: "svelte", text: "Svelte + SvelteKit" },
        { id: "electron", text: "Electron (Desktop)" },
        { id: "user_choice", text: "Let me specify" },
      ],
    },
    { 
      id: "backend", 
      text: "Which backend technology?", 
      type: "choice", 
      category: "tech_stack", 
      required: true,
      options: [
        { id: "node_express", text: "Node.js + Express" },
        { id: "node_fastify", text: "Node.js + Fastify" },
        { id: "python_fastapi", text: "Python + FastAPI" },
        { id: "python_django", text: "Python + Django" },
        { id: "go", text: "Go + Gin" },
        { id: "no_backend", text: "No backend" },
      ],
    },
    { 
      id: "database", 
      text: "Which database?", 
      type: "choice", 
      category: "tech_stack", 
      required: true,
      skipIf: (responses) => responses.backend === "no_backend",
      options: [
        { id: "postgresql", text: "PostgreSQL" },
        { id: "mysql", text: "MySQL" },
        { id: "mongodb", text: "MongoDB" },
        { id: "sqlite", text: "SQLite" },
        { id: "supabase", text: "Supabase" },
        { id: "no_database", text: "No database" },
      ],
    },
    { 
      id: "authentication", 
      text: "Authentication method?", 
      type: "choice", 
      category: "security", 
      required: true,
      options: [
        { id: "jwt", text: "JWT (JSON Web Tokens)" },
        { id: "oauth", text: "OAuth 2.0 (Google, GitHub)" },
        { id: "session", text: "Session-based" },
        { id: "clerk", text: "Clerk" },
        { id: "no_auth", text: "No authentication" },
      ],
    },
    { 
      id: "design_style", 
      text: "Design style preference?", 
      type: "choice", 
      category: "design", 
      required: false,
      options: [
        { id: "modern_minimal", text: "Modern & Minimal" },
        { id: "bold_colorful", text: "Bold & Colorful" },
        { id: "corporate", text: "Corporate/Professional" },
        { id: "dark_mode", text: "Dark Mode First" },
      ],
    },
    { 
      id: "key_features", 
      text: "Key features needed? (comma-separated)", 
      type: "text", 
      category: "features", 
      required: true,
      minPromptLength: 50, // Skip if prompt is already detailed
    },
    { 
      id: "target_audience", 
      text: "Who is your target audience?", 
      type: "text", 
      category: "general", 
      required: false,
    },
    { 
      id: "additional_requirements", 
      text: "Any additional requirements?", 
      type: "text", 
      category: "general", 
      required: false,
    },
    { 
      id: "end_phase", 
      text: "Ready to proceed?", 
      type: "choice", 
      category: "navigation", 
      required: true, 
      options: [
        { id: "continue", text: "Continue with more questions" },
        { id: "end_phase", text: "End Phase 1 and start Phase 2" },
        { id: "skip_phase", text: "Skip to Phase 3" },
      ],
    },
  ]
}

/**
 * Generate follow-up questions dynamically
 */
function generateFollowUpQuestions(ids: string[], session: QASession): Question[] {
  const followUpQuestions: Record<string, Question> = {
    "billing": {
      id: "billing_setup",
      text: "Do you need billing/payment integration?",
      type: "choice",
      category: "features",
      required: false,
      options: [
        { id: "stripe", text: "Stripe" },
        { id: "paypal", text: "PayPal" },
        { id: "polar", text: "Polar" },
        { id: "none", text: "No billing needed" },
      ],
    },
    "multi_tenancy": {
      id: "multi_tenancy",
      text: "Do you need multi-tenancy support?",
      type: "confirm",
      category: "features",
      required: false,
    },
    "payment": {
      id: "payment_gateway",
      text: "Which payment gateway?",
      type: "choice",
      category: "features",
      required: false,
      options: [
        { id: "stripe", text: "Stripe" },
        { id: "paypal", text: "PayPal" },
        { id: "square", text: "Square" },
      ],
    },
    "inventory": {
      id: "inventory_management",
      text: "Do you need inventory management?",
      type: "confirm",
      category: "features",
      required: false,
    },
    "charts": {
      id: "chart_library",
      text: "Which charting library?",
      type: "choice",
      category: "tech_stack",
      required: false,
      options: [
        { id: "recharts", text: "Recharts" },
        { id: "chartjs", text: "Chart.js" },
        { id: "d3", text: "D3.js" },
        { id: "tremor", text: "Tremor" },
      ],
    },
    "realtime": {
      id: "realtime_updates",
      text: "Do you need real-time data updates?",
      type: "choice",
      category: "features",
      required: false,
      options: [
        { id: "websocket", text: "WebSocket" },
        { id: "sse", text: "Server-Sent Events" },
        { id: "polling", text: "Polling" },
        { id: "none", text: "No real-time needed" },
      ],
    },
  }
  
  return ids
    .map(id => followUpQuestions[id])
    .filter((q): q is Question => q !== undefined)
}

export default QASystem
