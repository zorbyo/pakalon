/**
 * Blackbox Test Generation - Generates user story and behavioral tests
 * Tests validate the application from the user's perspective
 */

import type {
  TestCase,
  TestSuite,
  TestSubsection,
  UserStorySection,
  UserStoryEntry,
  ApiTestSection,
  ApiEndpointTest,
  IntegrationTestSection,
  IntegrationFlow,
  IntegrationStep,
  TestMetadata,
  SecurityFinding,
  TestSeverity,
} from "./testTypes.js";

export class BlackboxTestGenerator {
  private projectDir: string;
  private metadata: TestMetadata;
  private securityFindings: SecurityFinding[];

  constructor(
    projectDir: string,
    metadata: TestMetadata,
    securityFindings: SecurityFinding[] = [],
  ) {
    this.projectDir = projectDir;
    this.metadata = metadata;
    this.securityFindings = securityFindings;
  }

  public async generate(): Promise<BlackboxTestSuite[]> {
    const suites: BlackboxTestSuite[] = [];

    suites.push(this.generateAuthenticationSuite());
    suites.push(this.generateChatInterfaceSuite());
    suites.push(this.generateAgentModeSuite());
    suites.push(this.generatePipelineSuite());
    suites.push(this.generateSecurityBehaviorSuite());
    suites.push(this.generateApiSuite());
    suites.push(this.generateIntegrationFlowSuite());

    return suites;
  }

  private generateAuthenticationSuite(): BlackboxTestSuite {
    const tests: TestCase[] = [
      {
        id: "BT-AUTH-001",
        name: "Device code authentication flow",
        description: "User can authenticate via device code flow",
        severity: "critical",
        status: "pending",
        userStory: "US-AUTH-001",
        component: "auth",
        preconditions: ["User has valid GitHub account", "Pakalon backend is running"],
        steps: [
          "Run 'pakalon login'",
          "Note the 6-digit device code displayed",
          "Open https://pakalon.com/auth/device in browser",
          "Enter the device code",
          "Sign in with GitHub OAuth",
          "Verify JWT is stored at ~/.config/pakalon/storage.json",
        ],
        expectedResults: [
          "Device code is displayed",
          "Browser opens auth page",
          "JWT token is stored after login",
          "User can use authenticated commands",
        ],
        tags: ["blackbox", "auth", "device-code"],
      },
      {
        id: "BT-AUTH-002",
        name: "Token-based CI/CD authentication",
        description: "User can authenticate via PAKALON_TOKEN env var",
        severity: "high",
        status: "pending",
        userStory: "US-AUTH-002",
        component: "auth",
        preconditions: ["PAKALON_TOKEN env var is set"],
        steps: [
          "Set PAKALON_TOKEN environment variable",
          "Run 'pakalon setup-token'",
          "Run an authenticated command",
        ],
        expectedResults: [
          "Token is stored successfully",
          "Authenticated commands work",
        ],
        tags: ["blackbox", "auth", "ci-cd"],
      },
      {
        id: "BT-AUTH-003",
        name: "Logout clears credentials",
        description: "User can logout and credentials are removed",
        severity: "high",
        status: "pending",
        userStory: "US-AUTH-003",
        component: "auth",
        preconditions: ["User is logged in"],
        steps: ["Run 'pakalon logout'", "Verify storage.json is removed", "Try authenticated command"],
        expectedResults: [
          "Credentials are removed",
          "Authenticated commands fail with auth error",
        ],
        tags: ["blackbox", "auth", "logout"],
      },
      {
        id: "BT-AUTH-004",
        name: "Status shows auth state",
        description: "User can check current authentication status",
        severity: "medium",
        status: "pending",
        userStory: "US-AUTH-004",
        component: "auth",
        preconditions: ["Pakalon CLI is installed"],
        steps: ["Run 'pakalon status'", "Verify output shows auth state and plan"],
        expectedResults: ["Status shows current user and plan details"],
        tags: ["blackbox", "auth", "status"],
      },
    ];

    return {
      id: "BB-AUTH",
      name: "Authentication",
      description: "User authentication and authorization tests",
      type: "blackbox",
      tests,
      userStories: {
        stories: [
          {
            id: "US-AUTH-001",
            title: "As a user, I want to authenticate via device code flow",
            acceptanceCriteria: [
              "Device code is displayed on CLI",
              "Browser opens auth URL",
              "GitHub OAuth completes",
              "JWT is stored locally",
            ],
            tests: tests.filter((t) => t.userStory === "US-AUTH-001"),
          },
        ],
      },
      apiTests: { endpoints: [] },
      integrationTests: { flows: [] },
    };
  }

