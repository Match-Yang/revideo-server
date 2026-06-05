"use client";

import { Card, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { useI18n } from "@/i18n/i18n-provider";

export function SidebarSupportCard() {
  const { t } = useI18n();

  return (
    <Card size="sm" className="shadow-none group-data-[collapsible=icon]:hidden">
      <CardHeader className="px-4">
        <CardTitle className="text-sm">{t("sidebar.rendererTitle")}</CardTitle>
        <CardDescription>{t("sidebar.rendererDescription")}</CardDescription>
      </CardHeader>
    </Card>
  );
}
