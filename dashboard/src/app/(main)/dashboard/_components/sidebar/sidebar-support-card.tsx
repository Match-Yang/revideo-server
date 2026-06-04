import { Card, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

export function SidebarSupportCard() {
  return (
    <Card size="sm" className="shadow-none group-data-[collapsible=icon]:hidden">
      <CardHeader className="px-4">
        <CardTitle className="text-sm">FFmpeg renderer active</CardTitle>
        <CardDescription>
          Download, translate, render, draft, preflight, and publish from a single queue.
        </CardDescription>
      </CardHeader>
    </Card>
  );
}