  private generateChatInterfaceSuite(): BlackboxTestSuite {
    const tests: TestCase[] = [
      {
        id: "BT-CHAT-001",
        name: "Interactive chat mode starts",
        description: "User can start an interactive chat session",
        severity: "critical",
        status: "pending",
        userStory: "US-CHAT-001",
        component: "chat",
        preconditions: ["User is authenticated"],
        steps: ["Run 'pakalon'", "Verify TUI loads", "Verify chat input is active"],
        expectedResults: ["TUI displays correctly", "Chat input accepts text", "Model responds"],
        tags: ["blackbox", "chat", "tui"],
      },
      {
        id: "BT-CHAT-002",
        name: "Send and receive messages",
        description: "User can send messages and receive AI responses",
        severity: "critical",
        status: "pending",
        userStory: "US-CHAT-002",
        component: "chat",
        preconditions: ["Chat mode is active"],
        steps: [
          "Type a message in the input",
          "Press Enter to send",
          "Verify streaming response appears",
          "Verify response is complete",
        ],
        expectedResults: [
          "Message is sent to model",
          "Response streams in real-time",
          "Response is complete and coherent",
        ],
        tags: ["blackbox", "chat", "streaming"],
      },
      {
        id: "BT-CHAT-003",
        name: "Slash commands work",
        description: "User can use slash commands in chat",
        severity: "high",
        status: "pending",
        userStory: "US-CHAT-003",
        component: "chat",
        preconditions: ["Chat mode is active"],
        steps: [
          "Type '/plan' and verify plan mode activates",
          "Type '/edit' and verify edit mode activates",
          "Type '/compact' and verify context compaction",
          "Type '/clear' and verify history clears",
          "Type '/exit' or 'q' and verify exit",
        ],
        expectedResults: ["Each slash command performs its expected action"],
        tags: ["blackbox", "chat", "slash-commands"],
      },
      {
        id: "BT-CHAT-004",
        name: "Keyboard shortcuts work",
        description: "User can use keyboard shortcuts in chat",
        severity: "medium",
        status: "pending",
        userStory: "US-CHAT-004",
        component: "chat",
        preconditions: ["Chat mode is active"],
        steps: [
          "Press Ctrl+C to cancel stream",
          "Press Ctrl+U to clear input",
          "Press Tab to cycle modes",
          "Press Up/Down to browse history",
        ],
        expectedResults: ["Each shortcut performs its expected action"],
        tags: ["blackbox", "chat", "shortcuts"],
      },
      {
        id: "BT-CHAT-005",
        name: "Single message mode",
        description: "User can send a single message without interactive mode",
        severity: "high",
        status: "pending",
        userStory: "US-CHAT-005",
        component: "chat",
        preconditions: ["User is authenticated"],
        steps: ["Run 'pakalon \"Hello, world\"'", "Verify response is printed to stdout"],
        expectedResults: ["Response is printed", "CLI exits after response"],
        tags: ["blackbox", "chat", "single-message"],
      },
    ];

    return {
      id: "BB-CHAT",
      name: "Chat Interface",
      description: "Interactive chat interface behavioral tests",
      type: "blackbox",
      tests,
      userStories: {
        stories: [
          {
            id: "US-CHAT-001",
            title: "As a user, I want an interactive chat with AI",
            acceptanceCriteria: [
              "TUI loads with chat input",
              "Messages can be sent and received",
              "Responses stream in real-time",
            ],
            tests: tests.filter((t) => t.userStory === "US-CHAT-001"),
          },
        ],
      },
      apiTests: { endpoints: [] },
      integrationTests: { flows: [] },
    };
  }

