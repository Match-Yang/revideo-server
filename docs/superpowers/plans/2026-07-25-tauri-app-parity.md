# Tauri App Feature Parity Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Bring `revideo-app/` (Tauri v2 desktop client) to full feature parity with the `dashboard/` (Next.js web UI).

**Architecture:** The Tauri app uses React 19 + TypeScript frontend with Rust backend. The single `RevideoConsole.tsx` (499 lines) will be decomposed into focused sub-components mirroring the dashboard's 1778-line version. We port: i18n system, UI helper components, cover template engine, and all missing settings fields. The Rust backend already exposes all needed commands — only the frontend needs work.

**Tech Stack:** React 19, TypeScript, Tauri v2, shadcn/ui (base-nova), Tailwind CSS v4, @tauri-apps/api, @tauri-apps/plugin-dialog, sonner, lucide-react

**Audit reference:** `docs/audit/revideo-tauri-gap-2026-07-25.md`

---

## File Structure Map

### Files to CREATE

| File | Responsibility |
|------|---------------|
| `revideo-app/src/i18n/i18n-provider.tsx` | i18n context provider (port from dashboard) |
| `revideo-app/src/i18n/dictionaries.ts` | zh/en translation dictionaries (copy from dashboard) |
| `revideo-app/src/lib/cover-templates.ts` | Cover template SVG engine (copy from dashboard) |
| `revideo-app/src/components/settings/help-tooltip.tsx` | `?` help tooltip component |
| `revideo-app/src/components/settings/field-label.tsx` | Label + optional HelpTooltip |
| `revideo-app/src/components/settings/field-control.tsx` | Vertical field container |
| `revideo-app/src/components/settings/setting-row.tsx` | Horizontal setting row (label + help + description + control) |
| `revideo-app/src/components/settings/select-field.tsx` | SelectField with option description |
| `revideo-app/src/components/settings/label-input.tsx` | LabelInput row |
| `revideo-app/src/components/settings/wide-label-input.tsx` | WideLabelInput row |
| `revideo-app/src/components/settings/switch-row.tsx` | SwitchRow |
| `revideo-app/src/components/settings/prompt-field.tsx` | Prompt textarea field |
| `revideo-app/src/components/settings/path-field.tsx` | Path input + Tauri folder browse button |
| `revideo-app/src/components/settings/settings-section.tsx` | Section card container |
| `revideo-app/src/components/settings/cover-copy-pane.tsx` | Cover template selector with SVG preview grid |
| `revideo-app/src/components/settings/index.ts` | Barrel export |
| `revideo-app/src/components/page-header.tsx` | PageHeader (icon + title + description) |

### Files to MODIFY

| File | Changes |
|------|---------|
| `revideo-app/src/pages/RevideoConsole.tsx` | Full rewrite — use api.ts, use types.ts, use i18n, use setting sub-components, add all missing settings fields, add create dialog advanced options, add missing detail panel features |
| `revideo-app/src/App.tsx` | Wrap with I18nProvider |
| `revideo-app/src/lib/api.ts` | Add missing commands: `getPlatforms`, `restartBrowser`, `checkPlatformLogin`, `getDiscoveryStatus`, `runDiscovery` |
| `revideo-app/package.json` | Add `@tauri-apps/plugin-dialog` dependency |

### Files to READ (reference only, no changes)

| File | Purpose |
|------|---------|
| `dashboard/src/app/(main)/dashboard/_components/revideo-console.tsx` | Source of truth for all UI logic |
| `dashboard/src/lib/cover-templates.ts` | Source for cover template engine |
| `dashboard/src/i18n/i18n-provider.tsx` | Source for i18n provider |
| `dashboard/src/i18n/dictionaries.ts` | Source for translation strings |

---

## Task 1: Copy cover-templates.ts and i18n dictionaries

These are pure data/logic files — copy them, no modifications needed.

- [ ] **Step 1: Copy cover-templates.ts**

```bash
cp /Users/oliver/code/js/revideo-server/dashboard/src/lib/cover-templates.ts /Users/oliver/code/js/revideo-server/revideo-app/src/lib/cover-templates.ts
```

Verify: `head -5 /Users/oliver/code/js/revideo-server/revideo-app/src/lib/cover-templates.ts`
Expected: `// Shared cover-template engine...`

- [ ] **Step 2: Copy dictionaries.ts**

```bash
cp /Users/oliver/code/js/revideo-server/dashboard/src/i18n/dictionaries.ts /Users/oliver/code/js/revideo-server/revideo-app/src/i18n/dictionaries.ts
```

Verify: `head -5 /Users/oliver/code/js/revideo-server/revideo-app/src/i18n/dictionaries.ts`
Expected: `export const dictionaries = {`

- [ ] **Step 3: Commit**

```bash
cd /Users/oliver/code/js/revideo-server
git add revideo-app/src/lib/cover-templates.ts revideo-app/src/i18n/dictionaries.ts
git commit -m "chore(revideo-app): copy cover-templates engine and i18n dictionaries from dashboard"
```

---

## Task 2: Create i18n provider

Port the dashboard's `i18n-provider.tsx` to work with Tauri (no RSC).

- [ ] **Step 1: Create i18n provider**

Create `revideo-app/src/i18n/i18n-provider.tsx`:

