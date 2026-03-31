import {
  Activity,
  ClipboardList,
  GalleryVerticalEnd,
  HeartPulse,
  Rocket,
  Settings,
  type LucideIcon,
} from "lucide-react";

export interface NavSubItem {
  title: string;
  titleKey?: string;
  url: string;
  icon?: LucideIcon;
  comingSoon?: boolean;
  newTab?: boolean;
  isNew?: boolean;
}

export interface NavMainItem {
  title: string;
  titleKey?: string;
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
  labelKey?: string;
  items: NavMainItem[];
}

export const sidebarItems: NavGroup[] = [
  {
    id: 1,
    label: "Operations",
    labelKey: "sidebar.operations",
    items: [
      {
        title: "Jobs",
        titleKey: "sidebar.jobs",
        url: "/dashboard/jobs",
        icon: ClipboardList,
      },
      {
        title: "Publishing",
        titleKey: "sidebar.publishing",
        url: "/dashboard/publishing",
        icon: Rocket,
      },
    ],
  },
  {
    id: 2,
    label: "System",
    labelKey: "sidebar.system",
    items: [
      {
        title: "Health",
        titleKey: "sidebar.health",
        url: "/dashboard/health",
        icon: HeartPulse,
      },
      {
        title: "Settings",
        titleKey: "sidebar.settings",
        url: "/dashboard/settings",
        icon: Settings,
      },
    ],
  },
  {
    id: 3,
    label: "Artifacts",
    labelKey: "sidebar.artifacts",
    items: [
      {
        title: "Rendered files",
        titleKey: "sidebar.renderedFiles",
        url: "/out",
        icon: GalleryVerticalEnd,
        newTab: true,
      },
      {
        title: "API health",
        titleKey: "sidebar.apiHealth",
        url: "/api/health",
        icon: Activity,
        newTab: true,
      },
    ],
  },
];
