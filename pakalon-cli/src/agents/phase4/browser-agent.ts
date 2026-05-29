import { BrowserAgent } from '@/tools/browser-agent.js';

export interface SecurityScanResult {
  type: 'xss' | 'sql' | 'csrf' | 'idor' | 'auth' | 'ssl' | 'headers' | 'other';
  severity: 'CRITICAL' | 'HIGH' | 'MEDIUM' | 'LOW' | 'INFO';
  url: string;
  element?: string;
  payload?: string;
  description: string;
  remediation: string;
}

interface NavigationResponse {
  headers(): Record<string, string>;
  status(): number;
}

interface FormFieldDescriptor {
  formIndex: number;
  fieldIndex: number;
  name: string;
  id: string;
  type: string;
  inputType: string;
  hidden: boolean;
  tokenLike: boolean;
}

interface FormDescriptor {
  formIndex: number;
  action: string;
  method: string;
  name: string;
  id: string;
  fields: FormFieldDescriptor[];
}

const SECURITY_HEADERS = [
  {
    name: 'Content-Security-Policy',
    type: 'headers' as const,
    severity: 'HIGH' as const,
    remediation: 'Add a restrictive Content-Security-Policy that blocks inline script execution.',
  },
  {
    name: 'X-Frame-Options',
    type: 'headers' as const,
    severity: 'MEDIUM' as const,
    remediation: 'Set X-Frame-Options to DENY or SAMEORIGIN to prevent clickjacking.',
  },
  {
    name: 'X-Content-Type-Options',
    type: 'headers' as const,
    severity: 'MEDIUM' as const,
    remediation: 'Set X-Content-Type-Options: nosniff to prevent MIME sniffing.',
  },
  {
    name: 'Strict-Transport-Security',
    type: 'headers' as const,
    severity: 'HIGH' as const,
    remediation: 'Enable HSTS with a long max-age and includeSubDomains where possible.',
  },
  {
    name: 'X-XSS-Protection',
    type: 'headers' as const,
    severity: 'LOW' as const,
    remediation: 'Prefer Content-Security-Policy; keep X-XSS-Protection disabled on modern browsers.',
  },
];

const XSS_PAYLOADS = [
  '<script>alert(1)</script>',
  '"\'><img src=x onerror=alert(1)>',
  'javascript:alert(1)',
  '{{7*7}}',
  '${7*7}',
];

const SQL_PAYLOADS = [
  "' OR '1'='1",
  '1; DROP TABLE--',
  '" OR "1"="1"',
  "' UNION SELECT NULL--",
  'admin\'--',
];

const PATH_TRAVERSAL_PAYLOADS = [
  '../../../etc/passwd',
  '..\\..\\..\\windows\\win.ini',
];

const SENSITIVE_FIELD_NAMES = /csrf|token|authenticity|nonce|state|session/i;
const IDOR_FIELD_NAMES = /\b(id|userId|user_id|accountId|account_id|orderId|order_id|docId|doc_id|fileId|file_id|customerId|customer_id)\b/i;
const SQL_ERROR_PATTERNS = [
  /sql syntax/i,
  /mysql/i,
  /postgres/i,
  /sqlite/i,
  /odbc/i,
  /database error/i,
  /unclosed quotation mark/i,
  /quoted string not properly terminated/i,
  /you have an error in your sql syntax/i,
];

export class SecurityBrowserAgent extends BrowserAgent {
  private readonly contextData: unknown;
  private browser: import('playwright').Browser | null = null;
  private context: import('playwright').BrowserContext | null = null;
  private page: import('playwright').Page | null = null;
  private targetUrl = '';
  private responseHeaders: Record<string, string> = {};
  private baselineHtml = '';
  private baselineText = '';
  private forms: FormDescriptor[] = [];

  constructor(contextData?: unknown) {
    super();
    this.contextData = contextData;
  }

  async scanForVulnerabilities(targetUrl: string): Promise<SecurityScanResult[]> {
    this.targetUrl = targetUrl;
    const findings: SecurityScanResult[] = [];

    try {
      await this.ensurePage();
      findings.push(...await this.checkSecurityHeaders());
      findings.push(...await this.checkSSL());
      findings.push(...await this.testXSS());
      findings.push(...await this.testSQLInjection());
      findings.push(...await this.testCSRF());
      findings.push(...await this.testIDOR());
      return this.dedupe(findings);
    } finally {
      await this.closeSecurityBrowser();
    }
  }

