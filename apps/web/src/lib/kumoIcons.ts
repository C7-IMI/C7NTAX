/**
 * Template icons are stored as names on KumoAssetTemplate.icon, so they can be
 * created by seeds and edited as data. Everything that renders a template goes
 * through here to resolve that name to a real lucide icon.
 */
import {
  Activity, AppWindow, BatteryCharging, Bluetooth, BookOpen, Boxes, Building2, Cable, Calculator,
  CalendarClock, Camera, ClipboardCheck, ClipboardList, Cloud, Cpu, Database, DatabaseBackup,
  FileText, FolderOpen, FolderTree, Globe, HardDrive, Headphones, Key, KeyRound, Laptop, Layers,
  Lock, Mail, MapPin, MemoryStick, Monitor, MonitorSmartphone, Network, Package, Phone, PhoneCall,
  Plug, PlugZap, Power, Printer, Projector, RadioTower, Receipt, Router, ScanLine, Server, Settings,
  Shield, ShieldCheck, Signal, Smartphone, Tag, Terminal, Ticket, Tv, UserCog, Users, Video,
  Wrench, type LucideIcon,
} from "lucide-react";

/** Falls back to a monitor for anything unrecognised, so a bad name never breaks a screen. */
const TEMPLATE_ICONS: Record<string, LucideIcon> = {
  Activity, AppWindow, BatteryCharging, Bluetooth, BookOpen, Boxes, Building2, Cable, Calculator,
  CalendarClock, Camera, ClipboardCheck, ClipboardList, Cloud, Cpu, Database, DatabaseBackup,
  FileText, FolderOpen, FolderTree, Globe, HardDrive, Headphones, Key, KeyRound, Laptop, Layers,
  Lock, Mail, MapPin, MemoryStick, Monitor, MonitorSmartphone, Network, Package, Phone, PhoneCall,
  Plug, PlugZap, Power, Printer, Projector, RadioTower, Receipt, Router, ScanLine, Server, Settings,
  Shield, ShieldCheck, Signal, Smartphone, Tag, Terminal, Ticket, Tv, UserCog, Users, Video, Wrench,
};

const BY_LOWER_CASE_NAME = new Map(Object.entries(TEMPLATE_ICONS).map(([name, icon]) => [name.toLowerCase(), icon]));

export function templateIcon(name?: string | null): LucideIcon {
  if (!name) return Monitor;
  return TEMPLATE_ICONS[name] ?? BY_LOWER_CASE_NAME.get(name.trim().toLowerCase()) ?? Monitor;
}

/** The names offered when someone picks an icon for a new type. */
export const TEMPLATE_ICON_NAMES = Object.keys(TEMPLATE_ICONS);
