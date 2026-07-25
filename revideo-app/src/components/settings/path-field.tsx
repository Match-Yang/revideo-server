import * as React from "react";
import { open } from "@tauri-apps/plugin-dialog";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { FolderOpen } from "lucide-react";
import { SettingRow } from "./setting-row";

export function PathField({ label, help, name, defaultValue, onChanged }: {
  label: string;
  help?: React.ReactNode;
  name: string;
  defaultValue?: string;
  onChanged?: () => void;
}) {
  const [value, setValue] = React.useState(defaultValue ?? "");
  async function browse() {
    try {
      const selected = await open({ directory: true, multiple: false });
      if (selected) {
        setValue(String(selected));
        onChanged?.();
      }
    } catch { /* ignore */ }
  }
  return (
    <SettingRow label={label} help={help}>
      <div className="flex items-center gap-1.5">
        <Input name={name} value={value} onChange={(e) => setValue(e.target.value)} className="w-56" />
        <Button type="button" variant="outline" size="sm" onClick={browse} title="选择文件夹">
          <FolderOpen className="size-3.5" />
        </Button>
      </div>
    </SettingRow>
  );
}
