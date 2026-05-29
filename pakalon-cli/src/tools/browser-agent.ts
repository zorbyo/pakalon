import { z } from "zod";
import type { Browser, BrowserContext, Locator, Page } from "playwright";
import logger from "@/utils/logger.js";

export interface BrowserResult {
  success: boolean;
  message: string;
  data?: unknown;
  error?: string;
}

export interface PageElement {
  ref: string;
  role: string;
  name: string;
  type: string;
  value?: string;
  checked?: boolean;
  disabled?: boolean;
  focused?: boolean;
}

export interface PageSnapshot {
  url: string;
  title: string;
  content: string;
  elements: PageElement[];
}

type AccessibilityNode = {
  role?: string;
  name?: string;
  value?: unknown;
  checked?: boolean;
  disabled?: boolean;
  focused?: boolean;
  children?: AccessibilityNode[];
};

let browserInstance: Browser | null = null;
let browserContext: BrowserContext | null = null;
let currentPage: Page | null = null;
let elementRefCounter = 0;
const elementRefs = new Map<string, Locator>();

function generateElementRef(): string {
  elementRefCounter += 1;
  return `el_${elementRefCounter}_${Date.now().toString(36)}`;
}

function toWaitPattern(value: string): string | RegExp {
  if (value.startsWith("/") && value.endsWith("/") && value.length > 1) {
    return new RegExp(value.slice(1, -1));
  }

  if (value.includes("*")) {
    const escaped = value.replace(/[.+?^${}()|[\]\\]/g, "\\$&");
    const wildcarded = escaped.replace(/\*\*/g, ".*").replace(/\*/g, "[^/]*");
    return new RegExp(`^${wildcarded}$`);
  }

  return value;
}

async function getBrowser(): Promise<Browser> {
  if (!browserInstance || !browserInstance.isConnected()) {
    const playwright = await import("playwright");
    browserInstance = await playwright.chromium.launch({
      headless: true,
      args: ["--no-sandbox", "--disable-setuid-sandbox"],
    });
    browserContext = await browserInstance.newContext({ viewport: { width: 1280, height: 720 } });
    currentPage = await browserContext.newPage();
    elementRefCounter = 0;
    elementRefs.clear();
    logger.info("[browser-agent] Browser launched");
  }

  return browserInstance;
}

async function getPage(): Promise<Page> {
  await getBrowser();
  if (!currentPage) {
    throw new Error("No page available");
  }
  return currentPage;
}

async function closeBrowser(): Promise<void> {
  if (currentPage) {
    await currentPage.close();
    currentPage = null;
  }
  if (browserContext) {
    await browserContext.close();
    browserContext = null;
  }
  if (browserInstance) {
    await browserInstance.close();
    browserInstance = null;
  }
  elementRefs.clear();
}

async function locatorFromRef(ref: string): Promise<Locator | BrowserResult> {
  if (!ref || !ref.startsWith("el_")) {
    return { success: false, message: "Invalid element reference", error: "Element reference must start with 'el_'" };
  }

  const locator = elementRefs.get(ref);
  if (!locator) {
    return { success: false, message: "Element not found", error: `No element found with ref: ${ref}` };
  }

  return locator;
}

async function capturePageSnapshot(page: Page): Promise<PageSnapshot> {
  const title = await page.title();
  const accessibilitySnapshot = await page.accessibility.snapshot();
  const elements: PageElement[] = [];

  const walk = (node: AccessibilityNode | null): void => {
    if (!node) return;

    const ref = generateElementRef();
    const role = node.role || "unknown";
    const baseLocator = page.locator(`[role="${role}"]`);
    const locator = node.name ? baseLocator.filter({ hasText: node.name }) : baseLocator;
    elementRefs.set(ref, locator);

    const element: PageElement = {
      ref,
      role,
      name: node.name || "",
      type: "",
      disabled: node.disabled,
      focused: node.focused,
    };

    if (node.value !== undefined) {
      element.value = typeof node.value === "object" && node.value !== null ? JSON.stringify(node.value) : String(node.value);
    }

    if (typeof node.checked === "boolean") {
      element.checked = node.checked;
    }

    elements.push(element);

    for (const child of node.children ?? []) {
      walk(child);
    }
  };

  if (accessibilitySnapshot) {
    walk(accessibilitySnapshot as AccessibilityNode);
  }

  const content = await page.evaluate(() => document.body?.innerText || "");
  return { url: page.url(), title, content: content.slice(0, 5000), elements };
}

