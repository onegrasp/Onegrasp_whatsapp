import { useCallback, useEffect, useState } from "react";
import { NavLink, useLocation } from "react-router-dom";
import {
  FileText,
  LayoutDashboard,
  LogOut,
  Megaphone,
  Menu,
  MessageSquare,
  ScrollText,
  Send,
  Settings,
  Users,
  X,
} from "lucide-react";
import { useSocket } from "../context/SocketContext";
import { getConversations } from "../services/api";
import { useSettings } from "./SettingsDialog";

const NAV_GROUPS = [
  { items: [{ to: "/dashboard", icon: LayoutDashboard, label: "Dashboard" }] },
  {
    label: "Messaging",
    items: [
      { to: "/bulk", icon: Send, label: "Bulk send" },
      { to: "/chats", icon: MessageSquare, label: "Chats", showUnread: true },
      { to: "/campaigns", icon: Megaphone, label: "Campaigns" },
      { to: "/templates", icon: FileText, label: "Templates" },
    ],
  },
  { label: "Audience", items: [{ to: "/contacts", icon: Users, label: "Contacts" }] },
  { label: "System", items: [{ to: "/logs", icon: ScrollText, label: "Logs" }] },
];

const playNotificationSound = () => {
  try {
    const AudioContext = window.AudioContext || window.webkitAudioContext;
    if (!AudioContext) return;
    const ctx = new AudioContext();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = "sine";
    osc.frequency.setValueAtTime(880, ctx.currentTime);
    osc.frequency.exponentialRampToValueAtTime(1320, ctx.currentTime + 0.08);
    gain.gain.setValueAtTime(0.2, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.35);
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start();
    osc.stop(ctx.currentTime + 0.35);
  } catch (err) {
    console.warn("Notification sound could not play:", err);
  }
};

