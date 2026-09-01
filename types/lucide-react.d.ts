declare module "lucide-react" {
  import type { ComponentType, SVGProps } from "react";

  type LucideIcon = ComponentType<SVGProps<SVGSVGElement> & { size?: number | string; strokeWidth?: number | string }>;

  export const CheckIcon: LucideIcon;
  export const ChevronDownIcon: LucideIcon;
  export const ClockIcon: LucideIcon;
  export const CpuIcon: LucideIcon;
  export const EyeIcon: LucideIcon;
  export const FolderIcon: LucideIcon;
  export const FolderGit2Icon: LucideIcon;
  export const FolderPlusIcon: LucideIcon;
  export const GitBranchIcon: LucideIcon;
  export const LayersIcon: LucideIcon;
  export const LayoutGridIcon: LucideIcon;
  export const LayoutListIcon: LucideIcon;
  export const PackagePlusIcon: LucideIcon;
  export const PlusIcon: LucideIcon;
  export const RefreshCwIcon: LucideIcon;
  export const SearchIcon: LucideIcon;
  export const SlidersHorizontalIcon: LucideIcon;
  export const StarIcon: LucideIcon;
  export const Trash2Icon: LucideIcon;
}
