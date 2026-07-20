import { useState, useEffect } from "react";
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
import { getConversations } from "../services/api";

const navItems = [
  { to: "/dashboard", icon: LayoutDashboard, label: "Dashboard" },
  { to: "/templates", icon: FileText, label: "Templates" },
  { to: "/bulk", icon: Send, label: "Bulk Send" },
  { to: "/chats", icon: MessageSquare, label: "Chats", hasBadge: true },
  { to: "/contacts", icon: Users, label: "Contacts" },
  { to: "/campaigns", icon: Megaphone, label: "Campaigns" },
  { to: "/logs", icon: ScrollText, label: "Logs" },
];

export default function Sidebar() {
  const { connected, socket } = useSocket();
  const [unreadTotal, setUnreadTotal] = useState(0);

  const fetchUnread = async () => {
    try {
      const res = await getConversations();
      const total = (res.data || []).reduce((acc, c) => acc + (c.unreadCount || 0), 0);
      setUnreadTotal(total);
    } catch (err) {
      console.warn("Failed to fetch unread conversations count:", err);
    }
  };

  useEffect(() => {
    fetchUnread();
  }, []);

  useEffect(() => {
    if (!socket) return;
    const handleMsg = () => fetchUnread();
    socket.on("incoming_message", handleMsg);
    socket.on("new_message", handleMsg);

    return () => {
      socket.off("incoming_message", handleMsg);
      socket.off("new_message", handleMsg);
    };
  }, [socket]);

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
        {navItems.map(({ to, icon: Icon, label, hasBadge }) => (
          <NavLink
            key={to}
            to={to}
            className={({ isActive }) =>
              `flex items-center justify-between px-3 py-2.5 rounded-lg transition-colors duration-150 group ${
                isActive
                  ? "bg-wa-green/10 text-wa-green font-bold"
                  : "text-slate-600 hover:text-wa-green hover:bg-wa-green/10"
              }`
            }
          >
            <div className="flex items-center gap-3">
              <Icon size={18} className="shrink-0" />
              <span className="hidden lg:block text-sm font-medium">{label}</span>
            </div>
            {hasBadge && unreadTotal > 0 && (
              <span className="bg-red-500 text-white font-bold text-[10px] px-2 py-0.5 rounded-full animate-bounce shadow-sm">
                {unreadTotal}
              </span>
            )}
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
          <span className="hidden lg:block text-xs text-slate-500 font-medium">
            {connected ? "Live" : "Offline"}
          </span>
        </div>
      </div>
    </aside>
  );
}
