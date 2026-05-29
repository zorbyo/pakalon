import * as cheerio from "cheerio";
import * as crypto from "crypto";
import * as fs from "fs/promises";
import * as path from "path";

export interface WireframeElement {
  id: string;
  type: 'button' | 'card' | 'header' | 'input' | 'image' | 'text-block' | 'navigation' | 'icon' | 'container' | 'unknown';
  name: string;
  x: number;
  y: number;
  width: number;
  height: number;
  zIndex: number;
  content?: string;
  children: WireframeElement[];
  svgContent: string;
  properties: Record<string, string>;
}

export interface ExtractionOptions {
  svgPath: string;
  outputDir?: string;
  classifyElements?: boolean;
  minElementSize?: number;
  groupContainers?: boolean;
}

export interface ExtractionResult {
  success: boolean;
  elements: WireframeElement[];
  elementCount: number;
  typesFound: string[];
  outputDir?: string;
  warnings: string[];
}

type BBox = { x: number; y: number; width: number; height: number };

type InternalNode = {
  node: any;
  tag: string;
  attrs: Record<string, string>;
  text: string;
  bbox: BBox;
  order: number;
  depth: number;
  parent?: InternalNode;
  children: InternalNode[];
  semantic: string;
  kind: WireframeElement['type'];
  exported?: boolean;
};

const DEFAULT_MIN_SIZE = 10;

const BOUNDING_TAGS = new Set([
  'svg', 'g', 'rect', 'circle', 'ellipse', 'path', 'polygon', 'polyline', 'line', 'text', 'image', 'use', 'foreignObject',
]);

function normalizeText(value: string): string {
  return value.replace(/\s+/g, ' ').trim();
}

function slugify(value: string): string {
  return normalizeText(value)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80) || 'wireframe-element';
}

function shortHash(value: string): string {
  return crypto.createHash('sha1').update(value).digest('hex').slice(0, 10);
}

function toNumber(value: unknown, fallback = 0): number {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value !== 'string') return fallback;
  const parsed = Number.parseFloat(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function parsePoints(points: string): Array<[number, number]> {
  const values = points
    .trim()
    .split(/[\s,]+/)
    .map((value) => Number.parseFloat(value))
    .filter((value) => Number.isFinite(value));

  const coords: Array<[number, number]> = [];
  for (let i = 0; i < values.length - 1; i += 2) {
    coords.push([values[i] ?? 0, values[i + 1] ?? 0]);
  }
  return coords;
}

function parseTransformTranslate(transform: string | undefined): { x: number; y: number } {
  if (!transform) return { x: 0, y: 0 };
  const translate = transform.match(/translate\(([^)]+)\)/i)?.[1];
  if (!translate) return { x: 0, y: 0 };
  const values = translate.split(/[\s,]+/).map((part) => Number.parseFloat(part)).filter((part) => Number.isFinite(part));
  return { x: values[0] ?? 0, y: values[1] ?? 0 };
}

function unionBoxes(boxes: Array<BBox | null | undefined>): BBox | null {
  const valid = boxes.filter((box): box is BBox => Boolean(box) && box.width > 0 && box.height > 0);
  if (!valid.length) return null;

  let minX = valid[0]!.x;
  let minY = valid[0]!.y;
  let maxX = valid[0]!.x + valid[0]!.width;
  let maxY = valid[0]!.y + valid[0]!.height;

  for (const box of valid.slice(1)) {
    minX = Math.min(minX, box.x);
    minY = Math.min(minY, box.y);
    maxX = Math.max(maxX, box.x + box.width);
    maxY = Math.max(maxY, box.y + box.height);
  }

  return { x: minX, y: minY, width: Math.max(0, maxX - minX), height: Math.max(0, maxY - minY) };
}

function expandBox(box: BBox, padding: number): BBox {
  return {
    x: box.x - padding,
    y: box.y - padding,
    width: box.width + padding * 2,
    height: box.height + padding * 2,
  };
}

function containsBox(outer: BBox, inner: BBox, padding = 0): boolean {
  const expanded = expandBox(outer, padding);
  return inner.x >= expanded.x
    && inner.y >= expanded.y
    && inner.x + inner.width <= expanded.x + expanded.width
    && inner.y + inner.height <= expanded.y + expanded.height;
}

function boxArea(box: BBox): number {
  return Math.max(0, box.width) * Math.max(0, box.height);
}

