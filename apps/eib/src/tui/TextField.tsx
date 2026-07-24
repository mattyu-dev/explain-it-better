import { Text, useApp, useInput } from "ink";
import { useState } from "react";

export interface TextFieldProps {
  readonly label: string;
  readonly placeholder?: string;
  readonly onSubmit: (value: string) => void;
  readonly onCancel?: () => void;
  readonly disabled?: boolean;
}

export function TextField({
  label,
  placeholder = "",
  onSubmit,
  onCancel,
  disabled = false,
}: TextFieldProps) {
  const [value, setValue] = useState("");
  const { exit } = useApp();

  useInput(
    (input, key) => {
      if (key.ctrl && input === "c") {
        onCancel?.();
        exit();
        return;
      }
      if (key.return) {
        onSubmit(value.trim());
        setValue("");
        return;
      }
      if (key.backspace || key.delete) {
        setValue((current) => [...current].slice(0, -1).join(""));
        return;
      }
      if (!key.ctrl && !key.meta && !key.escape && input.length > 0) {
        setValue((current) => `${current}${input}`);
      }
    },
    { isActive: !disabled },
  );

  return (
    <Text>
      <Text color="cyan">{label}</Text>{" "}
      {value.length > 0 ? value : <Text dimColor>{placeholder}</Text>}
      <Text color="cyan">▌</Text>
    </Text>
  );
}
