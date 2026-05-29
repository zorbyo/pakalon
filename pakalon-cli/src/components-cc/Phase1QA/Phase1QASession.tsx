import React, { useEffect, useMemo, useState } from "react";
import { useInput } from "ink";
import { Phase1QAProvider, usePhase1QA, type Phase1QARequest } from "./Phase1QAProvider.js";
import { Phase1QAProgress } from "./Phase1QAProgress.js";
import { Phase1QuestionCard } from "./Phase1QuestionCard.js";

function Phase1QASessionInner({ request, onSubmit }: { request: Phase1QARequest; onSubmit: (value: string | string[]) => void }) {
  const { request: ctxRequest, setRequest, selectedIds, setSelectedIds, otherText, setOtherText } = usePhase1QA();
  const [cursor, setCursor] = useState(0);

  useEffect(() => {
    setRequest(request);
    setSelectedIds([]);
    setOtherText("");
    setCursor(0);
  }, [request, setRequest, setSelectedIds, setOtherText]);

  const choices = ctxRequest?.choices ?? request.choices;
  const multi = Boolean(request.multi_select);
  const submit = () => {
    if (request.allow_other && otherText.trim() && selectedIds.includes("other")) {
      onSubmit(otherText.trim());
      return;
    }
    if (multi) {
      const result = selectedIds.length > 0 ? selectedIds : [choices[cursor]?.id ?? choices[0]?.id ?? ""];
      onSubmit(result.filter(Boolean));
      return;
    }
    onSubmit(choices[cursor]?.id ?? choices[0]?.id ?? "");
  };

  useInput((input, key) => {
    if (key.upArrow || input === "k") setCursor((prev) => (prev - 1 + choices.length) % choices.length);
    if (key.downArrow || input === "j") setCursor((prev) => (prev + 1) % choices.length);
    if (key.escape) setSelectedIds([]);
    if (multi && input === " ") {
      const id = choices[cursor]?.id;
      if (!id) return;
      setSelectedIds((prev) => (prev.includes(id) ? prev.filter((value) => value !== id) : [...prev, id]));
    }
    if (key.return) submit();
    if (request.allow_other && input.length === 1 && !key.ctrl && !key.meta && !key.return) {
      const id = choices[cursor]?.id;
      if (id === "other") setOtherText((prev) => prev + input);
    }
  });

  const current = request.question_index ?? 0;
  const total = request.total_questions ?? 1;

  return (
    <>
      <Phase1QAProgress current={current + 1} total={total} />
      <Phase1QuestionCard request={request} selectedIds={selectedIds} cursor={cursor} otherText={otherText} />
    </>
  );
}

export function Phase1QASession({ request, onSubmit }: { request: Phase1QARequest; onSubmit: (value: string | string[]) => void }) {
  const key = useMemo(() => request._requestId, [request._requestId]);
  return (
    <Phase1QAProvider key={key}>
      <Phase1QASessionInner request={request} onSubmit={onSubmit} />
    </Phase1QAProvider>
  );
}