export interface BrowserWaitInput {
  time?: number;
  text?: string;
  textGone?: string;
  element?: string;
  url?: string;
  load?: "domcontentloaded" | "load" | "networkidle";
}

export const browserNavigateSchema = z.object({
  url: z.string().url(),
  waitUntil: z.enum(["domcontentloaded", "load", "networkidle"]).optional().default("domcontentloaded"),
});

export const browserClickSchema = z.object({
  ref: z.string(),
  elementDescription: z.string().optional(),
  doubleClick: z.boolean().optional().default(false),
  button: z.enum(["left", "right", "middle"]).optional().default("left"),
});

export const browserFillFormSchema = z.object({
  fields: z.array(z.object({
    ref: z.string(),
    name: z.string(),
    type: z.enum(["textbox", "checkbox", "radio", "combobox", "slider", "textarea"]),
    value: z.string(),
  })).min(1),
});

export const browserSnapshotSchema = z.object({
  filename: z.string().optional(),
  depth: z.number().optional().default(10),
});

export const browserScreenshotSchema = z.object({
  filename: z.string().optional(),
  fullPage: z.boolean().optional().default(false),
  type: z.enum(["png", "jpeg"]).optional().default("png"),
});

export const browserWaitSchema = z.object({
  time: z.number().optional(),
  text: z.string().optional(),
  textGone: z.string().optional(),
  element: z.string().optional(),
  url: z.string().optional(),
  load: z.enum(["domcontentloaded", "load", "networkidle"]).optional(),
});

export const browserSelectOptionSchema = z.object({
  ref: z.string(),
  values: z.array(z.string()).min(1),
});

export const browserPushStateSchema = z.object({
  url: z.string(),
});

export const browserHoverSchema = z.object({
  ref: z.string(),
});

export const browserScrollSchema = z.object({
  direction: z.enum(["up", "down", "left", "right"]),
  px: z.number().optional().default(800),
});

export const browserCheckSchema = z.object({
  ref: z.string(),
});

export const browserTypeSchema = z.object({
  ref: z.string(),
  text: z.string(),
});

export const browserPressSchema = z.object({
  key: z.string(),
});


export class BrowserAgent {
  async navigate(input: z.infer<typeof browserNavigateSchema>): Promise<BrowserResult> {
    try {
      const page = await getPage();
      await page.goto(input.url, { waitUntil: input.waitUntil });
      elementRefs.clear();
      elementRefCounter = 0;
      const snapshot = await capturePageSnapshot(page);
      return { success: true, message: `Navigated to ${snapshot.url}`, data: snapshot };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return { success: false, message: "Navigation failed", error: message };
    }
  }

  async back(): Promise<BrowserResult> {
    try {
      const page = await getPage();
      const url = (await page.goBack()) ?? page.url();
      return { success: true, message: `Went back to ${url}`, data: { url, title: await page.title() } };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return { success: false, message: "Back navigation failed", error: message };
    }
  }

  async forward(): Promise<BrowserResult> {
    try {
      const page = await getPage();
      const url = (await page.goForward()) ?? page.url();
      return { success: true, message: `Went forward to ${url}`, data: { url, title: await page.title() } };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return { success: false, message: "Forward navigation failed", error: message };
    }
  }

  async reload(): Promise<BrowserResult> {
    try {
      const page = await getPage();
      await page.reload();
      return { success: true, message: `Reloaded ${page.url()}`, data: { url: page.url(), title: await page.title() } };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return { success: false, message: "Reload failed", error: message };
    }
  }

