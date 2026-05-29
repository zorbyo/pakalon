/**
 * PhaseActionPanel — Phase-specific action buttons for HIL workflow control.
 *
 * Used in Phases 1-6 for:
 * - Phase 1: End Phase 1 / Skip to Phase 2
 * - Phase 2: Accept Design / Request Changes / Open Penpot
 * - Phase 3: Confirm Edit / Make Changes / End Phase 3
 * - Phase 4: View Report / Proceed to Phase 5 / Re-run Tests
 * - Phase 5: Deploy Now / View CI-CD / Cancel
 * - Phase 6: Generate Docs / Skip / View Summary
 *
 * Also handles auditor agent HIL questions after audit completion.
 */

import React, { useState, useCallback, useMemo } from "react";
import { Box, Text, useInput } from "ink";
import MultiChoicePanel, { type Choice } from "./MultiChoicePanel.js";

export type PhaseNumber = 1 | 2 | 3 | 4 | 5 | 6;

export type PhaseAction =
  | "accept_design"
  | "request_changes"
  | "open_penpot"
  | "confirm_edit"
  | "make_changes"
  | "end_phase"
  | "next_phase"
  | "previous_phase"
  | "skip_phase"
  | "run_auditor"
  | "implement_missing"
  | "ignore_missing"
  | "proceed_to_deployment"
  | "re_run_tests"
  | "view_report"
  | "deploy_now"
  | "view_cicd"
  | "cancel_deploy"
  | "generate_docs"
  | "skip_docs"
  | "view_summary"
  | "replan"
  | "ask_question"
  | string;

export interface PhaseActionButton {
  id: PhaseAction;
  label: string;
  description?: string;
  variant: "primary" | "secondary" | "danger" | "success";
  requiresConfirmation?: boolean;
}

export interface PhaseActionPanelProps {
  currentPhase: PhaseNumber;
  nextPhase?: PhaseNumber;
  previousPhase?: PhaseNumber;
  onAction: (action: PhaseAction, metadata?: Record<string, unknown>) => void;
  isYolo?: boolean;
  auditFindings?: {
    missingCount?: number;
    partialCount?: number;
    criticalItems?: string[];
  };
  designApproved?: boolean;
  editConfirmed?: boolean;
}

