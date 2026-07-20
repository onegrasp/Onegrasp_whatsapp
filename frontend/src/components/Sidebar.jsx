import { NavLink } from "react-router-dom";
import {
  LayoutDashboard,
  Send,
  MessageSquare,
  Users,
  Megaphone,
  Zap,
  FileText,
  ScrollText,
} from "lucide-react";
import { useSocket } from "../context/SocketContext";

const navItems = [
  { to: "/dashboard", icon: LayoutDashboard, label: "Dashboard" },
  { to: "/templates", icon: FileText, label: "Templates" },
  { to: "/bulk", icon: Send, label: "Bulk Send" },
  { to: "/chats", icon: MessageSquare, label: "Chats" },
  { to: "/contacts", icon: Users, label: "Contacts" },
  { to: "/campaigns", icon: Megaphone, label: "Campaigns" },
  { to: "/logs", icon: ScrollText, label: "Logs" },
];

export default function Sidebar() {
  const { connected } = useSocket();

  return (
    <aside className="w-16 lg:w-56 h-full bg-white border-r border-surface-border flex flex-col shrink-0 shadow-sm">
      {/* Logo */}
      <div className="h-16 flex items-center px-4 border-b border-surface-border gap-3">
        <div className="w-8 h-8 rounded-xl bg-wa-green flex items-center justify-center shrink-0 shadow-sm shadow-wa-green/20">
          <Zap size={16} className="text-white" />
        </div>
        <div className="hidden lg:block">
          <p className="text-slate-900 font-semibold text-sm leading-none">WA Bulk</p>
          <p className="text-slate-500 text-xs mt-0.5">Campaign Manager</p>
        </div>
      </div>

      {/* Nav */}
      <nav className="flex-1 py-4 px-2 space-y-1">
        {navItems.map(({ to, icon: Icon, label }) => (
          <NavLink
            key={to}
            to={to}
            className={({ isActive }) =>
              `flex items-center gap-3 px-3 py-2.5 rounded-lg transition-colors duration-150 group ${
                isActive
                  ? "bg-wa-green/10 text-wa-green"
                  : "text-slate-600 hover:text-wa-green hover:bg-wa-green/10"
              }`
            }
          >
            <Icon size={18} className="shrink-0" />
            <span className="hidden lg:block text-sm font-medium">{label}</span>
          </NavLink>
        ))}
      </nav>

      {/* Connection Status */}
      <div className="p-3 border-t border-surface-border">
        <div className="flex items-center gap-2 px-2">
          <div
            className={`w-2 h-2 rounded-full ${
              connected ? "bg-wa-green animate-pulse" : "bg-red-500"
            }`}
          />
          <span className="hidden lg:block text-xs text-slate-500">
            {connected ? "Live" : "Offline"}
          </span>
        </div>
      </div>
    </aside>
  );
}