  private generateAgentModeSuite(): BlackboxTestSuite {
    const tests: TestCase[] = [
      {
        id: "BT-AGENT-001",
        name: "Agentic mode with human-in-the-loop",
        description: "User can run autonomous build with HIL checkpoints",
        severity: "critical",
        status: "pending",
        userStory: "US-AGENT-001",
        component: "agent",
        preconditions: ["User is authenticated", "Project directory exists"],
        steps: [
          "Run 'pakalon /pakalon \"build a todo app\"'",
          "Verify Phase 1 planning starts",
          "Approve Phase 1 at checkpoint",
          "Verify Phase 2 wireframes generate",
          "Approve each subsequent phase",
          "Verify all 6 phases complete",
        ],
        expectedResults: [
          "All 6 phases execute in order",
          "Each phase pauses for approval",
          "Artifacts are generated per phase",
        ],
        tags: ["blackbox", "agent", "hil"],
      },
      {
        id: "BT-AGENT-002",
        name: "YOLO mode fully autonomous",
        description: "User can run fully autonomous build without prompts",
        severity: "critical",
        status: "pending",
        userStory: "US-AGENT-002",
        component: "agent",
        preconditions: ["User is authenticated"],
        steps: [
          "Run 'pakalon /pakalon \"build a todo app\" --permission-mode yolo'",
          "Verify all phases run without interruption",
          "Verify final output is generated",
        ],
        expectedResults: [
          "No approval prompts appear",
          "All phases complete automatically",
          "Final application is built",
        ],
        tags: ["blackbox", "agent", "yolo"],
      },
      {
        id: "BT-AGENT-003",
        name: "Phase 1 planning generates artifacts",
        description: "Planning phase creates plan.md, spec.md, and other files",
        severity: "high",
        status: "pending",
        userStory: "US-AGENT-003",
        component: "phase1",
        preconditions: ["Agent mode is running"],
        steps: [
          "Start agent mode",
          "Wait for Phase 1 to complete",
          "Verify .pakalon/plan.md exists",
          "Verify .pakalon/spec.md exists",
          "Verify user-stories.md exists",
        ],
        expectedResults: ["All Phase 1 artifacts are generated"],
        tags: ["blackbox", "agent", "phase1"],
      },
      {
        id: "BT-AGENT-004",
        name: "Phase 3 generates frontend code",
        description: "Development phase creates working frontend code",
        severity: "critical",
        status: "pending",
        userStory: "US-AGENT-004",
        component: "phase3",
        preconditions: ["Phase 1 and 2 are complete"],
        steps: [
          "Wait for Phase 3 to complete",
          "Verify source files are created",
          "Verify code compiles without errors",
          "Verify tests pass",
        ],
        expectedResults: [
          "Frontend code is generated",
          "Code compiles successfully",
          "Tests pass",
        ],
        tags: ["blackbox", "agent", "phase3"],
      },
      {
        id: "BT-AGENT-005",
        name: "Phase 4 security scanning runs",
        description: "Security phase runs SAST, DAST, and generates reports",
        severity: "critical",
        status: "pending",
        userStory: "US-AGENT-005",
        component: "phase4",
        preconditions: ["Phase 3 is complete"],
        steps: [
          "Wait for Phase 4 to complete",
          "Verify security-report.md exists",
          "Verify whitebox_testing.xml exists",
          "Verify blackbox_testing.xml exists",
        ],
        expectedResults: [
          "Security scans complete",
          "Reports are generated",
          "XML test files are created",
        ],
        tags: ["blackbox", "agent", "phase4"],
      },
    ];

    return {
      id: "BB-AGENT",
      name: "Agent Mode",
      description: "Autonomous build pipeline behavioral tests",
      type: "blackbox",
      tests,
      userStories: {
        stories: [
          {
            id: "US-AGENT-001",
            title: "As a user, I want autonomous build with checkpoints",
            acceptanceCriteria: [
              "6 phases execute in order",
              "Each phase pauses for approval in HIL mode",
              "Artifacts are generated per phase",
            ],
            tests: tests.filter((t) => t.userStory === "US-AGENT-001"),
          },
        ],
      },
      apiTests: { endpoints: [] },
      integrationTests: { flows: [] },
    };
  }

