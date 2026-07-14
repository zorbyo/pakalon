import { Log } from "../util/log"

const log = Log.create({ service: "pipeline:hil" })

export interface HILQuestion {
  id: string
  question: string
  options: string[]
  followUps?: HILQuestion[]
  required: boolean
  category: "tech-stack" | "design" | "backend" | "deployment" | "features" | "general"
}

export interface HILOption {
  label: string
  description: string
  value: string
}

export interface HILSession {
  id: string
  phase: number
  questions: HILQuestion[]
  answers: Record<string, string>
  currentQuestionIndex: number
  questionCount: number
  minQuestions: number
  status: "active" | "completed" | "skipped"
  startedAt: number
  followUps: string[]
  followUpAnswers: Record<number, string>
}

let active: HILSession | null = null
let min = 0

const BASE_QUESTIONS: HILQuestion[] = [
  {
    id: "tech-stack-frontend",
    question: "What frontend framework would you like to use?",
    options: [
      "React with Next.js",
      "React with Vite",
      "Vue with Nuxt",
      "Vue with Vite",
      "Svelte with SvelteKit",
      "Plain HTML/CSS/JavaScript",
      "Angular",
    ],
    required: true,
    category: "tech-stack",
    followUps: [
      {
        id: "css-framework",
        question: "Which CSS framework/library would you prefer?",
        options: ["Tailwind CSS", "Bootstrap", "Material UI", "Chakra UI", "Shadcn/UI", "Plain CSS"],
        required: true,
        category: "design",
      },
      {
        id: "ui-components",
        question: "Would you like to use a component library?",
        options: ["Shadcn/UI + Radix", "Material UI", "Ant Design", "Chakra UI", "Custom components"],
        required: false,
        category: "design",
      },
    ],
  },
  {
    id: "tech-stack-backend",
    question: "What backend technology would you like to use?",
    options: [
      "Node.js with Express",
      "Node.js with Fastify",
      "Python with FastAPI",
      "Python with Django",
      "Go with Gin",
      "Rust with Actix",
      "Java with Spring Boot",
      "No backend (frontend only)",
    ],
    required: true,
    category: "backend",
  },
  {
    id: "database",
    question: "What database would you like to use?",
    options: [
      "PostgreSQL",
      "MySQL",
      "MongoDB",
      "SQLite",
      "Supabase (PostgreSQL)",
      "Firebase",
      "PlanetScale (MySQL)",
      "No database needed",
    ],
    required: true,
    category: "backend",
  },
  {
    id: "authentication",
    question: "What authentication method would you prefer?",
    options: [
      "Email/Password with JWT",
      "OAuth (Google, GitHub, etc.)",
      "Magic Link",
      "Supabase Auth",
      "Firebase Auth",
      "Custom authentication",
      "No authentication needed",
    ],
    required: true,
    category: "backend",
  },
  {
    id: "design-style",
    question: "What design style are you looking for?",
    options: [
      "Modern minimalist",
      "Bold and colorful",
      "Professional/corporate",
      "Playful/fun",
      "Dark mode focused",
      "Light mode focused",
      "Both light and dark modes",
    ],
    required: true,
    category: "design",
  },
  {
    id: "design-3d",
    question: "Would you like to include 3D elements or animations?",
    options: [
      "Yes, with Three.js/React Three Fiber",
      "Yes, with Spline",
      "Simple CSS animations only",
      "No animations",
      "Let the AI decide",
    ],
    required: false,
    category: "design",
  },
  {
    id: "deployment",
    question: "Where would you like to deploy your application?",
    options: [
      "Vercel",
      "Netlify",
      "AWS",
      "Google Cloud",
      "DigitalOcean",
      "Self-hosted",
      "Not decided yet",
    ],
    required: true,
    category: "deployment",
  },
  {
    id: "features",
    question: "What are the key features you need?",
    options: [
      "User dashboard",
      "Admin panel",
      "Real-time updates",
      "File uploads",
      "Payment integration",
      "Email notifications",
      "Search functionality",
      "Analytics",
    ],
    required: true,
    category: "features",
  },
  {
    id: "api-style",
    question: "What API style would you prefer?",
    options: ["REST API", "GraphQL", "tRPC", "Let the AI decide based on use case"],
    required: true,
    category: "backend",
  },
  {
    id: "timeline",
    question: "What is your timeline for this project?",
    options: ["ASAP (days)", "1-2 weeks", "1 month", "Flexible", "No rush"],
    required: false,
    category: "general",
  },
  {
    id: "testing",
    question: "What testing approach would you like?",
    options: [
      "Unit tests with Jest/Vitest",
      "E2E tests with Playwright",
      "Both unit and E2E tests",
      "Minimal testing",
      "Let the AI decide",
    ],
    required: false,
    category: "general",
  },
  {
    id: "additional-context",
    question: "Any additional context or specific requirements?",
    options: [
      "No, proceed with standard setup",
      "Yes, I have specific requirements",
      "I have a reference website/design",
    ],
    required: false,
    category: "general",
  },
]

