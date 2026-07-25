import { Label } from "@/components/ui/label";
import { HelpTooltip } from "./help-tooltip";

export function FieldLabel({ id, label, help }: { id?: string; label: string; help?: React.ReactNode }) {
  return (
    <div className="flex min-h-5 items-center gap-1.5">
      <Label htmlFor={id} className="font-medium text-sm">{label}</Label>
      <HelpTooltip>{help}</HelpTooltip>
    </div>
  );
}
