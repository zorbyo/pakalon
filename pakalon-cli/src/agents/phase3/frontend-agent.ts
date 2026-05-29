/**
 * Phase 3 Sub-Agent: Frontend Agent
 * Generates React/Next.js components
 * 
 * Creates: Components, Pages, Hooks, State Management
 * 
 * Enhanced with phase document context consumption
 */

import { BaseAgent } from '../base-agent.js';
import type { AgentConfig, AgentContext, AgentResult } from '../types.js';
import { generateText } from 'ai';
import { openrouter } from '@openrouter/ai-sdk-provider';
import { getToolsForAI } from '@/tools/registry-new.js';
import * as path from 'path';
import * as fs from 'fs/promises';
import logger from '@/utils/logger.js';

const FRONTEND_AGENT_PROMPT_BASE = `You are the Frontend Development Agent for Pakalon Phase 3.

Your responsibilities:
1. Generate React/Next.js components
2. Create pages with proper routing
3. Implement state management
4. Add Tailwind CSS styling
5. Follow React best practices and patterns

You must use natural language. Explain component architecture clearly.`;

export interface FrontendAgentOptions {
  framework: 'react' | 'nextjs';
  outputDir: string;
  designSystem: any;
  phaseContext?: string;       // NEW: Phase document context
  wireframes?: string[];       // NEW: Wireframe files from Phase 2
}

export class FrontendAgent extends BaseAgent {
  private options: FrontendAgentOptions;
  
  constructor(context: AgentContext, options: FrontendAgentOptions) {
    // Build enhanced system prompt with phase context
    let systemPrompt = FRONTEND_AGENT_PROMPT_BASE;
    
    if (options.phaseContext) {
      systemPrompt += `

=== PHASE CONTEXT ===
${options.phaseContext}
`;
    }
    
    if (options.wireframes && options.wireframes.length > 0) {
      systemPrompt += `

=== WIREFRAMES TO REFERENCE ===
${options.wireframes.join(', ')}
`;
    }
    
    const config: AgentConfig = {
      name: 'frontend-agent',
      model: context.apiKey ? 'anthropic/claude-3-5-sonnet' : 'anthropic/claude-3-5-haiku',
      systemPrompt,
      tools: getToolsForAI(),
      maxTokens: 12288,
      temperature: 0.4,
    };
    
    super(config, context);
    this.options = options;
    
    logger.info(`[FrontendAgent] Initialized for ${options.framework}`);
    if (options.phaseContext) {
      logger.info('[FrontendAgent] Phase context loaded');
    }
  }
  
  public async execute(): Promise<AgentResult> {
    const startTime = Date.now();
    const filesCreated: string[] = [];
    
    try {
      logger.info('[FrontendAgent] ========================================');
      logger.info(`[FrontendAgent] Generating ${this.options.framework.toUpperCase()} frontend`);
      logger.info('[FrontendAgent] ========================================');
      
      await fs.mkdir(this.options.outputDir, { recursive: true });
      
      // Step 1: Generate base components
      logger.info('[FrontendAgent] Step 1/6: Base Components');
      const components = await this.generateComponents();
      filesCreated.push(...components);
      
      // Step 2: Generate pages
      logger.info('[FrontendAgent] Step 2/6: Pages');
      const pages = await this.generatePages();
      filesCreated.push(...pages);
      
      // Step 3: Generate hooks
      logger.info('[FrontendAgent] Step 3/6: Custom Hooks');
      const hooks = await this.generateHooks();
      filesCreated.push(...hooks);
      
      // Step 4: Generate state management
      logger.info('[FrontendAgent] Step 4/6: State Management');
      const stateFiles = await this.generateStateManagement();
      filesCreated.push(...stateFiles);
      
      // Step 5: Generate Tailwind config
      logger.info('[FrontendAgent] Step 5/6: Tailwind Configuration');
      const tailwindConfig = await this.generateTailwindConfig();
      filesCreated.push(tailwindConfig);
      
      // Step 6: Generate layout components
      logger.info('[FrontendAgent] Step 6/6: Layout Components');
      const layouts = await this.generateLayouts();
      filesCreated.push(...layouts);
      
      const duration = Date.now() - startTime;
      
      logger.info('[FrontendAgent] ========================================');
      logger.info(`[FrontendAgent] Complete in ${(duration / 1000).toFixed(1)}s`);
      logger.info(`[FrontendAgent] Generated ${filesCreated.length} files`);
      logger.info('[FrontendAgent] ========================================');
      
      return {
        success: true,
        message: `${this.options.framework.toUpperCase()} frontend generated`,
        filesCreated,
        duration,
      };
      
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      logger.error(`[FrontendAgent] Failed: ${message}`);
      
      return {
        success: false,
        message: `Frontend agent failed: ${message}`,
        duration: Date.now() - startTime,
      };
    }
  }
  
