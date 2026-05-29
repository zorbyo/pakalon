/**
 * TTS UI Components — Ink React components for Text-to-Speech controls
 */

import React, { useState } from "react";
import { Box, Text } from "ink";
import { isSpeaking, getCurrentVoice, setVoice, getAvailableVoices, getTtsState, type TtsVoice } from "./tts.js";

// ---------------------------------------------------------------------------
// Speaking indicator
// ---------------------------------------------------------------------------

const SPEAKING_FRAMES = ["\u25B6", "\u25B6\u25B6", "\u25B6\u25B6\u25B6"];

export const TtsIndicator: React.FC = () => {
  const [tick, setTick] = useState(0);
  const speaking = isSpeaking();

  React.useEffect(() => {
    if (!speaking) return;
    const timer = setInterval(() => setTick((v) => (v + 1) % SPEAKING_FRAMES.length), 300);
    return () => clearInterval(timer);
  }, [speaking]);

  if (!speaking) return null;

  const frame = SPEAKING_FRAMES[tick] ?? SPEAKING_FRAMES[0]!;
  const state = getTtsState();

  return (
    <Box>
      <Text color="green">{frame}</Text>
      <Text color="green"> Speaking</Text>
      {state.queue.length > 0 && (
        <Text dimColor> ({state.queue.length} queued)</Text>
      )}
    </Box>
  );
};

// ---------------------------------------------------------------------------
// TTS toggle
// ---------------------------------------------------------------------------

interface TtsToggleProps {
  enabled: boolean;
  onToggle: (enabled: boolean) => void;
}

export const TtsToggle: React.FC<TtsToggleProps> = ({ enabled, onToggle }) => {
  return (
    <Box>
      <Text>
        TTS:{" "}
        <Text color={enabled ? "green" : "red"} bold>
          {enabled ? "ON" : "OFF"}
        </Text>
      </Text>
    </Box>
  );
};

// ---------------------------------------------------------------------------
// Voice selector
// ---------------------------------------------------------------------------

interface VoiceSelectorProps {
  onSelect?: (voice: TtsVoice) => void;
}

export const VoiceSelector: React.FC<VoiceSelectorProps> = ({ onSelect }) => {
  const voices = getAvailableVoices();
  const current = getCurrentVoice();
  const [selected, setSelected] = useState<TtsVoice>(current);

  const handleSelect = (voice: TtsVoice) => {
    setSelected(voice);
    setVoice(voice);
    onSelect?.(voice);
  };

  return (
    <Box flexDirection="column" paddingX={1} gap={1}>
      <Text bold>Select Voice:</Text>
      {voices.map((voice) => (
        <Box key={voice}>
          <Text>
            {voice === selected ? "\u25C9 " : "\u25CB "}
            <Text color={voice === selected ? "green" : undefined}>
              {voice}
            </Text>
          </Text>
        </Box>
      ))}
      <Text dimColor>Current: {current}</Text>
    </Box>
  );
};

// ---------------------------------------------------------------------------
// TTS status bar line
// ---------------------------------------------------------------------------

export const TtsStatusLine: React.FC = () => {
  const state = getTtsState();

  if (!state.enabled && !state.speaking) return null;

  const parts: string[] = [];
  if (state.speaking) {
    parts.push("speaking");
  }
  if (state.queue.length > 0) {
    parts.push(`${state.queue.length} queued`);
  }
  parts.push(state.voice);

  return (
    <Text dimColor>
      TTS: {parts.join(" | ")}
    </Text>
  );
};

export default {
  TtsIndicator,
  TtsToggle,
  VoiceSelector,
  TtsStatusLine,
};