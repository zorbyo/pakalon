declare module "playwright" {
  export type ScreenshotType = "png" | "jpeg";

  export interface AccessibilityNode {
    role?: string;
    name?: string;
    value?: unknown;
    checked?: boolean | "mixed";
    disabled?: boolean;
    focused?: boolean;
    children?: AccessibilityNode[];
  }

  export interface Locator {
    click(options?: { button?: "left" | "right" | "middle" }): Promise<void>;
    dblclick(): Promise<void>;
    fill(value: string): Promise<void>;
    filter(options?: { hasText?: string | RegExp }): Locator;
    waitFor(options?: { state?: "hidden" | "visible" | "attached" | "detached"; timeout?: number }): Promise<void>;
    hover(): Promise<void>;
    check(): Promise<void>;
    isChecked(): Promise<boolean>;
    selectOption(values: string | string[]): Promise<unknown>;
  }

  export type AriaRole = string;

  export interface Page {
    goto(
      url: string,
      options?: { waitUntil?: "domcontentloaded" | "load" | "networkidle" },
    ): Promise<unknown>;
    url(): string;
    title(): Promise<string>;
    locator(selector: string): Locator;
    getByText(text: string | RegExp): Locator;
    accessibility: {
      snapshot(): Promise<AccessibilityNode | null>;
    };
    content(): Promise<string>;
    evaluate<T>(pageFunction: () => T): Promise<T>;
    evaluate<T, Arg>(pageFunction: (arg: Arg) => T, arg: Arg): Promise<T>;
    close(): Promise<void>;
    goBack(): Promise<string | null>;
    goForward(): Promise<string | null>;
    reload(options?: { waitUntil?: "domcontentloaded" | "load" | "networkidle" }): Promise<unknown>;
    waitForURL(url: string | RegExp, options?: { timeout?: number }): Promise<void>;
    waitForLoadState(state?: "domcontentloaded" | "load" | "networkidle", options?: { timeout?: number }): Promise<void>;
    waitForTimeout(timeout: number): Promise<void>;
    waitForSelector(
      selector: string,
      options?: { state?: "hidden" | "visible" | "attached" | "detached"; timeout?: number },
    ): Promise<unknown>;
    screenshot(options?: {
      path?: string;
      fullPage?: boolean;
      type?: ScreenshotType;
    }): Promise<Buffer>;
    mouse: {
      wheel(deltaX: number, deltaY: number): Promise<void>;
    };
    keyboard: {
      type(text: string): Promise<void>;
      press(key: string): Promise<void>;
    };
  }

  export interface BrowserContext {
    newPage(): Promise<Page>;
    close(): Promise<void>;
  }

  export interface Browser {
    isConnected(): boolean;
    newContext(options?: { viewport?: { width: number; height: number } }): Promise<BrowserContext>;
    close(): Promise<void>;
  }

  export const chromium: {
    launch(options?: { headless?: boolean; args?: string[] }): Promise<Browser>;
  };
}
