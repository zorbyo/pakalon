import { z } from "zod";
import logger from "@/utils/logger.js";
import type { AriaRole, Locator, Page } from "playwright";
import type { BrowserResult } from "../web-browser-tool.js";

/**
 * Supported semantic locator kinds.
 *
 * These map directly to Playwright's built-in accessibility-first locator APIs.
 */
export const semanticLocatorKindSchema = z.enum([
  "role",
  "text",
  "label",
  "placeholder",
  "testid",
  "title",
  "alt",
]);

/**
 * Supported actions for semantic locators.
 */
export const semanticLocatorActionSchema = z.enum([
  "click",
  "fill",
  "type",
  "text",
  "hover",
  "select",
  "check",
]);

/**
 * Positional modifier applied after creating a locator.
 *
 * `nth` is zero-based, matching Playwright's `locator.nth(index)`.
 */
export const semanticLocatorModifierSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("first") }),
  z.object({ kind: z.literal("last") }),
  z.object({
    kind: z.literal("nth"),
    index: z.number().int().nonnegative().describe("Zero-based locator index"),
  }),
]);

/**
 * Semantic locator definition for browser automation.
 *
 * - `role`: `page.getByRole(role, { name })`
 * - `text`: `page.getByText(text)`
 * - `label`: `page.getByLabel(label)`
 * - `placeholder`: `page.getByPlaceholder(placeholder)`
 * - `testid`: `page.getByTestId(testId)`
 * - `title`: `page.getByTitle(title)`
 * - `alt`: `page.getByAltText(altText)`
 */
export const semanticLocatorFinderSchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("role"),
    role: z.custom<AriaRole>((value) => typeof value === "string" && value.length > 0, {
      message: "ARIA role name is required",
    }).describe("ARIA role name, e.g. button, link, textbox"),
    name: z.string().min(1).optional().describe("Accessible name to match"),
    exact: z.boolean().optional().describe("Match the accessible name exactly"),
    modifier: semanticLocatorModifierSchema.optional(),
  }),
  z.object({
    kind: z.literal("text"),
    text: z.string().min(1),
    modifier: semanticLocatorModifierSchema.optional(),
  }),
  z.object({
    kind: z.literal("label"),
    label: z.string().min(1),
    modifier: semanticLocatorModifierSchema.optional(),
  }),
  z.object({
    kind: z.literal("placeholder"),
    placeholder: z.string().min(1),
    modifier: semanticLocatorModifierSchema.optional(),
  }),
  z.object({
    kind: z.literal("testid"),
    testid: z.string().min(1),
    modifier: semanticLocatorModifierSchema.optional(),
  }),
  z.object({
    kind: z.literal("title"),
    title: z.string().min(1),
    modifier: semanticLocatorModifierSchema.optional(),
  }),
  z.object({
    kind: z.literal("alt"),
    alt: z.string().min(1),
    modifier: semanticLocatorModifierSchema.optional(),
  }),
]);

/**
 * Semantic locator input accepted by {@link findAndExecute}.
 */
export type LocatorFinder = z.infer<typeof semanticLocatorFinderSchema>;

/**
 * Semantic locator action accepted by {@link findAndExecute}.
 */
export type LocatorAction = z.infer<typeof semanticLocatorActionSchema>;

/**
 * Semantic locator modifier accepted by {@link findAndExecute}.
 */
export type LocatorModifier = z.infer<typeof semanticLocatorModifierSchema>;

function applyModifier(locator: Locator, modifier?: LocatorModifier): Locator {
  if (!modifier) {
    return locator;
  }

  switch (modifier.kind) {
    case "first":
      return locator.first();
    case "last":
      return locator.last();
    case "nth":
      return locator.nth(modifier.index);
  }
}

function buildLocator(page: Page, finder: LocatorFinder): Locator {
  switch (finder.kind) {
    case "role": {
      const options = finder.name
        ? { name: finder.name, exact: finder.exact }
        : finder.exact !== undefined
          ? { exact: finder.exact }
          : undefined;

      const base = options ? page.getByRole(finder.role, options) : page.getByRole(finder.role);

      return applyModifier(base, finder.modifier);
    }
    case "text":
      return applyModifier(page.getByText(finder.text), finder.modifier);
    case "label":
      return applyModifier(page.getByLabel(finder.label), finder.modifier);
    case "placeholder":
      return applyModifier(page.getByPlaceholder(finder.placeholder), finder.modifier);
    case "testid":
      return applyModifier(page.getByTestId(finder.testid), finder.modifier);
    case "title":
      return applyModifier(page.getByTitle(finder.title), finder.modifier);
    case "alt":
      return applyModifier(page.getByAltText(finder.alt), finder.modifier);
  }
}