  private generatePipelineSuite(): BlackboxTestSuite {
    const tests: TestCase[] = [
      {
        id: "BT-PIPE-001",
        name: "CLI commands work",
        description: "All top-level CLI commands execute correctly",
        severity: "high",
        status: "pending",
        component: "cli",
        preconditions: ["Pakalon CLI is installed"],
        steps: [
          "Run 'pakalon --version' and verify output",
          "Run 'pakalon --help' and verify help text",
          "Run 'pakalon doctor' and verify system check",
          "Run 'pakalon models' and verify model list",
        ],
        expectedResults: ["Each command executes and produces expected output"],
        tags: ["blackbox", "cli", "commands"],
      },
      {
        id: "BT-PIPE-002",
        name: "Model management works",
        description: "User can list and set AI models",
        severity: "medium",
        status: "pending",
        component: "models",
        preconditions: ["User is authenticated"],
        steps: [
          "Run 'pakalon models' to list available models",
          "Run 'pakalon models set <model-id>' to set default",
          "Verify model is persisted",
        ],
        expectedResults: ["Models are listed", "Default model is set and persisted"],
        tags: ["blackbox", "models"],
      },
      {
        id: "BT-PIPE-003",
        name: "Session management works",
        description: "User can manage chat sessions",
        severity: "medium",
        status: "pending",
        component: "sessions",
        preconditions: ["User is authenticated"],
        steps: [
          "Run 'pakalon sessions' to list sessions",
          "Run 'pakalon sessions new' to create new session",
          "Run 'pakalon history' to view history",
        ],
        expectedResults: ["Sessions are listed, created, and browsed correctly"],
        tags: ["blackbox", "sessions"],
      },
      {
        id: "BT-PIPE-004",
        name: "Privacy mode suppresses data",
        description: "Privacy mode prevents data storage in external services",
        severity: "high",
        status: "pending",
        component: "privacy",
        preconditions: ["User is authenticated"],
        steps: [
          "Run 'pakalon --privacy'",
          "Send a message containing personal data",
          "Verify Mem0 is not called",
          "Verify telemetry is suppressed",
        ],
        expectedResults: [
          "Personal data is not stored externally",
          "X-Privacy-Mode header is sent",
        ],
        tags: ["blackbox", "privacy"],
      },
    ];

    return {
      id: "BB-PIPE",
      name: "Pipeline & CLI",
      description: "CLI commands and pipeline behavioral tests",
      type: "blackbox",
      tests,
      userStories: {
        stories: [],
      },
      apiTests: { endpoints: [] },
      integrationTests: { flows: [] },
    };
  }

