import z from "zod"
import { Config } from "./config"

const KeybindOverride = z
  .object(
    Object.fromEntries(Object.keys(Config.Keybinds.shape).map((key) => [key, z.string().optional()])) as Record<
      string,
      z.ZodOptional<z.ZodString>
    >,
  )
  .strict()

export const TuiOptions = z.object({
  scroll_speed: z.number().min(0.001).optional().describe("TUI scroll speed"),
  scroll_acceleration: z
    .object({
      enabled: z.boolean().describe("Enable scroll acceleration"),
    })
    .optional()
    .describe("Scroll acceleration settings"),
  diff_style: z
    .enum(["auto", "stacked"])
    .optional()
    .describe("Control diff rendering style: 'auto' adapts to terminal width, 'stacked' always shows single column"),
  alt_screen: z
    .boolean()
    .optional()
    .describe("Use alternate screen buffer (full-screen mode with clean scrollback)"),
  screen_reader: z
    .boolean()
    .optional()
    .describe("Enable screen reader accessibility mode (static text instead of spinners)"),
  beep_on_attention: z
    .boolean()
    .optional()
    .describe("Play audible beep when user attention is required"),
  streamer_mode: z
    .boolean()
    .optional()
    .describe("Hide model names and quota information for recording/streaming"),
  compact_paste: z
    .boolean()
    .optional()
    .describe("Collapse large pastes into compact tokens (shows summary instead of full text)"),
  compact_paste_threshold: z
    .number()
    .min(100)
    .optional()
    .describe("Number of characters before a paste is compacted (default: 500)"),
})

export const TuiInfo = z
  .object({
    $schema: z.string().optional(),
    theme: z.string().optional(),
    keybinds: KeybindOverride.optional(),
  })
  .extend(TuiOptions.shape)
  .strict()