```tsx
"use client";

import * as React from "react";
import { dictionaries, type Locale, type Dictionary } from "./dictionaries";

const STORAGE_KEY = "revideo.locale";

const defaultLocale: Locale = "zh";

function readNested(source: Dictionary, key: string): string {
  const keys = key.split(".");
  let current: unknown = source;
  for (const k of keys) {
    if (current && typeof current === "object" && k in (current as Record<string, unknown>)) {
      current = (current as Record<string, unknown>)[k];
    } else {
      return key;
    }
  }
  return typeof current === "string" ? current : key;
}

function format(template: string, values?: Record<string, string | number>): string {
  if (!values) return template;
  return template.replace(/\{(\w+)\}/g, (_, key) => String(values[key] ?? `{${key}}`));
}

interface I18nContextValue {
  locale: Locale;
  setLocale: (locale: Locale) => void;
  t: (key: string, values?: Record<string, string | number>) => string;
}

const I18nContext = React.createContext<I18nContextValue>({
  locale: defaultLocale,
  setLocale: () => {},
  t: (key) => key,
});

export function I18nProvider({ children }: { children: React.ReactNode }) {
  const [locale, setLocaleState] = React.useState<Locale>(() => {
    if (typeof window === "undefined") return defaultLocale;
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored === "en" || stored === "zh") return stored;
    return defaultLocale;
  });

  const setLocale = React.useCallback((next: Locale) => {
    setLocaleState(next);
    localStorage.setItem(STORAGE_KEY, next);
    document.documentElement.lang = next;
  }, []);

  React.useEffect(() => {
    document.documentElement.lang = locale;
  }, [locale]);

  const t = React.useCallback(
    (key: string, values?: Record<string, string | number>): string => {
      const text = readNested(dictionaries[locale], key);
      // Fallback to zh if current locale missing
      if (text === key && locale !== "zh") {
        return format(readNested(dictionaries.zh, key), values);
      }
      return format(text, values);
    },
    [locale],
  );

  return (
    <I18nContext.Provider value={{ locale, setLocale, t }}>
      {children}
    </I18nContext.Provider>
  );
}

export function useI18n() {
  return React.useContext(I18nContext);
}
```

- [ ] **Step 2: Commit**

```bash
cd /Users/oliver/code/js/revideo-server
git add revideo-app/src/i18n/i18n-provider.tsx
git commit -m "feat(revideo-app): add i18n provider with zh/en support"
```

---

## Task 3: Create PageHeader component

- [ ] **Step 1: Create PageHeader**

Create `revideo-app/src/components/page-header.tsx`:

```tsx
import * as React from "react";

export function PageHeader({
  icon: Icon,
  title,
  description,
  action,
}: {
  icon: React.ElementType;
  title: string;
  description: string;
  action?: React.ReactNode;
}) {
  return (
    <div className="flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
      <div className="flex items-start gap-3">
        <div className="flex size-10 items-center justify-center rounded-xl border bg-muted text-muted-foreground">
          <Icon className="size-5" />
        </div>
        <div>
          <h1 className="font-heading font-medium text-2xl tracking-tight">{title}</h1>
          <p className="mt-1 max-w-2xl text-muted-foreground text-sm">{description}</p>
        </div>
      </div>
      {action}
    </div>
  );
}
```

- [ ] **Step 2: Commit**

```bash
cd /Users/oliver/code/js/revideo-server
git add revideo-app/src/components/page-header.tsx
git commit -m "feat(revideo-app): add PageHeader component"
```

---

## Task 4: Create settings helper components

All setting sub-components in one batch — they are small and interdependent.

- [ ] **Step 1: Create HelpTooltip**

Create `revideo-app/src/components/settings/help-tooltip.tsx`:

```tsx
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";

export function HelpTooltip({ children }: { children?: React.ReactNode }) {
  if (!children) return null;
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span className="inline-flex size-4 cursor-help items-center justify-center rounded-full border text-[10px] text-muted-foreground">?</span>
      </TooltipTrigger>
      <TooltipContent className="max-w-72 text-xs">
        <p>{children}</p>
      </TooltipContent>
    </Tooltip>
  );
}
```

- [ ] **Step 2: Create FieldLabel**

Create `revideo-app/src/components/settings/field-label.tsx`:

```tsx
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
```

- [ ] **Step 3: Create FieldControl**

Create `revideo-app/src/components/settings/field-control.tsx`:

```tsx
import { FieldLabel } from "./field-label";

export function FieldControl({ label, help, children }: { label: string; help?: React.ReactNode; children: React.ReactNode }) {
  return (
    <div className="grid gap-2">
      <FieldLabel label={label} help={help} />
      {children}
    </div>
  );
}
```

- [ ] **Step 4: Create SettingRow**

Create `revideo-app/src/components/settings/setting-row.tsx`:

```tsx
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
```

- [ ] **Step 5: Create SelectField**

Create `revideo-app/src/components/settings/select-field.tsx`:

```tsx
import * as React from "react";
import { Input } from "@/components/ui/input";
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
```

- [ ] **Step 6: Create LabelInput**

Create `revideo-app/src/components/settings/label-input.tsx`:

```tsx
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
```

- [ ] **Step 7: Create WideLabelInput**

Create `revideo-app/src/components/settings/wide-label-input.tsx`:

```tsx
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
```

- [ ] **Step 8: Create SwitchRow**

Create `revideo-app/src/components/settings/switch-row.tsx`:

```tsx
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
```

- [ ] **Step 9: Create PromptField**

Create `revideo-app/src/components/settings/prompt-field.tsx`:

```tsx
import { Textarea } from "@/components/ui/textarea";
import { FieldControl } from "./field-control";

export function PromptField({ name, label, defaultValue }: { name: string; label: string; defaultValue?: string }) {
  return (
    <FieldControl label={label} help="只追加本项对应任务的额外约束；不会替代系统内置提示词。">
      <Textarea name={name} defaultValue={defaultValue} className="min-h-24 resize-y" />
    </FieldControl>
  );
}
```

- [ ] **Step 10: Create PathField**

Create `revideo-app/src/components/settings/path-field.tsx`:

```tsx
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
```

