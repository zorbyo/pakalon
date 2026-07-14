/**
 * Curated list of design/UI sites used by web scraping in phase 2 & 3.
 * These are the sites called out in the requirements.
 */
export const DESIGN_SITES: { name: string; url: string; type: "registry" | "gallery" | "showcase" }[] = [
	{ name: "shadcn/ui", url: "https://ui.shadcn.com", type: "registry" },
	{ name: "Lightswind", url: "https://lightswind.com/components", type: "registry" },
	{ name: "React Bits", url: "https://reactbits.dev", type: "registry" },
	{ name: "DaisyUI", url: "https://daisyui.com", type: "registry" },
	{ name: "Preline", url: "https://preline.co", type: "registry" },
	{ name: "Tailwind Flex", url: "https://tailwindflex.com", type: "gallery" },
	{ name: "Dribbble", url: "https://dribbble.com", type: "showcase" },
	{ name: "Magic UI", url: "https://magicui.design", type: "registry" },
	{ name: "Spline", url: "https://spline.design", type: "registry" },
	{ name: "Aura Browse", url: "https://www.aura.build/browse/components", type: "gallery" },
	{ name: "Aura", url: "https://www.aura.build/components", type: "registry" },
	{ name: "Shadcn Studio", url: "https://shadcnstudio.com", type: "registry" },
	{ name: "Tweakcn", url: "https://tweakcn.com", type: "registry" },
];

/** Whether a URL is in the design-sites allowlist. */
export function isDesignSite(url: string): boolean {
	try {
		const parsed = new URL(url);
		return DESIGN_SITES.some(s => parsed.hostname.endsWith(new URL(s.url).hostname));
	} catch {
		return false;
	}
}
