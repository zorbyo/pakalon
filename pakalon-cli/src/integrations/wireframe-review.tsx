import React, { useMemo, useState } from "react";
import { Box, Text, render, useInput } from "ink";
import logger from "@/utils/logger.js";

export interface ReviewResult {
  approved: boolean;
  decision: "approve" | "reject" | "modify";
  selectedIndex: number;
  notes: string;
}

interface WireframeReviewProps {
  wireframes: string[];
  projectDir: string;
  onDone: (result: ReviewResult) => void;
}

function WireframeReviewApp({ wireframes, projectDir, onDone }: WireframeReviewProps): React.ReactElement {
  const [index, setIndex] = useState(0);
  const [decision, setDecision] = useState<ReviewResult["decision"] | null>(null);
  const [notes, setNotes] = useState("");
  const [editingNotes, setEditingNotes] = useState(false);

  const previews = useMemo(() => wireframes.length ? wireframes : ["(no wireframes provided)"], [wireframes]);

  useInput((input, key) => {
    if (editingNotes) {
      if (key.return) {
        const finalDecision = decision ?? "modify";
        onDone({ approved: finalDecision === "approve", decision: finalDecision, selectedIndex: index, notes });
        return;
      }
      if (key.escape) {
        setEditingNotes(false);
        setNotes("");
        return;
      }
      if ((input === "\b" || input === "\x7f") && notes.length > 0) {
        setNotes((value) => value.slice(0, -1));
        return;
      }
      if (!key.ctrl && input.length === 1) setNotes((value) => value + input);
      return;
    }

    if (key.upArrow || input === "k") setIndex((value) => (value - 1 + previews.length) % previews.length);
    if (key.downArrow || input === "j") setIndex((value) => (value + 1) % previews.length);

    if (input === "a" || key.return) {
      setDecision("approve");
      onDone({ approved: true, decision: "approve", selectedIndex: index, notes: "" });
      return;
    }

    if (input === "r") {
      setDecision("reject");
      onDone({ approved: false, decision: "reject", selectedIndex: index, notes: "" });
      return;
    }

    if (input === "m") {
      setDecision("modify");
      setEditingNotes(true);
      return;
    }
  });

  return (
    <Box flexDirection="column" paddingX={1} paddingY={1}>
      <Text color="cyan" bold>Wireframe Review</Text>
      <Text dimColor>{projectDir}</Text>
      <Box marginTop={1} flexDirection="column">
        {previews.map((wireframe, idx) => (
          <Text key={`${wireframe}-${idx}`} color={idx === index ? "green" : undefined}>
            {idx === index ? ">" : "·"} {wireframe}
          </Text>
        ))}
      </Box>
      <Box marginTop={1} flexDirection="column">
        <Text>Preview: {previews[index] ?? "(none)"}</Text>
        <Text dimColor>a approve · r reject · m modify · ↑/↓ select</Text>
        {editingNotes && <Text color="yellow">Notes: {notes}_</Text>}
        {decision && !editingNotes && <Text color="green">Selected: {decision}</Text>}
      </Box>
    </Box>
  );
}

export async function reviewWireframes(wireframes: string[], projectDir: string): Promise<ReviewResult> {
  if (!process.stdin.isTTY || process.env.CI === "1" || process.env.PAKALON_AUTO_APPROVE_WIREFRAMES === "1") {
    const result: ReviewResult = {
      approved: true,
      decision: "approve",
      selectedIndex: 0,
      notes: "Auto-approved in non-interactive mode",
    };
    logger.info(`[Phase2] Wireframes auto-approved (${wireframes.length} items)`);
    return result;
  }

  return await new Promise<ReviewResult>((resolve) => {
    const { unmount } = render(
      <WireframeReviewApp
        wireframes={wireframes}
        projectDir={projectDir}
        onDone={(result) => {
          unmount();
          resolve(result);
        }}
      />,
    );
  });
}
