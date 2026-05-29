/**
 * WebBrowserTool for Pakalon CLI
 *
 * Provides browser automation capabilities including:
 * - Navigation to URLs
 * - Clicking elements
 * - Filling forms
 * - Taking screenshots
 * - Extracting page content
 */

import { z } from "zod";
import logger from "@/utils/logger.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface PageSnapshot {
  url: string;
  title: string;
  content: string;
  elements: PageElement[];
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

export interface BrowserResult {
  success: boolean;
  message: string;
  data?: unknown;
  error?: string;
}

export interface NavigateResult extends BrowserResult {
  url: string;
  title: string;
  snapshot?: PageSnapshot;
}

export interface ClickResult extends BrowserResult {
  elementRef: string;
}

export interface FillFormResult extends BrowserResult {
  fields: Array<{ name: string; value: string }>;
}

export interface ScreenshotResult extends BrowserResult {
  filename: string;
  path: string;
}

// ---------------------------------------------------------------------------
// Schema Definitions
// ---------------------------------------------------------------------------

export const browserNavigateSchema = z.object({
  url: z.string().url().describe("The URL to navigate to"),
  waitUntil: z.enum(["domcontentloaded", "load", "networkidle"]).optional()
    .default("domcontentloaded")
    .describe("When to consider navigation complete"),
});

export type BrowserNavigateInput = z.infer<typeof browserNavigateSchema>;

export const browserClickSchema = z.object({
  ref: z.string().describe("Element reference from page snapshot"),
  elementDescription: z.string().optional()
    .describe("Human-readable element description for logging"),
  doubleClick: z.boolean().optional().default(false)
    .describe("Whether to perform a double click"),
  button: z.enum(["left", "right", "middle"]).optional().default("left")
    .describe("Mouse button to use"),
});

export type BrowserClickInput = z.infer<typeof browserClickSchema>;

export const browserFillFormSchema = z.object({
  fields: z.array(z.object({
    ref: z.string().describe("Element reference from page snapshot"),
    name: z.string().describe("Human-readable field name"),
    type: z.enum(["textbox", "checkbox", "radio", "combobox", "slider", "textarea"])
      .describe("Type of the field"),
    value: z.string().describe("Value to fill (true/false for checkbox)"),
  })).min(1).describe("Fields to fill"),
});

export type BrowserFillFormInput = z.infer<typeof browserFillFormSchema>;

export const browserSnapshotSchema = z.object({
  filename: z.string().optional()
    .describe("Optional filename to save snapshot to"),
  depth: z.number().optional().default(10)
    .describe("Maximum depth of the snapshot tree"),
});

export type BrowserSnapshotInput = z.infer<typeof browserSnapshotSchema>;

export const browserScreenshotSchema = z.object({
  filename: z.string().optional()
    .describe("Filename for the screenshot"),
  fullPage: z.boolean().optional().default(false)
    .describe("Capture full scrollable page"),
  type: z.enum(["png", "jpeg"]).optional().default("png")
    .describe("Image format"),
});

export type BrowserScreenshotInput = z.infer<typeof browserScreenshotSchema>;

export const browserWaitSchema = z.object({
  time: z.number().optional()
    .describe("Time to wait in seconds"),
  text: z.string().optional()
    .describe("Text to wait for"),
  textGone: z.string().optional()
    .describe("Text to wait for to disappear"),
});

export type BrowserWaitInput = z.infer<typeof browserWaitSchema>;

export const browserSelectOptionSchema = z.object({
  ref: z.string().describe("Element reference from page snapshot"),
  elementDescription: z.string().optional()
    .describe("Human-readable element description"),
  values: z.array(z.string()).min(1)
    .describe("Values to select"),
});

export type BrowserSelectOptionInput = z.infer<typeof browserSelectOptionSchema>;

// ---------------------------------------------------------------------------
// Browser State (singleton-like session management)
// ---------------------------------------------------------------------------

let browserInstance: import("playwright").Browser | null = null;
let browserContext: import("playwright").BrowserContext | null = null;
let currentPage: import("playwright").Page | null = null;
let elementRefCounter = 0;
const elementRefs = new Map<string, import("playwright").Locator>();