function useUnreadTotal() {
  const { socket } = useSocket();
  const [unread, setUnread] = useState(0);

  const refresh = useCallback(async () => {
    try {
      const res = await getConversations();
      setUnread((res.data || []).reduce((sum, c) => sum + (c.unreadCount || 0), 0));
    } catch (err) {
      console.warn("Failed to fetch unread count:", err);
    }
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  useEffect(() => {
    if (!socket) return;
    // The shell is always mounted, so it is the single place that plays the
    // new-message sound.
    const onIncoming = () => {
      playNotificationSound();
      refresh();
    };
    socket.on("incoming_message", onIncoming);
    socket.on("new_message", refresh);
    return () => {
      socket.off("incoming_message", onIncoming);
      socket.off("new_message", refresh);
    };
  }, [socket, refresh]);

  return unread;
}

function NavContent({ unread, onNavigate, onLogout }) {
  const { connected } = useSocket();
  const { openSettings } = useSettings();

  return (
    <div className="flex h-full flex-col">
      <div className="flex h-14 shrink-0 items-center gap-2.5 border-b border-gray-200 px-4">
        <div className="grid h-7 w-7 place-items-center rounded-md bg-brand-600 text-xs font-semibold text-white" aria-hidden="true">
          OG
        </div>
        <div className="min-w-0 leading-tight">
          <p className="text-sm font-semibold text-gray-900">OneGrasp</p>
          <p className="text-xs text-gray-500">WhatsApp campaigns</p>
        </div>
      </div>

      <nav className="relative flex-1 space-y-5 overflow-y-auto px-3 py-4" aria-label="Main">
        {NAV_GROUPS.map((group, i) => (
          <div key={group.label || i}>
            {group.label && <p className="mb-1 px-2 text-xs font-medium text-gray-400">{group.label}</p>}
            <ul className="space-y-0.5">
              {group.items.map(({ to, icon: Icon, label, showUnread }) => (
                <li key={to}>
                  <NavLink
                    to={to}
                    onClick={onNavigate}
                    className={({ isActive }) =>
                      `group flex h-8 items-center gap-2.5 rounded-md px-2 text-sm transition-colors ${
                        isActive
                          ? "bg-white font-medium text-gray-900 shadow-xs ring-1 ring-gray-200"
                          : "text-gray-600 hover:bg-gray-100 hover:text-gray-900"
                      }`
                    }
                  >
                    {({ isActive }) => (
                      <>
                        <Icon size={16} className={isActive ? "text-brand-600" : "text-gray-400 group-hover:text-gray-500"} aria-hidden="true" />
                        <span className="flex-1">{label}</span>
                        {showUnread && unread > 0 && (
                          <span className="min-w-[20px] rounded-full bg-brand-600 px-1.5 text-center text-2xs font-medium leading-5 text-white tabular-nums">
                            {unread > 99 ? "99+" : unread}
                            <span className="sr-only"> unread</span>
                          </span>
                        )}
                      </>
                    )}
                  </NavLink>
                </li>
              ))}
            </ul>
          </div>
        ))}
      </nav>

      <div className="shrink-0 space-y-0.5 border-t border-gray-200 px-3 py-3">
        <button type="button" onClick={() => { onNavigate?.(); openSettings(); }} className="flex h-8 w-full items-center gap-2.5 rounded-md px-2 text-sm text-gray-600 hover:bg-gray-100 hover:text-gray-900">
          <Settings size={16} className="text-gray-400" aria-hidden="true" />
          Settings
        </button>
        <button type="button" onClick={onLogout} className="flex h-8 w-full items-center gap-2.5 rounded-md px-2 text-sm text-gray-600 hover:bg-gray-100 hover:text-gray-900">
          <LogOut size={16} className="text-gray-400" aria-hidden="true" />
          Sign out
        </button>
        <p className="flex items-center gap-2 px-2 pt-2 text-xs text-gray-500" title={connected ? "Real-time updates are connected" : "Real-time updates are disconnected"}>
          <span className={`h-1.5 w-1.5 rounded-full ${connected ? "bg-brand-500" : "bg-gray-300"}`} aria-hidden="true" />
          {connected ? "Live updates on" : "Live updates off"}
        </p>
      </div>
    </div>
  );
}

export default function AppShell({ onLogout, children }) {
  const unread = useUnreadTotal();
  const [drawerOpen, setDrawerOpen] = useState(false);
  const location = useLocation();

  useEffect(() => {
    setDrawerOpen(false);
  }, [location.pathname]);

  useEffect(() => {
    if (!drawerOpen) return;
    const onKey = (e) => e.key === "Escape" && setDrawerOpen(false);
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [drawerOpen]);

  // `relative` matters: absolutely positioned descendants (e.g. sr-only
  // labels) that have no closer positioned ancestor are anchored and clipped
  // here, instead of stretching the page and making it scroll into blank space.
  return (
    <div className="relative flex h-dvh overflow-hidden bg-white">
      <aside className="hidden w-60 shrink-0 border-r border-gray-200 bg-gray-50 lg:block">
        <NavContent unread={unread} onLogout={onLogout} />
      </aside>

      {drawerOpen && (
        <div className="fixed inset-0 z-40 lg:hidden">
          <div className="absolute inset-0 bg-gray-900/30" onClick={() => setDrawerOpen(false)} aria-hidden="true" />
          <aside className="relative h-full w-72 max-w-[85vw] border-r border-gray-200 bg-gray-50 shadow-overlay">
            <button type="button" onClick={() => setDrawerOpen(false)} className="btn btn-ghost btn-sm btn-icon absolute right-2 top-3" aria-label="Close menu">
              <X size={16} />
            </button>
            <NavContent unread={unread} onLogout={onLogout} onNavigate={() => setDrawerOpen(false)} />
          </aside>
        </div>
      )}

      <div className="flex min-w-0 flex-1 flex-col">
        <div className="flex h-14 shrink-0 items-center gap-3 border-b border-gray-200 px-4 lg:hidden">
          <button type="button" onClick={() => setDrawerOpen(true)} className="btn btn-ghost btn-sm btn-icon -ml-2" aria-label="Open menu">
            <Menu size={18} />
          </button>
          <span className="text-sm font-semibold text-gray-900">OneGrasp</span>
          {unread > 0 && (
            <span className="ml-auto rounded-full bg-brand-600 px-2 text-2xs font-medium leading-5 text-white tabular-nums">
              {unread} unread
            </span>
          )}
        </div>
        <main className="min-h-0 flex-1 overflow-hidden">{children}</main>
      </div>
    </div>
  );
}
