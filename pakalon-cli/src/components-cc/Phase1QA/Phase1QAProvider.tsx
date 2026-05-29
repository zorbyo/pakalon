import React, { createContext, useContext, useMemo, useState, type Dispatch, type ReactNode, type SetStateAction } from "react";

export type Phase1QAChoice = { id: string; label: string };

export type Phase1QARequest = {
  type: "choice_request";
  message: string;
  question: string;
  choices: Phase1QAChoice[];
  _requestId: string;
  question_index?: number;
  total_questions?: number;
  multi_select?: boolean;
  allow_other?: boolean;
};

type Phase1QAContextValue = {
  request: Phase1QARequest | null;
  setRequest: Dispatch<SetStateAction<Phase1QARequest | null>>;
  selectedIds: string[];
  setSelectedIds: Dispatch<SetStateAction<string[]>>;
  otherText: string;
  setOtherText: Dispatch<SetStateAction<string>>;
};

const Phase1QAContext = createContext<Phase1QAContextValue | null>(null);

export function Phase1QAProvider({ children }: { children: ReactNode }) {
  const [request, setRequest] = useState<Phase1QARequest | null>(null);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [otherText, setOtherText] = useState("");

  const value = useMemo(
    () => ({ request, setRequest, selectedIds, setSelectedIds, otherText, setOtherText }),
    [request, selectedIds, otherText],
  );

  return <Phase1QAContext.Provider value={value}>{children}</Phase1QAContext.Provider>;
}

export function usePhase1QA() {
  const ctx = useContext(Phase1QAContext);
  if (!ctx) throw new Error("usePhase1QA must be used within Phase1QAProvider");
  return ctx;
}