  async testXSS(): Promise<SecurityScanResult[]> {
    await this.ensurePage();
    await this.refreshBaseline();

    const findings: SecurityScanResult[] = [];
    const payloads = XSS_PAYLOADS;

    for (const form of this.forms) {
      for (const field of form.fields) {
        if (field.hidden || field.tokenLike) continue;
        for (const payload of payloads) {
          const result = await this.probeFormField(form.formIndex, field.fieldIndex, payload);
          if (result.reflected || result.renderedDangerously) {
            findings.push({
              type: payload.includes('{{') || payload.includes('${') ? 'other' : 'xss',
              severity: result.renderedDangerously ? 'HIGH' : 'MEDIUM',
              url: result.url,
              element: `${form.name || form.id || `form-${form.formIndex}`} :: ${field.name || field.id || `field-${field.fieldIndex}`}`,
              payload,
              description: result.renderedDangerously
                ? 'Potential XSS payload was reflected without escaping.'
                : 'Potential XSS payload was reflected in the response.',
              remediation: 'Escape user-supplied data before rendering and enforce a restrictive CSP.',
            });
            break;
          }
        }
      }
    }

    return findings;
  }

  async testSQLInjection(): Promise<SecurityScanResult[]> {
    await this.ensurePage();
    await this.refreshBaseline();

    const findings: SecurityScanResult[] = [];
    const payloads = [...SQL_PAYLOADS, ...PATH_TRAVERSAL_PAYLOADS];

    for (const form of this.forms) {
      for (const field of form.fields) {
        if (field.hidden) continue;
        for (const payload of payloads) {
          const result = await this.probeFormField(form.formIndex, field.fieldIndex, payload);
          if (result.sqlError || result.pathTraversal) {
            findings.push({
              type: payload.includes('passwd') || payload.includes('win.ini') ? 'other' : 'sql',
              severity: result.sqlError ? 'HIGH' : 'MEDIUM',
              url: result.url,
              element: `${form.name || form.id || `form-${form.formIndex}`} :: ${field.name || field.id || `field-${field.fieldIndex}`}`,
              payload,
              description: result.sqlError
                ? 'Database error hints suggest possible SQL injection.'
                : 'Suspicious path traversal behavior was observed during input testing.',
              remediation: 'Use parameterized queries, strict input validation, and safe file-system path handling.',
            });
            break;
          }
        }
      }
    }

    return findings;
  }

  async testCSRF(): Promise<SecurityScanResult[]> {
    await this.ensurePage();
    await this.refreshBaseline();

    const findings: SecurityScanResult[] = [];

    for (const form of this.forms) {
      const mutating = ['post', 'put', 'patch', 'delete'].includes(form.method) || /delete|update|change|edit|create|submit|login|checkout/i.test(form.action + ' ' + form.name + ' ' + form.id);
      if (!mutating) continue;

      const hasToken = form.fields.some((field) => field.hidden && field.tokenLike) || this.baselineHtml.includes('csrf') || this.baselineHtml.includes('anti-forgery');
      if (!hasToken) {
        findings.push({
          type: 'csrf',
          severity: 'MEDIUM',
          url: form.action,
          element: form.name || form.id || `form-${form.formIndex}`,
          description: 'State-changing form does not appear to include a CSRF token.',
          remediation: 'Add per-request CSRF tokens and verify them server-side for all mutating requests.',
        });
      }
    }

    return findings;
  }

  async testIDOR(): Promise<SecurityScanResult[]> {
    await this.ensurePage();
    await this.refreshBaseline();

    const findings: SecurityScanResult[] = [];
    const urls = await this.collectCandidateUrls();

    for (const candidate of urls) {
      const mutated = this.mutateIdentifier(candidate);
      if (!mutated) continue;

      const result = await this.navigateAndCapture(mutated);
      if (!result) continue;

      const looksAccessible = !/forbidden|unauthorized|access denied|not found|sign in/i.test(result.text);
      const similar = this.similarityScore(this.baselineText, result.text) > 0.6;

      if (looksAccessible && similar) {
        findings.push({
          type: 'idor',
          severity: 'MEDIUM',
          url: mutated,
          element: candidate,
          description: 'Potential IDOR exposure: mutable identifier is reachable without an obvious authorization barrier.',
          remediation: 'Authorize object access on the server and avoid exposing predictable identifiers when possible.',
        });
      }
    }

    if (findings.length === 0) {
      for (const form of this.forms) {
        const suspiciousField = form.fields.find((field) => IDOR_FIELD_NAMES.test(field.name) || IDOR_FIELD_NAMES.test(field.id));
        if (suspiciousField) {
          findings.push({
            type: 'idor',
            severity: 'INFO',
            url: form.action,
            element: `${form.name || form.id || `form-${form.formIndex}`} :: ${suspiciousField.name || suspiciousField.id}`,
            description: 'Form exposes an identifier field that should be verified server-side for object-level authorization.',
            remediation: 'Bind object access to the authenticated user and validate ownership on every request.',
          });
        }
      }
    }

    return findings;
  }