export namespace HILHandler {
  export function createSession(phase: number): HILSession {
    const session: HILSession = {
      id: `hil-${Date.now()}`,
      phase,
      questions: [...BASE_QUESTIONS],
      answers: {},
      currentQuestionIndex: 0,
      questionCount: 0,
      minQuestions: 0,
      status: "active",
      startedAt: Date.now(),
      followUps: [],
      followUpAnswers: {},
    }
    active = session
    min = 0
    return session
  }

  export function currentQuestion(session: HILSession): HILQuestion | undefined {
    return session.questions[session.currentQuestionIndex]
  }

  export function processAnswer(
    session: HILSession,
    questionId: string,
    answer: string,
  ): HILSession {
    const question = session.questions.find((q) => q.id === questionId)
    if (!question) return session

    const count = Object.keys(session.answers).length
    const floor = session.minQuestions > 0 ? session.minQuestions : min
    if (answer === "End Phase 1" && count < floor) {
      log.info("minimum question count not met", { count, min: floor })
      return {
        ...session,
        status: "active",
      }
    }

    const newAnswers = { ...session.answers, [questionId]: answer }
    const newIndex = session.currentQuestionIndex + 1

    // Check if there are follow-up questions based on the answer
    let newQuestions = [...session.questions]
    if (question.followUps) {
      const followUps = buildQuestionFollowUps(question, answer)
      newQuestions = [...newQuestions, ...followUps]
    }

    // Generate context-specific questions based on answers
    const contextQuestions = generateContextQuestions(newAnswers)
    newQuestions = [...newQuestions, ...contextQuestions]

    const isCompleted = newIndex >= newQuestions.length || answer === "End Phase 1"

    const next: HILSession = {
      ...session,
      questions: newQuestions,
      answers: newAnswers,
      currentQuestionIndex: newIndex,
      questionCount: Object.keys(newAnswers).length,
      minQuestions: floor,
      status: isCompleted ? "completed" : "active",
    }
    active = next
    return next
  }

  export function presentOptions(options: HILOption[]): string {
    if (options.length === 0) return "No options available."
    return options
      .map((opt, i) => `${i + 1}. ${opt.label}\n   ${opt.description}\n   value: ${opt.value}`)
      .join("\n")
  }

  export function enforceMinimumQuestions(minCount: number): boolean {
    if (!active) return false
    min = minCount > 0 ? minCount : 0
    active = {
      ...active,
      minQuestions: min,
      questionCount: Object.keys(active.answers).length,
    }
    return active.questionCount >= min
  }

  export function generateFollowUpQuestions(previousAnswer: string, context: string[]): string[] {
    const text = `${previousAnswer} ${context.join(" ")}`.toLowerCase()
    const list: string[] = []

    if (text.includes("dark") || text.includes("light")) {
      list.push("Do you want automatic theme switching based on system preference?")
    }

    if (text.includes("payment") || text.includes("stripe") || text.includes("paypal")) {
      list.push("What currency and regions must the payment flow support?")
    }

    if (text.includes("realtime") || text.includes("real-time") || text.includes("websocket")) {
      list.push("What events need to be pushed in real time and at what scale?")
    }

    if (text.includes("auth") || text.includes("oauth") || text.includes("jwt")) {
      list.push("Should sessions support multi-device sign-in and revocation?")
    }

    if (list.length === 0) {
      list.push("Can you share a concrete user flow for this requirement?")
      list.push("What constraints or non-negotiables should we enforce here?")
    }

    if (!active) return list
    active = {
      ...active,
      followUps: [...active.followUps, ...list],
    }
    return list
  }

  export function processFollowUp(questionIndex: number, answer: string): HILSession | null {
    if (!active) return null
    if (questionIndex < 0 || questionIndex >= active.followUps.length) return active
    active = {
      ...active,
      followUpAnswers: {
        ...active.followUpAnswers,
        [questionIndex]: answer,
      },
    }
    return active
  }

  export function shouldContinue(session: HILSession): boolean {
    return session.status === "active" && session.currentQuestionIndex < session.questions.length
  }

  export function getProgress(session: HILSession): { current: number; total: number; pct: number } {
    const current = session.currentQuestionIndex
    const total = session.questions.length
    const pct = total > 0 ? Math.round((current / total) * 100) : 0
    return { current, total, pct }
  }

  export function getCollectedAnswers(session: HILSession): Record<string, string> {
    return session.answers
  }

  export function skipToEnd(session: HILSession): HILSession {
    const next: HILSession = {
      ...session,
      status: "completed",
      currentQuestionIndex: session.questions.length,
      questionCount: Object.keys(session.answers).length,
    }
    active = next
    return next
  }