  private async generateComponents(): Promise<string[]> {
    const componentsDir = path.join(this.options.outputDir, 'components');
    await fs.mkdir(componentsDir, { recursive: true });
    
    const files: string[] = [];
    
    // Button component
    const buttonPath = path.join(componentsDir, 'Button.tsx');
    await fs.writeFile(buttonPath, this.generateButton(), 'utf-8');
    files.push(buttonPath);
    
    // Input component
    const inputPath = path.join(componentsDir, 'Input.tsx');
    await fs.writeFile(inputPath, this.generateInput(), 'utf-8');
    files.push(inputPath);
    
    // Card component
    const cardPath = path.join(componentsDir, 'Card.tsx');
    await fs.writeFile(cardPath, this.generateCard(), 'utf-8');
    files.push(cardPath);
    
    // Modal component
    const modalPath = path.join(componentsDir, 'Modal.tsx');
    await fs.writeFile(modalPath, this.generateModal(), 'utf-8');
    files.push(modalPath);
    
    logger.info(`[FrontendAgent] [OK] Generated ${files.length} components`);
    
    return files;
  }
  
  private generateButton(): string {
    return `/**
 * Button Component
 * Generated by Pakalon Frontend Agent
 */

import React from 'react';
import { cn } from '../utils/cn';

export interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: 'primary' | 'secondary' | 'outline' | 'ghost';
  size?: 'sm' | 'md' | 'lg';
  children: React.ReactNode;
}

export function Button({
  variant = 'primary',
  size = 'md',
  className,
  children,
  ...props
}: ButtonProps) {
  const baseStyles = 'inline-flex items-center justify-center rounded-md font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50';
  
  const variants = {
    primary: 'bg-blue-600 text-white hover:bg-blue-700 focus-visible:ring-blue-600',
    secondary: 'bg-gray-200 text-gray-900 hover:bg-gray-300 focus-visible:ring-gray-500',
    outline: 'border border-gray-300 bg-white hover:bg-gray-50 focus-visible:ring-gray-500',
    ghost: 'hover:bg-gray-100 focus-visible:ring-gray-500',
  };
  
  const sizes = {
    sm: 'h-8 px-3 text-sm',
    md: 'h-10 px-4',
    lg: 'h-12 px-6 text-lg',
  };
  
  return (
    <button
      className={cn(baseStyles, variants[variant], sizes[size], className)}
      {...props}
    >
      {children}
    </button>
  );
}
`;
  }
  
  private generateInput(): string {
    return `/**
 * Input Component
 * Generated by Pakalon Frontend Agent
 */

import React from 'react';
import { cn } from '../utils/cn';

export interface InputProps extends React.InputHTMLAttributes<HTMLInputElement> {
  label?: string;
  error?: string;
}

export const Input = React.forwardRef<HTMLInputElement, InputProps>(
  ({ label, error, className, ...props }, ref) => {
    return (
      <div className="w-full">
        {label && (
          <label className="block text-sm font-medium text-gray-700 mb-1">
            {label}
          </label>
        )}
        <input
          ref={ref}
          className={cn(
            'flex h-10 w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm',
            'placeholder:text-gray-400',
            'focus:outline-none focus:ring-2 focus:ring-blue-600 focus:ring-offset-2',
            'disabled:cursor-not-allowed disabled:opacity-50',
            error && 'border-red-500 focus:ring-red-600',
            className
          )}
          {...props}
        />
        {error && (
          <p className="mt-1 text-sm text-red-600">{error}</p>
        )}
      </div>
    );
  }
);

Input.displayName = 'Input';
`;
  }
  
