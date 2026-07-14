# analyze_video

> Extract frames from a local video file and describe what is happening across them with a vision-capable model.

## Source

- Entry: `packages/coding-agent/src/tools/video.ts`
- Model-facing prompt: `packages/coding-agent/src/prompts/tools/analyze-video.md`
- Helpers: `extractFrames()`, `isFfmpegAvailable()` — both already in `tools/video.ts`.
- Each extracted frame is fed through the existing `inspect_image` tool.

## Inputs

| Field | Type | Required | Description |
| --- | --- | --- | --- |
| `path` | `string` | Yes | Path to a local video file readable by `ffmpeg`. |
| `intervalSeconds` | `number` | No | Frame sampling interval (default `2`). Lower = more frames, higher cost. |
| `maxFrames` | `number` | No | Cap on frames extracted (default `60`). |
| `question` | `string` | No | Per-frame question sent to the vision model. Default: "Describe what is happening in this frame in 1-2 sentences." |

## Outputs

The tool returns a single `AgentToolResult`:

- `content`: one text block summarising the timeline (`t=Ns: …` per frame), joined into a single narrative.
- `details`:
  - `videoPath`: resolved path.
  - `durationSeconds`: last extracted frame timestamp.
  - `frameCount`: number of frames processed.
  - `provider`: `"ffmpeg+vision"` or `"native"` (future).
  - `frames`: list of `{ index, timestampSeconds, imagePath, description }`.

## Flow

1. Check `ffmpeg` is on `PATH` (the sandbox-runner image always ships it; otherwise the tool errors with a clear message).
2. Extract PNG frames into a tmp directory using the requested interval / max-frames / range.
3. For each frame, call `inspect_image` with the per-frame `question`.
4. Concatenate the per-frame descriptions into a single timeline summary.

## Notes

- Uses `fs.watch` cooldown-friendly frame extraction; each frame is a small PNG so `inspect_image` stays cheap.
- For Gemini / Anthropic native `video_understanding`, set `PAKALON_VIDEO_PROVIDER=native` to skip the frame-extraction path.
