import React, { useMemo, useRef, useEffect, useState } from "react";
import { Box } from "ink";
import HeaderBar from "@/frontend/components/HeaderBar.js";
import ChatScreen from "@/components/screens/ChatScreen.js";
import { useStore } from "@/store/index.js";

const MODE_TO_COLOR: Record<string, "orange" | "blue" | "red" | "green"> = {
  plan: "blue",
  "auto-accept": "red",
  orchestration: "green",
  normal: "orange",
};

interface ChatLayoutProps {
  initialMessage?: string;
  projectDir?: string;
  sessionId?: string;
  showBanner?: boolean;
  modelOverride?: string;
  defaultModel?: string;
  fallbackModel?: string;
  addDirs?: string[];
  allowedTools?: string;
  mcpServers?: string[];
  replayMessages?: string[];
  fileContexts?: string[];
  maxBudgetUsd?: number;
  disableSlashCommands?: boolean;
  systemPrompt?: string;
  playLogoAnimation?: boolean;
  memoryBlock?: string;
}

const ChatLayout: React.FC<ChatLayoutProps> = ({
  initialMessage,
  projectDir,
  sessionId,
  showBanner = false,
  modelOverride,
  defaultModel,
  fallbackModel,
  addDirs = [],
  allowedTools,
  mcpServers = [],
  replayMessages = [],
  fileContexts = [],
  maxBudgetUsd,
  disableSlashCommands = false,
  systemPrompt,
  playLogoAnimation = false,
  memoryBlock = "",
}) => {
  const permissionMode = useStore((s) => s.permissionMode);
  const colorMode = MODE_TO_COLOR[permissionMode] ?? "orange";

  // Stabilize shell width — read terminal dimensions once and update only on
  // significant resize events (≥4 columns difference). This prevents the entire
  // layout from re-rendering on every keystroke or tiny terminal width fluctuation
  // which was the primary cause of the UI flickering.
  const [stableShellWidth, setStableShellWidth] = useState(() => {
    const cols = process.stdout.columns ?? 80;
    return Math.max(40, cols - 2);
  });

  useEffect(() => {
    let lastWidth = process.stdout.columns ?? 80;

    const handleResize = () => {
      const newWidth = process.stdout.columns ?? 80;
      // Only trigger re-render if the width changed by at least 4 columns
      if (Math.abs(newWidth - lastWidth) >= 4) {
        lastWidth = newWidth;
        setStableShellWidth(Math.max(40, newWidth - 2));
      }
    };

    process.stdout.on("resize", handleResize);
    return () => {
      process.stdout.off("resize", handleResize);
    };
  }, []);

  return (
    <Box flexDirection="column" width="100%">
      <HeaderBar showLogo sessionId={sessionId} />

      <Box
        flexGrow={1}
        flexDirection="column"
        justifyContent="flex-start"
        width={stableShellWidth}
      >
        <ChatScreen
          initialMessage={initialMessage}
          projectDir={projectDir}
          showBanner={showBanner}
          modelOverride={modelOverride}
          defaultModel={defaultModel}
          fallbackModel={fallbackModel}
          addDirs={addDirs}
          allowedTools={allowedTools}
          mcpServers={mcpServers}
          replayMessages={replayMessages}
          fileContexts={fileContexts}
          maxBudgetUsd={maxBudgetUsd}
          disableSlashCommands={disableSlashCommands}
          systemPrompt={systemPrompt}
          memoryBlock={memoryBlock}
          colorMode={colorMode}
        />
      </Box>
    </Box>
  );
};

export default ChatLayout;