  private generateCard(): string {
    return `/**
 * Card Component
 * Generated by Pakalon Frontend Agent
 */

import React from 'react';
import { cn } from '../utils/cn';

export interface CardProps extends React.HTMLAttributes<HTMLDivElement> {
  children: React.ReactNode;
}

export function Card({ className, children, ...props }: CardProps) {
  return (
    <div
      className={cn(
        'rounded-lg border border-gray-200 bg-white p-6 shadow-sm',
        className
      )}
      {...props}
    >
      {children}
    </div>
  );
}

export interface CardHeaderProps extends React.HTMLAttributes<HTMLDivElement> {
  children: React.ReactNode;
}

export function CardHeader({ className, children, ...props }: CardHeaderProps) {
  return (
    <div className={cn('mb-4', className)} {...props}>
      {children}
    </div>
  );
}

export interface CardTitleProps extends React.HTMLAttributes<HTMLHeadingElement> {
  children: React.ReactNode;
}

export function CardTitle({ className, children, ...props }: CardTitleProps) {
  return (
    <h3 className={cn('text-xl font-semibold text-gray-900', className)} {...props}>
      {children}
    </h3>
  );
}

export interface CardContentProps extends React.HTMLAttributes<HTMLDivElement> {
  children: React.ReactNode;
}

export function CardContent({ className, children, ...props }: CardContentProps) {
  return (
    <div className={cn('text-gray-600', className)} {...props}>
      {children}
    </div>
  );
}
`;
  }
  
  private generateModal(): string {
    return `/**
 * Modal Component
 * Generated by Pakalon Frontend Agent
 */

import React, { useEffect } from 'react';
import { cn } from '../utils/cn';

export interface ModalProps {
  isOpen: boolean;
  onClose: () => void;
  title?: string;
  children: React.ReactNode;
  className?: string;
}

export function Modal({ isOpen, onClose, title, children, className }: ModalProps) {
  useEffect(() => {
    if (isOpen) {
      document.body.style.overflow = 'hidden';
    } else {
      document.body.style.overflow = 'unset';
    }
    
    return () => {
      document.body.style.overflow = 'unset';
    };
  }, [isOpen]);
  
  if (!isOpen) return null;
  
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      {/* Backdrop */}
      <div
        className="absolute inset-0 bg-black/50"
        onClick={onClose}
        aria-hidden="true"
      />
      
      {/* Modal */}
      <div
        className={cn(
          'relative z-10 w-full max-w-md rounded-lg bg-white p-6 shadow-xl',
          className
        )}
      >
        {title && (
          <div className="mb-4 flex items-center justify-between">
            <h2 className="text-xl font-semibold text-gray-900">{title}</h2>
            <button
              onClick={onClose}
              className="text-gray-400 hover:text-gray-600"
              aria-label="Close modal"
            >
              <svg className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>
        )}
        
        <div>{children}</div>
      </div>
    </div>
  );
}
`;
  }
  
  private async generatePages(): Promise<string[]> {
    const pagesDir = path.join(this.options.outputDir, this.options.framework === 'nextjs' ? 'app' : 'pages');
    await fs.mkdir(pagesDir, { recursive: true });
    
    const files: string[] = [];
    
    // Home page
    const homePath = path.join(pagesDir, this.options.framework === 'nextjs' ? 'page.tsx' : 'Home.tsx');
    await fs.writeFile(homePath, this.generateHomePage(), 'utf-8');
    files.push(homePath);
    
    // Dashboard page
    const dashboardDir = path.join(pagesDir, 'dashboard');
    await fs.mkdir(dashboardDir, { recursive: true });
    const dashboardPath = path.join(dashboardDir, this.options.framework === 'nextjs' ? 'page.tsx' : 'Dashboard.tsx');
    await fs.writeFile(dashboardPath, this.generateDashboard(), 'utf-8');
    files.push(dashboardPath);
    
    logger.info(`[FrontendAgent] [OK] Generated ${files.length} pages`);
    
    return files;
  }
  
