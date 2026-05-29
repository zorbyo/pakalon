/**
 * Banner — ASCII art header showing logo, username, and active model.
 * Uses figlet for dynamic banner rendering; falls back to static art if unavailable.
 */
import React from "react";
import { Box, Text } from "ink";

interface BannerProps {
  version?: string;
  plan?: string;
  githubLogin?: string;
  /** Active model ID — displayed prominently beneath the logo */
  modelId?: string | null;
  /** Override figlet font (optional) */
  font?: string;
}

const Banner: React.FC<BannerProps> = ({ version = "1.0.0", plan, githubLogin, modelId }) => {
  const terminalWidth = process.stdout.columns ?? 80;
  const compactMeta = terminalWidth < 72;

  const isStreamerMode = process.env.PAKALON_STREAMER_MODE === "1";

  return (
    <Box flexDirection="column" marginBottom={1}>
      <Box
        gap={compactMeta ? 0 : 2}
        flexDirection={compactMeta ? "column" : "row"}
      >
        {/* Username */}
        {githubLogin && (
          <Box gap={1}>
            <Text dimColor>user</Text>
            <Text color="white" bold>@{githubLogin}</Text>
          </Box>
        )}
        {/* Active model — hidden in streamer mode */}
        {modelId && !isStreamerMode && (
          <Box gap={1}>
            <Text dimColor>model</Text>
            <Text color="yellow" bold>
              {modelId.length > 45 ? `…${modelId.slice(-42)}` : modelId}
            </Text>
          </Box>
        )}
        {/* Version (smaller, dimmed) */}
        <Text dimColor>v{version}</Text>
        {plan && !isStreamerMode && (
          <Text color={plan === "pro" ? "yellow" : "white"}>
            [{plan.toUpperCase()}]
          </Text>
        )}
      </Box>
    </Box>
  );
};

export default Banner;

