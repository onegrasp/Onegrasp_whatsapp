import { Fragment, useCallback, useEffect, useRef, useState } from "react";
import { ArrowLeft, MessageSquare, Paperclip, Search, Send, Star, X } from "lucide-react";
import { getConversations, getMessages, sendSingleMessage, toggleImportantContact, uploadMediaFile } from "../services/api";
import { useSocket } from "../context/SocketContext";
import MessageBubble from "../components/MessageBubble";
import { Badge, EmptyState, Spinner } from "../components/ui";
import { useToast } from "../components/feedback";
import { useSettings } from "../components/SettingsDialog";
import { formatSetName } from "../lib/contacts";
import { errorMessage, formatDayLabel, formatRelative } from "../lib/format";

const isSamePhone = (p1, p2) => {
  if (!p1 || !p2) return false;
  const c1 = p1.replace(/\D/g, "");
  const c2 = p2.replace(/\D/g, "");
  return c1 === c2 || c1.endsWith(c2) || c2.endsWith(c1);
};

const initialOf = (text) => (text || "?").replace(/^\+/, "").charAt(0).toUpperCase();

function Avatar({ label, size = "md" }) {
  const dims = size === "sm" ? "h-8 w-8 text-xs" : "h-9 w-9 text-sm";
  return (
    <div className={`grid shrink-0 place-items-center rounded-full bg-gray-100 font-medium text-gray-600 ${dims}`} aria-hidden="true">
      {initialOf(label)}
    </div>
  );
}

// Removes duplicates that can appear when an optimistic message, its socket
// echo and a reload overlap.
const dedupeMessages = (messages) =>
  messages.filter(
    (msg, index, self) =>
      index ===
      self.findIndex(
        (m) =>
          (m._id && msg._id && m._id === msg._id) ||
          (m.messageId && msg.messageId && m.messageId === msg.messageId) ||
          (m.text === msg.text && m.direction === msg.direction && Math.abs(new Date(m.timestamp) - new Date(msg.timestamp)) < 3000)
      )
  );