  private generateHomePage(): string {
    return `/**
 * Home Page
 * Generated by Pakalon Frontend Agent
 */

import React from 'react';
import { Button } from '../components/Button';
import { Card, CardHeader, CardTitle, CardContent } from '../components/Card';

export default function HomePage() {
  return (
    <div className="min-h-screen bg-gray-50">
      <div className="mx-auto max-w-7xl px-4 py-16 sm:px-6 lg:px-8">
        {/* Hero Section */}
        <div className="text-center">
          <h1 className="text-4xl font-bold tracking-tight text-gray-900 sm:text-6xl">
            Welcome to Your App
          </h1>
          <p className="mt-6 text-lg leading-8 text-gray-600">
            Generated by Pakalon - Enterprise-grade application development
          </p>
          <div className="mt-10 flex items-center justify-center gap-x-6">
            <Button variant="primary" size="lg">
              Get Started
            </Button>
            <Button variant="outline" size="lg">
              Learn More
            </Button>
          </div>
        </div>
        
        {/* Features Section */}
        <div className="mt-20 grid grid-cols-1 gap-8 sm:grid-cols-2 lg:grid-cols-3">
          <Card>
            <CardHeader>
              <CardTitle>Fast & Modern</CardTitle>
            </CardHeader>
            <CardContent>
              Built with the latest technologies for optimal performance
            </CardContent>
          </Card>
          
          <Card>
            <CardHeader>
              <CardTitle>Fully Responsive</CardTitle>
            </CardHeader>
            <CardContent>
              Works perfectly on desktop, tablet, and mobile devices
            </CardContent>
          </Card>
          
          <Card>
            <CardHeader>
              <CardTitle>Enterprise Ready</CardTitle>
            </CardHeader>
            <CardContent>
              Production-ready with best practices and security built-in
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
`;
  }
  
  private generateDashboard(): string {
    return `/**
 * Dashboard Page
 * Generated by Pakalon Frontend Agent
 */

import React from 'react';
import { Card, CardHeader, CardTitle, CardContent } from '../../components/Card';

export default function DashboardPage() {
  return (
    <div className="min-h-screen bg-gray-50">
      <div className="mx-auto max-w-7xl px-4 py-8 sm:px-6 lg:px-8">
        <h1 className="text-3xl font-bold text-gray-900">Dashboard</h1>
        
        <div className="mt-8 grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-4">
          <Card>
            <CardHeader>
              <CardTitle>Total Users</CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-3xl font-bold text-gray-900">1,234</p>
              <p className="text-sm text-green-600">+12% from last month</p>
            </CardContent>
          </Card>
          
          <Card>
            <CardHeader>
              <CardTitle>Revenue</CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-3xl font-bold text-gray-900">$45,231</p>
              <p className="text-sm text-green-600">+8% from last month</p>
            </CardContent>
          </Card>
          
          <Card>
            <CardHeader>
              <CardTitle>Active Sessions</CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-3xl font-bold text-gray-900">573</p>
              <p className="text-sm text-gray-600">Currently online</p>
            </CardContent>
          </Card>
          
          <Card>
            <CardHeader>
              <CardTitle>Conversion Rate</CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-3xl font-bold text-gray-900">3.2%</p>
              <p className="text-sm text-red-600">-2% from last month</p>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
`;
  }
  
  private async generateHooks(): Promise<string[]> {
    const hooksDir = path.join(this.options.outputDir, 'hooks');
    await fs.mkdir(hooksDir, { recursive: true });
    
    const files: string[] = [];
    
    // useApi hook
    const useApiPath = path.join(hooksDir, 'useApi.ts');
    await fs.writeFile(useApiPath, this.generateUseApiHook(), 'utf-8');
    files.push(useApiPath);
    
    logger.info(`[FrontendAgent] [OK] Generated ${files.length} custom hooks`);
    
    return files;
  }
  