function parseViewBox(value: string | undefined): BBox | null {
  if (!value) return null;
  const parts = value.split(/[\s,]+/).map((part) => Number.parseFloat(part)).filter((part) => Number.isFinite(part));
  if (parts.length < 4) return null;
  return { x: parts[0] ?? 0, y: parts[1] ?? 0, width: Math.max(0, parts[2] ?? 0), height: Math.max(0, parts[3] ?? 0) };
}

function inferTextSize(text: string, attrs: Record<string, string>): BBox {
  const fontSize = toNumber(attrs['font-size'], 14);
  const width = Math.max(1, text.length * fontSize * 0.6);
  const height = Math.max(1, fontSize * 1.25);
  const x = toNumber(attrs.x, 0);
  const y = toNumber(attrs.y, 0) - height;
  return { x, y, width, height };
}

function pathToBox(d: string): BBox | null {
  const numbers = d.match(/-?\d*\.?\d+(?:e[-+]?\d+)?/gi)?.map((value) => Number.parseFloat(value)).filter((value) => Number.isFinite(value)) ?? [];
  if (numbers.length < 2) return null;

  const xs: number[] = [];
  const ys: number[] = [];
  for (let i = 0; i < numbers.length - 1; i += 2) {
    xs.push(numbers[i] ?? 0);
    ys.push(numbers[i + 1] ?? 0);
  }

  if (!xs.length || !ys.length) return null;
  const minX = Math.min(...xs);
  const maxX = Math.max(...xs);
  const minY = Math.min(...ys);
  const maxY = Math.max(...ys);
  return { x: minX, y: minY, width: Math.max(0, maxX - minX), height: Math.max(0, maxY - minY) };
}

function extractSemanticText(node: any): string {
  const attrs = node?.attribs ?? {};
  return normalizeText([
    attrs['data-name'],
    attrs['aria-label'],
    attrs['inkscape:label'],
    attrs.id,
    attrs.class,
  ].filter(Boolean).join(' '));
}

function isPenpotSvg($: cheerio.CheerioAPI, root: any): boolean {
  const metaText = normalizeText($('metadata').text());
  const rootText = normalizeText(root?.attribs?.id ?? '') + ' ' + normalizeText(root?.attribs?.class ?? '');
  return /penpot/i.test(metaText) || /penpot/i.test(rootText);
}

function getAttributes(node: any): Record<string, string> {
  const attrs = node?.attribs ?? {};
  return Object.fromEntries(Object.entries(attrs).map(([key, value]) => [key, String(value)]));
}

function classifySemanticLabel(value: string): WireframeElement['type'] {
  const text = value.toLowerCase();
  if (/\b(button|btn|cta|submit|primary-action|call-to-action)\b/.test(text)) return 'button';
  if (/\b(card|panel|tile|sheet|widget)\b/.test(text)) return 'card';
  if (/\b(header|hero|masthead|topbar|appbar|banner)\b/.test(text)) return 'header';
  if (/\b(input|field|textbox|text-field|textarea|select|search|form-control)\b/.test(text)) return 'input';
  if (/\b(image|img|avatar|thumbnail|photo|illustration|media)\b/.test(text)) return 'image';
  if (/\b(nav|navigation|navbar|menu|sidebar|breadcrumb|tabs?|toolbar|pagination)\b/.test(text)) return 'navigation';
  if (/\b(icon|glyph|chevron|arrow|close|menu-icon|svg-icon)\b/.test(text)) return 'icon';
  if (/\b(text|label|copy|headline|title|subtitle|paragraph|body|content)\b/.test(text)) return 'text-block';
  if (/\b(container|wrapper|section|layout|frame|group)\b/.test(text)) return 'container';
  return 'unknown';
}

function classifyByNode(node: any, semantic: string, content: string): WireframeElement['type'] {
  const tag = String(node?.tagName ?? node?.name ?? '').toLowerCase();
  const attrs = node?.attribs ?? {};
  const combined = `${semantic} ${content} ${attrs.class ?? ''} ${attrs.id ?? ''}`.toLowerCase();

  const semanticType = classifySemanticLabel(combined);
  if (semanticType !== 'unknown' && semanticType !== 'container') return semanticType;

  if (tag === 'text') return 'text-block';
  if (tag === 'image') return 'image';
  if (tag === 'use') return /icon|glyph|symbol/i.test(combined) ? 'icon' : 'unknown';
  if (tag === 'rect' || tag === 'path' || tag === 'polygon' || tag === 'polyline' || tag === 'circle' || tag === 'ellipse') {
    if (/button|cta|submit/.test(combined)) return 'button';
    if (/card|panel|tile|sheet/.test(combined)) return 'card';
    if (/header|hero|banner/.test(combined)) return 'header';
    if (/nav|menu|sidebar|navbar/.test(combined)) return 'navigation';
    if (/input|field|search|textbox/.test(combined)) return 'input';
  }

  return semanticType;
}