  private generateSecurityBehaviorSuite(): BlackboxTestSuite {
    const tests: TestCase[] = [];
    const severityMap: Record<string, TestSeverity> = {
      CRITICAL: "critical",
      HIGH: "high",
      MEDIUM: "medium",
      LOW: "low",
      INFO: "info",
    };

    for (const finding of this.securityFindings.slice(0, 30)) {
      tests.push({
        id: `BT-SEC-${String(tests.length + 1).padStart(3, "0")}`,
        name: `Security behavior: ${finding.rule || finding.tool}`,
        description: `Verify application handles: ${finding.message}`,
        severity: severityMap[finding.severity] || "medium",
        status: "failed",
        userStory: "US-SEC-001",
        component: "security",
        preconditions: ["Application is running"],
        steps: [
          `Trigger the condition at ${finding.file}${finding.line ? `:${finding.line}` : ""}`,
          "Verify the vulnerability is exploitable",
          "Apply fix",
          "Re-test to verify fix",
        ],
        expectedResults: ["Vulnerability is patched", "No regression in functionality"],
        error: finding.message,
        tags: ["blackbox", "security", finding.severity.toLowerCase()],
      });
    }

    const defaultSecurityTests: TestCase[] = [
      {
        id: "BT-SEC-DEFAULT-001",
        name: "XSS protection",
        description: "Verify application is not vulnerable to cross-site scripting",
        severity: "critical",
        status: "pending",
        userStory: "US-SEC-001",
        component: "security",
        preconditions: ["Application is running"],
        steps: [
          "Submit input with <script>alert('xss')</script>",
          "Verify script is not executed",
          "Verify input is escaped in output",
        ],
        expectedResults: ["Script tags are escaped", "No XSS execution"],
        tags: ["blackbox", "security", "xss"],
      },
      {
        id: "BT-SEC-DEFAULT-002",
        name: "SQL injection protection",
        description: "Verify application is not vulnerable to SQL injection",
        severity: "critical",
        status: "pending",
        userStory: "US-SEC-002",
        component: "security",
        preconditions: ["Application with database is running"],
        steps: [
          "Submit input with SQL injection payload",
          "Verify query executes safely",
          "Verify no data leakage",
        ],
        expectedResults: ["SQL injection fails safely", "No data is leaked"],
        tags: ["blackbox", "security", "sqli"],
      },
      {
        id: "BT-SEC-DEFAULT-003",
        name: "Path traversal protection",
        description: "Verify application is not vulnerable to path traversal",
        severity: "high",
        status: "pending",
        userStory: "US-SEC-003",
        component: "security",
        preconditions: ["Application with file access is running"],
        steps: [
          "Request file with ../../etc/passwd path",
          "Verify access is denied",
          "Verify file outside allowed directory is not accessible",
        ],
        expectedResults: ["Path traversal is blocked", "Only allowed files are accessible"],
        tags: ["blackbox", "security", "path-traversal"],
      },
      {
        id: "BT-SEC-DEFAULT-004",
        name: "Rate limiting works",
        description: "Verify API has rate limiting to prevent abuse",
        severity: "medium",
        status: "pending",
        userStory: "US-SEC-004",
        component: "security",
        preconditions: ["API is running"],
        steps: [
          "Send rapid successive requests",
          "Verify rate limit is enforced",
          "Verify 429 response is returned",
        ],
        expectedResults: ["Rate limit is enforced after threshold", "429 status returned"],
        tags: ["blackbox", "security", "rate-limiting"],
      },
    ];

    return {
      id: "BB-SEC",
      name: "Security Behavior",
      description: "External security behavior and vulnerability tests",
      type: "blackbox",
      tests: [...defaultSecurityTests, ...tests],
      userStories: {
        stories: [
          {
            id: "US-SEC-001",
            title: "As a user, I want the application to be secure",
            acceptanceCriteria: [
              "No XSS vulnerabilities",
              "No SQL injection vulnerabilities",
              "No path traversal vulnerabilities",
              "Rate limiting is enforced",
            ],
            tests: [...defaultSecurityTests, ...tests].filter(
              (t) => t.userStory === "US-SEC-001" || !t.userStory,
            ),
          },
        ],
      },
      apiTests: { endpoints: [] },
      integrationTests: { flows: [] },
    };
  }