function generateElementRef(): string {
  return `el_${++elementRefCounter}_${Date.now().toString(36)}`;
}

// ---------------------------------------------------------------------------
// Browser Lifecycle
// ---------------------------------------------------------------------------

async function getBrowser(): Promise<import("playwright").Browser> {
  if (!browserInstance || !browserInstance.isConnected()) {
    const playwright = await import("playwright");
    browserInstance = await playwright.chromium.launch({
      headless: true,
      args: ["--no-sandbox", "--disable-setuid-sandbox"],
    });
    browserContext = await browserInstance.newContext({
      viewport: { width: 1280, height: 720 },
    });
    currentPage = await browserContext.newPage();
    elementRefCounter = 0;
    elementRefs.clear();
    logger.info("[web-browser] Browser launched");
  }
  return browserInstance;
}

async function getPage(): Promise<import("playwright").Page> {
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
  logger.info("[web-browser] Browser closed");
}

// ---------------------------------------------------------------------------
// Page Snapshot Helper
// ---------------------------------------------------------------------------

async function capturePageSnapshot(page: import("playwright").Page): Promise<PageSnapshot> {
  const url = page.url();
  const title = await page.title();

  const accessibilitySnapshot = await page.accessibility.snapshot();
  const elements: PageElement[] = [];

  function processNode(node: import("playwright").AccessibilityNode, parentRef?: string): void {
    if (!node) return;

    const ref = generateElementRef();
    const element: PageElement = {
      ref,
      role: node.role || "unknown",
      name: node.name || "",
      type: "",
      disabled: node.disabled,
      focused: node.focused,
    };

    if (node.value) {
      if (typeof node.value === "object" && node.value !== null) {
        element.value = JSON.stringify(node.value);
      } else {
        element.value = String(node.value);
      }
    }

    if (typeof node.checked === "boolean") {
      element.checked = node.checked;
    }

    elements.push(element);

    if (node.children) {
      for (const child of node.children) {
        processNode(child, ref);
      }
    }
  }

  if (accessibilitySnapshot) {
    processNode(accessibilitySnapshot);
  }

  const content = await page.content();
  const textContent = await page.evaluate(() => document.body?.innerText || "");

  return {
    url,
    title,
    content: textContent.slice(0, 5000),
    elements,
  };
}

// ---------------------------------------------------------------------------
// Tool Implementations
// ---------------------------------------------------------------------------

export async function browserNavigate(input: BrowserNavigateInput): Promise<NavigateResult> {
  try {
    const page = await getPage();
    const waitUntil = input.waitUntil || "domcontentloaded";

    logger.info(`[web-browser] Navigating to: ${input.url}`);
    await page.goto(input.url, { waitUntil: waitUntil as "domcontentloaded" | "load" | "networkidle" });

    const url = page.url();
    const title = await page.title();
    const snapshot = await capturePageSnapshot(page);

    logger.info(`[web-browser] Navigated to: ${url}`);

    return {
      success: true,
      message: `Navigated to ${url}`,
      url,
      title,
      snapshot,
    };
  } catch (error) {
    const errMsg = error instanceof Error ? error.message : String(error);
    logger.error(`[web-browser] Navigation failed: ${errMsg}`);
    return {
      success: false,
      message: "Navigation failed",
      url: "",
      title: "",
      error: errMsg,
    };
  }
}