  private generateUseApiHook(): string {
    return `/**
 * useApi Hook
 * Generated by Pakalon Frontend Agent
 */

import { useState, useCallback } from 'react';

interface UseApiOptions {
  onSuccess?: (data: any) => void;
  onError?: (error: Error) => void;
}

export function useApi<T = any>(
  apiFunction: (...args: any[]) => Promise<T>,
  options: UseApiOptions = {}
) {
  const [data, setData] = useState<T | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<Error | null>(null);
  
  const execute = useCallback(
    async (...args: any[]) => {
      setLoading(true);
      setError(null);
      
      try {
        const result = await apiFunction(...args);
        setData(result);
        options.onSuccess?.(result);
        return result;
      } catch (err) {
        const error = err instanceof Error ? err : new Error(String(err));
        setError(error);
        options.onError?.(error);
        throw error;
      } finally {
        setLoading(false);
      }
    },
    [apiFunction, options]
  );
  
  return { data, loading, error, execute };
}
`;
  }
  
  private async generateStateManagement(): Promise<string[]> {
    const storeDir = path.join(this.options.outputDir, 'store');
    await fs.mkdir(storeDir, { recursive: true });
    
    const files: string[] = [];
    
    // Zustand store
    const storePath = path.join(storeDir, 'useStore.ts');
    await fs.writeFile(storePath, this.generateZustandStore(), 'utf-8');
    files.push(storePath);
    
    logger.info(`[FrontendAgent] [OK] Generated state management`);
    
    return files;
  }
  
  private generateZustandStore(): string {
    return `/**
 * Zustand Store
 * Generated by Pakalon Frontend Agent
 */

import { create } from 'zustand';
import { devtools, persist } from 'zustand/middleware';

interface User {
  id: string;
  email: string;
  name: string;
}

interface StoreState {
  user: User | null;
  setUser: (user: User | null) => void;
  logout: () => void;
}

export const useStore = create<StoreState>()(
  devtools(
    persist(
      (set) => ({
        user: null,
        setUser: (user) => set({ user }),
        logout: () => set({ user: null }),
      }),
      {
        name: 'app-storage',
      }
    )
  )
);
`;
  }
  
  private async generateTailwindConfig(): Promise<string> {
    const configPath = path.join(this.options.outputDir, '..', 'tailwind.config.ts');
    
    const colors = this.options.designSystem?.colors || {};
    
    const config = `/**
 * Tailwind CSS Configuration
 * Generated by Pakalon Frontend Agent
 */

import type { Config } from 'tailwindcss';

const config: Config = {
  content: [
    './pages/**/*.{js,ts,jsx,tsx,mdx}',
    './components/**/*.{js,ts,jsx,tsx,mdx}',
    './app/**/*.{js,ts,jsx,tsx,mdx}',
  ],
  theme: {
    extend: {
      colors: ${JSON.stringify(colors, null, 6)},
    },
  },
  plugins: [],
};

export default config;
`;
    
    await fs.writeFile(configPath, config, 'utf-8');
    logger.info(`[FrontendAgent] [OK] Generated Tailwind config`);
    
    return configPath;
  }
  
  private async generateLayouts(): Promise<string[]> {
    const layoutsDir = path.join(this.options.outputDir, 'components', 'layouts');
    await fs.mkdir(layoutsDir, { recursive: true });
    
    const files: string[] = [];
    
    // Main layout
    const layoutPath = path.join(layoutsDir, 'MainLayout.tsx');
    await fs.writeFile(layoutPath, this.generateMainLayout(), 'utf-8');
    files.push(layoutPath);
    
    logger.info(`[FrontendAgent] [OK] Generated layout components`);
    
    return files;
  }
  
  private generateMainLayout(): string {
    return `/**
 * Main Layout
 * Generated by Pakalon Frontend Agent
 */

import React from 'react';

export interface MainLayoutProps {
  children: React.ReactNode;
}

export function MainLayout({ children }: MainLayoutProps) {
  return (
    <div className="min-h-screen bg-gray-50">
      <header className="bg-white shadow">
        <div className="mx-auto max-w-7xl px-4 py-6 sm:px-6 lg:px-8">
          <h1 className="text-3xl font-bold tracking-tight text-gray-900">
            Your App
          </h1>
        </div>
      </header>
      
      <main>{children}</main>
      
      <footer className="bg-white">
        <div className="mx-auto max-w-7xl px-4 py-6 sm:px-6 lg:px-8">
          <p className="text-center text-gray-600">
            © 2024 Your App. All rights reserved.
          </p>
        </div>
      </footer>
    </div>
  );
}
`;
  }
}