  async checkSecurityHeaders(): Promise<SecurityScanResult[]> {
    await this.ensurePage();

    const findings: SecurityScanResult[] = [];
    const headers = this.responseHeaders;

    for (const header of SECURITY_HEADERS) {
      if (!this.hasHeader(headers, header.name)) {
        findings.push({
          type: header.type,
          severity: header.severity,
          url: this.targetUrl,
          description: `Missing security header: ${header.name}.`,
          remediation: header.remediation,
        });
      }
    }

    return findings;
  }

  async checkSSL(): Promise<SecurityScanResult[]> {
    await this.ensurePage();

    const findings: SecurityScanResult[] = [];
    const parsed = new URL(this.targetUrl);

    if (parsed.protocol !== 'https:') {
      findings.push({
        type: 'ssl',
        severity: 'HIGH',
        url: this.targetUrl,
        description: 'Target is not served over HTTPS.',
        remediation: 'Serve the application over TLS and redirect all HTTP traffic to HTTPS.',
      });
      return findings;
    }

    findings.push({
      type: 'ssl',
      severity: 'INFO',
      url: this.targetUrl,
      description: 'Target is served over HTTPS.',
      remediation: 'Keep TLS configurations and certificates up to date.',
    });

    return findings;
  }

  private async ensurePage(): Promise<void> {
    if (!this.targetUrl) {
      throw new Error('No target URL configured for security scan');
    }

    if (!this.browser || !this.browser.isConnected()) {
      const moduleName = 'play' + 'wright';
      const playwright = await import(/* @vite-ignore */ moduleName) as {
        chromium: {
          launch(options?: { headless?: boolean; args?: string[] }): Promise<import('playwright').Browser>;
        };
      };
      this.browser = await playwright.chromium.launch({
        headless: true,
        args: ['--no-sandbox', '--disable-setuid-sandbox'],
      });
      this.context = await this.browser.newContext({ viewport: { width: 1280, height: 900 } });
      this.page = await this.context.newPage();
    }

    if (!this.page) {
      throw new Error('Unable to initialize browser page');
    }

    if (this.page.url() !== this.targetUrl) {
      const response = await this.page.goto(this.targetUrl, { waitUntil: 'domcontentloaded' });
      const navigationResponse = response as NavigationResponse | null;
      this.responseHeaders = navigationResponse?.headers() ?? {};
    }

    await this.refreshBaseline();
  }

  private async refreshBaseline(): Promise<void> {
    if (!this.page) {
      return;
    }

    this.baselineHtml = await this.page.content();
    this.baselineText = await this.page.evaluate(() => document.body?.innerText || '');
    this.forms = await this.collectForms();
  }

  private async collectForms(): Promise<FormDescriptor[]> {
    if (!this.page) {
      return [];
    }

    const forms = await this.page.evaluate(() => Array.from(document.forms).map((form, formIndex) => {
      const controls = Array.from(form.querySelectorAll('input, textarea, select'));
      return {
        formIndex,
        action: form.action || window.location.href,
        method: (form.method || 'get').toLowerCase(),
        name: form.getAttribute('name') || '',
        id: form.id || '',
        fields: controls.map((control, fieldIndex) => {
          const element = control as HTMLElement & { type?: string; value?: string; name?: string; id?: string };
          const name = element.getAttribute('name') || element.id || `field-${fieldIndex}`;
          const tagName = element.tagName.toLowerCase();
          const tokenLike = SENSITIVE_FIELD_NAMES.test(name) || SENSITIVE_FIELD_NAMES.test(element.id || '');
          return {
            formIndex,
            fieldIndex,
            name,
            id: element.id || '',
            type: tagName,
            inputType: typeof element.type === 'string' ? String(element.type) : tagName,
            hidden: typeof element.type === 'string' && element.type.toLowerCase() === 'hidden',
            tokenLike,
          };
        }),
      };
    }));

    return forms as FormDescriptor[];
  }

