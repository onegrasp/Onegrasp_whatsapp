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

const playNotificationDing = () => {
  try {
    const AudioContext = window.AudioContext || window.webkitAudioContext;
    if (!AudioContext) return;
    const ctx = new AudioContext();

    const osc = ctx.createOscillator();
    const gain = ctx.createGain();

    osc.type = "sine";
    osc.frequency.setValueAtTime(880, ctx.currentTime); // A5 note (880Hz)
    osc.frequency.exponentialRampToValueAtTime(1320, ctx.currentTime + 0.08); // E6 note chime (1320Hz)

    gain.gain.setValueAtTime(0.3, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.35);

    osc.connect(gain);
    gain.connect(ctx.destination);

    osc.start();
    osc.stop(ctx.currentTime + 0.35);
  } catch (err) {
    console.warn("Notification sound could not play:", err);
  }
};

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

    const handleIncoming = (msg) => {
      if (msg.direction === "incoming" || !msg.direction) {
        playNotificationDing();
      }
      fetchUnread();
    };

    const handleNewMsg = (msg) => {
      if (msg.direction === "incoming") {
        playNotificationDing();
      }
      fetchUnread();
    };

    socket.on("incoming_message", handleIncoming);
    socket.on("new_message", handleNewMsg);

    return () => {
      socket.off("incoming_message", handleIncoming);
      socket.off("new_message", handleNewMsg);
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
              `flex items-center justify-between px-3 py-2.5 rounded-lg transition-colors duration-150 group relative ${
                isActive
                  ? "bg-wa-green/10 text-wa-green font-bold"
                  : "text-slate-600 hover:text-wa-green hover:bg-wa-green/10"
              }`
            }
          >
            <div className="flex items-center gap-3">
              <div className="relative">
                <Icon size={18} className="shrink-0" />
                {hasBadge && unreadTotal > 0 && (
                  <span className="lg:hidden absolute -top-1.5 -right-1.5 w-4 h-4 bg-red-500 text-white font-extrabold text-[9px] rounded-full flex items-center justify-center animate-bounce shadow-sm">
                    {unreadTotal > 9 ? "9+" : unreadTotal}
                  </span>
                )}
              </div>
              <span className="hidden lg:block text-sm font-medium">{label}</span>
            </div>
            {hasBadge && unreadTotal > 0 && (
              <span className="hidden lg:flex bg-red-500 text-white font-extrabold text-[10px] h-5 min-w-[20px] px-1.5 rounded-full items-center justify-center animate-bounce shadow-sm shadow-red-500/30">
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