  private generateApiSuite(): BlackboxTestSuite {
    const tests: TestCase[] = [
      {
        id: "BT-API-001",
        name: "Backend health endpoint",
        description: "Verify backend health check returns 200",
        severity: "high",
        status: "pending",
        component: "api",
        preconditions: ["Backend is running on localhost:8000"],
        steps: [
          "GET http://localhost:8000/health",
          "Verify response status is 200",
          "Verify response body contains health status",
        ],
        expectedResults: ["Status 200", "Healthy response body"],
        tags: ["blackbox", "api", "health"],
      },
      {
        id: "BT-API-002",
        name: "Model catalog endpoint",
        description: "Verify model catalog returns available models",
        severity: "high",
        status: "pending",
        component: "api",
        preconditions: ["Backend is running", "User is authenticated"],
        steps: [
          "GET /models with valid JWT",
          "Verify response contains model list",
          "Verify each model has required fields",
        ],
        expectedResults: ["Model list is returned", "Models have id, name, provider fields"],
        tags: ["blackbox", "api", "models"],
      },
      {
        id: "BT-API-003",
        name: "Session history endpoint",
        description: "Verify session history returns chat sessions",
        severity: "medium",
        status: "pending",
        component: "api",
        preconditions: ["Backend is running", "User has chat sessions"],
        steps: [
          "GET /sessions with valid JWT",
          "Verify response contains session list",
          "Verify sessions have id, created_at fields",
        ],
        expectedResults: ["Session list is returned", "Sessions have required fields"],
        tags: ["blackbox", "api", "sessions"],
      },
      {
        id: "BT-API-004",
        name: "Unauthorized access is rejected",
        description: "Verify API rejects requests without valid JWT",
        severity: "critical",
        status: "pending",
        component: "api",
        preconditions: ["Backend is running"],
        steps: [
          "GET /models without JWT",
          "GET /sessions without JWT",
          "Verify both return 401",
        ],
        expectedResults: ["Both endpoints return 401 Unauthorized"],
        tags: ["blackbox", "api", "auth"],
      },
    ];

    const endpoints: ApiEndpointTest[] = [
      {
        method: "GET",
        path: "/health",
        description: "Health check endpoint",
        tests: tests.filter((t) => t.id === "BT-API-001"),
      },
      {
        method: "GET",
        path: "/models",
        description: "Model catalog endpoint",
        tests: tests.filter((t) => t.id === "BT-API-002"),
      },
      {
        method: "GET",
        path: "/sessions",
        description: "Session history endpoint",
        tests: tests.filter((t) => t.id === "BT-API-003"),
      },
    ];

    return {
      id: "BB-API",
      name: "API Tests",
      description: "REST API endpoint behavioral tests",
      type: "blackbox",
      tests,
      userStories: { stories: [] },
      apiTests: { endpoints },
      integrationTests: { flows: [] },
    };
  }