function getNodeText(node: any): string {
  if (!node) return '';
  const text = typeof node?.textContent === 'string' ? node.textContent : '';
  return normalizeText(text);
}

function getNodeBBox(node: any, $: cheerio.CheerioAPI, cache: WeakMap<any, BBox | null>): BBox | null {
  if (!node || node.type !== 'tag') return null;
  if (cache.has(node)) return cache.get(node) ?? null;

  const tag = String(node.tagName ?? '').toLowerCase();
  const attrs = getAttributes(node);
  const translate = parseTransformTranslate(attrs.transform);

  let box: BBox | null = null;

  if (attrs.hidden === 'true' || attrs.display === 'none') {
    cache.set(node, null);
    return null;
  }

  switch (tag) {
    case 'svg': {
      box = parseViewBox(attrs.viewBox) ?? null;
      if (!box) {
        const width = toNumber(attrs.width, 0);
        const height = toNumber(attrs.height, 0);
        box = width > 0 && height > 0 ? { x: 0, y: 0, width, height } : null;
      }
      break;
    }
    case 'rect': {
      const x = toNumber(attrs.x, 0) + translate.x;
      const y = toNumber(attrs.y, 0) + translate.y;
      const width = toNumber(attrs.width, 0);
      const height = toNumber(attrs.height, 0);
      box = width > 0 && height > 0 ? { x, y, width, height } : null;
      break;
    }
    case 'circle': {
      const cx = toNumber(attrs.cx, 0) + translate.x;
      const cy = toNumber(attrs.cy, 0) + translate.y;
      const r = toNumber(attrs.r, 0);
      box = r > 0 ? { x: cx - r, y: cy - r, width: r * 2, height: r * 2 } : null;
      break;
    }
    case 'ellipse': {
      const cx = toNumber(attrs.cx, 0) + translate.x;
      const cy = toNumber(attrs.cy, 0) + translate.y;
      const rx = toNumber(attrs.rx, 0);
      const ry = toNumber(attrs.ry, 0);
      box = rx > 0 && ry > 0 ? { x: cx - rx, y: cy - ry, width: rx * 2, height: ry * 2 } : null;
      break;
    }
    case 'line': {
      const x1 = toNumber(attrs.x1, 0) + translate.x;
      const y1 = toNumber(attrs.y1, 0) + translate.y;
      const x2 = toNumber(attrs.x2, 0) + translate.x;
      const y2 = toNumber(attrs.y2, 0) + translate.y;
      box = unionBoxes([{ x: x1, y: y1, width: 0, height: 0 }, { x: x2, y: y2, width: 0, height: 0 }]);
      if (box) {
        box.width = Math.max(1, box.width);
        box.height = Math.max(1, box.height);
      }
      break;
    }
    case 'polygon':
    case 'polyline': {
      const points = parsePoints(attrs.points ?? '');
      if (points.length) {
        const xs = points.map(([x]) => x + translate.x);
        const ys = points.map(([, y]) => y + translate.y);
        const minX = Math.min(...xs);
        const maxX = Math.max(...xs);
        const minY = Math.min(...ys);
        const maxY = Math.max(...ys);
        box = { x: minX, y: minY, width: Math.max(0, maxX - minX), height: Math.max(0, maxY - minY) };
      }
      break;
    }
    case 'path': {
      box = pathToBox(attrs.d ?? '');
      if (box) {
        box = { x: box.x + translate.x, y: box.y + translate.y, width: box.width, height: box.height };
      }
      break;
    }
    case 'text': {
      const text = getNodeText(node);
      box = inferTextSize(text, attrs);
      box.x += translate.x;
      box.y += translate.y;
      break;
    }
    case 'image':
    case 'foreignobject':
    case 'use': {
      const x = toNumber(attrs.x, 0) + translate.x;
      const y = toNumber(attrs.y, 0) + translate.y;
      const width = toNumber(attrs.width, 0);
      const height = toNumber(attrs.height, 0);
      box = width > 0 && height > 0 ? { x, y, width, height } : null;
      break;
    }
    case 'g': {
      const childBoxes = $(node)
        .children()
        .toArray()
        .map((child) => getNodeBBox(child, $, cache));
      box = unionBoxes(childBoxes);
      if (box) {
        box = { x: box.x + translate.x, y: box.y + translate.y, width: box.width, height: box.height };
      }
      break;
    }
    default: {
      if (BOUNDING_TAGS.has(tag)) {
        const childBoxes = $(node)
          .children()
          .toArray()
          .map((child) => getNodeBBox(child, $, cache));
        box = unionBoxes(childBoxes);
        if (box) {
          box = { x: box.x + translate.x, y: box.y + translate.y, width: box.width, height: box.height };
        }
      }
      break;
    }
  }

  cache.set(node, box);
  return box;
}

