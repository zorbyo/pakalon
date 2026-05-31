/**
 * Security Database Lookups
 * 
 * Queries NVD, OSV, and CISA KEV for vulnerability information.
 * Based on OMP's security database integration.
 */

import logger from '@/utils/logger.js';

// ============================================================================
// Types
// ============================================================================

export interface Vulnerability {
  id: string;
  source: 'nvd' | 'osv' | 'cisa';
  title: string;
  description: string;
  severity: 'low' | 'medium' | 'high' | 'critical';
  cvssScore?: number;
  cveId?: string;
  affectedPackages: Array<{
    name: string;
    version: string;
    ecosystem?: string;
  }>;
  publishedAt: string;
  updatedAt: string;
  references: string[];
}

export interface VulnerabilityLookupResult {
  query: string;
  vulnerabilities: Vulnerability[];
  sources: string[];
  duration: number;
}

// ============================================================================
// NVD Client
// ============================================================================

async function queryNVD(
  query: string,
  maxResults: number = 10
): Promise<Vulnerability[]> {
  try {
    const apiKey = process.env.NVD_API_KEY;
    const headers: Record<string, string> = {};
    if (apiKey) {
      headers['apiKey'] = apiKey;
    }

    const response = await fetch(
      `https://services.nvd.nist.gov/rest/json/cves/2.0?keywordSearch=${encodeURIComponent(query)}&resultsPerPage=${maxResults}`,
      { headers }
    );

    if (!response.ok) {
      throw new Error(`NVD API error: ${response.statusText}`);
    }

    const data = await response.json();
    return (data.vulnerabilities || []).map((v: any) => {
      const cve = v.cve || {};
      const metrics = cve.metrics?.cvssMetricV31?.[0] || cve.metrics?.cvssMetricV30?.[0] || {};
      
      return {
        id: cve.id || '',
        source: 'nvd' as const,
        title: cve.id || 'Unknown CVE',
        description: cve.descriptions?.[0]?.value || '',
        severity: metrics.cvssData?.baseSeverity?.toLowerCase() || 'medium',
        cvssScore: metrics.cvssData?.baseScore,
        cveId: cve.id,
        affectedPackages: [],
        publishedAt: cve.published || '',
        updatedAt: cve.lastModified || '',
        references: (cve.references || []).map((r: any) => r.url || ''),
      };
    });
  } catch (error) {
    logger.error('[security-db] NVD query failed', { error: String(error) });
    return [];
  }
}

// ============================================================================
// OSV Client
// ============================================================================

async function queryOSV(
  query: string,
  maxResults: number = 10
): Promise<Vulnerability[]> {
  try {
    const response = await fetch('https://api.osv.dev/v1/query', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        query,
        page_token: undefined,
      }),
    });

    if (!response.ok) {
      throw new Error(`OSV API error: ${response.statusText}`);
    }

    const data = await response.json();
    return (data.vulns || []).slice(0, maxResults).map((v: any) => ({
      id: v.id || '',
      source: 'osv' as const,
      title: v.id || 'Unknown vulnerability',
      description: v.summary || v.details || '',
      severity: v.database_specific?.severity?.toLowerCase() || 'medium',
      cvssScore: v.database_specific?.cvss?.score,
      cveId: v.aliases?.find((a: string) => a.startsWith('CVE-')),
      affectedPackages: (v.affected || []).map((a: any) => ({
        name: a.package?.name || '',
        version: a.package?.ecosystem || '',
        ecosystem: a.package?.ecosystem,
      })),
      publishedAt: v.published || '',
      updatedAt: v.modified || '',
      references: (v.references || []).map((r: any) => r.url || ''),
    }));
  } catch (error) {
    logger.error('[security-db] OSV query failed', { error: String(error) });
    return [];
  }
}

// ============================================================================
// CISA KEV Client
// ============================================================================

