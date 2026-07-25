import { FieldLabel } from "./field-label";

export function FieldControl({ label, help, children }: { label: string; help?: React.ReactNode; children: React.ReactNode }) {
  return (
    <div className="grid gap-2">
      <FieldLabel label={label} help={help} />
      {children}
    </div>
  );
}
