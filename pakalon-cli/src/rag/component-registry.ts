import * as fs from "fs";
import * as path from "path";

export interface ComponentEntry {
  id: string;
  name: string;
  description: string;
  category: 'ui' | 'navigation' | 'form' | 'data-display' | 'feedback' | 'layout';
  framework: 'react' | 'vue' | 'html' | 'css';
  tags: string[];
  sourceUrl: string;
  code: string;
  preview?: string;
  complexity: 'simple' | 'medium' | 'complex';
  dependencies?: string[];
}

export interface ComponentRegistry {
  version: string;
  updatedAt: string;
  components: ComponentEntry[];
}

export const COMPONENT_REGISTRY_VERSION = "1.0.0";
export const COMPONENT_REGISTRY_RELATIVE_PATH = path.join(".pakalon-agents", "ai-agents", "component-registry.json");

export const CURATED_COMPONENT_SOURCES = [
  "https://lightswind.com",
  "https://reactbits.dev",
  "https://daisyui.com",
  "https://preline.co",
  "https://tailwindflex.com",
  "https://dribbble.com",
  "https://magicui.design",
  "https://aura.build",
  "https://shadcnstudio.com",
  "https://tweakcn.com",
  "https://componentsui.com",
  "https://ui.shadcn.com",
  "https://flowbite.com",
  "https://mantine.dev",
  "https://chakra-ui.com",
  "https://ui.aceternity.com",
  "https://kokonutui.com",
] as const;

export function getComponentRegistryPath(projectDir: string = process.cwd()): string {
  return path.join(path.resolve(projectDir), COMPONENT_REGISTRY_RELATIVE_PATH);
}

export function getComponentRegistryDir(projectDir: string = process.cwd()): string {
  return path.dirname(getComponentRegistryPath(projectDir));
}

export function ensureComponentRegistryDir(projectDir: string = process.cwd()): void {
  fs.mkdirSync(getComponentRegistryDir(projectDir), { recursive: true });
}

export function createEmptyComponentRegistry(): ComponentRegistry {
  return {
    version: COMPONENT_REGISTRY_VERSION,
    updatedAt: new Date().toISOString(),
    components: [],
  };
}

export function readComponentRegistry(projectDir: string = process.cwd()): ComponentRegistry {
  const filePath = getComponentRegistryPath(projectDir);
  if (!fs.existsSync(filePath)) return createEmptyComponentRegistry();

  const raw = fs.readFileSync(filePath, "utf-8");
  const parsed = JSON.parse(raw) as Partial<ComponentRegistry>;

  return {
    version: parsed.version ?? COMPONENT_REGISTRY_VERSION,
    updatedAt: parsed.updatedAt ?? new Date().toISOString(),
    components: Array.isArray(parsed.components) ? (parsed.components as ComponentEntry[]) : [],
  };
}

export function writeComponentRegistry(registry: ComponentRegistry, projectDir: string = process.cwd()): string {
  ensureComponentRegistryDir(projectDir);
  const filePath = getComponentRegistryPath(projectDir);
  fs.writeFileSync(filePath, `${JSON.stringify(registry, null, 2)}\n`, "utf-8");
  return filePath;
}

export function upsertComponents(registry: ComponentRegistry, components: ComponentEntry[]): ComponentRegistry {
  const byId = new Map(registry.components.map((component) => [component.id, component] as const));
  for (const component of components) byId.set(component.id, component);
  return {
    version: registry.version || COMPONENT_REGISTRY_VERSION,
    updatedAt: new Date().toISOString(),
    components: Array.from(byId.values()),
  };
}