function describeModifier(modifier?: LocatorModifier): string {
  if (!modifier) {
    return "";
  }

  switch (modifier.kind) {
    case "first":
      return " (first)";
    case "last":
      return " (last)";
    case "nth":
      return ` (nth ${modifier.index})`;
  }
}

function describeFinder(finder: LocatorFinder): string {
  switch (finder.kind) {
    case "role":
      return finder.name
        ? `role ${finder.role} name=${JSON.stringify(finder.name)}${describeModifier(finder.modifier)}`
        : `role ${finder.role}${describeModifier(finder.modifier)}`;
    case "text":
      return `text ${JSON.stringify(finder.text)}${describeModifier(finder.modifier)}`;
    case "label":
      return `label ${JSON.stringify(finder.label)}${describeModifier(finder.modifier)}`;
    case "placeholder":
      return `placeholder ${JSON.stringify(finder.placeholder)}${describeModifier(finder.modifier)}`;
    case "testid":
      return `testid ${JSON.stringify(finder.testid)}${describeModifier(finder.modifier)}`;
    case "title":
      return `title ${JSON.stringify(finder.title)}${describeModifier(finder.modifier)}`;
    case "alt":
      return `alt ${JSON.stringify(finder.alt)}${describeModifier(finder.modifier)}`;
  }
}

function buildError(message: string, error: string): BrowserResult {
  return {
    success: false,
    message,
    error,
  };
}

/**
 * Finds a semantic element and executes an action on it.
 *
 * This helper uses Playwright's accessibility-aware locator APIs, so it is
 * resilient to markup changes and prefers user-facing semantics over CSS
 * selectors.
 *
 * @param page - Playwright page instance.
 * @param finder - Semantic locator description.
 * @param action - Action to perform on the resolved locator.
 * @param value - Optional action value used by fill/type/select.
 * @returns A structured {@link BrowserResult} with success/error details.
 */
export async function findAndExecute(
  page: Page,
  finder: LocatorFinder,
  action: LocatorAction,
  value?: string,
): Promise<BrowserResult> {
  try {
    const normalizedFinder = semanticLocatorFinderSchema.parse(finder);
    const normalizedAction = semanticLocatorActionSchema.parse(action);

    if ((normalizedAction === "fill" || normalizedAction === "type" || normalizedAction === "select") && value === undefined) {
      return buildError(
        "Action value required",
        `The ${normalizedAction} action requires a value`,
      );
    }

    const locator = buildLocator(page, normalizedFinder);
    const description = describeFinder(normalizedFinder);

    logger.info(`[browser-locators] ${normalizedAction} -> ${description}`);

    switch (normalizedAction) {
      case "click":
        await locator.click();
        return {
          success: true,
          message: `Clicked ${description}`,
          data: { locator: description, action: normalizedAction },
        };

      case "fill":
        await locator.fill(value ?? "");
        return {
          success: true,
          message: `Filled ${description}`,
          data: { locator: description, action: normalizedAction, value },
        };

      case "type":
        await locator.type(value ?? "");
        return {
          success: true,
          message: `Typed into ${description}`,
          data: { locator: description, action: normalizedAction, value },
        };

      case "text": {
        const text = (await locator.textContent()) ?? "";
        return {
          success: true,
          message: `Read text from ${description}`,
          data: { locator: description, action: normalizedAction, text },
        };
      }

      case "hover":
        await locator.hover();
        return {
          success: true,
          message: `Hovered ${description}`,
          data: { locator: description, action: normalizedAction },
        };

      case "select": {
        await locator.selectOption(value ?? "");
        return {
          success: true,
          message: `Selected option in ${description}`,
          data: { locator: description, action: normalizedAction, value },
        };
      }

      case "check": {
        const desired = value?.toLowerCase();
        if (desired === "false" || desired === "0" || desired === "uncheck") {
          await locator.uncheck();
          return {
            success: true,
            message: `Unchecked ${description}`,
            data: { locator: description, action: normalizedAction, checked: false },
          };
        }

        await locator.check();
        return {
          success: true,
          message: `Checked ${description}`,
          data: { locator: description, action: normalizedAction, checked: true },
        };
      }
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    logger.error(`[browser-locators] Failed: ${message}`);
    return buildError("Semantic locator action failed", message);
  }
}

/**
 * Builds a locator without executing an action.
 *
 * This is useful for command parsing layers that want to inspect or compose a
 * locator before interacting with it.
 *
 * @param page - Playwright page instance.
 * @param finder - Semantic locator description.
 * @returns Resolved Playwright locator.
 */
export function findLocator(page: Page, finder: LocatorFinder): Locator {
  return buildLocator(page, semanticLocatorFinderSchema.parse(finder));
}

export default {
  semanticLocatorKindSchema,
  semanticLocatorActionSchema,
  semanticLocatorModifierSchema,
  semanticLocatorFinderSchema,
  findAndExecute,
  findLocator,
};
