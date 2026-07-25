import * as React from "react";
import { Input } from "@/components/ui/input";
import { SettingRow } from "./setting-row";
import { cn } from "@/lib/utils";

function cleanId(value: string) {
  return value.replace(/[^a-zA-Z0-9_-]/g, "-");
}

export function LabelInput({ label, help, className, ...props }: React.ComponentProps<typeof Input> & { label: string; help?: React.ReactNode }) {
  const controlId = props.id || cleanId(String(props.name || label));
  return (
    <SettingRow label={label} help={help}>
      <Input {...props} id={controlId} className={cn("w-28", className)} />
    </SettingRow>
  );
}