export default function Chats() {
  const { socket } = useSocket();
  const toast = useToast();
  const { settings, openSettings } = useSettings();

  const [conversations, setConversations] = useState([]);
  const [selectedPhone, setSelectedPhone] = useState(null);
  const [messages, setMessages] = useState([]);
  const [search, setSearch] = useState("");
  const [msgInput, setMsgInput] = useState("");
  const [loadingConvs, setLoadingConvs] = useState(true);
  const [loadingMsgs, setLoadingMsgs] = useState(false);
  const [sending, setSending] = useState(false);
  const [attachmentFile, setAttachmentFile] = useState(null);
  const [attachmentUrl, setAttachmentUrl] = useState("");
  const [uploadingAttachment, setUploadingAttachment] = useState(false);
  const bottomRef = useRef(null);
  const inputRef = useRef(null);
  const chatMediaRef = useRef(null);

  const loadConversations = useCallback(async () => {
    try {
      const res = await getConversations({ search });
      setConversations(res.data || []);
    } catch (err) {
      console.error(err);
    } finally {
      setLoadingConvs(false);
    }
  }, [search]);

  useEffect(() => {
    loadConversations();
  }, [loadConversations]);

  useEffect(() => {
    if (!selectedPhone) return;
    const load = async () => {
      setLoadingMsgs(true);
      try {
        const res = await getMessages(selectedPhone);
        setMessages(res.data.messages || []);
      } catch (err) {
        console.error(err);
        toast.error("This conversation could not be loaded.");
      } finally {
        setLoadingMsgs(false);
      }
    };
    load();
    // Opening a chat marks it read on the server; reflect that immediately.
    setConversations((prev) => prev.map((c) => (c.phone === selectedPhone ? { ...c, unreadCount: 0 } : c)));
    inputRef.current?.focus();
  }, [selectedPhone, toast]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  // Real-time updates. (The new-message sound is played by the app shell.)
  useEffect(() => {
    if (!socket) return;

    const onNewMessage = (msg) => {
      loadConversations();
      if (!selectedPhone || !isSamePhone(msg.phone, selectedPhone)) return;
      setMessages((prev) => {
        const exists = prev.some((m) => m._id === msg._id || (m.messageId && msg.messageId && m.messageId === msg.messageId));
        if (exists) return prev;
        // Replace the matching optimistic message, if any.
        const tempIndex = prev.findIndex(
          (m) => typeof m._id === "string" && m._id.startsWith("temp-") && m.text === msg.text && m.direction === msg.direction
        );
        if (tempIndex !== -1) {
          const updated = [...prev];
          updated[tempIndex] = { ...updated[tempIndex], ...msg };
          return updated;
        }
        return [...prev, msg];
      });
    };

    const onIncomingMessage = (msg) => {
      loadConversations();
      if (!selectedPhone || !isSamePhone(msg.phone, selectedPhone)) return;
      setMessages((prev) => {
        const exists = prev.some(
          (m) => m.text === msg.text && m.direction === "incoming" && Math.abs(new Date(m.timestamp) - new Date(msg.timestamp)) < 3000
        );
        if (exists) return prev;
        return [
          ...prev,
          {
            _id: msg.messageId || `inc-${Date.now()}`,
            phone: msg.phone,
            contact_name: msg.contactName,
            text: msg.text,
            direction: "incoming",
            status: "delivered",
            timestamp: msg.timestamp,
          },
        ];
      });
    };

    const onStatusUpdate = ({ messageId, status, errorDetails }) => {
      setMessages((prev) =>
        prev.map((m) => (m.messageId === messageId || m._id === messageId ? { ...m, status, ...(errorDetails && { errorDetails }) } : m))
      );
    };

    socket.on("new_message", onNewMessage);
    socket.on("incoming_message", onIncomingMessage);
    socket.on("status_update", onStatusUpdate);
    return () => {
      socket.off("new_message", onNewMessage);
      socket.off("incoming_message", onIncomingMessage);
      socket.off("status_update", onStatusUpdate);
    };
  }, [socket, selectedPhone, loadConversations]);

  const resizeInput = () => {
    const el = inputRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 128)}px`;
  };

  const clearAttachment = () => {
    setAttachmentFile(null);
    setAttachmentUrl("");
  };

  const handleChatMediaUpload = async (e) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    setUploadingAttachment(true);
    const fd = new FormData();
    fd.append("file", file);
    try {
      const res = await uploadMediaFile(fd);
      setAttachmentUrl(res.data.mediaUrl);
      setAttachmentFile(file);
    } catch (err) {
      toast.error(`Attachment upload failed: ${errorMessage(err)}`);
    } finally {
      setUploadingAttachment(false);
    }
  };

  const handleSend = async () => {
    if ((!msgInput.trim() && !attachmentUrl) || !selectedPhone || sending) return;
    const text = msgInput.trim();
    const mediaUrl = attachmentUrl;
    const currentPhone = selectedPhone;

    // Optimistic message for instant feedback.
    const tempId = `temp-${Date.now()}`;
    setMessages((prev) => [
      ...prev,
      { _id: tempId, phone: currentPhone, text, mediaUrl, direction: "outgoing", status: "sending", timestamp: new Date().toISOString() },
    ]);
    setMsgInput("");
    clearAttachment();
    requestAnimationFrame(resizeInput);
    setSending(true);

    try {
      const res = await sendSingleMessage({
        phone: currentPhone,
        message: text || undefined,
        type: "text",
        mediaUrl: mediaUrl || undefined,
      });
      const saved = res.data?.data;
      setMessages((prev) =>
        prev.map((m) =>
          m._id === tempId ? { ...m, status: "sent", messageId: saved?.message_id || res.data?.messageId || m.messageId } : m
        )
      );
      loadConversations();
    } catch (err) {
      const reason = errorMessage(err, "The message could not be sent.");
      toast.error(reason);
      setMessages((prev) => prev.map((m) => (m._id === tempId ? { ...m, status: "failed", errorDetails: reason } : m)));
    } finally {
      setSending(false);
    }
  };

  const handleKeyDown = (e) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  const handleStarToggle = async (phone, isImportant) => {
    try {
      await toggleImportantContact(phone, !isImportant);
      setConversations((prev) => prev.map((c) => (c.phone === phone ? { ...c, isImportant: !isImportant } : c)));
    } catch (err) {
      toast.error("Could not update the star.");
    }
  };

  const sortedConversations = [...conversations].sort((a, b) => {
    if (a.isImportant && !b.isImportant) return -1;
    if (!a.isImportant && b.isImportant) return 1;
    return new Date(b.lastTimestamp).getTime() - new Date(a.lastTimestamp).getTime();
  });

  const selectedConv = conversations.find((c) => c.phone === selectedPhone);
  const totalUnread = conversations.reduce((acc, c) => acc + (c.unreadCount || 0), 0);
  const contactName = selectedConv?.name && selectedConv.name !== selectedPhone ? selectedConv.name : "";
  const visibleMessages = dedupeMessages(messages);

  return (
    <div className="flex h-full overflow-hidden">
      {/* Conversation list */}
      <section aria-label="Conversations" className={`w-full shrink-0 flex-col border-r border-gray-200 md:flex md:w-80 ${selectedPhone ? "hidden" : "flex"}`}>
        <div className="space-y-3 border-b border-gray-200 px-4 py-3">
          <div className="flex items-center justify-between gap-2">
            <h1 className="flex items-baseline gap-2 text-lg font-semibold text-gray-900">
              Chats
              {totalUnread > 0 && <span className="text-xs font-medium text-brand-700 tabular-nums">{totalUnread} unread</span>}
            </h1>
            <button type="button" onClick={openSettings} className="btn btn-ghost btn-sm" title="Auto-reply settings">
              <span className={`h-1.5 w-1.5 rounded-full ${settings.autoReplyEnabled ? "bg-brand-500" : "bg-gray-300"}`} aria-hidden="true" />
              Auto-reply {settings.autoReplyEnabled ? "on" : "off"}
            </button>
          </div>
          <div className="relative">
            <Search size={14} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" aria-hidden="true" />
            <input type="search" aria-label="Search chats" value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search name or number" className="input pl-8" />
          </div>
        </div>

        <div className="relative min-h-0 flex-1 overflow-y-auto">
          {loadingConvs ? (
            <div className="flex items-center gap-2 px-4 py-6 text-sm text-gray-500">
              <Spinner /> Loading chats…
            </div>
          ) : sortedConversations.length === 0 ? (
            <EmptyState icon={MessageSquare} title={search ? "No matching chats" : "No conversations yet"} description={search ? "Try another name or number." : "Replies to your campaigns appear here."} />
          ) : (
            <ul>
              {sortedConversations.map((conv) => {
                const active = selectedPhone === conv.phone;
                const unread = conv.unreadCount > 0;
                return (
                  <li key={conv.phone} className="group relative border-b border-gray-100">
                    <button
                      type="button"
                      onClick={() => setSelectedPhone(conv.phone)}
                      aria-current={active ? "true" : undefined}
                      className={`flex w-full items-start gap-3 py-3 pl-4 pr-10 text-left ${active ? "bg-gray-100" : "hover:bg-gray-50"}`}
                    >
                      <Avatar label={conv.name || conv.phone} />
                      <div className="min-w-0 flex-1">
                        <div className="flex items-baseline justify-between gap-2">
                          <p className={`truncate text-sm ${unread ? "font-semibold text-gray-900" : "font-medium text-gray-900"}`}>{conv.name || conv.phone}</p>
                          <span className="shrink-0 text-xs text-gray-400">{formatRelative(conv.lastTimestamp)}</span>
                        </div>
                        <div className="mt-0.5 flex items-center gap-2">
                          <p className={`min-w-0 flex-1 truncate text-13 ${unread ? "text-gray-800" : "text-gray-500"}`}>
                            {conv.lastDirection === "outgoing" ? "You: " : ""}
                            {conv.lastMessage}
                          </p>
                          {unread && (
                            <span className="shrink-0 rounded-full bg-brand-600 px-1.5 text-2xs font-medium leading-5 text-white tabular-nums">
                              {conv.unreadCount}
                              <span className="sr-only"> unread</span>
                            </span>
                          )}
                        </div>
                      </div>
                    </button>
                    <button
                      type="button"
                      onClick={() => handleStarToggle(conv.phone, conv.isImportant)}
                      className={`absolute right-2 top-2.5 rounded p-1.5 hover:bg-gray-200 focus-visible:opacity-100 ${conv.isImportant ? "opacity-100" : "opacity-0 group-hover:opacity-100"}`}
                      aria-label={conv.isImportant ? `Unstar ${conv.name || conv.phone}` : `Star ${conv.name || conv.phone}`}
                      aria-pressed={Boolean(conv.isImportant)}
                    >
                      <Star size={14} className={conv.isImportant ? "fill-amber-400 text-amber-400" : "text-gray-400"} />
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      </section>

      {/* Thread */}
      {selectedPhone ? (
        <section aria-label="Conversation" className="flex min-w-0 flex-1 flex-col">
          <header className="flex h-14 shrink-0 items-center gap-3 border-b border-gray-200 px-4">
            <button type="button" onClick={() => setSelectedPhone(null)} className="btn btn-ghost btn-sm btn-icon -ml-2 md:hidden" aria-label="Back to chats">
              <ArrowLeft size={16} />
            </button>
            <Avatar label={selectedConv?.name || selectedPhone} size="sm" />
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-semibold text-gray-900">{selectedConv?.name || selectedPhone}</p>
              <p className="text-xs tabular-nums text-gray-500">{selectedPhone}</p>
            </div>
            {selectedConv?.isOptedOut && <Badge tone="danger">Opted out</Badge>}
            {selectedConv?.label && selectedConv.label !== "none" && <Badge>{formatSetName(selectedConv.label)}</Badge>}
            <button
              type="button"
              onClick={() => handleStarToggle(selectedPhone, selectedConv?.isImportant)}
              className="btn btn-ghost btn-sm btn-icon"
              aria-label={selectedConv?.isImportant ? "Unstar conversation" : "Star conversation"}
              aria-pressed={Boolean(selectedConv?.isImportant)}
            >
              <Star size={16} className={selectedConv?.isImportant ? "fill-amber-400 text-amber-400" : "text-gray-400"} />
            </button>
          </header>

          <div className="relative min-h-0 flex-1 overflow-y-auto bg-gray-50 px-4 py-4 sm:px-6">
            {loadingMsgs ? (
              <div className="flex h-full items-center justify-center gap-2 text-sm text-gray-500">
                <Spinner /> Loading messages…
              </div>
            ) : visibleMessages.length === 0 ? (
              <EmptyState icon={MessageSquare} title="No messages yet" description="Send a message to start the conversation." />
            ) : (
              <div className="mx-auto max-w-3xl space-y-1.5">
                {visibleMessages.map((msg, i) => {
                  const day = msg.timestamp ? new Date(msg.timestamp).toDateString() : "";
                  const prevDay = i > 0 && visibleMessages[i - 1].timestamp ? new Date(visibleMessages[i - 1].timestamp).toDateString() : null;
                  return (
                    <Fragment key={msg._id || msg.messageId || i}>
                      {day && day !== prevDay && (
                        <div className="flex justify-center py-2">
                          <span className="rounded-full bg-white px-2.5 py-0.5 text-xs text-gray-500 ring-1 ring-gray-200">{formatDayLabel(msg.timestamp)}</span>
                        </div>
                      )}
                      <MessageBubble message={msg} />
                    </Fragment>
                  );
                })}
                <div ref={bottomRef} />
              </div>
            )}
          </div>

          <div className="shrink-0 border-t border-gray-200 bg-white px-4 py-3">
            {selectedConv?.isOptedOut && (
              <p className="mb-2 rounded-md bg-red-50 px-3 py-1.5 text-xs text-red-800">
                This contact opted out. Only reply to their questions; don't send marketing. They can opt back in by replying START.
              </p>
            )}
            {attachmentFile && (
              <div className="mb-2 flex max-w-sm items-center gap-2 rounded-md border border-gray-200 px-2.5 py-1.5 text-13">
                <Paperclip size={13} className="text-gray-400" aria-hidden="true" />
                <span className="min-w-0 flex-1 truncate text-gray-700">{attachmentFile.name}</span>
                <button type="button" onClick={clearAttachment} className="text-gray-400 hover:text-gray-700" aria-label="Remove attachment">
                  <X size={14} />
                </button>
              </div>
            )}
            <div className="flex items-end gap-2">
              <button
                type="button"
                onClick={() => chatMediaRef.current?.click()}
                className="btn btn-ghost btn-icon"
                disabled={uploadingAttachment}
                aria-label="Attach a file"
                title="Attach image, video, audio or PDF"
              >
                {uploadingAttachment ? <Spinner size={16} /> : <Paperclip size={16} />}
              </button>
              <input ref={chatMediaRef} type="file" accept="image/*,video/mp4,video/3gpp,audio/*,application/pdf" onChange={handleChatMediaUpload} className="sr-only" />
              <textarea
                ref={inputRef}
                aria-label="Message"
                value={msgInput}
                onChange={(e) => {
                  setMsgInput(e.target.value);
                  resizeInput();
                }}
                onKeyDown={handleKeyDown}
                placeholder="Write a message"
                rows={1}
                className="input max-h-32 min-h-[36px] flex-1 resize-none py-1.5"
              />
              <button type="button" onClick={handleSend} disabled={(!msgInput.trim() && !attachmentUrl) || sending} className="btn btn-primary btn-icon" aria-label="Send message">
                {sending ? <Spinner size={16} className="text-white" /> : <Send size={16} />}
              </button>
            </div>
            <div className="mt-1.5 flex items-center justify-between gap-2 text-xs text-gray-400">
              <span className="hidden sm:inline">Enter to send · Shift + Enter for a new line</span>
              {contactName && (
                <button
                  type="button"
                  className="font-medium text-gray-500 hover:text-gray-800"
                  onClick={() => {
                    setMsgInput((prev) => `${prev}${prev && !prev.endsWith(" ") ? " " : ""}${contactName}`);
                    inputRef.current?.focus();
                  }}
                >
                  Insert name
                </button>
              )}
            </div>
          </div>
        </section>
      ) : (
        <div className="hidden flex-1 items-center justify-center bg-gray-50 md:flex">
          <EmptyState icon={MessageSquare} title="Select a conversation" description="Message history, delivery ticks and replies appear here in real time." />
        </div>
      )}
    </div>
  );
}
