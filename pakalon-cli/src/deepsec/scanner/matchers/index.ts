/**
 * Deepsec Matcher Registry
 * All built-in vulnerability matchers
 */

import type { MatcherPlugin } from "../../core/types.js";
import { regexMatcher } from "./utils.js";

// Core security matchers
export const XSS: MatcherPlugin = {
  slug: "xss",
  description: "Unsafe innerHTML, dangerouslySetInnerHTML, template injection",
  noiseTier: "normal",
  filePatterns: ["**/*.{ts,tsx,js,jsx,html,ejs,hbs}"],
  match(content: string, _filePath: string) {
    return regexMatcher("xss", [
      { regex: /dangerouslySetInnerHTML/, label: "dangerouslySetInnerHTML" },
      { regex: /\.innerHTML\s*=/, label: "innerHTML assignment" },
      { regex: /\.outerHTML\s*=/, label: "outerHTML assignment" },
      { regex: /document\.write\s*\(/, label: "document.write" },
    ], content);
  },
};

export const SQL_INJECTION: MatcherPlugin = {
  slug: "sql-injection",
  description: "Raw SQL string concatenation or interpolation",
  noiseTier: "normal",
  filePatterns: ["**/*.{ts,tsx,js,jsx}"],
  match(content: string, _filePath: string) {
    return regexMatcher("sql-injection", [
      { regex: /`\s*SELECT\s+[^`]{0,400}\$\{/, label: "template literal SELECT with interpolation" },
      { regex: /`\s*INSERT\s+[^`]{0,400}\$\{/, label: "template literal INSERT with interpolation" },
      { regex: /`\s*UPDATE\s+[^`]{0,400}\$\{/, label: "template literal UPDATE with interpolation" },
      { regex: /`\s*DELETE\s+[^`]{0,400}\$\{/, label: "template literal DELETE with interpolation" },
      { regex: /['"]SELECT\s+[^'"]{0,400}['"]\s*\+/, label: "string concat SELECT" },
      { regex: /['"]INSERT\s+[^'"]{0,400}['"]\s*\+/, label: "string concat INSERT" },
      { regex: /['"]UPDATE\s+[^'"]{0,400}['"]\s*\+/, label: "string concat UPDATE" },
      { regex: /['"]DELETE\s+[^'"]{0,400}['"]\s*\+/, label: "string concat DELETE" },
      { regex: /query\s*\(\s*`[^`]*\$\{/, label: "query() with interpolation" },
      { regex: /\.raw\s*\(\s*`[^`]*\$\{/, label: ".raw() with interpolation" },
    ], content);
  },
};

export const AUTH_BYPASS: MatcherPlugin = {
  slug: "auth-bypass",
  description: "Auth checks, middleware guards, session validation that may be bypassable",
  noiseTier: "normal",
  filePatterns: ["**/*.{ts,tsx,js,jsx}"],
  match(content: string, _filePath: string) {
    return regexMatcher("auth-bypass", [
      { regex: /isAdmin\s*[=!]==?\s*(true|false|req\.)/, label: "admin check comparison" },
      { regex: /auth.{0,30}skip|skip.{0,30}auth|bypass.{0,30}auth/i, label: "auth skip/bypass" },
      { regex: /if\s*\(\s*!?\s*session\s*\)/, label: "session null check" },
      { regex: /verify(Token|JWT|Session|Auth)\s*\(/, label: "auth verification call" },
      { regex: /middleware.{0,30}auth|auth.{0,30}middleware/i, label: "auth middleware" },
      { regex: /req\.headers\[['"]authorization['"]\]/, label: "authorization header access" },
    ], content);
  },
};

export const SECRETS_EXPOSURE: MatcherPlugin = {
  slug: "secrets-exposure",
  description: "Hardcoded API keys, tokens, passwords, and secrets",
  noiseTier: "normal",
  filePatterns: ["**/*.{ts,tsx,js,jsx,json,yaml,yml,env,conf,cfg}"],
  match(content: string, filePath: string) {
    if (/\.(test|spec|fixture|mock)\./i.test(filePath)) return [];
    if (/__(tests|mocks|fixtures)__/i.test(filePath)) return [];

    return regexMatcher("secrets-exposure", [
      { regex: /['"]sk[-_]live[-_][a-zA-Z0-9]{20,}['"]/, label: "Stripe secret key" },
      { regex: /['"]AIza[a-zA-Z0-9_-]{35}['"]/, label: "Google API key" },
      { regex: /['"]ghp_[a-zA-Z0-9]{36}['"]/, label: "GitHub personal access token" },
      { regex: /['"]AKIA[A-Z0-9]{16}['"]/, label: "AWS access key ID" },
      { regex: /['"][a-f0-9]{64}['"]/, label: "potential 256-bit hex secret" },
      { regex: /Bearer\s+[a-zA-Z0-9._-]{20,}/, label: "hardcoded Bearer token" },
      { regex: /(password|passwd|secret|api_key|apikey|api[-_]secret)\s*[:=]\s*['"][^'"]{8,}['"]/i, label: "hardcoded credential" },
    ], content);
  },
};

export const PATH_TRAVERSAL: MatcherPlugin = {
  slug: "path-traversal",
  description: "Path traversal vulnerabilities in file operations",
  noiseTier: "normal",
  filePatterns: ["**/*.{ts,tsx,js,jsx}"],
  match(content: string, _filePath: string) {
    return regexMatcher("path-traversal", [
      { regex: /fs\.(readFile|writeFile|access)\s*\(\s*req\./, label: "fs with request input" },
      { regex: /path\.(join|resolve|normalize)\s*\([^)]*req\./, label: "path with request input" },
      { regex: /require\s*\(\s*[^'"]*req\./, label: "dynamic require with request input" },
      { regex: /import\s*\(\s*[^'"]*req\./, label: "dynamic import with request input" },
    ], content);
  },
};

export const RCE: MatcherPlugin = {
  slug: "rce",
  description: "Remote code execution through eval, exec, or child_process",
  noiseTier: "normal",
  filePatterns: ["**/*.{ts,tsx,js,jsx}"],
  match(content: string, _filePath: string) {
    return regexMatcher("rce", [
      { regex: /eval\s*\(/, label: "eval() usage" },
      { regex: /new\s+Function\s*\(/, label: "new Function() usage" },
      { regex: /child_process\.(exec|execSync|spawn)\s*\(/, label: "child_process exec/spawn" },
      { regex: /setTimeout\s*\(\s*['"]/, label: "setTimeout with string" },
      { regex: /setInterval\s*\(\s*['"]/, label: "setInterval with string" },
    ], content);
  },
};

export const SSRF: MatcherPlugin = {
  slug: "ssrf",
  description: "Server-side request forgery through HTTP clients",
  noiseTier: "normal",
  filePatterns: ["**/*.{ts,tsx,js,jsx}"],
  match(content: string, _filePath: string) {
    return regexMatcher("ssrf", [
      { regex: /fetch\s*\(\s*req\./, label: "fetch with request input" },
      { regex: /axios\.(get|post|put|delete)\s*\(\s*req\./, label: "axios with request input" },
      { regex: /request\s*\(\s*[^)]*req\./, label: "request with request input" },
      { regex: /http\.(get|request)\s*\(\s*[^)]*req\./, label: "http module with request input" },
    ], content);
  },
};

export const INSECURE_CRYPTO: MatcherPlugin = {
  slug: "insecure-crypto",
  description: "Weak or deprecated cryptographic algorithms",
  noiseTier: "normal",
  filePatterns: ["**/*.{ts,tsx,js,jsx}"],
  match(content: string, _filePath: string) {
    return regexMatcher("insecure-crypto", [
      { regex: /crypto\.createHash\s*\(\s*['"]md5['"]\s*\)/, label: "MD5 hash usage" },
      { regex: /crypto\.createHash\s*\(\s*['"]sha1['"]\s*\)/, label: "SHA1 hash usage" },
      { regex: /createDecipher\s*\(\s*['"]aes-/, label: "AES with fixed key" },
      { regex: /Math\.random\s*\(\)/, label: "Math.random() for security" },
    ], content);
  },
};

export const OPEN_REDIRECT: MatcherPlugin = {
  slug: "open-redirect",
  description: "Open redirect vulnerabilities",
  noiseTier: "normal",
  filePatterns: ["**/*.{ts,tsx,js,jsx}"],
  match(content: string, _filePath: string) {
    return regexMatcher("open-redirect", [
      { regex: /res\.redirect\s*\(\s*req\./, label: "redirect with request input" },
      { regex: /Location:\s*[^'"]*req\./, label: "Location header with request input" },
      { regex: /window\.location\s*=\s*req\./, label: "window.location with request input" },
    ], content);
  },
};

export const MISSING_AUTH: MatcherPlugin = {
  slug: "missing-auth",
  description: "API endpoints and routes without authentication",
  noiseTier: "normal",
  filePatterns: ["**/*.{ts,tsx,js,jsx}"],
  match(content: string, _filePath: string) {
    return regexMatcher("missing-auth", [
      { regex: /app\.(get|post|put|delete)\s*\([^)]*\)\s*=>\s*\{/i, label: "route without auth middleware" },
      { regex: /router\.(get|post|put|delete)\s*\(/i, label: "router without auth" },
    ], content);
  },
};

export const CORS_WILDCARD: MatcherPlugin = {
  slug: "cors-wildcard",
  description: "CORS configured with wildcard origin",
  noiseTier: "normal",
  filePatterns: ["**/*.{ts,tsx,js,jsx}"],
  match(content: string, _filePath: string) {
    return regexMatcher("cors-wildcard", [
      { regex: /cors\s*\(\s*\{\s*origin:\s*['"]\\*['"]/, label: "CORS wildcard origin" },
      { regex: /Access-Control-Allow-Origin:\s*\\\*/, label: "Access-Control-Allow-Origin: *" },
    ], content);
  },
};

// Docker matchers
export const DOCKERFILE_CURL_PIPE: MatcherPlugin = {
  slug: "dockerfile-curl-pipe",
  description: "Curl piped to shell without verification",
  noiseTier: "normal",
  filePatterns: ["**/Dockerfile", "**/*.dockerfile"],
  match(content: string, _filePath: string) {
    return regexMatcher("dockerfile-curl-pipe", [
      { regex: /curl\s+.*\|\s*sh/i, label: "curl piped to shell" },
      { regex: /curl\s+.*\|\s*bash/i, label: "curl piped to bash" },
      { regex: /wget\s+.*\|\s*sh/i, label: "wget piped to shell" },
      { regex: /wget\s+.*\|\s*bash/i, label: "wget piped to bash" },
    ], content);
  },
};

export const DOCKERFILE_RUN_AS_ROOT: MatcherPlugin = {
  slug: "dockerfile-run-as-root",
  description: "Dockerfile running as root user",
  noiseTier: "normal",
  filePatterns: ["**/Dockerfile", "**/*.dockerfile"],
  match(content: string, _filePath: string) {
    return regexMatcher("dockerfile-run-as-root", [
      { regex: /^FROM\s+/, label: "Dockerfile without USER directive" },
    ], content);
  },
};

// Terraform matchers
export const TF_IAM_WILDCARD: MatcherPlugin = {
  slug: "tf-iam-wildcard",
  description: "Terraform IAM policy with wildcard permissions",
  noiseTier: "normal",
  filePatterns: ["**/*.tf", "**/*.hcl"],
  match(content: string, _filePath: string) {
    return regexMatcher("tf-iam-wildcard", [
      { regex: /Action\s*=\s*\[\s*"\\*"\s*\]/, label: "IAM wildcard action" },
      { regex: /Resource\s*=\s*"\\*"/, label: "IAM wildcard resource" },
    ], content);
  },
};

export const TF_PUBLIC_INGRESS: MatcherPlugin = {
  slug: "tf-public-ingress",
  description: "Terraform security group with public ingress",
  noiseTier: "normal",
  filePatterns: ["**/*.tf", "**/*.hcl"],
  match(content: string, _filePath: string) {
    return regexMatcher("tf-public-ingress", [
      { regex: /cidr_blocks\s*=\s*\[\s*"0\.0\.0\.0\/0"\s*\]/, label: "public CIDR block" },
      { regex: /0\.0\.0\.0\/0/, label: "open to internet" },
    ], content);
  },
};

// All matchers
export function createDefaultRegistry(): MatcherPlugin[] {
  return [
    XSS,
    SQL_INJECTION,
    AUTH_BYPASS,
    SECRETS_EXPOSURE,
    PATH_TRAVERSAL,
    RCE,
    SSRF,
    INSECURE_CRYPTO,
    OPEN_REDIRECT,
    MISSING_AUTH,
    CORS_WILDCARD,
    DOCKERFILE_CURL_PIPE,
    DOCKERFILE_RUN_AS_ROOT,
    TF_IAM_WILDCARD,
    TF_PUBLIC_INGRESS,
  ];
}