  async pushState(url: string): Promise<BrowserResult> {
    try {
      const page = await getPage();
      await page.evaluate((nextUrl) => history.pushState({}, "", nextUrl), url);
      return { success: true, message: `Pushed history state to ${page.url()}`, data: { url: page.url(), title: await page.title() } };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return { success: false, message: "Push state failed", error: message };
    }
  }

  async hover(ref: string): Promise<BrowserResult> {
    try {
      const locator = await locatorFromRef(ref);
      if ("success" in locator) return locator;
      await locator.hover();
      return { success: true, message: `Hovered ${ref}`, data: { ref } };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return { success: false, message: "Hover failed", error: message };
    }
  }

  async scroll(direction: "up" | "down" | "left" | "right", px = 800): Promise<BrowserResult> {
    try {
      const page = await getPage();
      const amount = Math.max(0, px);
      const dx = direction === "left" ? -amount : direction === "right" ? amount : 0;
      const dy = direction === "up" ? -amount : direction === "down" ? amount : 0;
      await page.mouse.wheel(dx, dy);
      return { success: true, message: `Scrolled ${direction} by ${amount}px`, data: { direction, px: amount } };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return { success: false, message: "Scroll failed", error: message };
    }
  }

  async check(ref: string): Promise<BrowserResult> {
    try {
      const locator = await locatorFromRef(ref);
      if ("success" in locator) return locator;
      if (!(await locator.isChecked())) {
        await locator.check();
      }
      return { success: true, message: `Checked ${ref}`, data: { ref } };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return { success: false, message: "Check failed", error: message };
    }
  }

  async type(ref: string, text: string): Promise<BrowserResult> {
    try {
      const page = await getPage();
      const locator = await locatorFromRef(ref);
      if ("success" in locator) return locator;
      await locator.click();
      await page.keyboard.type(text);
      return { success: true, message: `Typed into ${ref}`, data: { ref, textLength: text.length } };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return { success: false, message: "Type failed", error: message };
    }
  }

  async press(key: string): Promise<BrowserResult> {
    try {
      const page = await getPage();
      await page.keyboard.press(key);
      return { success: true, message: `Pressed ${key}`, data: { key } };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return { success: false, message: "Press failed", error: message };
    }
  }

  async selectOption(ref: string, values: string[]): Promise<BrowserResult> {
    try {
      const locator = await locatorFromRef(ref);
      if ("success" in locator) return locator;
      await locator.selectOption(values);
      return { success: true, message: `Selected ${values.length} option(s) in ${ref}`, data: { ref, values } };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return { success: false, message: "Select option failed", error: message };
    }
  }

  async click(ref: string): Promise<BrowserResult> {
    try {
      const locator = await locatorFromRef(ref);
      if ("success" in locator) return locator;
      await locator.click();
      return { success: true, message: `Clicked ${ref}`, data: { ref } };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return { success: false, message: "Click failed", error: message };
    }
  }

  async fillForm(fields: Array<{ ref: string; name: string; type: "textbox" | "checkbox" | "radio" | "combobox" | "slider" | "textarea"; value: string }>): Promise<BrowserResult> {
    try {
      const filledFields: Array<{ name: string; value: string }> = [];

      for (const field of fields) {
        const locator = await locatorFromRef(field.ref);
        if ("success" in locator) continue;

        filledFields.push({ name: field.name, value: field.value });

        switch (field.type) {
          case "textbox":
          case "textarea":
          case "slider":
            await locator.fill(field.value);
            break;
          case "checkbox": {
            const shouldCheck = field.value === "true" || field.value === "1";
            if ((await locator.isChecked()) !== shouldCheck) {
              await locator.click();
            }
            break;
          }
          case "radio":
            await locator.click();
            break;
          case "combobox":
            await locator.selectOption(field.value);
            break;
        }
      }

      return { success: true, message: `Filled ${filledFields.length} fields`, data: filledFields };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return { success: false, message: "Fill form failed", error: message };
    }
  }

