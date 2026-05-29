import fs from 'fs/promises';
import path from 'path';
import * as yaml from 'js-yaml';
import crypto from 'node:crypto';

export type SBOMFormat = 'cyclonedx' | 'spdx';

export interface SBOMComponent {
  bomRef: string;
  name: string;
  version: string;
  type: 'application' | 'library';
  scope: 'required' | 'optional' | 'dev';
  purl?: string;
  license?: string;
  dependencies?: string[];
}

export interface SBOM {
  format: SBOMFormat;
  bomFormat: 'CycloneDX' | 'SPDX';
  specVersion: string;
  serialNumber: string;
  metadata: {
    timestamp: string;
    component: {
      name: string;
      version: string;
      type: 'application';
    };
  };
  components: SBOMComponent[];
  dependencies: Array<{ ref: string; dependsOn: string[] }>;
}

type Manifest = {
  name?: string;
  version?: string;
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
  optionalDependencies?: Record<string, string>;
};

function asString(value: unknown, fallback: string): string {
  return typeof value === 'string' && value.trim() ? value : fallback;
}

function purl(name: string, version: string): string {
  return `pkg:npm/${encodeURIComponent(name)}@${encodeURIComponent(version)}`;
}

function componentFrom(name: string, version: string, scope: SBOMComponent['scope'], type: SBOMComponent['type']): SBOMComponent {
  const bomRef = `${name}@${version}`;
  return {
    bomRef,
    name,
    version,
    type,
    scope,
    purl: purl(name, version),
  };
}

function collectManifestComponents(manifest: Manifest): SBOMComponent[] {
  const components: SBOMComponent[] = [];
  const entries: Array<[string, string, SBOMComponent['scope']]> = [];
  for (const [name, version] of Object.entries(manifest.dependencies ?? {})) entries.push([name, version, 'required']);
  for (const [name, version] of Object.entries(manifest.optionalDependencies ?? {})) entries.push([name, version, 'optional']);
  for (const [name, version] of Object.entries(manifest.devDependencies ?? {})) entries.push([name, version, 'dev']);

  for (const [name, version, scope] of entries) {
    components.push(componentFrom(name, version.replace(/^[~^]/, ''), scope, 'library'));
  }

  return components;
}

function collectPackageLockComponents(lock: any): SBOMComponent[] {
  const components: SBOMComponent[] = [];
  const packages = lock?.packages ?? {};

  for (const [location, meta] of Object.entries<any>(packages)) {
    if (!location || location === '') continue;
    const segments = location.split('/').filter(Boolean);
    const name = segments[segments.length - 1] ?? location;
    const version = asString(meta?.version, '0.0.0');
    const scope: SBOMComponent['scope'] = location.includes('node_modules/') ? 'required' : 'dev';
    components.push(componentFrom(name, version, scope, 'library'));
  }

  return components;
}

function collectPnpmLockComponents(lock: any): SBOMComponent[] {
  const components: SBOMComponent[] = [];
  const packages = lock?.packages ?? {};

  for (const [location, meta] of Object.entries<any>(packages)) {
    const name = String(meta?.name ?? location.split('/').pop() ?? location).replace(/^"|"$/g, '');
    const version = asString(meta?.version, '0.0.0');
    components.push(componentFrom(name, version, location.includes('dev') ? 'dev' : 'required', 'library'));
  }

  return components;
}

function collectYarnLockComponents(lockText: string): SBOMComponent[] {
  const components: SBOMComponent[] = [];
  const blocks = lockText.split(/\n(?=[^\s].*:)/g);

  for (const block of blocks) {
    const nameMatch = block.match(/^([^:@\s][^:]*):/m);
    const versionMatch = block.match(/\n\s+version\s+"([^"]+)"/m);
    if (!nameMatch || !versionMatch) continue;
    const name = nameMatch[1]!.split('@')[0] ?? nameMatch[1]!;
    components.push(componentFrom(name, versionMatch[1]!, 'required', 'library'));
  }

  return components;
}

function dedupeComponents(components: SBOMComponent[]): SBOMComponent[] {
  const seen = new Map<string, SBOMComponent>();
  for (const component of components) {
    seen.set(component.bomRef, component);
  }
  return [...seen.values()].sort((a, b) => a.bomRef.localeCompare(b.bomRef));
}

function buildDependencies(components: SBOMComponent[]): Array<{ ref: string; dependsOn: string[] }> {
  const root = components[0];
  if (!root) return [];
  return [{ ref: root.bomRef, dependsOn: components.slice(1).map((component) => component.bomRef) }];
}

export async function generateSBOM(projectDir: string, format: SBOMFormat): Promise<SBOM> {
  const manifestPath = path.join(projectDir, 'package.json');
  const manifestRaw = await fs.readFile(manifestPath, 'utf8').catch(() => '');
  const manifest = manifestRaw ? (JSON.parse(manifestRaw) as Manifest) : {};

  const components = collectManifestComponents(manifest);

  const lockCandidates = [
    path.join(projectDir, 'package-lock.json'),
    path.join(projectDir, 'pnpm-lock.yaml'),
    path.join(projectDir, 'pnpm-lock.yml'),
    path.join(projectDir, 'yarn.lock'),
  ];

  for (const lockPath of lockCandidates) {
    const lockRaw = await fs.readFile(lockPath, 'utf8').catch(() => '');
    if (!lockRaw) continue;

    if (lockPath.endsWith('package-lock.json')) {
      try {
        components.push(...collectPackageLockComponents(JSON.parse(lockRaw)));
      } catch {
        // ignore malformed lockfile
      }
    } else if (lockPath.endsWith('pnpm-lock.yaml') || lockPath.endsWith('pnpm-lock.yml')) {
      try {
        components.push(...collectPnpmLockComponents(yaml.load(lockRaw)));
      } catch {
        // ignore malformed lockfile
      }
    } else if (lockPath.endsWith('yarn.lock')) {
      components.push(...collectYarnLockComponents(lockRaw));
    }
  }

  const deduped = dedupeComponents([
    componentFrom(asString(manifest.name, path.basename(projectDir)), asString(manifest.version, '0.0.0'), 'required', 'application'),
    ...components,
  ]);

  const sbom: SBOM = {
    format,
    bomFormat: format === 'cyclonedx' ? 'CycloneDX' : 'SPDX',
    specVersion: format === 'cyclonedx' ? '1.5' : '2.3',
    serialNumber: `urn:uuid:${crypto.randomUUID()}`,
    metadata: {
      timestamp: new Date().toISOString(),
      component: {
        name: asString(manifest.name, path.basename(projectDir)),
        version: asString(manifest.version, '0.0.0'),
        type: 'application',
      },
    },
    components: deduped,
    dependencies: buildDependencies(deduped),
  };

  const outputDir = path.join(projectDir, '.pakalon-agents', 'phase-4');
  await fs.mkdir(outputDir, { recursive: true });
  await fs.writeFile(path.join(outputDir, 'sbom.json'), `${JSON.stringify(sbom, null, 2)}\n`, 'utf8');

  return sbom;
}
