/**
 * Pakalon mode and configuration constants.
 */
export type PakalonMode = "HIL" | "YOLO";

export const PAKALON_MODES: Record<PakalonMode, string> = {
	HIL: "Human-in-Loop",
	YOLO: "Fully Autonomous",
};