  async snapshot(input: z.infer<typeof browserSnapshotSchema>): Promise<BrowserResult> {
    try {
      const page = await getPage();
      const snapshot = await capturePageSnapshot(page);

      if (input.filename) {
        const fs = await import("fs");
        fs.writeFileSync(input.filename, JSON.stringify(snapshot, null, 2), "utf-8");
      }

      return { success: true, message: `Snapshot captured: ${snapshot.title}`, data: snapshot };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return { success: false, message: "Snapshot failed", error: message };
    }
  }

  async screenshot(input: z.infer<typeof browserScreenshotSchema>): Promise<BrowserResult> {
    try {
      const page = await getPage();
      const filename = input.filename ?? `screenshot-${Date.now()}.${input.type}`;
      const path = await page.screenshot({ path: filename, fullPage: input.fullPage, type: input.type });
      return { success: true, message: `Screenshot saved: ${filename}`, data: { filename, path: String(path) } };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return { success: false, message: "Screenshot failed", error: message };
    }
  }

  async wait(input: BrowserWaitInput): Promise<BrowserResult> {
    try {
      const page = await getPage();

      if (input.time !== undefined) {
        await page.waitForTimeout(input.time * 1000);
      }

      if (input.text) {
        await page.getByText(input.text).waitFor({ timeout: 30000 });
      }

      if (input.textGone) {
        await page.getByText(input.textGone).waitFor({ state: "hidden", timeout: 30000 });
      }

      if (input.element) {
        await page.waitForSelector(input.element, { timeout: 30000 });
      }

      if (input.url) {
        await page.waitForURL(toWaitPattern(input.url), { timeout: 30000 });
      }

      if (input.load) {
        await page.waitForLoadState(input.load, { timeout: 30000 });
      }

      return { success: true, message: "Wait completed", data: input };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return { success: false, message: "Wait failed", error: message };
    }
  }

  async close(): Promise<BrowserResult> {
    try {
      await closeBrowser();
      return { success: true, message: "Browser closed" };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return { success: false, message: "Close failed", error: message };
    }
  }

  async getPage(): Promise<Page> {
    return getPage();
  }
}

export const browserAgent = new BrowserAgent();

export const browserNavigate = (input: z.infer<typeof browserNavigateSchema>) => browserAgent.navigate(input);
export const browserBack = () => browserAgent.back();
export const browserForward = () => browserAgent.forward();
export const browserReload = () => browserAgent.reload();
export const browserPushState = (input: z.infer<typeof browserPushStateSchema>) => browserAgent.pushState(input.url);
export const browserHover = (input: z.infer<typeof browserHoverSchema>) => browserAgent.hover(input.ref);
export const browserScroll = (input: z.infer<typeof browserScrollSchema>) => browserAgent.scroll(input.direction, input.px);
export const browserCheck = (input: z.infer<typeof browserCheckSchema>) => browserAgent.check(input.ref);
export const browserType = (input: z.infer<typeof browserTypeSchema>) => browserAgent.type(input.ref, input.text);
export const browserPress = (input: z.infer<typeof browserPressSchema>) => browserAgent.press(input.key);
export const browserSelectOption = (input: z.infer<typeof browserSelectOptionSchema>) => browserAgent.selectOption(input.ref, input.values);
export const browserClick = (input: z.infer<typeof browserClickSchema>) => browserAgent.click(input.ref);
export const browserFillForm = (input: z.infer<typeof browserFillFormSchema>) => browserAgent.fillForm(input.fields);
export const browserSnapshot = (input: z.infer<typeof browserSnapshotSchema>) => browserAgent.snapshot(input);
export const browserScreenshot = (input: z.infer<typeof browserScreenshotSchema>) => browserAgent.screenshot(input);
export const browserWait = (input: BrowserWaitInput) => browserAgent.wait(input);
export const browserClose = () => browserAgent.close();

export default BrowserAgent;
