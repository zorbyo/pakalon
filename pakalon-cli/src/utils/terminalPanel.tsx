/**
 * TerminalPanel — reusable terminal display panel for Ink TUI.
 *
 * Provides a bordered panel with title, content area, and optional footer.
 * Supports scrolling, auto-scroll, and dynamic height calculation.
 */
import React, { useState, useEffect, useRef, useMemo } from "react";
import { Box, Text, useInput } from "ink";
import { PAKALON_GOLD, TEXT_SECONDARY, BORDER_DIM } from "@/constants/colors.js";

export interface TerminalPanelProps {
  title?: string;
  children: React.ReactNode;
  height?: number;
  maxHeight?: number;
  width?: number | string;
  scrollable?: boolean;
  autoScroll?: boolean;
  footer?: React.ReactNode;
  borderColor?: string;
  focused?: boolean;
  onScroll?: (offset: number) => void;
  className?: string;
}

const TerminalPanel: React.FC<TerminalPanelProps> = ({
  title,
  children,
  height,
  maxHeight,
  width = "100%",
  scrollable = true,
  autoScroll = true,
  footer,
  borderColor = BORDER_DIM,
  focused = false,
  onScroll,
  className,
}) => {
  const [scrollOffset, setScrollOffset] = useState(0);
  const [contentHeight, setContentHeight] = useState(0);
  const scrollRef = useRef(0);

  const effectiveBorderColor = focused ? PAKALON_GOLD : borderColor;
  const panelHeight = height ?? maxHeight ?? 12;
  const contentAreaHeight = Math.max(1, panelHeight - (title ? 1 : 0) - (footer ? 1 : 0));

  useEffect(() => {
    if (autoScroll) {
      setScrollOffset(Math.max(0, contentHeight - contentAreaHeight));
    }
  }, [contentHeight, contentAreaHeight, autoScroll]);

  useInput(
    (input) => {
      if (!scrollable) return;
      if (input === "up" || input === "k") {
        const newOffset = Math.max(0, scrollRef.current - 1);
        scrollRef.current = newOffset;
        setScrollOffset(newOffset);
        onScroll?.(newOffset);
      }
      if (input === "down" || input === "j") {
        const maxOffset = Math.max(0, contentHeight - contentAreaHeight);
        const newOffset = Math.min(maxOffset, scrollRef.current + 1);
        scrollRef.current = newOffset;
        setScrollOffset(newOffset);
        onScroll?.(newOffset);
      }
    },
    { isActive: scrollable },
  );

  const borderStyle = useMemo(
    () => ({
      borderTop: `─`.repeat(typeof width === "number" ? width : 40),
      borderBottom: `─`.repeat(typeof width === "number" ? width : 40),
      borderLeft: "│",
      borderRight: "│",
    }),
    [width],
  );

  return (
    <Box flexDirection="column" width={width} className={className}>
      {title && (
        <Box borderStyle="single" borderColor={effectiveBorderColor} paddingX={1}>
          <Text bold color={effectiveBorderColor}>
            {title}
          </Text>
        </Box>
      )}
      <Box
        flexDirection="column"
        height={contentAreaHeight}
        borderStyle="single"
        borderColor={effectiveBorderColor}
        overflow="hidden"
      >
        <Box flexDirection="column" paddingLeft={1} paddingRight={1}>
          {children}
        </Box>
      </Box>
      {footer && (
        <Box borderStyle="single" borderColor={effectiveBorderColor} paddingX={1}>
          <Text color={TEXT_SECONDARY}>{footer}</Text>
        </Box>
      )}
    </Box>
  );
};

export default TerminalPanel;
