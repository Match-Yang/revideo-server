import { HelpTooltip } from "./help-tooltip";
import { cn } from "@/lib/utils";

export function SettingRow({ label, help, description, children, className }: {
  label: string;
  help?: React.ReactNode;
  description?: string;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("flex min-h-10 items-center gap-6 py-2.5", className)}>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-1 font-medium text-sm leading-snug">
          {label}
          <HelpTooltip>{help}</HelpTooltip>
        </div>
        {description && <div className="mt-0.5 text-muted-foreground text-xs leading-snug">{description}</div>}
      </div>
      <div className="shrink-0">{children}</div>
    </div>
  );
}