function shouldConsiderNode(node: any, bbox: BBox | null, minElementSize: number): boolean {
  if (!node || node.type !== 'tag' || !bbox) return false;
  if (bbox.width < minElementSize && bbox.height < minElementSize) return false;
  const tag = String(node.tagName ?? '').toLowerCase();
  if (!BOUNDING_TAGS.has(tag)) return false;
  if (tag === 'svg') return true;
  if (tag === 'g') return true;
  return true;
}

function hasPenpotLayerAttrs(attrs: Record<string, string>): boolean {
  return Boolean(
    attrs['inkscape:groupmode'] === 'layer'
    || attrs['data-name']
    || attrs['data-id']
    || attrs['inkscape:label']
    || /penpot/i.test(`${attrs.id ?? ''} ${attrs.class ?? ''}`),
  );
}

function isContainerCandidate(node: InternalNode): boolean {
  const tag = node.tag;
  const semantic = node.semantic.toLowerCase();
  const content = node.content?.toLowerCase() ?? '';
  const combined = `${semantic} ${content} ${node.attrs.class ?? ''} ${node.attrs.id ?? ''}`.toLowerCase();

  if (tag === 'svg' || tag === 'g') return true;
  if (hasPenpotLayerAttrs(node.attrs)) return true;
  if (/\b(container|wrapper|section|group|frame|layout|layer)\b/.test(combined)) return true;
  if (/\b(card|header|navigation|navbar|sidebar|toolbar|panel|hero|modal|dialog)\b/.test(combined)) return true;
  return boxArea(node.bbox) >= 3000 && node.children.length >= 2;
}

function buildNodeHierarchy(nodes: InternalNode[], preserveHierarchy: boolean): InternalNode[] {
  if (!preserveHierarchy) {
    return nodes.map((node) => ({ ...node, children: [] }));
  }

  const assigned = new Set<InternalNode>();
  const containers = nodes.filter((node) => isContainerCandidate(node)).sort((a, b) => boxArea(a.bbox) - boxArea(b.bbox));

  for (const node of nodes) {
    let bestParent: InternalNode | undefined;
    for (const container of containers) {
      if (container === node) continue;
      if (boxArea(container.bbox) <= boxArea(node.bbox)) continue;
      if (!containsBox(container.bbox, node.bbox, 2)) continue;
      if (!bestParent || boxArea(container.bbox) < boxArea(bestParent.bbox)) {
        bestParent = container;
      }
    }

    if (bestParent) {
      node.parent = bestParent;
      bestParent.children.push(node);
      assigned.add(node);
    }
  }

  return nodes.filter((node) => !node.parent || !assigned.has(node.parent) || node.parent === node);
}

function buildNodeId(name: string, type: WireframeElement['type'], order: number, bbox: BBox): string {
  return `${slugify(`${name}-${type}`)}-${shortHash(`${order}:${bbox.x}:${bbox.y}:${bbox.width}:${bbox.height}`)}`;
}

function serializeRootNamespaces(root: any): string {
  const attrs = root?.attribs ?? {};
  const namespaces: Array<[string, string]> = [
    ['xmlns', attrs.xmlns || 'http://www.w3.org/2000/svg'],
    ['xmlns:xlink', attrs['xmlns:xlink'] || 'http://www.w3.org/1999/xlink'],
  ];

  for (const [key, value] of Object.entries(attrs)) {
    if (key.startsWith('xmlns:') && !namespaces.some(([namespaceKey]) => namespaceKey === key)) {
      namespaces.push([key, value]);
    }
  }

  return namespaces.map(([key, value]) => `${key}="${value.replace(/"/g, '&quot;')}"`).join(' ');
}