  private async probeFormField(formIndex: number, fieldIndex: number, payload: string): Promise<{
    url: string;
    reflected: boolean;
    renderedDangerously: boolean;
    sqlError: boolean;
    pathTraversal: boolean;
  }> {
    if (!this.page) {
      throw new Error('Browser page not available');
    }

    await this.page.goto(this.targetUrl, { waitUntil: 'domcontentloaded' });
    const before = await this.page.content();

    await this.page.evaluate((args: { formIndex: number; fieldIndex: number; injectedPayload: string }) => {
      const { formIndex: currentFormIndex, fieldIndex: currentFieldIndex, injectedPayload } = args;
      const form = document.forms[currentFormIndex];
      if (!form) return;

      const controls = Array.from(form.querySelectorAll('input, textarea, select'));
      const field = controls[currentFieldIndex] as HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement | undefined;
      if (!field) return;

      if ('value' in field) {
        field.value = injectedPayload;
      }

      field.dispatchEvent(new Event('input', { bubbles: true }));
      field.dispatchEvent(new Event('change', { bubbles: true }));

      try {
        if (typeof form.requestSubmit === 'function') {
          form.requestSubmit();
        } else {
          form.submit();
        }
      } catch {
        return;
      }
    }, { formIndex, fieldIndex, injectedPayload: payload });
    await this.page.waitForTimeout(350);

    const afterHtml = await this.page.content();
    const afterText = await this.page.evaluate(() => document.body?.innerText || '');
    const url = this.page.url();

    return {
      url,
      reflected: afterHtml.includes(payload) || afterText.includes(payload) || (!before.includes(payload) && afterText.includes(payload.replace(/<[^>]+>/g, ''))),
      renderedDangerously: afterHtml.includes(payload) && /<script|onerror=|onload=|javascript:/i.test(payload),
      sqlError: SQL_ERROR_PATTERNS.some((pattern) => pattern.test(afterText) || pattern.test(afterHtml)),
      pathTraversal: /root:x:0:0|daemon:|[A-Za-z]:\\Windows\\|\/etc\/passwd/i.test(afterText) || /win\.ini/i.test(afterHtml),
    };
  }

  private async collectCandidateUrls(): Promise<string[]> {
    if (!this.page) {
      return [];
    }

    const urls = await this.page.evaluate(() => {
      const links = Array.from(document.querySelectorAll('a[href]')).map((link) => (link as HTMLAnchorElement).href);
      const forms = Array.from(document.forms).map((form) => form.action || window.location.href);
      return [...links, ...forms].filter(Boolean);
    });

    const sameOrigin = new URL(this.targetUrl).origin;
    return Array.from(new Set(urls.filter((item) => {
      try {
        return new URL(item).origin === sameOrigin;
      } catch {
        return false;
      }
    })));
  }

  private mutateIdentifier(url: string): string | null {
    try {
      const parsed = new URL(url);
      let mutated = false;

      parsed.searchParams.forEach((value, key) => {
        if (/\d+/.test(value) && IDOR_FIELD_NAMES.test(key)) {
          parsed.searchParams.set(key, String(Number(value) + 1));
          mutated = true;
        }
      });

      if (mutated) {
        return parsed.toString();
      }

      const pathMatch = parsed.pathname.match(/^(.*\/)(\d+)(\/?)$/);
      if (pathMatch) {
        parsed.pathname = `${pathMatch[1]}${Number(pathMatch[2]) + 1}${pathMatch[3]}`;
        return parsed.toString();
      }

      return null;
    } catch {
      return null;
    }
  }

  private async navigateAndCapture(url: string): Promise<{ url: string; text: string } | null> {
    if (!this.page) {
      return null;
    }

    try {
      await this.page.goto(url, { waitUntil: 'domcontentloaded' });
      return {
        url: this.page.url(),
        text: await this.page.evaluate(() => document.body?.innerText || ''),
      };
    } catch {
      return null;
    }
  }

  private similarityScore(left: string, right: string): number {
    if (!left || !right) {
      return 0;
    }

    const leftTokens = new Set(left.toLowerCase().split(/\W+/).filter(Boolean));
    const rightTokens = new Set(right.toLowerCase().split(/\W+/).filter(Boolean));
    let intersection = 0;

    for (const token of leftTokens) {
      if (rightTokens.has(token)) {
        intersection += 1;
      }
    }

    return intersection / Math.max(leftTokens.size, rightTokens.size, 1);
  }

  private hasHeader(headers: Record<string, string>, name: string): boolean {
    const needle = name.toLowerCase();
    return Object.keys(headers).some((key) => key.toLowerCase() === needle || key.toLowerCase().includes(needle));
  }

  private dedupe(results: SecurityScanResult[]): SecurityScanResult[] {
    const seen = new Set<string>();
    const unique: SecurityScanResult[] = [];

    for (const result of results) {
      const key = [result.type, result.severity, result.url, result.element ?? '', result.payload ?? '', result.description].join('|');
      if (seen.has(key)) continue;
      seen.add(key);
      unique.push(result);
    }

    return unique;
  }

  private async closeSecurityBrowser(): Promise<void> {
    if (this.page) {
      await this.page.close();
      this.page = null;
    }

    if (this.context) {
      await this.context.close();
      this.context = null;
    }

    if (this.browser) {
      await this.browser.close();
      this.browser = null;
    }
  }
}