  private generateIntegrationFlowSuite(): BlackboxTestSuite {
    const flows: IntegrationFlow[] = [
      {
        name: "Full build pipeline",
        description: "End-to-end test of the 6-phase autonomous build",
        steps: [
          {
            action: "Start agent mode with a prompt",
            expectedOutcome: "Phase 1 planning begins",
            testCaseId: "BT-AGENT-001",
          },
          {
            action: "Approve Phase 1 output",
            expectedOutcome: "Phase 2 wireframe generation begins",
            testCaseId: "BT-AGENT-001",
          },
          {
            action: "Approve Phase 2 wireframes",
            expectedOutcome: "Phase 3 frontend development begins",
            testCaseId: "BT-AGENT-001",
          },
          {
            action: "Approve Phase 3 code",
            expectedOutcome: "Phase 4 security scanning begins",
            testCaseId: "BT-AGENT-001",
          },
          {
            action: "Review Phase 4 security report",
            expectedOutcome: "Phase 5 CI/CD setup begins",
            testCaseId: "BT-AGENT-001",
          },
          {
            action: "Approve Phase 5 pipeline",
            expectedOutcome: "Phase 6 documentation generation begins",
            testCaseId: "BT-AGENT-001",
          },
          {
            action: "Complete Phase 6",
            expectedOutcome: "Full application is built and documented",
            testCaseId: "BT-AGENT-001",
          },
        ],
      },
      {
        name: "Chat to code workflow",
        description: "User asks for code changes in chat mode",
        steps: [
          {
            action: "Enter edit mode via /edit",
            expectedOutcome: "File selection interface appears",
            testCaseId: "BT-CHAT-003",
          },
          {
            action: "Select a file to edit",
            expectedOutcome: "File content is loaded into editor",
            testCaseId: "BT-CHAT-003",
          },
          {
            action: "Request a code change",
            expectedOutcome: "AI generates the code change",
            testCaseId: "BT-CHAT-002",
          },
          {
            action: "Apply the change",
            expectedOutcome: "File is updated on disk",
            testCaseId: "BT-CHAT-002",
          },
        ],
      },
      {
        name: "Security feedback loop",
        description: "Security scan finds and fixes vulnerabilities",
        steps: [
          {
            action: "Run Phase 4 security scan",
            expectedOutcome: "Vulnerabilities are identified",
            testCaseId: "BT-AGENT-005",
          },
          {
            action: "Review security findings",
            expectedOutcome: "Critical and high issues are listed",
            testCaseId: "BT-AGENT-005",
          },
          {
            action: "Apply automated patches",
            expectedOutcome: "Fixable vulnerabilities are patched",
            testCaseId: "BT-AGENT-005",
          },
          {
            action: "Re-scan after patches",
            expectedOutcome: "Patched vulnerabilities no longer appear",
            testCaseId: "BT-AGENT-005",
          },
        ],
      },
    ];

    const tests: TestCase[] = [
      {
        id: "BT-FLOW-001",
        name: "End-to-end build pipeline",
        description: "Complete 6-phase autonomous build from prompt to deployment",
        severity: "critical",
        status: "pending",
        userStory: "US-FLOW-001",
        component: "pipeline",
        preconditions: ["User is authenticated", "Target project directory exists"],
        steps: flows[0]?.steps.map((s) => s.action) ?? [],
        expectedResults: flows[0]?.steps.map((s) => s.expectedOutcome) ?? [],
        tags: ["blackbox", "e2e", "pipeline"],
      },
      {
        id: "BT-FLOW-002",
        name: "Chat-to-code workflow",
        description: "User edits code through chat interface",
        severity: "high",
        status: "pending",
        userStory: "US-FLOW-002",
        component: "chat",
        preconditions: ["User is authenticated", "Project has source files"],
        steps: flows[1]?.steps.map((s) => s.action) ?? [],
        expectedResults: flows[1]?.steps.map((s) => s.expectedOutcome) ?? [],
        tags: ["blackbox", "e2e", "chat"],
      },
      {
        id: "BT-FLOW-003",
        name: "Security feedback loop",
        description: "Vulnerabilities are found, patched, and verified",
        severity: "critical",
        status: "pending",
        userStory: "US-FLOW-003",
        component: "security",
        preconditions: ["Phase 3 code is generated"],
        steps: flows[2]?.steps.map((s) => s.action) ?? [],
        expectedResults: flows[2]?.steps.map((s) => s.expectedOutcome) ?? [],
        tags: ["blackbox", "e2e", "security"],
      },
    ];

    return {
      id: "BB-FLOW",
      name: "Integration Flows",
      description: "End-to-end integration flow tests",
      type: "blackbox",
      tests,
      userStories: {
        stories: [
          {
            id: "US-FLOW-001",
            title: "As a user, I want to build an app from a single prompt",
            acceptanceCriteria: [
              "All 6 phases complete",
              "Working application is generated",
              "Documentation is created",
            ],
            tests: tests.filter((t) => t.userStory === "US-FLOW-001"),
          },
        ],
      },
      apiTests: { endpoints: [] },
      integrationTests: { flows },
    };
  }
}

export interface BlackboxTestSuite {
  id: string;
  name: string;
  description: string;
  type: "blackbox";
  tests: TestCase[];
  userStories: UserStorySection;
  apiTests: ApiTestSection;
  integrationTests: IntegrationTestSection;
}
