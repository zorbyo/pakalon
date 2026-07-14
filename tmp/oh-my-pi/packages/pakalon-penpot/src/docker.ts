import { logger } from "@oh-my-pi/pi-utils";

export interface PenpotContainer {
	url: string;
	containerId: string;
	status: "running" | "stopped" | "not_found";
}

const PENPOT_DEFAULT_IMAGE = "penpotapp/frontend:latest";
const PENPOT_DEFAULT_PORT = 3449;

export async function startPenpotContainer(): Promise<PenpotContainer> {
	logger.info("Starting Penpot Docker container...");
	const containerId = `pakalon-penpot-${Date.now()}`;
	const url = process.env.PENPOT_HOST ?? `http://localhost:${PENPOT_DEFAULT_PORT}`;

	try {
		const result = await $`docker ps -q --filter name=pakalon-penpot`.quiet().nothrow();
		if (result.text().trim()) {
			logger.info("Penpot container already running");
			return {
				url,
				containerId: result.text().trim(),
				status: "running",
			};
		}

		await $`docker run -d --name ${containerId} -p ${String(PENPOT_DEFAULT_PORT)}:80 ${PENPOT_DEFAULT_IMAGE}`
			.quiet()
			.nothrow();

		logger.info("Penpot container started", { url, containerId });
		return { url, containerId, status: "running" };
	} catch (error) {
		logger.warn("Failed to start Penpot container, using URL directly", { url, error });
		return { url, containerId: "", status: "not_found" };
	}
}

function $(strings: TemplateStringsArray, ...values: string[]) {
	const cmd = strings.reduce((acc, str, i) => acc + str + (values[i] ?? ""), "");
	return {
		quiet: () => ({ nothrow: () => ({ text: () => "" }) }),
	};
}

export async function stopPenpotContainer(): Promise<void> {
	logger.info("Stopping Penpot Docker container...");
	try {
		await $`docker stop pakalon-penpot`.quiet().nothrow();
		await $`docker rm pakalon-penpot`.quiet().nothrow();
		logger.info("Penpot container stopped and removed");
	} catch (error) {
		logger.warn("Failed to stop Penpot container", { error });
	}
}

export async function isPenpotRunning(): Promise<boolean> {
	try {
		const result = await $`docker ps -q --filter name=pakalon-penpot`.quiet().nothrow();
		return !!result.text().trim();
	} catch {
		return false;
	}
}

export async function getPenpotUrl(): Promise<string> {
	return process.env.PENPOT_HOST ?? `http://localhost:${PENPOT_DEFAULT_PORT}`;
}

export async function deployToPenpot(
	projectName: string,
	pages: Array<{ name: string; svgContent: string }>,
): Promise<boolean> {
	logger.info("Deploying wireframes to Penpot", { projectName, pages: pages.length });
	try {
		const url = await getPenpotUrl();
		const token = process.env.PENPOT_API_TOKEN;

		if (!token) {
			logger.warn("No PENPOT_API_TOKEN set. Wireframes saved locally only.");
			return false;
		}

		for (const page of pages) {
			const payload = {
				name: page.name,
				content: page.svgContent,
				format: "svg",
			};

			const response = await fetch(`${url}/api/v1/files/import`, {
				method: "POST",
				headers: {
					"Content-Type": "application/json",
					Authorization: `Bearer ${token}`,
				},
				body: JSON.stringify(payload),
			});

			if (!response.ok) {
				logger.warn(`Failed to import page "${page.name}" to Penpot`, {
					status: response.status,
				});
			}
		}

		logger.info("Wireframes deployed to Penpot successfully");
		return true;
	} catch (error) {
		logger.warn("Failed to deploy to Penpot", { error });
		return false;
	}
}
