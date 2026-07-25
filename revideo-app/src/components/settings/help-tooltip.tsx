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
