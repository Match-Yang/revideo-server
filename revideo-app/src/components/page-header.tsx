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
