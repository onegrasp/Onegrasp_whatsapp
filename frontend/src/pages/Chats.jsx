import { useState, useEffect, useRef, useCallback } from "react";
import { Search, Send, Loader2, MessageSquare, Star, Paperclip, Upload, X } from "lucide-react";
import { getConversations, getMessages, sendSingleMessage, toggleImportantContact, getSettings, updateSettings, uploadMediaFile } from "../services/api";
import { useSocket } from "../context/SocketContext";
import MessageBubble from "../components/MessageBubble";

const formatRelativeTime = (ts) => {
  if (!ts) return "";
  const now = Date.now();
  const diff = now - new Date(ts).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "now";
  if (mins < 60) return `${mins}m`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h`;
  return new Date(ts).toLocaleDateString([], { month: "short", day: "numeric" });
};

const LABELS = {
  none: { color: "bg-slate-200 text-slate-700", text: "—" },
  interested: { color: "bg-wa-green/20 text-wa-green font-bold", text: "Interested" },
  follow_up: { color: "bg-yellow-100 text-yellow-700 font-bold", text: "Follow Up" },
  converted: { color: "bg-blue-100 text-blue-700 font-bold", text: "Converted" },
  not_interested: { color: "bg-red-100 text-red-700 font-bold", text: "Not Interested" },
};

const getAvatarGradient = (phone) => {
  const num = phone.split("").reduce((acc, char) => acc + char.charCodeAt(0), 0);
  const gradients = [
    "from-emerald-400 to-teal-500",
    "from-wa-green to-emerald-600",
    "from-cyan-400 to-blue-500",
    "from-emerald-500 to-wa-dark",
    "from-teal-400 to-cyan-500",
  ];
  return gradients[num % gradients.length];
};

export default function Chats() {
  const { socket } = useSocket();
  const [conversations, setConversations] = useState([]);
  const [selectedPhone, setSelectedPhone] = useState(null);
  const [messages, setMessages] = useState([]);
  const [search, setSearch] = useState("");
  const [msgInput, setMsgInput] = useState("");
  const [loadingConvs, setLoadingConvs] = useState(true);
  const [loadingMsgs, setLoadingMsgs] = useState(false);
  const [sending, setSending] = useState(false);
  const bottomRef = useRef(null);
  const inputRef = useRef(null);

  // Auto Reply State
  const [autoReplyEnabled, setAutoReplyEnabled] = useState(false);
  const [autoReplyMessage, setAutoReplyMessage] = useState("");
  const [showAutoReplyModal, setShowAutoReplyModal] = useState(false);
  const [savingSettings, setSavingSettings] = useState(false);

  // Twilio Integration State
  const [twilioMode, setTwilioMode] = useState("sandbox");
  const [twilioAccountSid, setTwilioAccountSid] = useState("");
  const [twilioAuthToken, setTwilioAuthToken] = useState("");
  const [twilioWhatsappNumber, setTwilioWhatsappNumber] = useState("");
  const [twilioMessagingServiceSid, setTwilioMessagingServiceSid] = useState("");
  const [validateWebhookSignature, setValidateWebhookSignature] = useState(false);
  const [sendingRate, setSendingRate] = useState(2);

  // Chat Media Attachment State
  const [attachmentFile, setAttachmentFile] = useState(null);
  const [attachmentUrl, setAttachmentUrl] = useState("");
  const [uploadingAttachment, setUploadingAttachment] = useState(false);
  const chatMediaRef = useRef(null);

  const handleChatMediaUpload = async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    setUploadingAttachment(true);
    const fd = new FormData();
    fd.append("file", file);
    try {
      const res = await uploadMediaFile(fd);
      setAttachmentUrl(res.data.mediaUrl);
      setAttachmentFile(file);
    } catch (err) {
      alert("Attachment upload failed: " + (err.response?.data?.error || err.message));
    } finally {
      setUploadingAttachment(false);
    }
  };

  const loadConversations = useCallback(async () => {
    try {
      const res = await getConversations({ search });
      setConversations(res.data);
    } catch (err) {
      console.error(err);
    } finally {
      setLoadingConvs(false);
    }
  }, [search]);

  // Load chats and settings on mount
  useEffect(() => {
    loadConversations();
    const fetchSettings = async () => {
      try {
        const res = await getSettings();
        setAutoReplyEnabled(res.data.autoReplyEnabled);
        setAutoReplyMessage(res.data.autoReplyMessage);
        setTwilioMode(res.data.twilioMode || "sandbox");
        setTwilioAccountSid(res.data.twilioAccountSid || "");
        setTwilioAuthToken(res.data.twilioAuthToken || "");
        setTwilioWhatsappNumber(res.data.twilioWhatsappNumber || "");
        setTwilioMessagingServiceSid(res.data.twilioMessagingServiceSid || "");
        setValidateWebhookSignature(res.data.validateWebhookSignature || false);
        setSendingRate(res.data.sendingRate || 2);
      } catch (err) {
        console.error("Failed to load settings:", err);
      }
    };
    fetchSettings();
  }, [loadConversations]);

  useEffect(() => {
    if (!selectedPhone) return;
    const load = async () => {
      setLoadingMsgs(true);
      try {
        const res = await getMessages(selectedPhone);
        setMessages(res.data.messages);
      } catch (err) {
        console.error(err);
      } finally {
        setLoadingMsgs(false);
      }
    };
    load();
    inputRef.current?.focus();
  }, [selectedPhone]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  // Phone Normalization Helper
  const isSamePhone = (p1, p2) => {
    if (!p1 || !p2) return false;
    const c1 = p1.replace(/\D/g, "");
    const c2 = p2.replace(/\D/g, "");
    return c1 === c2 || c1.endsWith(c2) || c2.endsWith(c1);
  };

  // Real-time updates
  useEffect(() => {
    if (!socket) return;

    socket.on("new_message", (msg) => {
      loadConversations();
      if (selectedPhone && isSamePhone(msg.phone, selectedPhone)) {
        setMessages((prev) => {
          // Avoid duplicate messages if already optimistically added
          const exists = prev.some((m) => m._id === msg._id || (m.messageId && m.messageId === msg.messageId));
          if (exists) return prev;
          return [...prev, msg];
        });
      }
    });

    socket.on("incoming_message", (msg) => {
      loadConversations();
      if (selectedPhone && isSamePhone(msg.phone, selectedPhone)) {
        setMessages((prev) => {
          const exists = prev.some((m) => m.text === msg.text && Math.abs(new Date(m.timestamp) - new Date(msg.timestamp)) < 3000);
          if (exists) return prev;
          return [...prev, {
            _id: msg.messageId || "inc-" + Date.now(),
            phone: msg.phone,
            contact_name: msg.contactName,
            text: msg.text,
            direction: "incoming",
            status: "delivered",
            timestamp: msg.timestamp,
          }];
        });
      }
    });

    socket.on("status_update", ({ messageId, status }) => {
      setMessages((prev) =>
        prev.map((m) => (m.messageId === messageId || m._id === messageId ? { ...m, status } : m))
      );
    });

    return () => {
      socket.off("new_message");
      socket.off("incoming_message");
      socket.off("status_update");
    };
  }, [socket, selectedPhone, loadConversations]);

  const handleSend = async () => {
    if ((!msgInput.trim() && !attachmentUrl) || !selectedPhone || sending) return;
    const text = msgInput.trim();
    const mediaUrl = attachmentUrl;
    const currentPhone = selectedPhone;

    // Optimistic UI update for instant feedback
    const tempId = "temp-" + Date.now();
    const tempMsg = {
      _id: tempId,
      phone: currentPhone,
      text,
      mediaUrl,
      direction: "outgoing",
      status: "sending",
      timestamp: new Date().toISOString(),
    };

    setMessages((prev) => [...prev, tempMsg]);
    setMsgInput("");
    setAttachmentFile(null);
    setAttachmentUrl("");
    setSending(true);

    try {
      const res = await sendSingleMessage({
        phone: currentPhone,
        message: text || undefined,
        type: "text",
        mediaUrl: mediaUrl || undefined,
      });

      // Update optimistic message status to sent
      setMessages((prev) =>
        prev.map((m) =>
          m._id === tempId
            ? { ...m, status: "sent", messageId: res.data?.messageId || m._id }
            : m
        )
      );
      loadConversations();
    } catch (err) {
      alert(err.response?.data?.error || "Failed to send message");
      // Mark optimistic message as failed
      setMessages((prev) =>
        prev.map((m) => (m._id === tempId ? { ...m, status: "failed" } : m))
      );
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

  const handleStarToggle = async (e, phone, isImportant) => {
    e.stopPropagation();
    try {
      await toggleImportantContact(phone, !isImportant);
      setConversations((prev) =>
        prev.map((c) => (c.phone === phone ? { ...c, isImportant: !isImportant } : c))
      );
    } catch (err) {
      console.error("Error toggling star:", err);
    }
  };

  const handleSaveSettings = async () => {
    setSavingSettings(true);
    try {
      await updateSettings({
        autoReplyEnabled,
        autoReplyMessage,
        twilioMode,
        twilioAccountSid,
        twilioAuthToken,
        twilioWhatsappNumber,
        twilioMessagingServiceSid,
        validateWebhookSignature,
        sendingRate,
      });
      setShowAutoReplyModal(false);
    } catch (err) {
      alert("Failed to save settings");
    } finally {
      setSavingSettings(false);
    }
  };

  const sortedConversations = [...conversations].sort((a, b) => {
    if (a.isImportant && !b.isImportant) return -1;
    if (!a.isImportant && b.isImportant) return 1;
    return new Date(b.lastTimestamp).getTime() - new Date(a.lastTimestamp).getTime();
  });

  const selectedConv = conversations.find((c) => c.phone === selectedPhone);

  return (
    <div className="h-full flex overflow-hidden bg-slate-50">
      {/* Conversations list sidebar */}
      <div className="w-80 border-r border-slate-200/60 flex flex-col bg-white overflow-hidden shrink-0 shadow-sm">
        {/* Search & Settings header */}
        <div className="p-4 border-b border-slate-100">
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center gap-2">
              <h2 className="text-base font-bold text-slate-800">Chats</h2>
              {conversations.reduce((acc, c) => acc + (c.unreadCount || 0), 0) > 0 && (
                <span className="bg-emerald-500/15 text-emerald-700 font-bold text-[10px] px-2.5 py-0.5 rounded-full border border-emerald-500/25 animate-pulse">
                  {conversations.reduce((acc, c) => acc + (c.unreadCount || 0), 0)} Unread
                </span>
              )}
            </div>
            <button
              onClick={() => setShowAutoReplyModal(true)}
              className={`text-[10px] font-bold uppercase tracking-wider px-2 py-1 rounded-md transition-all duration-150 border border-slate-100 ${
                autoReplyEnabled
                  ? "bg-wa-green/10 text-wa-green border-wa-green/20"
                  : "bg-slate-50 text-slate-500 hover:bg-slate-100 hover:text-slate-700"
              }`}
            >
              🤖 Auto Reply: {autoReplyEnabled ? "ON" : "OFF"}
            </button>
          </div>
          <div className="relative">
            <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search chats or numbers..."
              className="input pl-8 text-xs h-9 bg-slate-50 border-slate-100 focus:bg-white"
            />
          </div>
        </div>

        {/* Chats List */}
        <div className="flex-1 overflow-y-auto divide-y divide-slate-100/60 px-2 py-1">
          {loadingConvs ? (
            Array(6)
              .fill(0)
              .map((_, i) => (
                <div key={i} className="px-4 py-3.5 animate-pulse">
                  <div className="flex items-center gap-3">
                    <div className="w-10 h-10 rounded-full bg-slate-100 shrink-0" />
                    <div className="flex-1">
                      <div className="h-3 bg-slate-100 rounded w-24 mb-2.5" />
                      <div className="h-2.5 bg-slate-100 rounded w-40" />
                    </div>
                  </div>
                </div>
              ))
          ) : sortedConversations.length === 0 ? (
            <div className="p-8 text-center text-slate-400 text-xs">
              <MessageSquare className="mx-auto text-slate-300 mb-2" size={24} />
              No conversations found.
            </div>
          ) : (
            sortedConversations.map((conv) => (
              <div
                key={conv.phone}
                onClick={() => setSelectedPhone(conv.phone)}
                className={`w-full text-left px-3.5 py-3 rounded-2xl mb-1 transition-all duration-150 group flex items-center gap-3 relative cursor-pointer ${
                  selectedPhone === conv.phone
                    ? "bg-wa-green/10 text-wa-green border border-wa-green/20"
                    : "hover:bg-slate-50 border border-transparent"
                }`}
              >
                <div
                  className={`w-10 h-10 rounded-full bg-gradient-to-tr ${getAvatarGradient(
                    conv.phone
                  )} flex items-center justify-center shrink-0 text-sm font-bold text-white shadow-sm shadow-emerald-500/10`}
                >
                  {(conv.name || conv.phone)[0].toUpperCase()}
                </div>

                <div className="flex-1 min-w-0 pr-4">
                  <div className="flex items-center justify-between">
                    <span className="text-slate-800 text-xs font-bold truncate group-hover:text-wa-dark transition-colors">
                      {conv.name || conv.phone}
                    </span>
                    <div className="flex items-center gap-1.5 ml-2 shrink-0">
                      {conv.unreadCount > 0 && (
                        <span className="bg-emerald-500 text-slate-900 font-extrabold text-[10px] h-4.5 min-w-[18px] px-1 rounded-full flex items-center justify-center shadow-sm animate-pulse">
                          {conv.unreadCount}
                        </span>
                      )}
                      <span className="text-slate-400 text-[10px] font-medium">
                        {formatRelativeTime(conv.lastTimestamp)}
                      </span>
                    </div>
                  </div>
                  <p className="text-slate-400 text-xs truncate mt-1 leading-normal">
                    {conv.lastDirection === "outgoing" ? "You: " : ""}
                    {conv.lastMessage}
                  </p>
                </div>

                <button
                  onClick={(e) => handleStarToggle(e, conv.phone, conv.isImportant)}
                  className="absolute right-3.5 top-1/2 -translate-y-1/2 shrink-0 p-1 rounded-full hover:bg-slate-100/50 transition-all"
                  title={conv.isImportant ? "Unmark as Important" : "Mark as Important"}
                >
                  <Star
                    size={14}
                    className={`transition-all duration-150 ${
                      conv.isImportant
                        ? "fill-yellow-400 text-yellow-400 scale-110"
                        : "text-slate-300 opacity-0 group-hover:opacity-100 hover:text-slate-500"
                    }`}
                  />
                </button>
              </div>
            ))
          )}
        </div>
      </div>

      {/* Active Chat Window */}
      {selectedPhone ? (
        <div className="flex-1 flex flex-col overflow-hidden bg-[#efebe4] relative">
          <div className="absolute inset-0 opacity-[0.06] bg-repeat pointer-events-none" style={{ backgroundImage: "url('https://user-images.githubusercontent.com/15075759/28719144-86dc0f70-73b1-11e7-911d-60d70fcded21.png')" }}></div>

          {/* Chat header */}
          <div className="h-16 px-6 border-b border-slate-200/50 flex items-center justify-between bg-white/95 backdrop-blur-md shadow-sm shrink-0 z-10">
            <div className="flex items-center gap-3">
              <div
                className={`w-9 h-9 rounded-full bg-gradient-to-tr ${getAvatarGradient(
                  selectedPhone
                )} flex items-center justify-center text-sm font-bold text-white shadow-sm`}
              >
                {(selectedConv?.name || selectedPhone)[0].toUpperCase()}
              </div>
              <div>
                <div className="flex items-center gap-2">
                  <p className="text-slate-800 text-sm font-bold leading-tight">
                    {selectedConv?.name || selectedPhone}
                  </p>
                  <button
                    onClick={(e) => handleStarToggle(e, selectedPhone, selectedConv?.isImportant)}
                    className="p-0.5 rounded-full hover:bg-slate-100 transition-colors"
                  >
                    <Star
                      size={14}
                      className={
                        selectedConv?.isImportant
                          ? "fill-yellow-400 text-yellow-400"
                          : "text-slate-300 hover:text-slate-400"
                      }
                    />
                  </button>
                </div>
                <p className="text-slate-400 text-xs font-mono mt-0.5">{selectedPhone}</p>
              </div>
            </div>

            {selectedConv?.label && selectedConv.label !== "none" && (
              <span className={`badge px-2.5 py-0.5 rounded-md font-semibold text-[10px] uppercase tracking-wider ${LABELS[selectedConv.label]?.color}`}>
                {LABELS[selectedConv.label]?.text}
              </span>
            )}
          </div>

          {/* Messages stream */}
          <div className="flex-1 overflow-y-auto p-6 flex flex-col z-10">
            {loadingMsgs ? (
              <div className="flex flex-col items-center justify-center h-full gap-2">
                <Loader2 size={24} className="animate-spin text-wa-green" />
                <span className="text-xs text-slate-500 font-medium">Loading chat history...</span>
              </div>
            ) : messages.length === 0 ? (
              <div className="flex flex-col items-center justify-center h-full text-slate-400 text-xs gap-2">
                <MessageSquare size={32} className="text-slate-300" />
                <p className="font-semibold">No messages yet</p>
                <p className="text-[10px]">Send a message to initiate the conversation.</p>
              </div>
            ) : (
              <div className="space-y-1">
                {messages.map((msg) => (
                  <MessageBubble key={msg._id} message={msg} />
                ))}
                <div ref={bottomRef} />
              </div>
            )}
          </div>

          {/* Chat composer panel */}
          <div className="px-5 py-4 border-t border-slate-200/50 bg-white/95 backdrop-blur-md flex flex-col gap-2 z-10 shadow-lg">
            {attachmentFile && (
              <div className="flex items-center gap-2 p-2 bg-slate-50 border border-slate-100 rounded-xl max-w-sm animate-in fade-in slide-in-from-bottom-1 duration-150">
                <Paperclip size={12} className="text-slate-400" />
                <span className="text-xs text-wa-green truncate flex-1">{attachmentFile.name}</span>
                <button
                  type="button"
                  onClick={() => {
                    setAttachmentFile(null);
                    setAttachmentUrl("");
                  }}
                  className="text-slate-400 hover:text-red-500"
                >
                  <X size={12} />
                </button>
              </div>
            )}
            <div className="flex items-end gap-3 w-full">
              <button
                type="button"
                onClick={() => chatMediaRef.current.click()}
                className="btn-secondary h-11 w-11 flex items-center justify-center p-0 shrink-0 rounded-full hover:bg-slate-100 transition-colors"
                disabled={uploadingAttachment}
              >
                {uploadingAttachment ? <Loader2 size={16} className="animate-spin text-wa-green" /> : <Paperclip size={16} className="text-slate-600" />}
              </button>
              <input
                ref={chatMediaRef}
                type="file"
                onChange={handleChatMediaUpload}
                className="hidden"
              />
              <textarea
                ref={inputRef}
                value={msgInput}
                onChange={(e) => setMsgInput(e.target.value)}
                onKeyDown={handleKeyDown}
                placeholder="Type a message... (Press Enter to send)"
                rows={1}
                className="input resize-none flex-1 max-h-24 py-3 bg-slate-50 border-slate-100 hover:bg-slate-100/30 focus:bg-white transition-all shadow-inner text-sm"
                style={{ minHeight: 44 }}
              />
              <button
                onClick={handleSend}
                disabled={(!msgInput.trim() && !attachmentUrl) || sending}
                className="btn-primary h-11 px-5 shrink-0 shadow-md shadow-emerald-500/10 hover:shadow-emerald-500/25 active:scale-[0.98] transition-transform disabled:opacity-50"
              >
                {sending ? <Loader2 size={16} className="animate-spin text-slate-900" /> : <Send size={16} />}
              </button>
            </div>
          </div>
        </div>
      ) : (
        <div className="flex-1 flex items-center justify-center text-slate-400 flex-col gap-3 relative bg-slate-100/50">
          <div className="absolute inset-0 opacity-[0.03] bg-repeat pointer-events-none" style={{ backgroundImage: "url('https://user-images.githubusercontent.com/15075759/28719144-86dc0f70-73b1-11e7-911d-60d70fcded21.png')" }}></div>
          <div className="w-16 h-16 rounded-3xl bg-wa-green/10 flex items-center justify-center mb-1 text-wa-green shadow-inner">
            <MessageSquare size={32} />
          </div>
          <h3 className="text-slate-800 font-bold text-sm">WhatsApp Chat Inbox</h3>
          <p className="text-xs text-slate-400 text-center max-w-xs leading-relaxed">
            Select an active conversation from the sidebar chats list to view message history, checkmarks, and chat in real-time.
          </p>
        </div>
      )}

      {/* Auto Reply & Twilio Settings Modal */}
      {showAutoReplyModal && (
        <div className="fixed inset-0 bg-slate-900/40 backdrop-blur-sm flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-3xl p-6 max-w-md w-full shadow-xl border border-slate-100 flex flex-col gap-4 animate-in fade-in zoom-in duration-200 max-h-[90vh] overflow-y-auto">
            <div>
              <h3 className="text-sm font-bold text-slate-900">Application Settings</h3>
              <p className="text-xs text-slate-500 mt-1">Configure auto-responses and Twilio WhatsApp integration parameters.</p>
            </div>

            {/* Toggle option */}
            <div className="flex items-center justify-between p-3.5 rounded-2xl bg-slate-50 border border-slate-100/50">
              <div>
                <p className="text-xs font-bold text-slate-800">Enable Auto Reply</p>
                <p className="text-[10px] text-slate-400">Respond automatically to incoming messages.</p>
              </div>
              <label className="relative inline-flex items-center cursor-pointer">
                <input
                  type="checkbox"
                  checked={autoReplyEnabled}
                  onChange={(e) => setAutoReplyEnabled(e.target.checked)}
                  className="sr-only peer"
                />
                <div className="w-9 h-5 bg-slate-200 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-slate-300 after:border after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:bg-wa-green"></div>
              </label>
            </div>

            {/* Message Input */}
            <div>
              <label className="block text-xs font-bold text-slate-700 mb-1.5">Auto Reply Message</label>
              <textarea
                value={autoReplyMessage}
                onChange={(e) => setAutoReplyMessage(e.target.value)}
                disabled={!autoReplyEnabled}
                rows={3}
                className="input resize-none bg-slate-50 border-slate-100 hover:bg-slate-100/30 focus:bg-white disabled:opacity-50 text-xs"
                placeholder="Type auto reply response..."
              />
            </div>

            {/* Twilio Configuration Section */}
            <div className="border-t border-slate-100 pt-3 flex flex-col gap-3">
              <p className="text-xs font-bold text-slate-900">Twilio API Parameters</p>

              {/* Sandbox vs Production Mode */}
              <div>
                <label className="block text-[10px] text-slate-400 mb-1">Twilio Operation Mode</label>
                <div className="flex rounded-lg overflow-hidden border border-slate-100">
                  {["sandbox", "production"].map((m) => (
                    <button
                      key={m}
                      type="button"
                      onClick={() => setTwilioMode(m)}
                      className={`flex-1 py-1.5 text-xs font-medium capitalize transition-colors ${
                        twilioMode === m
                          ? "bg-wa-green text-slate-900 font-bold"
                          : "text-slate-600 bg-slate-50 hover:bg-slate-100/80"
                      }`}
                    >
                      {m}
                    </button>
                  ))}
                </div>
              </div>

              {/* Twilio Credentials */}
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="block text-[10px] text-slate-400 mb-0.5">Account SID</label>
                  <input
                    type="text"
                    value={twilioAccountSid}
                    onChange={(e) => setTwilioAccountSid(e.target.value)}
                    placeholder="AC..."
                    className="input py-1.5 text-xs font-mono"
                  />
                </div>
                <div>
                  <label className="block text-[10px] text-slate-400 mb-0.5">Auth Token</label>
                  <input
                    type="password"
                    value={twilioAuthToken}
                    onChange={(e) => setTwilioAuthToken(e.target.value)}
                    placeholder="Token"
                    className="input py-1.5 text-xs font-mono"
                  />
                </div>
              </div>

              {twilioMode === "production" ? (
                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <label className="block text-[10px] text-slate-400 mb-0.5">WhatsApp Number</label>
                    <input
                      type="text"
                      value={twilioWhatsappNumber}
                      onChange={(e) => setTwilioWhatsappNumber(e.target.value)}
                      placeholder="e.g. +14155238886"
                      className="input py-1.5 text-xs font-mono"
                    />
                  </div>
                  <div>
                    <label className="block text-[10px] text-slate-400 mb-0.5">Messaging Service SID</label>
                    <input
                      type="text"
                      value={twilioMessagingServiceSid}
                      onChange={(e) => setTwilioMessagingServiceSid(e.target.value)}
                      placeholder="MG..."
                      className="input py-1.5 text-xs font-mono"
                    />
                  </div>
                </div>
              ) : (
                <p className="text-[10px] text-slate-400 leading-normal bg-slate-50 p-2 rounded-xl">
                  ℹ Sandbox mode uses Twilio's official sandbox WhatsApp sender number (+1 415 523 8886) automatically.
                </p>
              )}

              {/* Webhook Signature verification & Rate limits */}
              <div className="flex items-center justify-between p-2.5 rounded-2xl bg-slate-50 border border-slate-100/50">
                <div>
                  <p className="text-[11px] font-bold text-slate-800">Verify Webhook Signature</p>
                  <p className="text-[9px] text-slate-400">Validate incoming payload authenticity.</p>
                </div>
                <label className="relative inline-flex items-center cursor-pointer">
                  <input
                    type="checkbox"
                    checked={validateWebhookSignature}
                    onChange={(e) => setValidateWebhookSignature(e.target.checked)}
                    className="sr-only peer"
                  />
                  <div className="w-9 h-5 bg-slate-200 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-slate-300 after:border after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:bg-wa-green"></div>
                </label>
              </div>

              <div>
                <label className="block text-[10px] text-slate-400 mb-1">Sending Rate (Messages per Second)</label>
                <input
                  type="number"
                  min="0.1"
                  max="100"
                  step="0.1"
                  value={sendingRate}
                  onChange={(e) => setSendingRate(e.target.value)}
                  className="input py-1.5 text-xs w-28 font-mono"
                />
              </div>
            </div>

            {/* Actions */}
            <div className="flex justify-end gap-2 mt-2 pt-3 border-t border-slate-100">
              <button
                onClick={() => setShowAutoReplyModal(false)}
                className="px-4 py-2 rounded-xl text-slate-500 hover:bg-slate-100 text-xs font-bold"
              >
                Cancel
              </button>
              <button
                onClick={handleSaveSettings}
                disabled={savingSettings}
                className="btn-primary px-5 py-2 text-xs font-bold text-slate-900 bg-wa-green hover:bg-wa-dark rounded-3xl"
              >
                {savingSettings ? "Saving..." : "Save Settings"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
