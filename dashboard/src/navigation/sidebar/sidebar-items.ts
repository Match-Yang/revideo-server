import {
  Activity,
  Bot,
  ClipboardList,
  GalleryVerticalEnd,
  GitBranch,
  HeartPulse,
  LayoutDashboard,
  Rocket,
  Settings,
  type LucideIcon,
} from "lucide-react";

export interface NavSubItem {
  title: string;
  url: string;
  icon?: LucideIcon;
  comingSoon?: boolean;
  newTab?: boolean;
  isNew?: boolean;
}

export interface NavMainItem {
  title: string;
  url: string;
  icon?: LucideIcon;
  subItems?: NavSubItem[];
  comingSoon?: boolean;
  newTab?: boolean;
  isNew?: boolean;
}

export interface NavGroup {
  id: number;
  label?: string;
  items: NavMainItem[];
}

export const sidebarItems: NavGroup[] = [
  {
    id: 1,
    label: "Operations",
    items: [
      {
        title: "Overview",
        url: "/dashboard/default",
        icon: LayoutDashboard,
      },
      {
        title: "Jobs",
        url: "/dashboard/jobs",
        icon: ClipboardList,
      },
      {
        title: "Queue",
        url: "/dashboard/queue",
        icon: GitBranch,
      },
      {
        title: "Publishing",
        url: "/dashboard/publishing",
        icon: Rocket,
      },
    ],
  },
  {
    id: 2,
    label: "System",
    items: [
      {
        title: "Health",
        url: "/dashboard/health",
        icon: HeartPulse,
      },
      {
        title: "Browser",
        url: "/dashboard/browser",
        icon: Bot,
      },
      {
        title: "Settings",
        url: "/dashboard/settings",
        icon: Settings,
      },
    ],
  },
  {
    id: 3,
    label: "Artifacts",
    items: [
      {
        title: "Rendered files",
        url: "/out",
        icon: GalleryVerticalEnd,
        newTab: true,
      },
      {
        title: "API health",
        url: "/api/health",
        icon: Activity,
        newTab: true,
      },
    ],
  },
];
