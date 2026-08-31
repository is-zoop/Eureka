import type { CSSProperties } from "react";
import { getIcon } from "material-file-icons";

interface IconProps {
  size?: number;
}

const FOLDER_ICON = `<svg viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg"><path fill="#5B8FD1" d="M3 5.5A2.5 2.5 0 0 1 5.5 3H10l2 2h6.5A2.5 2.5 0 0 1 21 7.5v9A2.5 2.5 0 0 1 18.5 19h-13A2.5 2.5 0 0 1 3 16.5v-11Z"/><path fill="#7AA7DE" d="M3 9h18v7.5a2.5 2.5 0 0 1-2.5 2.5h-13A2.5 2.5 0 0 1 3 16.5V9Z"/></svg>`;
const FOLDER_OPEN_ICON = `<svg viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg"><path fill="#5B8FD1" d="M3 5.5A2.5 2.5 0 0 1 5.5 3H10l2 2h6.5A2.5 2.5 0 0 1 21 7.5v1.1H3V5.5Z"/><path fill="#7AA7DE" d="M4.7 9h16.9a1.4 1.4 0 0 1 1.35 1.8l-1.8 6.7A2 2 0 0 1 19.2 19H3.8a1.8 1.8 0 0 1-1.73-2.3l1.25-6.2A1.8 1.8 0 0 1 4.7 9Z"/></svg>`;

const svgUrlCache = new Map<string, string>();

function toSvgUrl(svg: string) {
  const cached = svgUrlCache.get(svg);
  if (cached) return cached;

  const url = `url("data:image/svg+xml,${encodeURIComponent(svg)}")`;
  svgUrlCache.set(svg, url);
  return url;
}

function SvgIcon({ svg, size = 14 }: IconProps & { svg: string }) {
  const style = {
    width: size,
    height: size,
    backgroundImage: toSvgUrl(svg),
  } as CSSProperties;

  return <span aria-hidden="true" className="material-file-icon" style={style} />;
}

export function FolderIcon({ size = 14, open = false }: IconProps & { open?: boolean }) {
  return <SvgIcon svg={open ? FOLDER_OPEN_ICON : FOLDER_ICON} size={size} />;
}

export function GenericFileIcon({ size = 14 }: IconProps) {
  return <SvgIcon svg={getIcon("file").svg} size={size} />;
}

export function getFileIcon(name: string, size = 14): React.ReactNode {
  return <SvgIcon svg={getIcon(name).svg} size={size} />;
}
