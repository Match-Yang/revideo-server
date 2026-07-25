import * as React from "react";
import { Input } from "@/components/ui/input";
import { HelpTooltip } from "./help-tooltip";
import { cn } from "@/lib/utils";

function cleanId(value: string) {
  return value.replace(/[^a-zA-Z0-9_-]/g, "-");
}

export function WideLabelInput({ label, help, className, ...props }: React.ComponentProps<typeof Input> & { label: string; help?: React.ReactNode }) {
  const controlId = props.id || cleanId(String(props.name || label));
  return (
    <div className="flex min-h-10 items-center gap-6 py-2.5">
      <div className="flex w-28 shrink-0 items-center gap-1 font-medium text-sm leading-snug">
        {label}
        <HelpTooltip>{help}</HelpTooltip>
      </div>
      <div className="min-w-0 flex-1">
        <Input {...props} id={controlId} className={cn("w-full", className)} />
      </div>
    </div>
  );
}