function buildPhaseChoices(
  currentPhase: PhaseNumber,
  options: {
    nextPhase?: PhaseNumber;
    previousPhase?: PhaseNumber;
    isYolo?: boolean;
    auditFindings?: {
      missingCount?: number;
      partialCount?: number;
      criticalItems?: string[];
    };
    designApproved?: boolean;
    editConfirmed?: boolean;
  }
): PhaseActionButton[] {
  const { nextPhase, previousPhase, isYolo, auditFindings, designApproved, editConfirmed } = options;

  const baseActions: PhaseActionButton[] = [];

  switch (currentPhase) {
    case 1: {
      baseActions.push(
        {
          id: "end_phase",
          label: "End Phase 1 and proceed",
          description: "Finish planning and start wireframing (Phase 2)",
          variant: "primary",
        },
        {
          id: "skip_phase",
          label: "Skip to Development",
          description: "Bypass design phase, go directly to Phase 3",
          variant: "secondary",
        },
        {
          id: "replan",
          label: "Continue Planning",
          description: "Ask more questions and refine the plan",
          variant: "secondary",
        }
      );
      break;
    }

    case 2: {
      baseActions.push(
        {
          id: "accept_design",
          label: designApproved ? "Design Accepted [OK]" : "Accept this Design",
          description: "Approve the wireframes and proceed to development",
          variant: "success",
        },
        {
          id: "request_changes",
          label: "Request Changes",
          description: "Request modifications to the current design",
          variant: "danger",
        },
        {
          id: "open_penpot",
          label: "Open in Penpot",
          description: "Open Penpot to manually edit the design",
          variant: "secondary",
        }
      );
      break;
    }

    case 3: {
      baseActions.push(
        {
          id: "confirm_edit",
          label: editConfirmed ? "Changes Confirmed [OK]" : "Confirm Edit",
          description: "Accept the current changes and continue",
          variant: "success",
        },
        {
          id: "make_changes",
          label: "Make Changes",
          description: "Request specific modifications to the code",
          variant: "secondary",
        },
        {
          id: "end_phase",
          label: "End Phase 3",
          description: "Complete development and proceed to testing",
          variant: "primary",
        }
      );
      break;
    }

    case 4: {
      baseActions.push(
        {
          id: "view_report",
          label: "View Full Report",
          description: "See detailed security and QA findings",
          variant: "secondary",
        },
        {
          id: "proceed_to_deployment",
          label: "Proceed to Deployment",
          description: "Move to Phase 5 with current results",
          variant: "success",
        },
        {
          id: "re_run_tests",
          label: "Re-run Tests",
          description: "Execute security scans again",
          variant: "secondary",
        }
      );
      break;
    }

    case 5: {
      baseActions.push(
        {
          id: "deploy_now",
          label: "Deploy Now",
          description: "Push to repository and deploy",
          variant: "success",
        },
        {
          id: "view_cicd",
          label: "View CI/CD Pipeline",
          description: "Review deployment configuration",
          variant: "secondary",
        },
        {
          id: "cancel_deploy",
          label: "Cancel Deployment",
          description: "Return to previous phase",
          variant: "danger",
        }
      );
      break;
    }

    case 6: {
      baseActions.push(
        {
          id: "generate_docs",
          label: "Generate Documentation",
          description: "Create complete documentation",
          variant: "success",
        },
        {
          id: "skip_docs",
          label: "Skip Documentation",
          description: "Skip to completion",
          variant: "secondary",
        },
        {
          id: "view_summary",
          label: "View Project Summary",
          description: "Review all completed phases",
          variant: "secondary",
        }
      );
      break;
    }
  }

  if (previousPhase) {
    baseActions.push({
      id: "previous_phase",
      label: `Back to Phase ${previousPhase}`,
      description: `Return to Phase ${previousPhase}`,
      variant: "secondary",
    });
  }

  if (auditFindings && (auditFindings.missingCount > 0 || auditFindings.partialCount > 0)) {
    baseActions.push(
      {
        id: "implement_missing",
        label: `Implement Missing (${auditFindings.missingCount + auditFindings.partialCount})`,
        description: "Fix all missing and partially implemented features",
        variant: "danger",
      },
      {
        id: "ignore_missing",
        label: "Ignore and Proceed",
        description: "Continue without implementing missing features",
        variant: "secondary",
      }
    );
  }

  if (isYolo) {
    baseActions.push({
      id: "ask_question",
      label: "Ask Question",
      description: "Ask about the current phase without stopping",
      variant: "secondary",
    });
  }

  return baseActions;
}

const PhaseActionPanel: React.FC<PhaseActionPanelProps> = ({
  currentPhase,
  nextPhase,
  previousPhase,
  onAction,
  isYolo = false,
  auditFindings,
  designApproved = false,
  editConfirmed = false,
}) => {
  const [selectedIndex, setSelectedIndex] = useState(0);

  const choices = useMemo<Choice[]>(() => {
    const actions = buildPhaseChoices(currentPhase, {
      nextPhase,
      previousPhase,
      isYolo,
      auditFindings,
      designApproved,
      editConfirmed,
    });
    return actions.map((action, index) => ({
      id: action.id,
      label: action.label,
      description: action.description,
    }));
  }, [currentPhase, nextPhase, previousPhase, isYolo, auditFindings, designApproved, editConfirmed]);

  const actions = useMemo(() => {
    return buildPhaseChoices(currentPhase, {
      nextPhase,
      previousPhase,
      isYolo,
      auditFindings,
      designApproved,
      editConfirmed,
    });
  }, [currentPhase, nextPhase, previousPhase, isYolo, auditFindings, designApproved, editConfirmed]);

  const handleSelect = useCallback(
    (choiceId: string) => {
      const action = actions.find(a => a.id === choiceId);
      if (action) {
        onAction(action.id as PhaseAction);
      }
    },
    [actions, onAction]
  );

  if (choices.length === 0) return null;

  return (
    <Box flexDirection="column" marginY={1}>
      <Box paddingX={1} marginBottom={1}>
        <Text bold color="#ff8c00">
          Phase {currentPhase}
        </Text>
        <Text dimColor color="gray">
          {" "}— Choose an action:
        </Text>
      </Box>
      <MultiChoicePanel
        question={`What would you like to do for Phase ${currentPhase}?`}
        choices={choices}
        onSelect={handleSelect}
        title="Phase Actions"
      />
    </Box>
  );
};

export default PhaseActionPanel;