- [ ] **Step 11: Create SettingsSection**

Create `revideo-app/src/components/settings/settings-section.tsx`:

```tsx
export function SettingsSection({ title, description, children }: { title: string; description?: string; children: React.ReactNode }) {
  return (
    <div className="grid gap-0 rounded-lg border bg-card px-4 py-1">
      <div className="py-3">
        <h3 className="font-medium text-sm">{title}</h3>
        {description && <p className="mt-0.5 text-muted-foreground text-xs">{description}</p>}
      </div>
      {children}
    </div>
  );
}
```

- [ ] **Step 12: Create barrel export**

Create `revideo-app/src/components/settings/index.ts`:

```ts
export { HelpTooltip } from "./help-tooltip";
export { FieldLabel } from "./field-label";
export { FieldControl } from "./field-control";
export { SettingRow } from "./setting-row";
export { SelectField } from "./select-field";
export { LabelInput } from "./label-input";
export { WideLabelInput } from "./wide-label-input";
export { SwitchRow } from "./switch-row";
export { PromptField } from "./prompt-field";
export { PathField } from "./path-field";
export { SettingsSection } from "./settings-section";
export { CoverCopyPane } from "./cover-copy-pane";
```

- [ ] **Step 13: Commit all settings components**

```bash
cd /Users/oliver/code/js/revideo-server
git add revideo-app/src/components/settings/ revideo-app/src/components/page-header.tsx
git commit -m "feat(revideo-app): add settings helper components (SelectField, SwitchRow, PathField, etc.)"
```

---

## Task 5: Create CoverCopyPane

The most complex settings sub-component — depends on `cover-templates.ts` from Task 1.

- [ ] **Step 1: Create CoverCopyPane**

Create `revideo-app/src/components/settings/cover-copy-pane.tsx`:

```tsx
import * as React from "react";
import { CheckCircle2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  COVER_TEMPLATE_IDS,
  DEFAULT_COVER_TEMPLATE,
  buildCoverSvg,
  coverTemplateAiPrompt,
  coverTemplateFields,
  coverTemplateSampleBg,
  coverTemplateSampleText,
  isNoTemplate,
  normalizeCoverTemplateId,
} from "@/lib/cover-templates";
import { LabelInput } from "./label-input";
import { FieldControl } from "./field-control";
import { SettingRow } from "./setting-row";
import { cn } from "@/lib/utils";

function svgDataUri(svg: string) {
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
}

interface CoverCopyPaneProps {
  settings: Record<string, unknown> | null;
  getNested: (obj: unknown, path: string, fallback?: string) => string;
  onChanged?: () => void;
}

export function CoverCopyPane({ settings, getNested, onChanged }: CoverCopyPaneProps) {
  const [template, setTemplate] = React.useState(
    normalizeCoverTemplateId(getNested(settings, "task.cover.template", DEFAULT_COVER_TEMPLATE)),
  );
  const [imageMode, setImageMode] = React.useState(getNested(settings, "task.cover.image_mode", "ai"));
  const [copyMode, setCopyMode] = React.useState(getNested(settings, "task.cover.copy_mode", "ai"));
  const [aiPrompt, setAiPrompt] = React.useState(
    getNested(settings, "task.cover.ai_prompt", "") || coverTemplateAiPrompt(template),
  );
  const noTemplate = isNoTemplate(template);

  function onTemplateChange(value: string) {
    setTemplate(value);
    setAiPrompt(coverTemplateAiPrompt(value));
    window.setTimeout(() => onChanged?.(), 0);
  }

  return (
    <div className="rounded-lg border bg-card px-4 py-1">
      <input type="hidden" name="task.cover.template" value={template} />
      <div className="py-2.5">
        <div className="flex items-center gap-1.5 font-medium text-sm">
          封面模板
        </div>
        <p className="mt-0.5 text-muted-foreground text-xs">决定封面的视觉风格（配色、描边、文字样式），渲染时会真实套用所选模板。</p>
        <div className="mt-2 grid grid-cols-2 gap-3">
          {COVER_TEMPLATE_IDS.map((name) => {
            const selected = template === name;
            const svgPreview = isNoTemplate(name)
              ? null
              : buildCoverSvg(name, coverTemplateSampleText(name), { width: 480, height: 270 });

            return (
              <button
                type="button"
                key={name}
                onClick={() => onTemplateChange(name)}
                className={cn(
                  "group relative overflow-hidden rounded-lg border-2 text-left transition",
                  selected ? "border-primary ring-2 ring-primary/30" : "border-transparent hover:border-border",
                )}
              >
                <div className="flex aspect-video items-center justify-center overflow-hidden bg-zinc-900">
                  {isNoTemplate(name) ? (
                    <div
                      className="flex h-full w-full items-center justify-center font-medium text-[10px] text-zinc-500"
                      style={{ background: coverTemplateSampleBg(name) }}
                    >
                      纯画面 · 无文字
                    </div>
                  ) : (
                    <img
                      alt={`${name} 封面模板预览`}
                      className="h-full w-full object-cover"
                      src={svgDataUri(svgPreview || "")}
                      style={{ background: coverTemplateSampleBg(name), backgroundSize: "cover" }}
                    />
                  )}
                </div>
                <div className="flex items-center justify-between bg-card px-2 py-1.5 text-[11px]">
                  <span className="font-medium">{name}</span>
                  {selected && <CheckCircle2 className="size-3 text-primary" />}
                </div>
              </button>
            );
          })}
        </div>
      </div>

      <SettingRow label="封面图" help="选择封面画面的来源。" description={imageMode === "fixed" ? "使用视频中固定的某一帧作为封面画面。" : "固定抽取 5 帧交给 AI 选最佳画面；模型无多模态能力时从 5 帧中随机选 1 帧。"}>
        <div className="w-36">
          <select name="task.cover.image_mode" value={imageMode} onChange={(e) => setImageMode(e.target.value)}
            className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-xs">
            <option value="fixed">固定帧</option>
            <option value="ai">AI 选帧</option>
          </select>
        </div>
      </SettingRow>
      {imageMode === "fixed" && (
        <LabelInput label="帧编号" help="从 0 开始计数，0 表示第一帧。" name="task.cover.fixed_frame_index" type="number" min={0} defaultValue={getNested(settings, "task.cover.fixed_frame_index", "0")} className="w-28" />
      )}

      {noTemplate ? (
        <input type="hidden" name="task.cover.copy_mode" value="none" />
      ) : (
        <>
          <SettingRow label="封面文案" help="选择封面上叠加文字的来源。" description={copyMode === "none" ? "封面不叠加任何文字，仅使用画面。" : copyMode === "fixed" ? "使用下方手动填写的固定文案。" : "由 AI 根据视频内容生成封面文案，可编辑提示词。"}>
            <div className="w-36">
              <select name="task.cover.copy_mode" value={copyMode} onChange={(e) => setCopyMode(e.target.value)}
                className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-xs">
                <option value="none">无文案</option>
                <option value="fixed">固定文案</option>
                <option value="ai">AI 文案</option>
              </select>
            </div>
          </SettingRow>

          {copyMode === "fixed" && (
            <div className="grid gap-3 rounded-lg bg-muted/30 p-3 md:grid-cols-2" key={template}>
              <div className="md:col-span-2">
                <p className="text-muted-foreground text-xs">
                  当前模板需要 {coverTemplateFields(template).length} 行固定文案，输入框顺序对应预览里的文字层级和位置。
                </p>
              </div>
              {coverTemplateFields(template).map((field) => (
                <LabelInput key={field.key} label={field.label} name={`task.cover.copy_lines.${field.key}`} placeholder={field.placeholder} defaultValue={getNested(settings, `task.cover.copy_lines.${field.key}`, "")} className="w-full" />
              ))}
            </div>
          )}

          {copyMode === "ai" && (
            <FieldControl label="AI 文案提示词" help="作为封面文案生成的额外约束；每个模板有默认提示词，可自行修改。">
              <Textarea name="task.cover.ai_prompt" value={aiPrompt} onChange={(e) => setAiPrompt(e.target.value)} className="min-h-24 resize-y" />
            </FieldControl>
          )}
        </>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Commit**

```bash
cd /Users/oliver/code/js/revideo-server
git add revideo-app/src/components/settings/cover-copy-pane.tsx
git commit -m "feat(revideo-app): add CoverCopyPane with SVG template preview grid"
```

---

## Task 6: Update api.ts with missing commands

- [ ] **Step 1: Add missing Tauri commands to api.ts**

Add to `revideo-app/src/lib/api.ts` (after the existing browser section):

```ts
// ── Missing commands ──

