import { Textarea } from "@/components/ui/textarea";
import { FieldControl } from "./field-control";

export function PromptField({ name, label, defaultValue }: { name: string; label: string; defaultValue?: string }) {
  return (
    <FieldControl label={label} help="只追加本项对应任务的额外约束；不会替代系统内置提示词。">
      <Textarea name={name} defaultValue={defaultValue} className="min-h-24 resize-y" />
    </FieldControl>
  );
}
