import React, { useMemo, useState, useEffect } from "react";
import { Box, Text } from "ink";
import fs from "node:fs";
import { fileURLToPath } from "node:url";
import { useAuth, useModel, useStore } from "@/store/index.js";
import { PAKALON_GOLD } from "@/constants/colors.js";
import { getShellWidth } from "@/utils/shell-layout.js";
import PakalonLogo from "./PakalonLogo.js";

const PAKALON_VERSION = (() => {
  const fromEnv = process.env.npm_package_version?.trim();
  if (fromEnv) return `v${fromEnv}`;

  try {
    const pkgPath = fileURLToPath(
      new URL("../../../package.json", import.meta.url),
    );
    if (fs.existsSync(pkgPath)) {
      const raw = fs.readFileSync(pkgPath, "utf-8");
      const parsed = JSON.parse(raw) as { version?: unknown };
      if (typeof parsed.version === "string" && parsed.version.trim()) {
        return `v${parsed.version.trim()}`;
      }
    }
  } catch {
    // ignore and fall back
  }

  // Try alternative path for built binary
  try {
    const altPath = fileURLToPath(
      new URL("../../package.json", import.meta.url),
    );
    if (fs.existsSync(altPath)) {
      const raw = fs.readFileSync(altPath, "utf-8");
      const parsed = JSON.parse(raw) as { version?: unknown };
      if (typeof parsed.version === "string" && parsed.version.trim()) {
        return `v${parsed.version.trim()}`;
      }
    }
  } catch {
    // ignore and fall back
  }

  return "v1.0.0";
})();

interface HeaderBarProps {
  showLogo?: boolean;
  sessionId?: string;
}

const IdentityField: React.FC<{ label: string; value: string }> = ({
  label,
  value,
}) => (
  <Text>
    <Text color={PAKALON_GOLD} bold>
      {label}{" "}
    </Text>
    <Text color="white">{value}</Text>
  </Text>
);

const HeaderBar: React.FC<HeaderBarProps> = ({
  showLogo = true,
  sessionId: sessionIdOverride,
}) => {
  const { githubLogin, displayName } = useAuth();
  const { selectedModel } = useModel();
  const sessionId = useStore((s) => s.sessionId);
  // Stabilize terminal dimensions — read once, only update on significant resize (≥4 cols)
  const [stableDimensions, setStableDimensions] = useState(() => ({
    width: process.stdout.columns ?? 120,
    rows: process.stdout.rows ?? 40,
  }));

  useEffect(() => {
    let lastWidth = process.stdout.columns ?? 120;
    let lastRows = process.stdout.rows ?? 40;

    const handleResize = () => {
      const newWidth = process.stdout.columns ?? 120;
      const newRows = process.stdout.rows ?? 40;
      if (
        Math.abs(newWidth - lastWidth) >= 4 ||
        Math.abs(newRows - lastRows) >= 2
      ) {
        lastWidth = newWidth;
        lastRows = newRows;
        setStableDimensions({ width: newWidth, rows: newRows });
      }
    };

    process.stdout.on("resize", handleResize);
    return () => {
      process.stdout.off("resize", handleResize);
    };
  }, []);

  const terminalWidth = stableDimensions.width;
  const terminalRows = stableDimensions.rows;
  const compactTerminal = terminalWidth < 78 || terminalRows < 20;
  const tinyTerminal = terminalWidth < 66;
  const shellWidth = getShellWidth(terminalWidth);
  const headerWidth = Math.max(
    44,
    Math.min(84, terminalWidth - 4, shellWidth + 12),
  );
  const compactLayout = compactTerminal || headerWidth < 58;

  const truncate = (value: string, max: number) =>
    value.length > max ? `${value.slice(0, Math.max(0, max - 1))}…` : value;

  const modelDisplayRaw = selectedModel?.trim() || "none";
  const primaryName = useMemo(() => {
    const trimmedDisplay = displayName?.trim();
    if (trimmedDisplay) return trimmedDisplay;
    const trimmedLogin = githubLogin?.trim();
    return trimmedLogin || "Pakalon User";
  }, [displayName, githubLogin]);

  const secondaryIdentity = useMemo(() => {
    const trimmedDisplay = displayName?.trim()?.toLowerCase();
    const trimmedLogin = githubLogin?.trim();
    if (!trimmedLogin) return null;
    if (trimmedDisplay && trimmedDisplay === trimmedLogin.toLowerCase())
      return null;
    return trimmedLogin;
  }, [displayName, githubLogin]);

  const identityDisplay = secondaryIdentity
    ? `${primaryName} (${secondaryIdentity})`
    : primaryName;
  const currentSessionDisplayRaw =
    sessionIdOverride?.trim() || sessionId?.trim() || "creating...";

  const maxFieldLen = Math.max(
    10,
    Math.floor(headerWidth / 2) - (tinyTerminal ? 12 : 10),
  );
  const identityDisplaySafe = truncate(identityDisplay, maxFieldLen);
  const modelDisplay = truncate(modelDisplayRaw, maxFieldLen);
  const currentSessionDisplay = truncate(
    currentSessionDisplayRaw,
    Math.max(12, headerWidth - 24),
  );

  return (
    <Box width="100%" justifyContent="center" marginTop={0} flexShrink={0}>
      <Box
        borderStyle="single"
        borderColor={PAKALON_GOLD}
        flexDirection="column"
        width={headerWidth}
        minHeight={compactLayout ? 8 : 11}
        justifyContent="center"
        alignItems="center"
        paddingX={compactLayout ? 1 : 2}
        paddingY={compactLayout ? 0 : 1}
        flexShrink={0}
      >
        <Box flexDirection="column" width="100%" alignItems="center">
          {showLogo && (
            <Box
              justifyContent="center"
              alignItems="center"
              marginTop={0}
              marginBottom={compactLayout ? 0 : 1}
              flexDirection="column"
            >
              {compactTerminal ? (
                <Box justifyContent="center" width="100%">
                  <Text color="white" bold>
                     PAKALON
                  </Text>
                </Box>
              ) : (
                <PakalonLogo variant="header" align="center" />
              )}
            </Box>
          )}

          <Box flexDirection="column" gap={0} width="100%" alignItems="center">
            <Box
              justifyContent="center"
              gap={compactLayout ? 2 : 6}
              flexWrap="wrap"
            >
              <IdentityField label="User" value={identityDisplaySafe} />
              <IdentityField label="Model" value={modelDisplay} />
            </Box>
            <Box justifyContent="center" width="100%">
              <IdentityField label="Session ID" value={currentSessionDisplay} />
            </Box>
            <Box
              justifyContent="center"
              width="100%"
              marginTop={compactLayout ? 0 : 1}
            >
              <Text color={PAKALON_GOLD}>{PAKALON_VERSION}</Text>
            </Box>
          </Box>
        </Box>
      </Box>
    </Box>
  );
};

export default HeaderBar;