export async function restartBrowser(): Promise<void> {
  return invoke<void>("restart_browser");
}

export async function checkPlatformLogin(platform: string): Promise<{ logged_in: boolean }> {
  return invoke<{ logged_in: boolean }>("check_platform_login", { platform });
}

export interface DiscoveryStatus {
  last_run_at: string | null;
  last_status: string;
  stats: Record<string, number>;
  errors: string[];
}

export async function getDiscoveryStatus(): Promise<DiscoveryStatus> {
  return invoke<DiscoveryStatus>("get_discovery_status");
}

export async function runDiscovery(): Promise<string> {
  return invoke<string>("run_discovery");
}

export interface PlatformInfo {
  source: string[];
  target: string[];
}

export async function getPlatforms(): Promise<PlatformInfo> {
  return invoke<PlatformInfo>("get_platforms");
}
```

- [ ] **Step 2: Commit**

```bash
cd /Users/oliver/code/js/revideo-server
git add revideo-app/src/lib/api.ts
git commit -m "feat(revideo-app): add missing Tauri commands to api.ts"
```

---

## Task 7: Install @tauri-apps/plugin-dialog

- [ ] **Step 1: Install dialog plugin**

```bash
cd /Users/oliver/code/js/revideo-server/revideo-app
npm install @tauri-apps/plugin-dialog
```

Verify: `grep plugin-dialog package.json`

- [ ] **Step 2: Add dialog plugin to Cargo.toml**

Check `revideo-app/src-tauri/Cargo.toml` for existing plugin dependencies. Add if missing:

```bash
cd /Users/oliver/code/js/revideo-server/revideo-app/src-tauri
grep -q "tauri-plugin-dialog" Cargo.toml || cargo add tauri-plugin-dialog
```

- [ ] **Step 3: Register plugin in main.rs**

Check `revideo-app/src-tauri/src/main.rs`. If there's a plugin registration block, add:
```rust
tauri_plugin_dialog::init(),
```

- [ ] **Step 4: Commit**

```bash
cd /Users/oliver/code/js/revideo-server
git add revideo-app/package.json revideo-app/package-lock.json revideo-app/src-tauri/Cargo.toml revideo-app/src-tauri/src/main.rs
git commit -m "feat(revideo-app): add @tauri-apps/plugin-dialog for folder picker"
```

---

## Task 8: Wrap App with I18nProvider and clean up App.tsx

- [ ] **Step 1: Update App.tsx**

Replace `revideo-app/src/App.tsx` with:

```tsx
import { useEffect } from "react";
import { Routes, Route, Link, useLocation } from "react-router-dom";
import { Video, Settings, HeartPulse, Send } from "lucide-react";
import { TooltipProvider } from "@/components/ui/tooltip";
import { Toaster } from "sonner";
import { I18nProvider, useI18n } from "@/i18n/i18n-provider";
import RevideoConsole from "@/pages/RevideoConsole";
import { cn } from "@/lib/utils";
import * as api from "@/lib/api";