async function queryCISA(
  query: string,
  maxResults: number = 10
): Promise<Vulnerability[]> {
  try {
    const response = await fetch(
      'https://www.cisa.gov/sites/default/files/feeds/known_exploited_vulnerabilities.json'
    );

    if (!response.ok) {
      throw new Error(`CISA API error: ${response.statusText}`);
    }

    const data = await response.json();
    const vulns = data.vulnerabilities || [];
    
    // Filter by query
    const filtered = vulns.filter((v: any) => {
      const searchText = `${v.cveID} ${v.vulnerabilityName} ${v.vendorProject} ${v.product}`.toLowerCase();
      return searchText.includes(query.toLowerCase());
    });

    return filtered.slice(0, maxResults).map((v: any) => ({
      id: v.cveID || '',
      source: 'cisa' as const,
      title: v.vulnerabilityName || v.cveID || 'Unknown',
      description: `Known exploited vulnerability in ${v.vendorProject} ${v.product}`,
      severity: 'critical' as const, // CISA KEV items are all critical
      cveId: v.cveID,
      affectedPackages: [{
        name: v.product || '',
        version: v.version || '',
        ecosystem: v.vendorProject,
      }],
      publishedAt: v.dateAdded || '',
      updatedAt: v.dateAdded || '',
      references: v.notes ? [v.notes] : [],
    }));
  } catch (error) {
    logger.error('[security-db] CISA query failed', { error: String(error) });
    return [];
  }
}

// ============================================================================
// Security Database Manager
// ============================================================================

export class SecurityDatabaseManager {
  /**
   * Query all security databases
   */
  async query(
    searchTerm: string,
    options?: {
      sources?: ('nvd' | 'osv' | 'cisa')[];
      maxResults?: number;
    }
  ): Promise<VulnerabilityLookupResult> {
    const startTime = Date.now();
    const sources = options?.sources || ['nvd', 'osv', 'cisa'];
    const maxResults = options?.maxResults || 10;

    const allVulnerabilities: Vulnerability[] = [];

    // Query in parallel
    const queries: Promise<Vulnerability[]>[] = [];
    if (sources.includes('nvd')) {
      queries.push(queryNVD(searchTerm, maxResults));
    }
    if (sources.includes('osv')) {
      queries.push(queryOSV(searchTerm, maxResults));
    }
    if (sources.includes('cisa')) {
      queries.push(queryCISA(searchTerm, maxResults));
    }

    const results = await Promise.allSettled(queries);
    for (const result of results) {
      if (result.status === 'fulfilled') {
        allVulnerabilities.push(...result.value);
      }
    }

    // Sort by severity and CVSS score
    const severityOrder = { critical: 0, high: 1, medium: 2, low: 3 };
    allVulnerabilities.sort((a, b) => {
      const severityDiff = (severityOrder[a.severity] || 3) - (severityOrder[b.severity] || 3);
      if (severityDiff !== 0) return severityDiff;
      return (b.cvssScore || 0) - (a.cvssScore || 0);
    });

    return {
      query: searchTerm,
      vulnerabilities: allVulnerabilities.slice(0, maxResults),
      sources,
      duration: Date.now() - startTime,
    };
  }

  /**
   * Format vulnerability for display
   */
  formatVulnerability(vuln: Vulnerability): string {
    const severityEmoji: Record<string, string> = {
      critical: '🔴',
      high: '🟠',
      medium: '🟡',
      low: '🟢',
    };

    return `${severityEmoji[vuln.severity] || '⚪'} ${vuln.id} (${vuln.source.toUpperCase()})
  Severity: ${vuln.severity}${vuln.cvssScore ? ` (CVSS: ${vuln.cvssScore})` : ''}
  ${vuln.title}
  ${vuln.description.slice(0, 200)}${vuln.description.length > 200 ? '...' : ''}
  Affected: ${vuln.affectedPackages.map(p => `${p.name} ${p.version}`).join(', ') || 'N/A'}
  Published: ${vuln.publishedAt}`;
  }
}

// ============================================================================
// Singleton
// ============================================================================

let managerInstance: SecurityDatabaseManager | null = null;

export function getSecurityDatabaseManager(): SecurityDatabaseManager {
  if (!managerInstance) {
    managerInstance = new SecurityDatabaseManager();
  }
  return managerInstance;
}

export function resetSecurityDatabaseManager(): void {
  managerInstance = null;
}