function cloneElementHtml(node: any, $: cheerio.CheerioAPI): string {
  const clone = $(node).clone();
  return $.html(clone);
}

function createStandaloneSvg(node: InternalNode, root: any, $: cheerio.CheerioAPI): string {
  const viewBox = `${node.bbox.x} ${node.bbox.y} ${Math.max(1, node.bbox.width)} ${Math.max(1, node.bbox.height)}`;
  const namespaces = serializeRootNamespaces(root);
  const defs = $(root).children('defs, style, symbol, clipPath, mask, pattern').toArray().map((child) => $.html($(child).clone())).join('\n');
  const body = cloneElementHtml(node.node, $);

  return [
    `<?xml version="1.0" encoding="UTF-8"?>`,
    `<svg ${namespaces} viewBox="${viewBox}" width="${Math.max(1, Math.ceil(node.bbox.width))}" height="${Math.max(1, Math.ceil(node.bbox.height))}" role="img" aria-label="${escapeAttribute(node.semantic || node.kind || node.tag)}">`,
    defs ? `  <defs>\n${defs}\n  </defs>` : '',
    `  ${body}`,
    `</svg>`,
  ].filter(Boolean).join('\n');
}

function escapeAttribute(value: string): string {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function nodeToElement(node: InternalNode, root: any, $: cheerio.CheerioAPI, classifyElements: boolean, preserveHierarchy: boolean): WireframeElement {
  const name = normalizeText(node.semantic || node.content || node.tag || 'wireframe element') || 'wireframe element';
  const type = classifyElements ? classifyByNode(node.node, node.semantic, node.content ?? '') : 'unknown';
  const children = preserveHierarchy
    ? node.children
        .slice()
        .sort((a, b) => a.order - b.order)
        .map((child) => nodeToElement(child, root, $, classifyElements, preserveHierarchy))
    : [];

  return {
    id: buildNodeId(name, type, node.order, node.bbox),
    type,
    name,
    x: node.bbox.x,
    y: node.bbox.y,
    width: node.bbox.width,
    height: node.bbox.height,
    zIndex: node.order,
    content: node.content || undefined,
    children,
    svgContent: createStandaloneSvg(node, root, $),
    properties: node.attrs,
  };
}

function flattenElements(elements: WireframeElement[]): WireframeElement[] {
  const flattened: WireframeElement[] = [];
  const visit = (element: WireframeElement): void => {
    flattened.push(element);
    for (const child of element.children) visit(child);
  };
  for (const element of elements) visit(element);
  return flattened;
}

function createWarningSummary(warnings: string[], values: string[]): void {
  for (const value of values) {
    if (value && !warnings.includes(value)) warnings.push(value);
  }
}

export function classifySvgElement(element: any): WireframeElement['type'] {
  const attrs = getAttributes(element);
  const semantic = normalizeText([
    attrs['data-name'],
    attrs['aria-label'],
    attrs['inkscape:label'],
    attrs.id,
    attrs.class,
  ].filter(Boolean).join(' '));
  const content = normalizeText(String(element?.textContent ?? ''));
  return classifyByNode(element, semantic, content);
}

export async function extractWireframeElements(options: ExtractionOptions): Promise<ExtractionResult> {
  const warnings: string[] = [];
  const classifyElements = options.classifyElements ?? true;
  const preserveHierarchy = options.groupContainers ?? true;
  const minElementSize = options.minElementSize ?? DEFAULT_MIN_SIZE;

  let svgSource = '';
  try {
    svgSource = await fs.readFile(options.svgPath, 'utf8');
  } catch (error) {
    return {
      success: false,
      elements: [],
      elementCount: 0,
      typesFound: [],
      outputDir: options.outputDir,
      warnings: [`Failed to read SVG: ${String(error)}`],
    };
  }

  let $: cheerio.CheerioAPI;
  try {
    $ = cheerio.load(svgSource, { xmlMode: true, decodeEntities: true, lowerCaseAttributeNames: false, lowerCaseTags: false } as any);
  } catch (error) {
    return {
      success: false,
      elements: [],
      elementCount: 0,
      typesFound: [],
      outputDir: options.outputDir,
      warnings: [`Malformed SVG could not be parsed: ${String(error)}`],
    };
  }

  const root = $('svg').first();
  if (!root.length) {
    warnings.push('No <svg> root element found; attempting best-effort extraction from parsed document.');
  }

  const rootNode = root.length ? root.get(0) : $.root().children().first().get(0);
  if (!rootNode) {
    return {
      success: false,
      elements: [],
      elementCount: 0,
      typesFound: [],
      outputDir: options.outputDir,
      warnings: [...warnings, 'SVG document is empty or malformed.'],
    };
  }

  const penpotDetected = isPenpotSvg($, rootNode);
  if (penpotDetected) warnings.push('Penpot-specific SVG structure detected; using layer and metadata heuristics.');

  const bboxCache = new WeakMap<any, BBox | null>();
  const nodes: InternalNode[] = [];
  let order = 0;

  const visit = (node: any, depth: number, parent?: InternalNode): void => {
    if (!node || node.type !== 'tag') {
      return;
    }

    const tag = String(node.tagName ?? '').toLowerCase();
    if (!BOUNDING_TAGS.has(tag)) {
      for (const child of $(node).children().toArray()) visit(child, depth + 1, parent);
      return;
    }

    const bbox = getNodeBBox(node, $, bboxCache);
    if (!shouldConsiderNode(node, bbox, minElementSize)) {
      for (const child of $(node).children().toArray()) visit(child, depth + 1, parent);
      return;
    }

    const attrs = getAttributes(node);
    const semantic = normalizeText([
      attrs['data-name'],
      attrs['aria-label'],
      attrs['inkscape:label'],
      attrs.id,
      attrs.class,
    ].filter(Boolean).join(' ')) || tag;
    const content = getNodeText(node);

    const internal: InternalNode = {
      node,
      tag,
      attrs,
      text: content,
      bbox: bbox ?? { x: 0, y: 0, width: 0, height: 0 },
      order: order++,
      depth,
      parent,
      children: [],
      semantic,
      kind: 'unknown',
    };

    nodes.push(internal);
    if (parent) parent.children.push(internal);

    for (const child of $(node).children().toArray()) visit(child, depth + 1, internal);
  };

  visit(rootNode, 0);

  if (!nodes.length) {
    warnings.push('No extractable SVG elements were found.');
  }

  const topLevel = buildNodeHierarchy(nodes, preserveHierarchy);
  const rootElements = topLevel
    .sort((a, b) => a.order - b.order)
    .map((node) => nodeToElement(node, rootNode, $, classifyElements, preserveHierarchy));

  const elements = flattenElements(rootElements);
  const typesFound = Array.from(new Set(elements.map((element) => element.type)));

  const baseOutputDir = options.outputDir ?? path.join(path.dirname(options.svgPath), `${path.basename(options.svgPath, path.extname(options.svgPath))}-elements`);

  try {
    await fs.mkdir(baseOutputDir, { recursive: true });
    for (const element of elements) {
      const typeDir = path.join(baseOutputDir, element.type);
      await fs.mkdir(typeDir, { recursive: true });
      await fs.writeFile(path.join(typeDir, `${element.id}.svg`), element.svgContent, 'utf8');
    }

    const indexPayload = {
      sourceSvg: options.svgPath,
      generatedAt: new Date().toISOString(),
      penpotDetected,
      elementCount: elements.length,
      typesFound,
      warnings,
      elements,
    };
    await fs.writeFile(path.join(baseOutputDir, 'index.json'), `${JSON.stringify(indexPayload, null, 2)}\n`, 'utf8');
  } catch (error) {
    warnings.push(`Failed to write extracted elements: ${String(error)}`);
  }

  createWarningSummary(warnings, [
    elements.length === 0 ? 'No wireframe elements were extracted.' : '',
  ]);

  return {
    success: elements.length > 0,
    elements,
    elementCount: elements.length,
    typesFound,
    outputDir: baseOutputDir,
    warnings,
  };
}

export function generateElementReport(elements: WireframeElement[]): string {
  const total = elements.length;
  const byType = new Map<string, number>();
  for (const element of elements) {
    byType.set(element.type, (byType.get(element.type) ?? 0) + 1);
  }

  const lines = [
    '# Wireframe Element Report',
    '',
    `Total elements: ${total}`,
    '',
    '## Types',
    ...Array.from(byType.entries())
      .sort((a, b) => b[1] - a[1])
      .map(([type, count]) => `- ${type}: ${count}`),
    '',
    '## Elements',
    ...elements.map((element) => `- ${element.name} (${element.type}) @ ${Math.round(element.x)},${Math.round(element.y)} ${Math.round(element.width)}x${Math.round(element.height)}`),
  ];

  return lines.join('\n');
}

export default {
  extractWireframeElements,
  classifySvgElement,
  generateElementReport,
};
