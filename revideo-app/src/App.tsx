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
