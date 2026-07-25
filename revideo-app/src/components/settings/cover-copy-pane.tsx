import * as React from "react";
import { CheckCircle2 } from "lucide-react";
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
        <div className="flex items-center gap-1.5 font-medium text-sm">封面模板</div>
        <p className="mt-0.5 text-muted-foreground text-xs">决定封面的视觉风格（配色、描边、文字样式），渲染时会真实套用所选模板。</p>
        <div className="mt-2 grid grid-cols-2 gap-3">
          {COVER_TEMPLATE_IDS.map((name) => {
            const selected = template === name;
            const svgPreview = isNoTemplate(name)
              ? null
              : buildCoverSvg(name, coverTemplateSampleText(name), { width: 480, height: 270 });
            return (
              <button type="button" key={name} onClick={() => onTemplateChange(name)}
                className={cn(
                  "group relative overflow-hidden rounded-lg border-2 text-left transition",
                  selected ? "border-primary ring-2 ring-primary/30" : "border-transparent hover:border-border",
                )}>
                <div className="flex aspect-video items-center justify-center overflow-hidden bg-zinc-900">
                  {isNoTemplate(name) ? (
                    <div className="flex h-full w-full items-center justify-center font-medium text-[10px] text-zinc-500"
                      style={{ background: coverTemplateSampleBg(name) }}>
                      纯画面 · 无文字
                    </div>
                  ) : (
                    <img alt={`${name} 封面模板预览`} className="h-full w-full object-cover"
                      src={svgDataUri(svgPreview || "")}
                      style={{ background: coverTemplateSampleBg(name), backgroundSize: "cover" }} />
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