export const bundledComponentRegistry: ComponentRegistry = {
  version: COMPONENT_REGISTRY_VERSION,
  updatedAt: new Date().toISOString(),
  components: [
    {
      id: "button-primary-react",
      name: "Primary Button",
      description: "A compact primary action button with loading and disabled states.",
      category: "ui",
      framework: "react",
      tags: ["button", "cta", "primary", "interactive"],
      sourceUrl: "pakalon://bundled/button-primary-react",
      code: `export function PrimaryButton({ children, loading = false, disabled = false, ...props }: React.ButtonHTMLAttributes<HTMLButtonElement> & { loading?: boolean }) {
  return (
    <button
      {...props}
      disabled={disabled || loading}
      className="inline-flex items-center justify-center rounded-lg bg-slate-900 px-4 py-2 text-sm font-medium text-white transition hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-60"
    >
      {loading ? "Loading..." : children}
    </button>
  );
}`,
      complexity: "simple",
      dependencies: ["react"],
    },
    {
      id: "sidebar-nav-react",
      name: "Sidebar Navigation",
      description: "Responsive navigation rail with active state highlighting.",
      category: "navigation",
      framework: "react",
      tags: ["sidebar", "nav", "navigation", "responsive"],
      sourceUrl: "pakalon://bundled/sidebar-nav-react",
      code: `export function SidebarNav({ items }: { items: Array<{ label: string; href: string; active?: boolean }> }) {
  return (
    <aside className="w-64 border-r border-slate-200 bg-white p-4">
      <nav className="space-y-1">
        {items.map((item) => (
          <a
            key={item.href}
            href={item.href}
            className={item.active ? "block rounded-md bg-slate-900 px-3 py-2 text-sm text-white" : "block rounded-md px-3 py-2 text-sm text-slate-600 hover:bg-slate-100"}
          >
            {item.label}
          </a>
        ))}
      </nav>
    </aside>
  );
}`,
      complexity: "medium",
      dependencies: ["react"],
    },
    {
      id: "stat-card-react",
      name: "Stat Card",
      description: "A dashboard data card for metrics, trends, and delta display.",
      category: "data-display",
      framework: "react",
      tags: ["card", "metric", "dashboard", "analytics"],
      sourceUrl: "pakalon://bundled/stat-card-react",
      code: `export function StatCard({ label, value, delta }: { label: string; value: string; delta?: string }) {
  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
      <p className="text-sm text-slate-500">{label}</p>
      <div className="mt-2 flex items-end justify-between gap-4">
        <span className="text-3xl font-semibold text-slate-900">{value}</span>
        {delta ? <span className="text-sm font-medium text-emerald-600">{delta}</span> : null}
      </div>
    </div>
  );
}`,
      complexity: "simple",
      dependencies: ["react"],
    },
    {
      id: "auth-form-react",
      name: "Authentication Form",
      description: "Email/password form with inline validation and submit state.",
      category: "form",
      framework: "react",
      tags: ["form", "auth", "login", "validation"],
      sourceUrl: "pakalon://bundled/auth-form-react",
      code: `export function AuthForm() {
  return (
    <form className="space-y-4 rounded-2xl border border-slate-200 bg-white p-6">
      <div>
        <label className="mb-1 block text-sm font-medium text-slate-700">Email</label>
        <input className="w-full rounded-lg border border-slate-300 px-3 py-2" type="email" />
      </div>
      <div>
        <label className="mb-1 block text-sm font-medium text-slate-700">Password</label>
        <input className="w-full rounded-lg border border-slate-300 px-3 py-2" type="password" />
      </div>
      <button className="w-full rounded-lg bg-slate-900 px-4 py-2 text-white">Sign in</button>
    </form>
  );
}`,
      complexity: "medium",
      dependencies: ["react"],
    },
    {
      id: "toast-feedback-react",
      name: "Toast Feedback",
      description: "Transient feedback toast for success and error notifications.",
      category: "feedback",
      framework: "react",
      tags: ["toast", "notification", "alert", "feedback"],
      sourceUrl: "pakalon://bundled/toast-feedback-react",
      code: `export function Toast({ title, message, tone = "success" }: { title: string; message: string; tone?: "success" | "error" }) {
  return (
    <div className={tone === "success" ? "rounded-lg border border-emerald-200 bg-emerald-50 p-4" : "rounded-lg border border-rose-200 bg-rose-50 p-4"}>
      <p className="font-medium">{title}</p>
      <p className="text-sm opacity-80">{message}</p>
    </div>
  );
}`,
      complexity: "simple",
      dependencies: ["react"],
    },
    {
      id: "app-shell-layout-react",
      name: "App Shell Layout",
      description: "Shell layout with header, sidebar, and content region scaffolding.",
      category: "layout",
      framework: "react",
      tags: ["layout", "shell", "app", "responsive"],
      sourceUrl: "pakalon://bundled/app-shell-layout-react",
      code: `export function AppShellLayout({ sidebar, children }: { sidebar: React.ReactNode; children: React.ReactNode }) {
  return (
    <div className="grid min-h-screen grid-cols-1 md:grid-cols-[280px_1fr]">
      <div>{sidebar}</div>
      <main className="bg-slate-50 p-6">{children}</main>
    </div>
  );
}`,
      complexity: "medium",
      dependencies: ["react"],
    },
  ],
};
