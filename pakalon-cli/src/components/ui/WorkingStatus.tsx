import React, { useEffect, useMemo, useState } from "react";
import { Box, Text } from "ink";
import { getShellWidth } from "@/utils/shell-layout.js";
import { useStore } from "@/store/index.js";

const BLINK_INTERVAL = 600; // ms between blink toggles
const CIRCLE = "●";

type Props = {
  active: boolean;
  shellWidth?: number;
};

const WorkingStatus: React.FC<Props> = React.memo(({ active, shellWidth }) => {
  const runningCommands = useStore((s) => s.runningCommands);
  const [blinkOn, setBlinkOn] = useState(true);
  const terminalWidth = process.stdout.columns ?? 120;
  const resolvedShellWidth = shellWidth ?? getShellWidth(terminalWidth);
  const contentWidth: number | "100%" = shellWidth !== undefined ? "100%" : resolvedShellWidth;
  const containerJustify = "center";
  const isActive = active || runningCommands.length > 0;
  const visibleCommands = useMemo(
    () => runningCommands.slice(-3),
    [runningCommands],
  );

  // Blink timer for running commands
  useEffect(() => {
    if (!isActive) return;
    const timer = setInterval(() => {
      setBlinkOn((value) => !value);
    }, BLINK_INTERVAL);
    return () => clearInterval(timer);
  }, [isActive]);

  return (
    <Box justifyContent={containerJustify} width="100%" minHeight={1}>
      <Box justifyContent="flex-start" width={contentWidth} paddingLeft={1} alignItems="center">
        {isActive ? (
          <Box flexDirection="row" gap={2} flexWrap="wrap">
            {visibleCommands.length > 0 ? (
              visibleCommands.map((command) => {
                const isRunning = command.status === "running";
                const isError = command.status === "error";
                const indicatorColor = isRunning
                  ? "green"
                  : isError
                    ? "red"
                    : "grey";
                // Blinking: show circle when blinkOn, show dim hollow when blinkOff (only for running)
                const showCircle = isRunning ? blinkOn : true;
                const indicatorChar = showCircle ? CIRCLE : "○";
                const color = isRunning && !blinkOn ? "grey" : indicatorColor;

                return (
                  <Text key={command.id} color={color}>
                    {indicatorChar} {command.commandName.slice(0, 34)}
                  </Text>
                );
              })
            ) : (
              <Text color="green">{CIRCLE} working</Text>
            )}
          </Box>
        ) : (
          <Text> </Text>
        )}
      </Box>
    </Box>
  );
});

WorkingStatus.displayName = "WorkingStatus";

export default WorkingStatus;
