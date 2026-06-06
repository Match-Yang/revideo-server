"use client";

import Link from "next/link";

import { Button } from "@/components/ui/button";
import { useI18n } from "@/i18n/i18n-provider";

export default function Page() {
  const { t } = useI18n();

  return (
    <main className="flex min-h-svh items-center justify-center bg-background p-6">
      <div className="grid gap-4 text-center">
        <div>
          <h1 className="font-heading font-medium text-3xl tracking-tight">Revideo Console</h1>
          <p className="mt-2 text-muted-foreground text-sm">{t("openWorkflowDashboard")}</p>
        </div>
        <Button asChild>
          <Link href="/dashboard/jobs">{t("enterDashboard")}</Link>
        </Button>
      </div>
    </main>
  );
}
