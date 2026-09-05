import { forwardRef, type SVGProps } from "react";
import icons from "./pixel-icon-data.json";

// Each filled cell is one square pixel. Odd dimensions provide a center cell.
function pixelIcon(name: keyof typeof icons) {
  const rows = icons[name];
  const path = rows.flatMap((row, y) => Array.from(row, (cell, x) =>
    cell === "#" ? `M${x} ${y}h1v1h-1z` : "",
  )).join("");
  const Icon = forwardRef<SVGSVGElement, SVGProps<SVGSVGElement>>(function PixelIcon(props, ref) {
    const labelled = props["aria-label"] || props["aria-labelledby"];
    return <svg ref={ref} width="18" height="18" viewBox={`0 0 ${rows[0].length} ${rows.length}`} fill="currentColor" shapeRendering="crispEdges" aria-hidden={labelled ? undefined : true} {...props}><path d={path} /></svg>;
  });
  Icon.displayName = name;
  return Icon;
}

export const Check = pixelIcon("Check");
export const XIcon = pixelIcon("XIcon");
export const ChevronDown = pixelIcon("ChevronDown");
export const ArrowRight = pixelIcon("ArrowRight");
export const Eye = pixelIcon("Eye");
export const Play = pixelIcon("Play");
export const Shield = pixelIcon("Shield");
export const UserRound = pixelIcon("UserRound");
export const Users = pixelIcon("Users");
export const Server = pixelIcon("Server");
export const Search = pixelIcon("Search");
export const Clock3 = pixelIcon("Clock3");
export const MessageSquareText = pixelIcon("MessageSquareText");
export const Terminal = pixelIcon("Terminal");
export const KeyRound = pixelIcon("KeyRound");
export const Upload = pixelIcon("Upload");
export const ArrowBigUpDash = pixelIcon("ArrowBigUpDash");
export const LogOut = pixelIcon("LogOut");
export const CornerDownLeft = pixelIcon("CornerDownLeft");
export const Copy = pixelIcon("Copy");
export const Trash2 = pixelIcon("Trash2");
export const Save = pixelIcon("Save");
export const Box = pixelIcon("Box");
export const Archive = pixelIcon("Archive");
export const Kick = pixelIcon("Kick");
export const HeartPulse = pixelIcon("HeartPulse");
export const Wifi = pixelIcon("Wifi");
export const Blocks = pixelIcon("Blocks");
export const Earth = pixelIcon("Earth");
export const SlidersHorizontal = pixelIcon("SlidersHorizontal");
export const Settings2 = pixelIcon("Settings2");
export const Megaphone = pixelIcon("Megaphone");
export const InfoIcon = pixelIcon("InfoIcon");
export const TriangleAlertIcon = pixelIcon("TriangleAlertIcon");
export const Loader2Icon = pixelIcon("Loader2Icon");
export const RefreshCw = pixelIcon("RefreshCw");
export const Calendar = pixelIcon("Calendar");
export const History = pixelIcon("History");
export const AdminBadge = pixelIcon("AdminBadge");
export const ServerOff = pixelIcon("ServerOff");
export const Ban = pixelIcon("Ban");
export const ArchiveRestore = pixelIcon("ArchiveRestore");
export const PackagePlus = pixelIcon("PackagePlus");
export const CircleCheckIcon = pixelIcon("CircleCheckIcon");
export const OctagonXIcon = pixelIcon("OctagonXIcon");
