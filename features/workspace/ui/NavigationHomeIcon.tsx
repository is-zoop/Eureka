"use client";

import type { ComponentProps } from "react";
import { MorphIcon } from "morphicons/react";

type IconData = NonNullable<ComponentProps<typeof MorphIcon>["icon"]>;

// Heroicons 24px home outline (MIT).
const HOME_OUTLINE: IconData = [
  ["path", { d: "m2.25 12 8.954-8.955c.44-.439 1.152-.439 1.591 0L21.75 12M4.5 9.75v10.125c0 .621.504 1.125 1.125 1.125H9.75v-4.875c0-.621.504-1.125 1.125-1.125h2.25c.621 0 1.125.504 1.125 1.125V21h4.125c.621 0 1.125-.504 1.125-1.125V9.75M8.25 21h8.25" }],
];

// Heroicons 24px solid home (MIT); preserve the separate roof and doorway.
const HOME_FILLED: IconData = [
  ["path", { fill: "currentColor", d: "M11.47 3.841a.75.75 0 0 1 1.06 0l8.69 8.69a.75.75 0 1 0 1.06-1.061l-8.689-8.69a2.25 2.25 0 0 0-3.182 0l-8.69 8.69a.75.75 0 1 0 1.061 1.06l8.69-8.689Z" }],
  ["path", { fill: "currentColor", d: "m12 5.432 8.159 8.159c.03.03.06.058.091.086v6.198c0 1.035-.84 1.875-1.875 1.875H15a.75.75 0 0 1-.75-.75v-4.5a.75.75 0 0 0-.75-.75h-3a.75.75 0 0 0-.75.75V21a.75.75 0 0 1-.75.75H5.625a1.875 1.875 0 0 1-1.875-1.875v-6.198a2.29 2.29 0 0 0 .091-.086L12 5.432Z" }],
];

export function NavigationHomeIcon({ selected, className }: { selected: boolean; className?: string }) {
  return <MorphIcon icon={selected ? HOME_FILLED : HOME_OUTLINE} size={20} strokeWidth={2} spring="snappy" className={className} aria-hidden="true" />;
}
