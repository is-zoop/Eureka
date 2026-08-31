declare module "lucide-react" {
  import type { ComponentType, SVGProps } from "react";

  type LucideIcon = ComponentType<SVGProps<SVGSVGElement> & { size?: number | string; strokeWidth?: number | string }>;

  export const CheckIcon: LucideIcon;
  export const ChevronDownIcon: LucideIcon;
  export const FolderIcon: LucideIcon;
  export const FolderGit2Icon: LucideIcon;
  export const FolderPlusIcon: LucideIcon;
  export const GitBranchIcon: LucideIcon;
  export const PlusIcon: LucideIcon;
  export const Trash2Icon: LucideIcon;
}
