import { Switch } from "@/components/ui/switch";
import { SettingRow } from "./setting-row";

function cleanId(value: string) {
  return value.replace(/[^a-zA-Z0-9_-]/g, "-");
}

export function SwitchRow({ label, name, defaultChecked, help }: { label: string; name: string; defaultChecked?: boolean; help?: React.ReactNode }) {
  const controlId = cleanId(name);
  return (
    <SettingRow label={label} help={help}>
      <Switch id={controlId} name={name} defaultChecked={defaultChecked} />
    </SettingRow>
  );
}
