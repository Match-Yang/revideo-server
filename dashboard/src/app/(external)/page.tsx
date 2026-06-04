import Link from "next/link";

import { Button } from "@/components/ui/button";

export default function Page() {
  return (
    <main className="flex min-h-svh items-center justify-center bg-background p-6">
      <div className="grid gap-4 text-center">
        <div>
          <h1 className="font-heading text-3xl font-medium tracking-tight">Revideo Console</h1>
          <p className="mt-2 text-muted-foreground text-sm">Open the workflow dashboard.</p>
        </div>
        <Button asChild>
          <Link href="/dashboard/default">Enter dashboard</Link>
        </Button>
      </div>
    </main>
  );
}
