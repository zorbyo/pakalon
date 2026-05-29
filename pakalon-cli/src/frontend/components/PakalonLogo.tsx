import React from "react";
import { Box, Text } from "ink";
import { PAKALON_GOLD } from "@/constants/colors.js";

type PakalonLogoVariant = "splash" | "header";

interface PakalonLogoProps {
  variant?: PakalonLogoVariant;
  align?: "flex-start" | "center" | "flex-end";
}

const FULL_LOGO_LINES = [
  "██████╗  █████╗ ██╗  ██╗ █████╗ ██╗      ██████╗ ███╗   ██╗",
  "██╔══██╗██╔══██╗██║ ██╔╝██╔══██╗██║     ██╔═══██╗████╗  ██║",
  "██████╔╝███████║█████╔╝ ███████║██║     ██║   ██║██╔██╗ ██║",
  "██╔═══╝ ██╔══██║██╔═██╗ ██╔══██║██║     ██║   ██║██║╚██╗██║",
  "██║     ██║  ██║██║  ██╗██║  ██║███████╗╚██████╔╝██║ ╚████║",
  "╚═╝     ╚═╝  ╚═╝╚═╝  ╚═╝╚═╝  ╚═╝╚══════╝ ╚═════╝ ╚═╝  ╚═══╝",
];

const COMPACT_LOGO_LINES = [
  "PAKALON",
];

const FULL_LOGO_WIDTH = Math.max(...FULL_LOGO_LINES.map((line) => line.length));
const COMPACT_LOGO_WIDTH = Math.max(...COMPACT_LOGO_LINES.map((line) => line.length));

export function getPakalonLogoWidth(
  variant: PakalonLogoVariant,
  terminalWidth = process.stdout.columns ?? 120
): number {
  if ((variant === "splash" && terminalWidth < 72) || terminalWidth < 58) {
    return COMPACT_LOGO_WIDTH;
  }
  return FULL_LOGO_WIDTH;
}

const PakalonLogo: React.FC<PakalonLogoProps> = React.memo(({
  variant = "splash",
  align = "center",
}) => {
  const terminalWidth = process.stdout.columns ?? 120;
  const useCompact = (variant === "splash" && terminalWidth < 72) || terminalWidth < 58;
  const lines = useCompact ? COMPACT_LOGO_LINES : FULL_LOGO_LINES;

  return (
    <Box flexDirection="column" alignItems={align} flexShrink={0}>
      {lines.map((line, index) => (
        <Text key={index} color={variant === "header" ? "whiteBright" : PAKALON_GOLD} bold>
          {line}
        </Text>
      ))}
    </Box>
  );
});

PakalonLogo.displayName = "PakalonLogo";

export default PakalonLogo;