  export function getRemainingRequired(session: HILSession): HILQuestion[] {
    return session.questions.filter(
      (q) => q.required && !session.answers[q.id] && session.questions.indexOf(q) >= session.currentQuestionIndex,
    )
  }

  export function getAnsweredQuestions(session: HILSession): HILQuestion[] {
    return session.questions.filter((q) => session.answers[q.id])
  }

  export function getUnansweredQuestions(session: HILSession): HILQuestion[] {
    return session.questions.filter(
      (q) => !session.answers[q.id] && session.questions.indexOf(q) >= session.currentQuestionIndex,
    )
  }

  function buildQuestionFollowUps(question: HILQuestion, answer: string): HILQuestion[] {
    const followUps: HILQuestion[] = []

    // Generate follow-ups based on the selected option
    if (question.id === "tech-stack-frontend" && answer.includes("React")) {
      followUps.push({
        id: "react-state",
        question: "Which state management solution would you prefer?",
        options: ["Zustand", "Redux Toolkit", "Jotai", "Recoil", "React Context", "Let the AI decide"],
        required: false,
        category: "tech-stack",
      })
    }

    if (question.id === "database" && answer === "Supabase (PostgreSQL)") {
      followUps.push({
        id: "supabase-features",
        question: "Which Supabase features would you like to use?",
        options: [
          "Auth + Database",
          "Auth + Database + Storage",
          "Auth + Database + Edge Functions",
          "Full Supabase suite",
        ],
        required: false,
        category: "backend",
      })
    }

    if (question.id === "features" && answer.includes("Payment")) {
      followUps.push({
        id: "payment-provider",
        question: "Which payment provider would you like?",
        options: ["Stripe", "PayPal", "Polar", "Razorpay", "Let the AI decide"],
        required: false,
        category: "features",
      })
    }

    return followUps
  }

  function generateContextQuestions(answers: Record<string, string>): HILQuestion[] {
    const contextQuestions: HILQuestion[] = []

    // If user chose real-time, ask about WebSocket solution
    if (answers["features"]?.includes("Real-time")) {
      contextQuestions.push({
        id: "realtime-solution",
        question: "How would you like to implement real-time features?",
        options: ["WebSocket (Socket.io)", "Server-Sent Events", "Supabase Realtime", "Pusher", "Let the AI decide"],
        required: false,
        category: "backend",
      })
    }

    // If user chose file uploads, ask about storage
    if (answers["features"]?.includes("File uploads")) {
      contextQuestions.push({
        id: "file-storage",
        question: "Where would you like to store uploaded files?",
        options: ["Local filesystem", "AWS S3", "Cloudinary", "Supabase Storage", "Firebase Storage"],
        required: false,
        category: "backend",
      })
    }

    return contextQuestions
  }

  export function generateSummary(session: HILSession): string {
    const lines = [
      "# Phase 1 - Interactive Planning Summary",
      "",
      "## Session Information",
      `- Session ID: ${session.id}`,
      `- Phase: ${session.phase}`,
      `- Status: ${session.status}`,
      `- Started: ${new Date(session.startedAt).toISOString()}`,
      `- Questions Asked: ${Object.keys(session.answers).length}`,
      "",
      "## Collected Answers",
      "",
    ]

    const categoryMap: Record<string, Array<{ question: string; answer: string }>> = {}
    for (const question of session.questions) {
      const answer = session.answers[question.id]
      if (answer) {
        if (!categoryMap[question.category]) {
          categoryMap[question.category] = []
        }
        categoryMap[question.category]!.push({
          question: question.question,
          answer,
        })
      }
    }

    for (const [category, items] of Object.entries(categoryMap)) {
      lines.push(`### ${category.replace("-", " ").replace(/\b\w/g, (l) => l.toUpperCase())}`)
      for (const item of items) {
        lines.push(`- **Q:** ${item.question}`)
        lines.push(`  **A:** ${item.answer}`)
      }
      lines.push("")
    }

    lines.push("---")
    lines.push("*Generated by Pakalon Phase 1 HIL Handler*")

    return lines.join("\n")
  }

  export function generateTechStackFromAnswers(answers: Record<string, string>): string {
    const parts: string[] = []

    if (answers["tech-stack-frontend"]) {
      parts.push(`Frontend: ${answers["tech-stack-frontend"]}`)
    }
    if (answers["css-framework"]) {
      parts.push(`CSS: ${answers["css-framework"]}`)
    }
    if (answers["ui-components"]) {
      parts.push(`UI Components: ${answers["ui-components"]}`)
    }
    if (answers["tech-stack-backend"]) {
      parts.push(`Backend: ${answers["tech-stack-backend"]}`)
    }
    if (answers["database"]) {
      parts.push(`Database: ${answers["database"]}`)
    }
    if (answers["authentication"]) {
      parts.push(`Auth: ${answers["authentication"]}`)
    }
    if (answers["api-style"]) {
      parts.push(`API: ${answers["api-style"]}`)
    }

    return parts.join("\n")
  }
}
