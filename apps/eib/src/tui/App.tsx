import { Box, Text, useApp, useInput } from "ink";
import { useEffect, useState } from "react";
import type { CliServiceResult, CliServices } from "../services.js";
import { NewWizard } from "./NewWizard.js";

type View = "home" | "new" | "doctor";

export interface AppProps {
  readonly services: CliServices;
  readonly signal: AbortSignal;
  readonly onCancel: () => void;
}

export function App({ services, signal, onCancel }: AppProps) {
  const { exit } = useApp();
  const [view, setView] = useState<View>("home");
  const [doctor, setDoctor] = useState<CliServiceResult>();
  const [doctorError, setDoctorError] = useState<string>();

  useInput(
    (input, key) => {
      if (key.ctrl && input === "c") {
        onCancel();
        exit();
        return;
      }
      if (view === "home") {
        if (input === "n" || key.return) setView("new");
        if (input === "d") setView("doctor");
        if (input === "q" || key.escape) exit();
      } else if (view === "doctor" && (input === "q" || key.escape)) {
        setView("home");
        setDoctor(undefined);
        setDoctorError(undefined);
      }
    },
    { isActive: view !== "new" },
  );

  useEffect(() => {
    const onAbort = (): void => exit();
    signal.addEventListener("abort", onAbort, { once: true });
    return () => signal.removeEventListener("abort", onAbort);
  }, [exit, signal]);

  useEffect(() => {
    if (view !== "doctor" || doctor !== undefined || doctorError !== undefined) {
      return;
    }
    let active = true;
    void services
      .execute({ name: "doctor", global: { json: false } }, signal)
      .then((result) => {
        if (active) setDoctor(result);
      })
      .catch((cause: unknown) => {
        if (active) setDoctorError(cause instanceof Error ? cause.message : String(cause));
      });
    return () => {
      active = false;
    };
  }, [doctor, doctorError, services, signal, view]);

  if (view === "new") {
    return <NewWizard
      services={services}
      signal={signal}
      onCancel={onCancel}
      onBack={() => setView("home")}
    />;
  }

  if (view === "doctor") {
    return (
      <Box flexDirection="column">
        <Text bold>Local backend readiness</Text>
        <Box marginTop={1} flexDirection="column">
          {doctor === undefined && doctorError === undefined ? (
          <Text color="cyan">Checking local prompt evaluators without reading credentials…</Text>
          ) : null}
          {doctor !== undefined ? <Text>{doctor.message}</Text> : null}
          {doctorError !== undefined ? <Text color="red">{doctorError}</Text> : null}
        </Box>
        <Text dimColor>q or Esc returns</Text>
      </Box>
    );
  }

  return (
    <Box flexDirection="column">
      <Text bold color="cyan">Explain It Better</Text>
      <Text>Turn a human demand into a clear, target-aware prompt.</Text>
      <Box marginTop={1} flexDirection="column">
        <Text><Text color="cyan">n / Enter</Text>  Shape a new prompt</Text>
        <Text><Text color="cyan">d</Text>          Doctor: local evaluator readiness</Text>
        <Text><Text color="cyan">q</Text>          Quit</Text>
      </Box>
      <Box marginTop={1}>
        <Text dimColor>Every result is a prompt for a person to inspect and paste.</Text>
      </Box>
    </Box>
  );
}
