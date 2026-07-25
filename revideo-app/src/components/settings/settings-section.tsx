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
