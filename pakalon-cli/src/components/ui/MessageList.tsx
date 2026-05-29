/**
 * MessageList — renders the conversation history in Ink.
 * T-CLI-11: Inline image rendering via term-img for image paths detected in messages.
 * T-CLI-70: In-chat action buttons rendered after messages with interactive choices.
 */
import React, { useEffect, useMemo, useState, useCallback } from "react";
import { Box, Text } from "ink";
import type {
  ChatMessage,
  ActionButton,
} from "@/store/slices/session.slice.js";
import InlineActionButtons from "./InlineActionButtons.js";
import { useBlink } from "@/hooks/useBlink.js";
import {
  PAKALON_GOLD,
  PAKALON_BLUE,
  TEXT_PRIMARY,
  TEXT_SECONDARY,
} from "@/constants/colors.js";
import { getShellWidth } from "@/utils/shell-layout.js";

// T-CLI-11: Extract image file paths from message text
const IMAGE_PATH_RE =
  /(?:^|\s)((?:\.{0,2}\/|[A-Za-z]:[/\\]|\/)[^\s"'<>]+\.(?:png|jpg|jpeg|gif|webp|bmp|svg))(?:\s|$)/gi;

function extractImagePaths(text: string): string[] {
  const paths: string[] = [];
  let match: RegExpExecArray | null;
  IMAGE_PATH_RE.lastIndex = 0;
  while ((match = IMAGE_PATH_RE.exec(text)) !== null) {
    if (match[1]) paths.push(match[1].trim());
  }
  return paths;
}

// T-CLI-11: Lazy-load term-img and render image inline in terminal
const InlineImage: React.FC<{ filePath: string }> = React.memo(
  ({ filePath }) => {
    const [pixels, setPixels] = useState<string | null>(null);
    const [error, setError] = useState<string | null>(null);

    useEffect(() => {
      let cancelled = false;
      (async () => {
        try {
          // term-img is ESM — dynamic import at usage time
          const termImg = await import("term-img");
          const render = termImg.default ?? termImg;
          const output = render(filePath, {
            width: 40,
            fallback: () => `[image: ${filePath}]`,
          });
          if (!cancelled)
            setPixels(
              typeof output === "string" ? output : `[image: ${filePath}]`,
            );
        } catch (err: unknown) {
          if (!cancelled) setError(`[image unavailable: ${filePath}]`);
        }
      })();
      return () => {
        cancelled = true;
      };
    }, [filePath]);

    if (error) return <Text dimColor>{error}</Text>;
    if (pixels === null) return <Text dimColor>loading image…</Text>;
    // term-img outputs raw escape sequences — print directly
    return (
      <Box flexDirection="column">
        {/* eslint-disable-next-line react/no-danger-with-children */}
        <Text>{pixels}</Text>
        <Text dimColor color="gray">
          image {filePath}
        </Text>
      </Box>
    );
  },
);

InlineImage.displayName = "InlineImage";

interface MessageListProps {
  messages: ChatMessage[];
  assistantBusy?: boolean;
  colorMode?: "orange" | "blue" | "red" | "green";
  shellWidth?: number;
  thinkingText?: string;
  onActionButton?: (messageId: string, actionId: string) => void;
}

const SPINNER_FRAMES = ["·", "*", "*", "", "*", "*"];
const USER_HIGHLIGHT_BG = "#3A2510";
const MAX_RENDERED_MESSAGES = 80;
const ANSI_COLOR_RE = /\x1b\[[0-9;]*m/g;

function stripAnsi(text: string): string {
  return text.replace(ANSI_COLOR_RE, "");
}

function contentNeedsDiffRendering(content: string): boolean {
  return (
    content.includes("```diff") ||
    /\n(?:\x1b\[[0-9;]*m)*[+-]/.test(content) ||
    /\n@@ /.test(content)
  );
}

function getDiffLineColor(
  line: string,
  inDiffFence: boolean,
): string | undefined {
  const clean = stripAnsi(line);
  if (clean.startsWith("+") && !clean.startsWith("+++")) return "green";
  if (clean.startsWith("-") && !clean.startsWith("---")) return "red";
  if (!inDiffFence) return undefined;
  if (clean.startsWith("@@")) return "cyan";
  if (
    clean.startsWith("diff ") ||
    clean.startsWith("index ") ||
    clean.startsWith("---") ||
    clean.startsWith("+++")
  ) {
    return PAKALON_GOLD;
  }
  return undefined;
}

function isErrorMessage(message: ChatMessage): boolean {
  if (message.role === "user") return false;
  const content =
    typeof message.content === "string"
      ? message.content.trim().toLowerCase()
      : "";
  return (
    content.startsWith("error:") ||
    content.startsWith("[X]") ||
    content.startsWith("explore error:") ||
    content.includes("failed:") ||
    content.includes("upstream ai provider error") ||
    content.includes("provider rate-limited") ||
    content.includes("model not found") ||
    content.includes("rate limit") ||
    content.includes("unknown command") ||
    content.includes("no session found") ||
    content.includes("session not found") ||
    content.includes("could not") ||
    content.includes("failed to") ||
    content.includes("permission denied") ||
    content.includes("not able to") ||
    content.includes("not found")
  );
}

// Optimized spinner hook to reduce re-renders - use longer interval (600ms default)
function useSpinner(isActive: boolean, intervalMs: number = 600) {
  const [frame, setFrame] = useState(0);

  useEffect(() => {
    if (!isActive) {
      setFrame(0);
      return;
    }
    const timer = setInterval(() => {
      setFrame((f) => (f + 1) % SPINNER_FRAMES.length);
    }, intervalMs);
    return () => clearInterval(timer);
  }, [isActive, intervalMs]);

  return SPINNER_FRAMES[frame] ?? SPINNER_FRAMES[0];
}

const MINI_ASCII_BADGE_FRAMES = [
  [" <> ", "<><><>", " <> "],
  [" <> ", "<><><>", " <> "],
  ["<><><>", "<><><>", "<><><>"],
  [" <> ", "<><><>", " <> "],
];

const AssistantBadge: React.FC<{
  animate?: boolean;
  colorMode?: "orange" | "blue" | "red" | "green";
}> = React.memo(({ animate = false, colorMode = "orange" }) => {
  const [asciiFrame, setAsciiFrame] = useState(0);
  const assistantColor =
    colorMode === "blue"
      ? PAKALON_BLUE
      : colorMode === "red"
        ? "#EF4444"
        : colorMode === "green"
          ? "#22C55E"
          : PAKALON_GOLD;

  useEffect(() => {
    if (!animate) return;
    const timer = setInterval(() => {
      setAsciiFrame((f) => (f + 1) % MINI_ASCII_BADGE_FRAMES.length);
    }, 200);
    return () => clearInterval(timer);
  }, [animate]);

  if (animate) {
    const frame =
      MINI_ASCII_BADGE_FRAMES[asciiFrame] ?? MINI_ASCII_BADGE_FRAMES[0]!;
    return (
      <Box flexDirection="column" marginRight={1} width={3}>
        {frame.map((line, i) => (
          <Text key={i} color={assistantColor} bold>
            {line}
          </Text>
        ))}
      </Box>
    );
  }

  return (
    <Box marginRight={1} minWidth={3}>
      <Text color={assistantColor} bold>
        {"<>"}
      </Text>
    </Box>
  );
});

AssistantBadge.displayName = "AssistantBadge";

const AssistantContent: React.FC<{ content: string; isError: boolean }> =
  React.memo(({ content, isError }) => {
    if (isError || !contentNeedsDiffRendering(content)) {
      return (
        <Text wrap="wrap" color={isError ? "red" : undefined}>
          {content}
        </Text>
      );
    }

    let inDiffFence = false;

    return (
      <Box flexDirection="column">
        {content.split("\n").map((rawLine, index) => {
          const line = stripAnsi(rawLine);
          const trimmed = line.trimStart();
          const startsDiffFence = /^```diff\b/.test(trimmed);
          const startsAnyFence = /^```/.test(trimmed);

          if (startsDiffFence) {
            inDiffFence = true;
            return (
              <Text key={index} dimColor>
                {line}
              </Text>
            );
          }

          if (startsAnyFence) {
            inDiffFence = false;
            return (
              <Text key={index} dimColor>
                {line}
              </Text>
            );
          }

          return (
            <Text
              key={index}
              wrap="wrap"
              color={getDiffLineColor(line, inDiffFence)}
            >
              {line}
            </Text>
          );
        })}
      </Box>
    );
  });

AssistantContent.displayName = "AssistantContent";

const ToolMessage: React.FC<{ msg: ChatMessage }> = React.memo(({ msg }) => {
  const running = msg.toolStatus === "running";
  const [, isVisible] = useBlink(running, 400);
  const color =
    msg.toolStatus === "error"
      ? "red"
      : msg.toolStatus === "completed"
        ? "green"
        : PAKALON_GOLD;

  return (
    <Box marginY={0} paddingLeft={2} gap={1} alignItems="flex-start">
      <Text color={color} bold>
        {running ? (isVisible ? "*" : " ") : msg.toolStatus === "error" ? "x" : "[OK]"}
      </Text>
      <Box flexDirection="column">
        <Text dimColor color="gray" wrap="wrap">
          {msg.content}
        </Text>
      </Box>
    </Box>
  );
});

ToolMessage.displayName = "ToolMessage";

function getThinkingPreview(text: string): string {
  const trimmed = text.trim();
  if (!trimmed) return "";
  const tailLines = trimmed.split("\n").slice(-18).join("\n");
  return tailLines.length > 2400 ? `…${tailLines.slice(-2400)}` : tailLines;
}

const ThinkingTrace: React.FC<{ text: string }> = React.memo(({ text }) => {
  const preview = getThinkingPreview(text);
  if (!preview) return null;

  return (
    <Box marginY={0} paddingLeft={2} flexDirection="column">
      <Text color={PAKALON_GOLD}>thinking process</Text>
      <Text dimColor color="gray" wrap="wrap">
        {preview}
      </Text>
    </Box>
  );
});

ThinkingTrace.displayName = "ThinkingTrace";

const MessageItemBase: React.FC<{
  msg: ChatMessage;
  animateAssistant?: boolean;
  colorMode?: "orange" | "blue" | "red" | "green";
  onActionButton?: (messageId: string, actionId: string) => void;
}> = React.memo(
  ({ msg, animateAssistant = false, colorMode = "orange", onActionButton }) => {
    const isUser = msg.role === "user";
    const isSystem = msg.role === "system";
    const isTool = msg.role === "tool";
    const isAssistant = !isUser && !isSystem && !isTool;

    if (isSystem) {
      return (
        <Box marginY={0}>
          <Text dimColor color="gray">
            [system] {msg.content}
          </Text>
        </Box>
      );
    }

    if (isTool) {
      return <ToolMessage msg={msg} />;
    }

    return (
      <Box flexDirection="column" marginY={0}>
        <Box gap={1} alignItems="flex-start">
          {isUser ? (
            <Text
              bold
              color={
                colorMode === "blue"
                  ? PAKALON_BLUE
                  : colorMode === "red"
                    ? "#EF4444"
                    : colorMode === "green"
                      ? "#22C55E"
                      : PAKALON_GOLD
              }
            >
              you
            </Text>
          ) : null}
          <Text dimColor>
            {msg.createdAt.toLocaleTimeString("en-US", {
              hour: "2-digit",
              minute: "2-digit",
            })}
          </Text>
        </Box>
        <Box paddingLeft={2} flexDirection="column">
          {isUser ? (
            <Box paddingX={1} marginRight={1}>
              <Text
                wrap="wrap"
                color={TEXT_PRIMARY}
                backgroundColor={getUserHighlightBg(colorMode)}
              >{` ${msg.content} `}</Text>
            </Box>
          ) : (
            <AssistantContent
              content={msg.content}
              isError={isErrorMessage(msg)}
            />
          )}
          {/* T-CLI-11: Render any image file paths embedded in the message inline */}
          {!msg.isStreaming &&
            extractImagePaths(msg.content).map((imgPath) => (
              <InlineImage key={imgPath} filePath={imgPath} />
            ))}
          {/* T-CLI-70: Render inline action buttons if message has them */}
          {msg.buttons && msg.buttons.length > 0 && !msg.isStreaming && (
            <Box marginTop={1} marginLeft={2}>
              <InlineActionButtons
                buttons={msg.buttons}
                messageId={msg.id}
                onAction={({ action }) => onActionButton?.(msg.id, action)}
              />
            </Box>
          )}
        </Box>
      </Box>
    );
  },
);

MessageItemBase.displayName = "MessageItemBase";

const MessageItem = MessageItemBase;

function getUserHighlightBg(
  colorMode: "orange" | "blue" | "red" | "green",
): string {
  if (colorMode === "blue") return "#102A43";
  if (colorMode === "red") return "#3F1014";
  if (colorMode === "green") return "#123524";
  return USER_HIGHLIGHT_BG;
}

const BusyRow: React.FC<{ colorMode?: "orange" | "blue" | "red" | "green" }> =
  React.memo(({ colorMode = "orange" }) => {
    const spinnerFrame = useSpinner(true, 500);
    const assistantColor =
      colorMode === "blue"
        ? PAKALON_BLUE
        : colorMode === "red"
          ? "#EF4444"
          : colorMode === "green"
            ? "#22C55E"
            : PAKALON_GOLD;

    // Stabilize timestamp — compute once on mount to avoid re-render flicker
    const [timestamp] = useState(
      new Date().toLocaleTimeString("en-US", {
        hour: "2-digit",
        minute: "2-digit",
      }),
    );

    return (
      <Box flexDirection="column" marginY={0}>
        <Box gap={1} alignItems="flex-start">
          <Box marginRight={1} minWidth={3}>
            <Text color={assistantColor} bold>
              {spinnerFrame}
            </Text>
          </Box>
          <Text dimColor>{timestamp}</Text>
        </Box>
        <Box paddingLeft={2}>
          <Text color={assistantColor}>pakalon is thinking…</Text>
        </Box>
      </Box>
    );
  });

BusyRow.displayName = "BusyRow";

const MessageList: React.FC<MessageListProps> = React.memo(
  ({
    messages,
    assistantBusy = false,
    colorMode = "orange",
    shellWidth,
    thinkingText,
    onActionButton,
  }) => {
    const resolvedShellWidth =
      shellWidth ?? getShellWidth(process.stdout.columns ?? 80);
    const contentWidth: number | "100%" =
      shellWidth !== undefined ? "100%" : resolvedShellWidth;
    const containerJustify = shellWidth !== undefined ? "flex-start" : "center";

    const activeAssistantMessageId = useMemo(() => {
      for (let index = messages.length - 1; index >= 0; index -= 1) {
        const message = messages[index];
        if (!message) continue;
        if (
          message.role !== "user" &&
          message.role !== "system" &&
          message.role !== "tool"
        ) {
          return message.id;
        }
      }
      return null;
    }, [messages]);

    // Show the loading animation when AI is busy
    const showBusyRow = assistantBusy !== undefined ? assistantBusy : false;
    const visibleMessages = useMemo(() => {
      if (messages.length <= MAX_RENDERED_MESSAGES) return messages;
      return messages.slice(messages.length - MAX_RENDERED_MESSAGES);
    }, [messages]);
    const hiddenMessageCount = messages.length - visibleMessages.length;

    return (
      <Box
        width="100%"
        justifyContent={containerJustify}
        flexGrow={1}
        flexDirection="column"
        overflow="hidden"
      >
        <Box flexDirection="column" flexGrow={1} width={contentWidth}>
          {hiddenMessageCount > 0 && (
            <Text dimColor color="gray">
              Showing latest {visibleMessages.length} messages.{" "}
              {hiddenMessageCount} older messages are retained in session
              history.
            </Text>
          )}
          {visibleMessages.map((msg) => (
            <MessageItem
              key={msg.id}
              msg={msg}
              animateAssistant={false}
              colorMode={colorMode}
              onActionButton={onActionButton}
            />
          ))}
          {thinkingText ? <ThinkingTrace text={thinkingText} /> : null}
        </Box>
      </Box>
    );
  },
);

MessageList.displayName = "MessageList";

export default MessageList;
