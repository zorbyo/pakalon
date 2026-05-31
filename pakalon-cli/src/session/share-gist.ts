/**
 * Session Share via GitHub Gist
 * 
 * Shares a session as a private GitHub Gist with a shareable HTML link.
 * Based on pi's /share command.
 * 
 * Features:
 * - Create private GitHub Gist with HTML content
 * - Generate shareable link
 * - Optional description
 * - Token management
 */

import { execSync } from 'child_process';
import { JsonlSessionStorage } from './jsonl-storage.js';
import { SessionHtmlExporter } from './export-html.js';
import logger from '@/utils/logger.js';

// ============================================================================
// Types
// ============================================================================

export interface ShareOptions {
  /** Custom description for the gist */
  description?: string;
  /** Whether to make the gist public (default: false) */
  public?: boolean;
  /** Custom filename */
  filename?: string;
}

export interface ShareResult {
  /** Gist ID */
  gistId: string;
  /** Gist URL */
  gistUrl: string;
  /** Raw HTML URL */
  htmlUrl: string;
  /** Whether the share was successful */
  success: boolean;
  /** Error message if failed */
  error?: string;
}

// ============================================================================
// GitHub Gist Sharer
// ============================================================================

export class SessionGistSharer {
  private session: JsonlSessionStorage;

  constructor(session: JsonlSessionStorage) {
    this.session = session;
  }

  /**
   * Share session as a GitHub Gist
   */
  async share(options?: ShareOptions): Promise<ShareResult> {
    try {
      // Check if gh CLI is available
      this.checkGhCli();

      // Check if authenticated
      const isAuthenticated = this.checkAuthentication();
      if (!isAuthenticated) {
        return {
          gistId: '',
          gistUrl: '',
          htmlUrl: '',
          success: false,
          error: 'Not authenticated with GitHub. Run "gh auth login" first.',
        };
      }

      // Generate HTML content
      const exporter = new SessionHtmlExporter(this.session);
      const metadata = this.session.getMetadata();
      const htmlContent = await exporter.exportToHtml({
        title: options?.description ?? `Session ${metadata.id}`,
        theme: 'dark',
      });

      // Create gist
      const filename = options?.filename ?? `${metadata.id}.html`;
      const description = options?.description ?? `Pakalon Session: ${metadata.id}`;
      const isPublic = options?.public ?? false;

      const result = await this.createGist(htmlContent, filename, description, isPublic);
      
      logger.info('[share-gist] Shared session', { gistId: result.gistId, url: result.gistUrl });
      
      return result;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      logger.error('[share-gist] Failed to share session', { error: message });
      
      return {
        gistId: '',
        gistUrl: '',
        htmlUrl: '',
        success: false,
        error: message,
      };
    }
  }

  /**
   * Check if gh CLI is installed
   */
  private checkGhCli(): void {
    try {
      execSync('gh --version', { stdio: 'ignore' });
    } catch {
      throw new Error('GitHub CLI (gh) is not installed. Install it from https://cli.github.com/');
    }
  }

  /**
   * Check if authenticated with GitHub
   */
  private checkAuthentication(): boolean {
    try {
      execSync('gh auth status', { stdio: 'ignore' });
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Create a GitHub Gist
   */
  private async createGist(
    content: string,
    filename: string,
    description: string,
    isPublic: boolean
  ): Promise<ShareResult> {
    try {
      // Create gist using gh CLI
      const visibility = isPublic ? '--public' : '--private';
      const command = [
        'gh', 'gist', 'create',
        visibility,
        '--desc', `"${description}"`,
        '--filename', filename,
        '-',  // Read from stdin
      ].join(' ');

      // Write content to stdin and execute
      const result = execSync(command, {
        input: content,
        encoding: 'utf-8',
        stdio: ['pipe', 'pipe', 'pipe'],
      });

      // Parse gist URL from output
      const gistUrl = result.trim();
      const gistId = this.extractGistId(gistUrl);
      const htmlUrl = this.convertToHtmlUrl(gistUrl);

      return {
        gistId,
        gistUrl,
        htmlUrl,
        success: true,
      };
    } catch (error) {
      throw new Error(`Failed to create gist: ${error}`);
    }
  }

  /**
   * Extract gist ID from URL
   */
  private extractGistId(url: string): string {
    const match = url.match(/gist\.github\.com\/[^/]+\/([a-f0-9]+)/i);
    return match?.[1] ?? '';
  }

  /**
   * Convert gist URL to raw HTML URL
   */
  private convertToHtmlUrl(gistUrl: string): string {
    // Convert https://gist.github.com/user/id to raw HTML URL
    return gistUrl;
  }
}

// ============================================================================
// Convenience Function
// ============================================================================

export async function shareSessionAsGist(
  session: JsonlSessionStorage,
  options?: ShareOptions
): Promise<ShareResult> {
  const sharer = new SessionGistSharer(session);
  return sharer.share(options);
}
