import { Box, Text, useApp, useInput } from "ink";
import { useCallback, useEffect, useMemo, useState } from "react";
import type { CliServiceResult, CliServices } from "../services.js";
import type { CliCommand } from "../args/types.js";
import { TextField } from "./TextField.js";

type NewCommand = Extract<CliCommand, { name: "new" }>;

interface ClarificationView {
  readonly field: string;
  readonly question: string;
  readonly recommendedAssumption: string;
}

function clarificationFrom(result: CliServiceResult): ClarificationView | undefined {
  if (typeof result.data !== "object" || result.data === null) {
    return undefined;
  }
  const question = (result.data as { question?: unknown }).question;
  if (typeof question !== "object" || question === null) {
    return undefined;
  }
  const candidate = question as Record<string, unknown>;
  return typeof candidate["field"] === "string" &&
    typeof candidate["question"] === "string" &&
    typeof candidate["recommendedAssumption"] === "string"
    ? {
        field: candidate["field"],
        question: candidate["question"],
        recommendedAssumption: candidate["recommendedAssumption"],
      }
    : undefined;
}

export interface NewWizardProps {
  readonly services: CliServices;
  readonly signal: AbortSignal;
  readonly onCancel: () => void;
  readonly onBack: () => void;
}

export function NewWizard({ services, signal, onCancel, onBack }: NewWizardProps) {
  const { exit } = useApp();
  const targets = useMemo(() => services.listTargets(), [services]);
  const [brief, setBrief] = useState<string>();
  const [targetIndex, setTargetIndex] = useState(0);
  const [targetSelected, setTargetSelected] = useState(false);
  const [clarifications, setClarifications] = useState<
    Array<{ field: string; answer: string; assumed?: boolean }>
  >([]);
  const [fast, setFast] = useState(false);
  const [result, setResult] = useState<CliServiceResult>();
  const [question, setQuestion] = useState<ClarificationView>();
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string>();

  const submit = useCallback(async () => {
    if (brief === undefined || targets[targetIndex] === undefined) {
      return;
    }
    setRunning(true);
    setError(undefined);
    try {
      const command: NewCommand = {
        name: "new",
        global: { json: false },
        brief,
        fast,
        targets: [targets[targetIndex].id],
        clarifications,
      };
      const next = await services.execute(command, signal);
      const nextQuestion = clarificationFrom(next);
      if (next.status === "needs_input" && nextQuestion !== undefined) {
        setQuestion(nextQuestion);
      } else {
        setResult(next);
      }
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setRunning(false);
    }
  }, [brief, clarifications, fast, services, signal, targetIndex, targets]);

  useEffect(() => {
    if (targetSelected && result === undefined && question === undefined && !running) {
      void submit();
    }
  }, [question, result, running, submit, targetSelected]);

  useInput(
    (input, key) => {
      if (key.ctrl && input === "c") {
        onCancel();
        exit();
        return;
      }
      if (brief === undefined && key.escape) {
        onBack();
        return;
      }
      if (error !== undefined && (input === "q" || key.escape)) {
        onBack();
        return;
      }
      if (brief !== undefined && !targetSelected) {
        if (key.upArrow) {
          setTargetIndex((value) => (value - 1 + targets.length) % targets.length);
        } else if (key.downArrow) {
          setTargetIndex((value) => (value + 1) % targets.length);
        } else if (key.return && targets.length > 0) {
          setTargetSelected(true);
        } else if (key.escape) {
          setBrief(undefined);
        }
        return;
      }
      if (result !== undefined && (input === "q" || key.escape)) {
        onBack();
      }
    },
    { isActive: brief !== undefined && question === undefined },
  );

  if (brief === undefined) {
    return (
      <Box flexDirection="column">
        <Text bold>Turn a demand into a better prompt</Text>
        <Text dimColor>Describe the outcome in your own words. Explicit details are preserved.</Text>
        <Box marginTop={1}>
          <TextField
            label="Brief:"
            placeholder="What do you want the prompt to achieve?"
            onCancel={onCancel}
            onSubmit={(value) => {
              if (value.length > 0) setBrief(value);
            }}
          />
        </Box>
        <Text dimColor>Esc returns · Ctrl+C cancels</Text>
      </Box>
    );
  }

  if (!targetSelected) {
    return (
      <Box flexDirection="column">
        <Text bold>Select the model you will use this prompt with</Text>
        <Text dimColor>↑/↓ select · Enter continue · Esc edit brief</Text>
        <Box marginTop={1} flexDirection="column">
          {targets.map((target, index) => (
            <Text
              key={target.id}
              {...(index === targetIndex ? { color: "cyan" as const } : {})}
            >
              {index === targetIndex ? "› " : "  "}
              {target.id} — {target.provider}/{target.model} ({target.surface}
              {target.availability === "target_only" ? ", target-only" : ""})
            </Text>
          ))}
        </Box>
      </Box>
    );
  }

  if (question !== undefined) {
    return (
      <Box flexDirection="column">
        <Text bold color="yellow">Clarification needed</Text>
        <Text>{question.question}</Text>
        <Text dimColor>Recommended: {question.recommendedAssumption}</Text>
        <Text dimColor>Type an answer, :assume to accept the recommendation, or :fast for all defaults.</Text>
        <Box marginTop={1}>
          <TextField
            label="Answer:"
            placeholder="Your answer"
            onCancel={onCancel}
            onSubmit={(answer) => {
              if (answer === ":fast") {
                setFast(true);
              } else if (answer === ":assume" || answer.length === 0) {
                setClarifications((items) => [
                  ...items,
                  {
                    field: question.field,
                    answer: question.recommendedAssumption,
                    assumed: true,
                  },
                ]);
              } else {
                setClarifications((items) => [
                  ...items,
                  { field: question.field, answer },
                ]);
              }
              setQuestion(undefined);
            }}
          />
        </Box>
      </Box>
    );
  }

  if (running) {
    return <Text color="cyan">Shaping the prompt…</Text>;
  }

  if (error !== undefined) {
    return (
      <Box flexDirection="column">
        <Text color="red">Could not create the prompt package: {error}</Text>
        <Text dimColor>Press Esc to return.</Text>
      </Box>
    );
  }

  if (result !== undefined) {
    return (
      <Box flexDirection="column">
        <Text bold color={result.exitCode === 0 ? "green" : "yellow"}>
          {result.message}
        </Text>
        <Text dimColor>Verification labels report evidence level, not universal perfection.</Text>
        <Text dimColor>Press q or Esc to return.</Text>
      </Box>
    );
  }

  return <Text color="cyan">Preparing compiler…</Text>;
}