const navItems = [
  { to: "/", labelKey: "sidebar.jobs", icon: Video },
  { to: "/publishing", labelKey: "sidebar.publishing", icon: Send },
  { to: "/health", labelKey: "sidebar.health", icon: HeartPulse },
  { to: "/settings", labelKey: "sidebar.settings", icon: Settings },
];

function Layout() {
  const location = useLocation();
  const { t } = useI18n();
  return (
    <div className="flex h-screen">
      <aside className="w-52 border-r border-border flex flex-col bg-muted/30 shrink-0">
        <div className="p-4 font-bold text-lg text-primary">Revideo</div>
        <nav className="flex-1 px-2 space-y-1">
          {navItems.map(({ to, labelKey, icon: Icon }) => {
            const active = location.pathname === to || (to !== "/" && location.pathname.startsWith(to));
            return (
              <Link key={to} to={to}
                className={cn("flex items-center gap-3 px-3 py-2 rounded-md text-sm transition",
                  active ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-muted hover:text-foreground")}>
                <Icon className="w-4 h-4" />{t(labelKey)}
              </Link>
            );
          })}
        </nav>
      </aside>
      <main className="flex-1 overflow-auto p-6">
        <AppOutlet />
      </main>
    </div>
  );
}

function AppOutlet() {
  const location = useLocation();
  if (location.pathname === "/publishing") return <RevideoConsole view="publishing" />;
  if (location.pathname === "/health") return <RevideoConsole view="health" />;
  if (location.pathname === "/settings") return <RevideoConsole view="settings" />;
  return <RevideoConsole view="jobs" />;
}

function AppInner() {
  useEffect(() => {
    api.initApp().then(r => console.log("[init]", r)).catch(e => console.error("[init]", e));
  }, []);

  return (
    <TooltipProvider>
      <Toaster richColors position="top-right" />
      <Routes>
        <Route element={<Layout />}>
          <Route path="/*" element={<AppOutlet />} />
        </Route>
      </Routes>
    </TooltipProvider>
  );
}

export default function App() {
  return (
    <I18nProvider>
      <AppInner />
    </I18nProvider>
  );
}
```

- [ ] **Step 2: Commit**

```bash
cd /Users/oliver/code/js/revideo-server
git add revideo-app/src/App.tsx
git commit -m "feat(revideo-app): wrap App with I18nProvider, use i18n for sidebar labels"
```

---

## Task 9: Rewrite RevideoConsole — Part 1 (Infrastructure + Jobs View)

This is the main rewrite. The file grows from 499 to ~1200+ lines. We do it in parts to keep commits manageable.

- [ ] **Step 1: Replace the first half of RevideoConsole.tsx**

Replace everything from line 1 through line 100 (the imports, types, helpers, and main component state/effect setup) in `revideo-app/src/pages/RevideoConsole.tsx` with the updated version that:

1. Uses `api.ts` instead of raw `invoke()` calls
2. Uses `types.ts` types instead of inline types
3. Uses `useI18n()` for all user-facing text
4. Adds `publishing` to status filter options
5. Adds duplicate URL detection in the create dialog
6. Resets page to 1 when filters change
7. Shows draft title in the jobs table
8. Shows error in workflow step detail
9. Shows `targetCommentCount` badge in detail
10. Uses `canPause`/`canResume`/`canRetry` logic for action buttons
11. Adds `PageHeader` to Publishing and Health views
12. Adds detailed dependency info to Health view
13. Keeps Tauri-specific features (cover image preview, progress event block, `convertFileSrc`)

The full replacement content is too large for inline listing here. Key changes from the current version:

**Imports — add:**
```tsx
import * as api from "@/lib/api";
import { useI18n } from "@/i18n/i18n-provider";
import { PageHeader } from "@/components/page-header";
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "@/components/ui/accordion";
import { Checkbox } from "@/components/ui/checkbox";
```

**Constants — add (from dashboard):**
```tsx
const languages = ["zh-CN", "en", "ja", "ko", "es", "fr", "de", "ru"];
const styleConstraintOptions = ["自然口语", "保守直译", "短视频口吻", "新闻解说", "专业测评", "夸张吸睛", "幽默吐槽", "克制高级", "本土化表达", "保留原文语气", "适合 B 站", "适合抖音", "适合小红书", "适合 YouTube"];
const resolutionOptions: Array<[string, string]> = [["auto", "自动"], ["best", "最高清"], ["8k", "8K"], ["4k", "4K"], ["2k", "2K"], ["1080p", "1080p"], ["720p", "720p"], ["480p", "480p"]];
const resolutionOptionHelp = { auto: "由系统自动选择最合适的分辨率。", best: "使用可用的最高分辨率。", "8k": "目标 8K（4320p），不存在则向下兼容更低分辨率。", "4k": "目标 4K（2160p），不存在则向下兼容更低分辨率。", "2k": "目标 2K（1440p），不存在则向下兼容更低分辨率。", "1080p": "目标 1080p，不存在则向下兼容更低分辨率。", "720p": "目标 720p，不存在则向下兼容更低分辨率。", "480p": "目标 480p，不存在则向下兼容更低分辨率。" };
```

**Derived status — use dashboard's more comprehensive logic:**
- Add `scheduled` status support
- Add `publishing` status for jobs with targets in publishing state
- Detect `cancelled` state

**Page reset on filter change:**
```tsx
React.useEffect(() => setPage(1), [query, statusFilter, pageSize]);
```

**Duplicate URL detection in create dialog:**
```tsx
const trimmed = sourceUrl.trim();
const dup = trimmed ? jobs.find((j) => j.source.url === trimmed) : undefined;
```

**Status filter — add `publishing`:**
```tsx
{["all","running","publishing","paused","completed","failed"].map(s =>
  <option key={s} value={s}>{t(`status.${s}`)}</option>
)}
```

**Detail panel — add error display + comment count:**
```tsx
{selectedJob.workflow.steps[step]?.error && (
  <p className="mt-2 break-words text-destructive text-xs">{selectedJob.workflow.steps[step].error}</p>
)}
```
```tsx
<Badge variant="outline">{t("jobs.comments")} {selectedJob.options.target_comment_count ?? "-"}</Badge>
```

**Health view — detailed dependencies:**
Instead of boolean checks, iterate over the health response and show name + version + error.

**Publishing view — add PageHeader + CardHeader:**
```tsx
<PageHeader icon={Rocket} title={t("page.publishingTitle")} description={t("page.publishingDescription")} />
```

- [ ] **Step 2: Commit Jobs/Publishing/Health rewrite**

```bash
cd /Users/oliver/code/js/revideo-server
git add revideo-app/src/pages/RevideoConsole.tsx
git commit -m "feat(revideo-app): rewrite Jobs/Publishing/Health views with i18n, duplicate detection, error display"
```

---

## Task 10: Rewrite RevideoConsole — Part 2 (Create Dialog Advanced Options)

Add the Accordion-based advanced options section to the create dialog.

- [ ] **Step 1: Add translation accordion to create dialog**

Inside the create dialog form, after the core options section, add (matching dashboard lines 814-873):

```tsx
{/* Advanced collapsible sections */}
<div className="px-4 py-2">
  <div className="mb-2 px-2">
    <span className="select-none text-muted-foreground text-xs">{t("create.advancedOptions")}</span>
  </div>
  <Accordion type="multiple" defaultValue={[]} className="grid gap-1.5">
    <AccordionItem value="translation" className="rounded-lg border bg-card px-4">
      <AccordionTrigger className="items-center gap-3 text-left hover:no-underline py-3">
        <div className="flex min-w-0 items-center gap-3">
          <span className="flex shrink-0 items-center justify-center rounded-lg bg-muted text-muted-foreground size-6">
            <Globe className="size-3" />
          </span>
          <div className="min-w-0">
            <div className="font-medium text-sm">{t("create.translation")}</div>
            <div className="mt-0.5 text-muted-foreground text-xs">{t("create.translationDescription")}</div>
          </div>
        </div>
      </AccordionTrigger>
      <AccordionContent className="grid gap-1 px-2 pb-3">
        {/* Target Language */}
        <div className="flex items-center gap-4 py-2.5">
          <div className="flex w-40 shrink-0 items-center gap-2 text-muted-foreground text-sm">
            <Globe className="size-4" /><span className="whitespace-nowrap">{t("create.targetLanguage")}</span>
          </div>
          <div className="flex min-w-0 flex-1 items-center gap-2">
            <select name="targetLanguage" defaultValue="zh-CN" className="flex h-9 w-full max-w-40 rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-xs">
              {languages.map((code) => <option key={code} value={code}>{t(`languages.${code}`)}</option>)}
            </select>
          </div>
        </div>
        {/* Subtitle Mode */}
        <div className="flex items-center gap-4 py-2.5">
          <div className="flex w-40 shrink-0 items-center gap-2 text-muted-foreground text-sm">
            <Globe className="size-4" /><span className="whitespace-nowrap">{t("create.subtitleMode")}</span>
          </div>
          <select name="subtitleMode" defaultValue="auto" className="flex h-9 w-full max-w-40 rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-xs">
            <option value="auto">{t("create.auto")}</option>
            <option value="always">{t("create.alwaysTranslate")}</option>
            <option value="off">{t("create.noTranslate")}</option>
          </select>
        </div>
        {/* Comment Mode */}
        <div className="flex items-center gap-4 py-2.5">
          <div className="flex w-40 shrink-0 items-center gap-2 text-muted-foreground text-sm">
            <MessageSquare className="size-4" /><span className="whitespace-nowrap">{t("create.commentMode")}</span>
          </div>
          <select name="commentMode" defaultValue="auto" className="flex h-9 w-full max-w-40 rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-xs">
            <option value="auto">{t("create.auto")}</option>
            <option value="always">{t("create.alwaysTranslate")}</option>
            <option value="off">{t("create.noTranslate")}</option>
          </select>
        </div>
        {/* Sensitive Content */}
        <div className="flex items-center gap-4 py-2.5">
          <div className="flex w-40 shrink-0 items-center gap-2 text-muted-foreground text-sm">
            <SlidersHorizontal className="size-4" /><span className="whitespace-nowrap">{t("create.sensitiveContent")}</span>
          </div>
          <select name="sensitiveContent" defaultValue="preserve" className="flex h-9 w-full max-w-40 rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-xs">
            <option value="preserve">{t("create.preserve")}</option>
            <option value="soften">{t("create.soften")}</option>
            <option value="mark">{t("create.mark")}</option>
            <option value="delete">{t("create.delete")}</option>
          </select>
        </div>
        {/* Bilingual */}
        <div className="flex items-center gap-4 py-2.5">
          <div className="flex w-40 shrink-0 items-center gap-2 text-muted-foreground text-sm">
            <Globe className="size-4" /><span className="whitespace-nowrap">{t("create.bilingualSubtitles")}</span>
          </div>
          <Switch name="bilingualSubtitles" defaultChecked={false} />
        </div>
        {/* Style Constraints */}
        <div className="flex items-center gap-4 py-2.5">
          <div className="flex w-40 shrink-0 items-center gap-2 text-muted-foreground text-sm">
            <SlidersHorizontal className="size-4" /><span className="whitespace-nowrap">{t("create.styleConstraints")}</span>
          </div>
          <Input name="styleConstraints" defaultValue="自然口语，本土化表达" placeholder={styleConstraintOptions.join("，")} className="max-w-xs" />
        </div>
        {/* Advanced Prompts (collapsible) */}
        <div className="rounded-lg border bg-muted/20 px-3">
          <button type="button" className="flex w-full items-center justify-between py-3 font-medium text-sm"
            onClick={() => setPromptPanelOpen((open) => !open)}>
            <span>{t("create.advancedPrompts")}</span>
            <ChevronDown className={cn("size-4 text-muted-foreground transition-transform", promptPanelOpen && "rotate-180")} />
          </button>
          {promptPanelOpen && (
            <div className="grid gap-3 pb-3">
              <div className="grid gap-2">
                <Label htmlFor="promptSubtitle">{t("create.subtitlePrompt")}</Label>
                <Textarea id="promptSubtitle" name="promptSubtitle" defaultValue="" className="min-h-16 resize-y" />
              </div>
              <div className="grid gap-2">
                <Label htmlFor="promptComment">{t("create.commentPrompt")}</Label>
                <Textarea id="promptComment" name="promptComment" defaultValue="" className="min-h-16 resize-y" />
              </div>
            </div>
          )}
        </div>
      </AccordionContent>
    </AccordionItem>
  </Accordion>
</div>
```

Add `MessageSquare` and `ChevronDown` to imports, and `promptPanelOpen` state.

- [ ] **Step 2: Commit**

```bash
cd /Users/oliver/code/js/revideo-server
git add revideo-app/src/pages/RevideoConsole.tsx
git commit -m "feat(revideo-app): add create dialog advanced translation options (accordion)"
```

---

## Task 11: Rewrite RevideoConsole — Part 3 (Settings — Discovery + Download + Prepare)

Replace the Settings view's discovery, download, and prepare sections with full-featured versions matching the dashboard.

- [ ] **Step 1: Replace settings — discovery section**

The discovery section should have 8 sub-sections:
1. 启用开关 (`SwitchRow` for `task.discovery.enabled`)
2. 监控频道 (`Textarea` for `task.discovery.channels`)
3. 硬性过滤 (min views, min comments, max age — `LabelInput`)
4. 语义过滤 (`PromptField` for `task.discovery.semantic_filter_prompt`)
5. 渲染参数 (maxDurationSec, repeatTimes — `LabelInput`)
6. 定时 (scheduleHour — `LabelInput`)
7. 目标平台 (Checkbox list for bilibili/douyin/youtube/tiktok)
8. 手动触发 (Button + running status + detailed run record with stats/createdJobIds/errors)

Discovery running state should poll at 5s intervals while running.

- [ ] **Step 2: Replace settings — download section**

Full download section with:
1. `PathField` for `task.storage.task_data_dir`
2. `SelectField` for `task.download.video_quality` (8 options with help)
3. `LabelInput` for `task.download.comment_seconds`
4. `LabelInput` for `task.download.max_comments`
5. `LabelInput` for `task.download.retry_count`
6. `LabelInput` for `task.download.timeout_sec`

- [ ] **Step 3: Replace settings — prepare section**

Full prepare section with:
1. `SelectField` for `task.prepare.output_aspect` (portrait/landscape/source with help)
2. `SelectField` for `task.prepare.output_resolution` (8 options with help)
3. `SelectField` for `task.prepare.fit_mode` (smart-crop/blur-background/keep-bars/center-crop with help)
4. `SelectField` for `task.prepare.subtitle_cleanup` (merge-short/keep with help)

- [ ] **Step 4: Commit**

```bash
cd /Users/oliver/code/js/revideo-server
git add revideo-app/src/pages/RevideoConsole.tsx
git commit -m "feat(revideo-app): full Discovery/Download/Prepare settings with all fields and help tooltips"
```

---

## Task 12: Rewrite RevideoConsole — Part 4 (Settings — Translation + Cover + Render)

- [ ] **Step 1: Replace settings — translation section**

Full translation section with:
1. `SelectField` for `task.translation.target_language` (8 languages with i18n labels)
2. `SelectField` for `task.translation.subtitle_mode` (auto/always/off with help)
3. `SelectField` for `task.translation.comment_mode` (auto/always/off with help)
4. `SwitchRow` for `task.translation.bilingual_subtitles`
5. `SelectField` for `task.translation.sensitive_content` (preserve/soften/mark/delete with help)
6. `Input` for `task.translation.style_constraints` (placeholder = styleConstraintOptions)
7. `PromptField` for `task.translation.subtitle_prompt_override`
8. `PromptField` for `task.translation.comment_prompt_override`

- [ ] **Step 2: Replace settings — cover section**

Replace simple input with `CoverCopyPane` component:

```tsx
{activeSettings === "cover" && (
  <CoverCopyPane settings={settings} getNested={getNested} onChanged={() => { if (formRef.current) scheduleSave(formRef.current, 300); }} />
)}
```

- [ ] **Step 3: Replace settings — render section**

Full render section with:
1. `PathField` for `task.render.output_dir`
2. `SwitchRow` for `task.render.render_comments`
3. `SelectField` for `task.render.comment_font_size` (small/medium/large with help)
4. `SelectField` for `task.render.comment_content` (full/truncated/summary with help)
5. `LabelInput` for `task.render.repeat_times`
6. `SelectField` for `task.render.output_format` (mp4/mov with help)

Note: The Rust `types.ts` has `RenderSettings` with fields `comment_font_size`, `comment_content`, `repeat_times`, `output_format`. Verify field names match. If Rust uses different names, use those instead.

- [ ] **Step 4: Commit**

```bash
cd /Users/oliver/code/js/revideo-server
git add revideo-app/src/pages/RevideoConsole.tsx
git commit -m "feat(revideo-app): full Translation/Cover/Render settings with CoverCopyPane"
```

---

## Task 13: Rewrite RevideoConsole — Part 5 (Settings — Publish + LLM + Agent)

- [ ] **Step 1: Replace settings — publish section**

Full publish section per platform with:
1. **通用** section: enabled switch (controlled state + auto-save), defaultAction SelectField (draft/publish), retryCount LabelInput
2. **平台特殊配置** section per platform — implement all 7 platforms:
   - Bilibili: category (SelectField with 28 options), declaration (SelectField with 7 options), tags (LabelInput)
   - Douyin: declarationType (SelectField), visibility (SelectField), topics (LabelInput)
   - Xiaohongshu: visibility (SelectField), topics (LabelInput)
   - YouTube: category (LabelInput), visibility (SelectField), tags (LabelInput)
   - TikTok: privacy (SelectField), allowComment (SwitchRow), allowDuet (SwitchRow), allowStitch (SwitchRow), isAigc (SwitchRow)
   - Instagram: visibility (SelectField), hashtags (LabelInput)
   - X: replySettings (SelectField), isSensitive (SwitchRow), hashtags (LabelInput)
3. **额外提示词**: title_prompt, description_prompt, tags_prompt PromptField x3

All field names must match the Rust `PlatformPublishConfig` type. The current `types.ts` has a simplified `PlatformPublishConfig` — it may need to be extended if the Rust side supports all fields. Check `crates/revideo-core/types.rs` for the full Rust type.

If the Rust backend doesn't support all these fields yet, skip the ones not in the Rust type and add a TODO comment.

- [ ] **Step 2: Replace settings — LLM section**

Full LLM section with:
1. `WideLabelInput` for `llm.api_base`
2. `WideLabelInput` for `llm.text_model`
3. `WideLabelInput` for `llm.api_key` (password type)

Keep the Tauri-only `vision_model` field if the Rust backend supports it.

- [ ] **Step 3: Replace settings — Agent section**

Full Agent section with:
1. Read-only Textarea containing `AGENT_INSTRUCTION` constant (copy from dashboard)
2. Copy button that copies to clipboard
3. Help text below

The `AGENT_INSTRUCTION` constant (from dashboard lines 233-255):
```ts
const AGENT_INSTRUCTION = `请按以下步骤帮我安装并配置 Revideo 视频搬运服务，完成后告诉我。

1. 安装服务
Linux / macOS：
curl -fsSL https://raw.githubusercontent.com/Match-Yang/revideo-server/main/install.sh | bash
Windows (PowerShell)：
iex (irm https://raw.githubusercontent.com/Match-Yang/revideo-server/main/install.ps1)
（脚本会自动安装 Node.js、yt-dlp、ffmpeg 并启动服务，端口 6688）

2. 将 Revideo 接入你的 MCP 配置：
{
  "mcpServers": {
    "revideo": {
      "url": "http://localhost:6688/mcp"
    }
  }
}

3. 打开 http://localhost:6688 ，在「设置 → LLM」里填好兼容 OpenAI 格式的 URL、模型名和 API Key。

配置完成后，我就能通过 MCP 的 submit_video_job 等工具，自动完成视频下载、翻译、渲染和发布。

项目地址：https://github.com/Match-Yang/revideo-server`;
```

- [ ] **Step 4: Add debounced settings save**

Replace the instant `saveSettingsForm()` with a debounced version:

```tsx
const saveTimerRef = React.useRef<ReturnType<typeof setTimeout> | null>(null);

function scheduleSave(form: HTMLFormElement, delay = 700) {
  if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
  saveTimerRef.current = setTimeout(() => saveSettingsForm(form), delay);
}
```

Use `onChange={(e) => scheduleSave(e.currentTarget)}` on the form instead of the instant save.

- [ ] **Step 5: Commit**

```bash
cd /Users/oliver/code/js/revideo-server
git add revideo-app/src/pages/RevideoConsole.tsx
git commit -m "feat(revideo-app): full Publish/LLM/Agent settings with per-platform configs and debounced save"
```

---

## Task 14: Verify and type-check

- [ ] **Step 1: Run TypeScript type check**

```bash
cd /Users/oliver/code/js/revideo-server/revideo-app
npx tsc --noEmit 2>&1 | head -50
```

Fix any type errors found.

- [ ] **Step 2: Run Vite build**

```bash
cd /Users/oliver/code/js/revideo-server/revideo-app
npx vite build 2>&1 | tail -20
```

Fix any build errors found.

- [ ] **Step 3: Cross-reference with gap audit**

Open `docs/audit/revideo-tauri-gap-2026-07-25.md` and verify every item in P0 and P1 is addressed. Any remaining items should be documented as known gaps.

- [ ] **Step 4: Commit any fixes**

```bash
cd /Users/oliver/code/js/revideo-server
git add -A
git commit -m "fix(revideo-app): resolve type errors and build issues from parity rewrite"
```

---

## Task 15: Final review and documentation update

- [ ] **Step 1: Update the gap audit with status**

Add "已修复" markers to items in `docs/audit/revideo-tauri-gap-2026-07-25.md` that are now resolved, and note any items that remain open with reasons.

- [ ] **Step 2: Commit**

```bash
cd /Users/oliver/code/js/revideo-server
git add docs/audit/revideo-tauri-gap-2026-07-25.md
git commit -m "docs(audit): update tauri gap audit with resolved items"
```
