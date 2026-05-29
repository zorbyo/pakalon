import { z } from "zod";
import type { Page } from "playwright";

export interface DistilledElement {
  tag: string;
  type?: string;
  text?: string;
  attributes: Record<string, string>;
  interactive: boolean;
  children: DistilledElement[];
}

export const distilledElementSchema: z.ZodType<DistilledElement> = z.lazy(() =>
  z.object({
    tag: z.string(),
    type: z.string().optional(),
    text: z.string().optional(),
    attributes: z.record(z.string()),
    interactive: z.boolean(),
    children: z.array(distilledElementSchema),
  }),
);

type RawDistilledElement = {
  tag: string;
  type?: string;
  text?: string;
  attributes: Record<string, string>;
  interactive: boolean;
  children: RawDistilledElement[];
};

function formatElement(element: DistilledElement, depth = 0): string[] {
  const indent = "  ".repeat(depth);
  const parts = [`${indent}[${element.tag}]`];

  if (element.text) {
    parts.push(`"${element.text}"`);
  }

  if (element.type) {
    parts.push(`type=${element.type}`);
  }

  for (const [key, value] of Object.entries(element.attributes)) {
    parts.push(`${key}="${value}"`);
  }

  if (element.interactive) {
    parts.push("clickable");
  }

  const lines = [parts.join(" ")];
  for (const child of element.children) {
    lines.push(...formatElement(child, depth + 1));
  }
  return lines;
}

export async function distillPage(page: Page): Promise<string> {
  const distilled = await page.evaluate(() => {
    const visible = (element: Element): boolean => {
      const htmlElement = element as HTMLElement;
      if (htmlElement.hidden) return false;
      if (htmlElement.getAttribute("aria-hidden") === "true") return false;
      const style = window.getComputedStyle(htmlElement);
      if (style.display === "none" || style.visibility === "hidden" || Number(style.opacity) === 0) return false;
      if (htmlElement.tagName === "INPUT" && (htmlElement as HTMLInputElement).type === "hidden") return false;
      return true;
    };

    const isInteractive = (element: Element): boolean => {
      const tag = element.tagName.toLowerCase();
      if (tag === "button" || tag === "summary") return true;
      if (tag === "a" && element.hasAttribute("href")) return true;
      if (tag === "input" || tag === "textarea" || tag === "select") return true;
      if (element.getAttribute("role") && ["button", "link", "checkbox", "radio", "textbox", "combobox", "switch", "tab"].includes(element.getAttribute("role") ?? "")) return true;
      if (element.hasAttribute("contenteditable") && element.getAttribute("contenteditable") !== "false") return true;
      if (element.hasAttribute("onclick")) return true;
      return false;
    };

    const cleanText = (value: string): string => value.replace(/\s+/g, " ").trim().slice(0, 120);

    const serialize = (element: Element): RawDistilledElement | null => {
      if (!visible(element)) return null;

      const children: RawDistilledElement[] = [];
      for (const child of Array.from(element.children)) {
        const serialized = serialize(child);
        if (serialized) {
          children.push(serialized);
        }
      }

      const interactive = isInteractive(element);
      if (!interactive && children.length === 0) {
        return null;
      }

      const tag = element.tagName.toLowerCase();
      const attributes: Record<string, string> = {};

      const role = element.getAttribute("role");
      const ariaLabel = element.getAttribute("aria-label");
      const placeholder = element.getAttribute("placeholder");
      const href = element.getAttribute("href");
      const value = (element as HTMLInputElement).value;
      const title = element.getAttribute("title");

      if (role) attributes.role = role;
      if (ariaLabel) attributes["aria-label"] = cleanText(ariaLabel);
      if (placeholder) attributes.placeholder = cleanText(placeholder);
      if (href) attributes.href = href;
      if (title) attributes.title = cleanText(title);
      if (value && tag === "input") attributes.value = cleanText(value);

      return {
        tag,
        type: (element as HTMLInputElement).type || undefined,
        text: cleanText(element.textContent || "") || undefined,
        attributes,
        interactive,
        children,
      };
    };

    const roots: RawDistilledElement[] = [];
    for (const element of Array.from(document.body?.children ?? [])) {
      const serialized = serialize(element);
      if (serialized) {
        roots.push(serialized);
      }
    }

    return roots;
  });

  const formatted = (distilled as DistilledElement[])
    .flatMap((element) => formatElement(element))
    .slice(0, 150);

  return formatted.length > 0 ? formatted.join("\n") : "No interactive elements found.";
}
