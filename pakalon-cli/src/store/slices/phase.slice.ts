/**
 * Phase slice — manages current phase state and HIL action buttons.
 */
import type { StateCreator } from "zustand";

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
  | "ask_question";

export interface PhaseActionButton {
  id: PhaseAction;
  label: string;
  description?: string;
  variant: "primary" | "secondary" | "danger" | "success";
  shortcut?: string;
  disabled?: boolean;
}

export interface PhaseActionState {
  messageId: string | null;
  buttons: PhaseActionButton[];
  currentPhase: PhaseNumber | null;
  isAwaitingAction: boolean;
  designApproved: boolean;
  editConfirmed: boolean;
  auditFindings: {
    missingCount: number;
    partialCount: number;
    criticalItems: string[];
  } | null;
}

export interface PhaseState extends PhaseActionState {
  setCurrentPhase: (phase: PhaseNumber | null) => void;
  setActionButtons: (buttons: PhaseActionButton[], messageId?: string) => void;
  clearActionButtons: () => void;
  triggerPhaseAction: (action: PhaseAction, metadata?: Record<string, unknown>) => void;
  setDesignApproved: (approved: boolean) => void;
  setEditConfirmed: (confirmed: boolean) => void;
  setAuditFindings: (findings: PhaseActionState["auditFindings"]) => void;
  setAwaitingAction: (awaiting: boolean) => void;
}

export const createPhaseSlice: StateCreator<
  PhaseState,
  [],
  [],
  PhaseState
> = (set, get) => ({
  messageId: null,
  buttons: [],
  currentPhase: null,
  isAwaitingAction: false,
  designApproved: false,
  editConfirmed: false,
  auditFindings: null,

  setCurrentPhase: (phase: PhaseNumber | null) => set({ currentPhase: phase }),

  setActionButtons: (buttons: PhaseActionButton[], messageId?: string) =>
    set({
      buttons,
      messageId: messageId ?? null,
      isAwaitingAction: buttons.length > 0,
    }),

  clearActionButtons: () =>
    set({
      buttons: [],
      messageId: null,
      isAwaitingAction: false,
    }),

  triggerPhaseAction: (action: PhaseAction, metadata?: Record<string, unknown>) => {
    if (_onPhaseAction) {
      _onPhaseAction(action, metadata);
    }
    set({ buttons: [], messageId: null, isAwaitingAction: false });
  },

  setDesignApproved: (approved: boolean) => set({ designApproved: approved }),
  setEditConfirmed: (confirmed: boolean) => set({ editConfirmed: confirmed }),
  setAuditFindings: (findings) => set({ auditFindings: findings }),
  setAwaitingAction: (awaiting: boolean) => set({ isAwaitingAction: awaiting }),
});

let _onPhaseAction: ((action: PhaseAction, metadata?: Record<string, unknown>) => void) | null = null;

export function setOnPhaseActionCallback(
  cb: (action: PhaseAction, metadata?: Record<string, unknown>) => void
): void {
  _onPhaseAction = cb;
}

export function clearOnPhaseActionCallback(): void {
  _onPhaseAction = null;
}
