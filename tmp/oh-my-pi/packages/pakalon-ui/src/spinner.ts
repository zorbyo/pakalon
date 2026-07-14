const SPINNER_FRAMES = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];
const INTERVAL_MS = 80;

export class Spinner {
	private frame = 0;
	private interval: ReturnType<typeof setInterval> | null = null;
	private message = "";

	start(message = ""): void {
		this.message = message;
		this.frame = 0;
		if (this.interval) return;
		this.interval = setInterval(() => {
			this.frame = (this.frame + 1) % SPINNER_FRAMES.length;
			this.render();
		}, INTERVAL_MS);
	}

	stop(): void {
		if (this.interval) {
			clearInterval(this.interval);
			this.interval = null;
		}
	}

	setMessage(message: string): void {
		this.message = message;
	}

	private render(): void {
		const frame = SPINNER_FRAMES[this.frame];
		if (this.message) {
			process.stdout.write(`\r${frame} ${this.message}`);
		}
	}
}
