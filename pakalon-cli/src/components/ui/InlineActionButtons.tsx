/**
 * InlineActionButtons — Interactive buttons rendered within chat messages.
 *
 * Used for HIL (Human-in-the-Loop) phase control:
 * - "Accept this design" — Phase 2 approval
 * - "Confirm edit" / "Make changes" — Phase 3 approval
 * - "End phase X and start phase Y" — Phase transitions
 * - "Accept and proceed" — General approval
 *
 * Navigation:
 *   Tab / Shift+Tab — move between buttons
 *   Enter / Space — activate selected button
 *   1-9 number keys — direct button activation
 *
 * Props:
 *   buttons      — array of action buttons
 *   onAction     — called with { action, buttonId } when button is activated
 *   messageId    — optional association with a message for tracking
 */

import React, { useState, useCallback, useEffect, useRef } from "react";
import { Box, Text, useInput } from "ink";

export interface ActionButton {
  id: string;
  label: string;
  description?: string;
  variant?: "primary" | "secondary" | "danger" | "success";
  shortcut?: string;
  disabled?: boolean;
}

export interface InlineActionButtonsProps {
  buttons: ActionButton[];
  onAction: (action: { action: string; buttonId: string }) => void;
  messageId?: string;
  title?: string;
}

const BUTTON_COLORS = {
  primary: "#ff8c00",
  secondary: "#6b7280",
  danger: "#ef4444",
  success: "#22c55e",
} as const;

const BORDER_COLOR = "#ff8c00";
const SELECTED_BG = "#3a3a3a";
const DISABLED_COLOR = "#4a4a4a";

const InlineActionButtons: React.FC<InlineActionButtonsProps> = ({
  buttons,
  onAction,
  messageId,
  title = "Actions",
}) => {
  const [cursor, setCursor] = useState(0);
  const [confirmed, setConfirmed] = useState<number | null>(null);
  const [showAll, setShowAll] = useState(false);
  const inputRef = useRef<boolean>(false);

  const visibleButtons = showAll ? buttons : buttons.slice(0, 5);
  const hasMoreButtons = !showAll && buttons.length > 5;

  const validButtons = visibleButtons.filter(b => !b.disabled);
  const activeIndex = Math.min(cursor, validButtons.length - 1);

  const handleInput = useCallback(
    (input: string, key: { tab: boolean; return: boolean; escape: boolean; shift: boolean }) => {
      if (inputRef.current) return;
      inputRef.current = true;

      try {
        if (key.escape) {
          setShowAll(false);
          return;
        }

        if ((input === "m" || input === "M") && hasMoreButtons) {
          setShowAll(true);
          return;
        }

        if (key.tab && validButtons.length > 0) {
          if (key.shift) {
            setCursor(prev => (prev - 1 + validButtons.length) % validButtons.length);
          } else {
            setCursor(prev => (prev + 1) % validButtons.length);
          }
          return;
        }

        if (key.return || input === " ") {
          const selectedButton = validButtons[activeIndex];
          if (selectedButton && !selectedButton.disabled) {
            setConfirmed(activeIndex);
            onAction({ action: selectedButton.id, buttonId: selectedButton.id });
          }
          return;
        }

        const num = parseInt(input, 10);
        if (!isNaN(num) && num >= 1 && num <= visibleButtons.length) {
          const btn = visibleButtons[num - 1];
          if (btn && !btn.disabled) {
            setConfirmed(num - 1);
            onAction({ action: btn.id, buttonId: btn.id });
          }
        }

        if (input === "a" || input === "A") {
          const acceptBtn = visibleButtons.find(b => 
            b.id.toLowerCase().includes("accept") || 
            b.label.toLowerCase().includes("accept")
          );
          if (acceptBtn) {
            setConfirmed(visibleButtons.indexOf(acceptBtn));
            onAction({ action: acceptBtn.id, buttonId: acceptBtn.id });
          }
        }

        if (input === "r" || input === "R") {
          const rejectBtn = visibleButtons.find(b => 
            b.id.toLowerCase().includes("reject") ||
            b.id.toLowerCase().includes("cancel") ||
            b.label.toLowerCase().includes("reject")
          );
          if (rejectBtn) {
            setConfirmed(visibleButtons.indexOf(rejectBtn));
            onAction({ action: rejectBtn.id, buttonId: rejectBtn.id });
          }
        }
      } finally {
        setTimeout(() => { inputRef.current = false; }, 50);
      }
    },
    [activeIndex, hasMoreButtons, validButtons, visibleButtons, onAction]
  );

  useInput(handleInput);

  useEffect(() => {
    setCursor(0);
    setConfirmed(null);
  }, [messageId]);

  if (buttons.length === 0) return null;

  if (confirmed !== null && confirmed < visibleButtons.length) {
    const btn = visibleButtons[confirmed];
    if (!btn) return null;
    return (
      <Box marginY={1} paddingX={2}>
        <Text color={BUTTON_COLORS[btn.variant || "primary"]}>
          [OK] {btn.label}
        </Text>
      </Box>
    );
  }

  return (
    <Box flexDirection="column" marginY={1}>
      {title && (
        <Box paddingX={1} marginBottom={1}>
          <Text dimColor color="gray" bold>
            {title}
          </Text>
        </Box>
      )}
      
      <Box flexDirection="row" gap={1} flexWrap="wrap">
        {visibleButtons.map((button, index) => {
          const isActive = index === activeIndex;
          const isConfirmed = confirmed === index;
          const color = button.disabled 
            ? DISABLED_COLOR 
            : BUTTON_COLORS[button.variant || "primary"];
          
          const bgColor = isActive ? SELECTED_BG : undefined;
          
          return (
            <Box
              key={button.id}
              borderStyle={isActive ? "bold" : "single"}
              borderColor={color}
              backgroundColor={bgColor}
              paddingX={1}
              paddingY={0}
            >
              <Text 
                color={color} 
                bold={isActive}
                dimColor={button.disabled}
              >
                {isActive ? "> " : "  "}
                {index + 1}. {button.label}
                {button.shortcut && !isActive && ` (${button.shortcut})`}
              </Text>
            </Box>
          );
        })}
        
        {hasMoreButtons && (
          <Box 
            borderStyle="single" 
            borderColor="gray"
            paddingX={1}
            paddingY={0}
          >
            <Text dimColor color="gray">
              m: +{buttons.length - 5} more
            </Text>
          </Box>
        )}
      </Box>
      
      <Box paddingX={1} marginTop={1}>
        <Text dimColor color="gray">
          Tab/Shift+Tab: navigate  Enter: activate  1-9: select directly
        </Text>
      </Box>
    </Box>
  );
};

export default InlineActionButtons;
