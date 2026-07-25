import * as React from "react";
import { SettingRow } from "./setting-row";

function cleanId(value: string) {
  return value.replace(/[^a-zA-Z0-9_-]/g, "-");
}

export function SelectField({ name, label, help, defaultValue, options, optionHelp, className }: {
  name: string;
  label: string;
  help?: React.ReactNode;
  defaultValue?: string;
  options: Array<[string, string]>;
  optionHelp?: Record<string, string>;
  className?: string;
}) {
  const [currentValue, setCurrentValue] = React.useState(defaultValue ?? "");
  const controlId = cleanId(name);
  return (
    <SettingRow label={label} help={help} description={optionHelp?.[currentValue]}>
      <div className={className || "w-36"}>
        <select id={controlId} name={name} defaultValue={defaultValue}
          onChange={(e) => setCurrentValue(e.target.value)}
          className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-xs transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring">
          {options.map(([value, optionLabel]) => (
            <option key={value} value={value}>{optionLabel}</option>
          ))}
        </select>
      </div>
    </SettingRow>
  );
}