export async function browserClick(input: BrowserClickInput): Promise<ClickResult> {
  try {
    const page = await getPage();

    const ref = input.ref;
    if (!ref || !ref.startsWith("el_")) {
      return {
        success: false,
        message: "Invalid element reference",
        elementRef: ref,
        error: "Element reference must start with 'el_'",
      };
    }

    const locator = elementRefs.get(ref);
    if (!locator) {
      return {
        success: false,
        message: "Element not found",
        elementRef: ref,
        error: `No element found with ref: ${ref}`,
      };
    }

    const description = input.elementDescription || ref;
    logger.info(`[web-browser] Clicking: ${description}`);

    if (input.doubleClick) {
      await locator.dblclick();
    } else {
      await locator.click();
    }

    return {
      success: true,
      message: `Clicked ${description}`,
      elementRef: ref,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    logger.error(`[web-browser] Click failed: ${message}`);
    return {
      success: false,
      message: "Click failed",
      elementRef: input.ref,
      error: message,
    };
  }
}

export async function browserFillForm(input: BrowserFillFormInput): Promise<FillFormResult> {
  try {
    const page = await getPage();
    const filledFields: Array<{ name: string; value: string }> = [];

    for (const field of input.fields) {
      const ref = field.ref;
      if (!ref || !ref.startsWith("el_")) {
        logger.warn(`[web-browser] Invalid ref for field ${field.name}: ${ref}`);
        continue;
      }

      const locator = elementRefs.get(ref);
      if (!locator) {
        logger.warn(`[web-browser] Element not found for field ${field.name}`);
        continue;
      }

      logger.info(`[web-browser] Filling ${field.type} field: ${field.name}`);
      filledFields.push({ name: field.name, value: field.value });

      switch (field.type) {
        case "textbox":
        case "textarea":
          await locator.fill(field.value);
          break;
        case "checkbox":
          const shouldCheck = field.value === "true" || field.value === "1";
          const isChecked = await locator.isChecked();
          if (isChecked !== shouldCheck) {
            await locator.click();
          }
          break;
        case "radio":
          await locator.click();
          break;
        case "combobox":
          await locator.selectOption(field.value);
          break;
        case "slider":
          await locator.fill(field.value);
          break;
        default:
          await locator.fill(field.value);
      }
    }

    return {
      success: true,
      message: `Filled ${filledFields.length} fields`,
      fields: filledFields,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    logger.error(`[web-browser] Fill form failed: ${message}`);
    return {
      success: false,
      message: "Fill form failed",
      fields: [],
      error: message,
    };
  }
}

export async function browserSnapshot(input: BrowserSnapshotInput): Promise<BrowserResult> {
  try {
    const page = await getPage();
    const snapshot = await capturePageSnapshot(page);

    if (input.filename) {
      const fs = await import("fs");
      const path = await import("path");
      const content = JSON.stringify(snapshot, null, 2);
      fs.writeFileSync(input.filename, content, "utf-8");
      logger.info(`[web-browser] Snapshot saved to: ${input.filename}`);
    }

    return {
      success: true,
      message: `Snapshot captured: ${snapshot.title}`,
      data: snapshot,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    logger.error(`[web-browser] Snapshot failed: ${message}`);
    return {
      success: false,
      message: "Snapshot failed",
      error: message,
    };
  }
}

export async function browserScreenshot(input: BrowserScreenshotInput): Promise<ScreenshotResult> {
  try {
    const page = await getPage();
    const filename = input.filename || `screenshot-${Date.now()}.${input.type}`;
    const screenshotType = input.type === "jpeg" ? "jpeg" : "png";

    const path = await page.screenshot({
      path: filename,
      fullPage: input.fullPage,
      type: screenshotType,
    });

    logger.info(`[web-browser] Screenshot saved: ${filename}`);

    return {
      success: true,
      message: `Screenshot saved: ${filename}`,
      filename,
      path: String(path),
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    logger.error(`[web-browser] Screenshot failed: ${message}`);
    return {
      success: false,
      message: "Screenshot failed",
      filename: input.filename || "",
      path: "",
      error: message,
    };
  }
}

export async function browserWait(input: BrowserWaitInput): Promise<BrowserResult> {
  try {
    const page = await getPage();

    if (input.time !== undefined) {
      const timeMs = input.time * 1000;
      logger.info(`[web-browser] Waiting ${input.time}s`);
      await page.waitForTimeout(timeMs);
    }

    if (input.text) {
      logger.info(`[web-browser] Waiting for text: ${input.text}`);
      await page.waitForSelector(`text=${input.text}`, { timeout: 30000 });
    }

    if (input.textGone) {
      logger.info(`[web-browser] Waiting for text to disappear: ${input.textGone}`);
      await page.waitForSelector(`text=${input.textGone}`, { state: "hidden", timeout: 30000 });
    }

    return {
      success: true,
      message: "Wait completed",
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    logger.error(`[web-browser] Wait failed: ${message}`);
    return {
      success: false,
      message: "Wait failed",
      error: message,
    };
  }
}

export async function browserSelectOption(input: BrowserSelectOptionInput): Promise<BrowserResult> {
  try {
    const page = await getPage();
    const ref = input.ref;

    if (!ref || !ref.startsWith("el_")) {
      return {
        success: false,
        message: "Invalid element reference",
        error: "Element reference must start with 'el_'",
      };
    }

    const locator = elementRefs.get(ref);
    if (!locator) {
      return {
        success: false,
        message: "Element not found",
        error: `No element found with ref: ${ref}`,
      };
    }

    const description = input.elementDescription || ref;
    logger.info(`[web-browser] Selecting option in: ${description}`);

    await locator.selectOption(input.values);

    return {
      success: true,
      message: `Selected options in ${description}`,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    logger.error(`[web-browser] Select option failed: ${message}`);
    return {
      success: false,
      message: "Select option failed",
      error: message,
    };
  }
}

export async function browserClose(): Promise<BrowserResult> {
  try {
    await closeBrowser();
    return {
      success: true,
      message: "Browser closed",
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    logger.error(`[web-browser] Close failed: ${message}`);
    return {
      success: false,
      message: "Close failed",
      error: message,
    };
  }
}

// ---------------------------------------------------------------------------
// Tool Definitions for Registry
// ---------------------------------------------------------------------------

export const browserNavigateToolDefinition = {
  name: "browser_navigate",
  description: "Navigate to a URL in the browser",
  parameters: browserNavigateSchema,
  requiresPermission: true,
  execute: browserNavigate,
};

export const browserClickToolDefinition = {
  name: "browser_click",
  description: "Click an element on the page",
  parameters: browserClickSchema,
  requiresPermission: true,
  execute: browserClick,
};

export const browserFillFormToolDefinition = {
  name: "browser_fill_form",
  description: "Fill multiple form fields on the page",
  parameters: browserFillFormSchema,
  requiresPermission: true,
  execute: browserFillForm,
};

export const browserSnapshotToolDefinition = {
  name: "browser_snapshot",
  description: "Capture accessibility snapshot of the current page",
  parameters: browserSnapshotSchema,
  requiresPermission: false,
  execute: browserSnapshot,
};

export const browserScreenshotToolDefinition = {
  name: "browser_screenshot",
  description: "Take a screenshot of the current page",
  parameters: browserScreenshotSchema,
  requiresPermission: false,
  execute: browserScreenshot,
};

export const browserWaitToolDefinition = {
  name: "browser_wait",
  description: "Wait for text to appear/disappear or a specified time",
  parameters: browserWaitSchema,
  requiresPermission: false,
  execute: browserWait,
};

export const browserSelectOptionToolDefinition = {
  name: "browser_select_option",
  description: "Select an option in a dropdown",
  parameters: browserSelectOptionSchema,
  requiresPermission: true,
  execute: browserSelectOption,
};

export const browserCloseToolDefinition = {
  name: "browser_close",
  description: "Close the browser",
  parameters: z.object({}),
  requiresPermission: true,
  execute: browserClose,
};

// ---------------------------------------------------------------------------
// Exports
// ---------------------------------------------------------------------------

export default {
  browserNavigate,
  browserClick,
  browserFillForm,
  browserSnapshot,
  browserScreenshot,
  browserWait,
  browserSelectOption,
  browserClose,
  browserNavigateSchema,
  browserClickSchema,
  browserFillFormSchema,
  browserSnapshotSchema,
  browserScreenshotSchema,
  browserWaitSchema,
  browserSelectOptionSchema,
  browserNavigateToolDefinition,
  browserClickToolDefinition,
  browserFillFormToolDefinition,
  browserSnapshotToolDefinition,
  browserScreenshotToolDefinition,
  browserWaitToolDefinition,
  browserSelectOptionToolDefinition,
  browserCloseToolDefinition,
};
