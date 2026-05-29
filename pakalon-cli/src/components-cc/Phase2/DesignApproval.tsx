/**
 * DesignApproval Component
 * Interactive design approval UI for Phase 2 wireframe review.
 * Shows wireframe preview with prominent Accept/Change/Redesign buttons.
 */
import React, { useState } from "react";
import { Box, Text, Color } from "ink";

export interface DesignApprovalProps {
  wireframeSvg: string;
  projectName: string;
  iteration: number;
  onApprove: (comment?: string) => void;
  onRequestChanges: (feedback: string) => void;
  onRedesign: (instruction?: string) => void;
  onOpenPenpot: () => void;
}

type ApprovalAction = "idle" | "changes" | "redesign";

export const DesignApproval: React.FC<DesignApprovalProps> = ({
  wireframeSvg,
  projectName,
  iteration,
  onApprove,
  onRequestChanges,
  onRedesign,
  onOpenPenpot,
}) => {
  const [action, setAction] = useState<ApprovalAction>("idle");
  const [feedback, setFeedback] = useState("");

  const handleApprove = () => {
    onApprove();
  };

  const handleRequestChanges = () => {
    if (feedback.trim()) {
      onRequestChanges(feedback);
    } else {
      setAction("changes");
    }
  };

  const handleRedesign = () => {
    if (action === "redesign" && feedback.trim()) {
      onRedesign(feedback);
    } else {
      setAction("redesign");
    }
  };

  const handleOpenPenpot = () => {
    onOpenPenpot();
  };

  const handleKeyPress = (key: string) => {
    if (key === "enter" && action === "idle") {
      handleApprove();
    }
  };

  // Simple SVG preview (shows dimensions as text representation)
  const renderWireframePreview = () => {
    const lines = wireframeSvg.split("\n").filter((l) => l.trim());
    const previewLines = lines.slice(0, 20).map((line) => {
      // Truncate long SVG lines for preview
      if (line.length > 78) {
        return line.substring(0, 75) + "...";
      }
      return line;
    });
    return previewLines.join("\n");
  };

  return (
    <Box flexDirection="column" borderStyle="round" borderColor="cyan">
      {/* Header */}
      <Box paddingX={1}>
        <Color bold cyan>
          Design Review — Iteration {iteration}
        </Color>
      </Box>
      <Box paddingX={1}>
        <Text>Project: {projectName}</Text>
      </Box>
      <Box marginY={1}>
        <Text dimmed>──────────────────────────────────────────────────────────────</Text>
      </Box>

      {/* Wireframe Preview */}
      <Box flexDirection="column" paddingX={1}>
        <Color bold>Wireframe Preview:</Color>
        <Box marginY={1} flexDirection="column">
          <Text wrap="truncate">{renderWireframePreview()}</Text>
        </Box>
      </Box>

      <Box marginY={1}>
        <Text dimmed>──────────────────────────────────────────────────────────────</Text>
      </Box>

      {/* Action Buttons */}
      <Box flexDirection="column" paddingX={1}>
        {/* Primary: Accept Design */}
        <Box>
          <Text>
            <Color green bold bgBlack>
              [Ctrl+Enter] Accept Design
            </Color>
            {"  "}
            <Color green>[OK] Looks good — approve and proceed to Phase 3</Color>
          </Text>
        </Box>

        {/* Secondary Actions */}
        <Box marginTop={1}>
          <Color yellow>[C] Request Changes</Color>
          <Text dimmed>  — Need modifications before approval</Text>
        </Box>

        <Box>
          <Color magenta>[R] Redesign</Color>
          <Text dimmed>  — Regenerate wireframe from scratch</Text>
        </Box>

        <Box>
          <Color blue>[P] Open in Penpot</Color>
          <Text dimmed>  — Edit design in browser with live sync</Text>
        </Box>
      </Box>

      {/* Feedback Input */}
      {(action === "changes" || action === "redesign") && (
        <Box flexDirection="column" marginTop={1} paddingX={1}>
          <Text bold>
            <Color yellow>
              {action === "changes" ? "What changes are needed?" : "What should change in the redesign?"}
            </Color>
          </Text>
<Box marginTop={1}>
             <Text dimmed>&gt; </Text>
            <Text
              onKeyPress={(key) => {
                if (key === "enter") {
                  if (action === "changes") {
                    handleRequestChanges();
                  } else {
                    handleRedesign();
                  }
                }
              }}
            >
              <input
                type="text"
                value={feedback}
                onChange={(e) => setFeedback(e.target.value)}
                placeholder={`Describe ${action === "changes" ? "changes" : "redesign instructions"}...`}
                style={{
                  background: "transparent",
                  border: "none",
                  color: "yellow",
                  outline: "none",
                  flex: 1,
                }}
              />
            </Text>
          </Box>
          <Text dimmed>Press Enter to submit</Text>
        </Box>
      )}

      {/* Keyboard Shortcuts Help */}
      <Box marginTop={2} paddingX={1}>
        <Text dimmed>
          <Color cyan>Ctrl+Enter</Color> = Approve | <Color yellow>C</Color> = Changes |{" "}
          <Color magenta>R</Color> = Redesign | <Color blue>P</Color> = Penpot
        </Text>
      </Box>
    </Box>
  );
};

export default DesignApproval;