import { useEffect, useMemo, useRef, useState, useCallback } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { MessageCircle, X, Send, Loader2 } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import {
  getChatSettings,
  getOrCreateMyConversation,
  listConversationMessages,
  userSendMessage,
  userMarkRead,
  type ChatMessage,
  type ChatSettings,
} from "@/lib/live-chat.functions";

// Backwards-compat exports (older settings consumer still references these)
export type LiveChatWidgetSettings = {
  enabled: boolean;
  position: "bottom-right" | "bottom-left";
  chat_message?: string;
  heading?: string;
  subheading?: string;
  whatsapp_number?: string;
};
export const LIVE_CHAT_DEFAULTS: LiveChatWidgetSettings = {
  enabled: true,
  position: "bottom-right",
};

const SOUND_KEY = "lc_sound_enabled";

function timeAgo(iso: string) {
  const diff = Date.now() - new Date(iso).getTime();
  const m = Math.floor(diff / 60000);
  if (m < 1) return "just now";
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return new Date(iso).toLocaleDateString();
}

function playPing() {
  try {
    const enabled = localStorage.getItem(SOUND_KEY) !== "0";
    if (!enabled) return;
    // tiny WebAudio ping — avoids bundling audio file
    const ctx = new (window.AudioContext || (window as any).webkitAudioContext)();
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.frequency.value = 880;
    o.connect(g);
    g.connect(ctx.destination);
    g.gain.setValueAtTime(0.0001, ctx.currentTime);
    g.gain.exponentialRampToValueAtTime(0.15, ctx.currentTime + 0.01);
    g.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + 0.25);
    o.start();
    o.stop(ctx.currentTime + 0.26);
  } catch {
    /* ignore */
  }
}

export function LiveChatWidget() {
  const qc = useQueryClient();
  const fetchSettings = useServerFn(getChatSettings);
  const startConv = useServerFn(getOrCreateMyConversation);
  const fetchMessages = useServerFn(listConversationMessages);
  const sendMsg = useServerFn(userSendMessage);
  const markRead = useServerFn(userMarkRead);

  const [authed, setAuthed] = useState<boolean | null>(null);
  const [open, setOpen] = useState(false);
  const [input, setInput] = useState("");
  const [unread, setUnread] = useState(0);
  const [soundOn, setSoundOn] = useState<boolean>(() => {
    if (typeof window === "undefined") return true;
    return localStorage.getItem(SOUND_KEY) !== "0";
  });
  const scrollRef = useRef<HTMLDivElement | null>(null);

  // Auth gate
  useEffect(() => {
    let alive = true;
    supabase.auth.getUser().then(({ data }) => alive && setAuthed(!!data.user));
    const { data: sub } = supabase.auth.onAuthStateChange((_e, s) => {
      setAuthed(!!s?.user);
    });
    return () => {
      alive = false;
      sub.subscription.unsubscribe();
    };
  }, []);

  const settingsQ = useQuery({
    queryKey: ["chat", "settings"],
    queryFn: () => fetchSettings(),
    staleTime: 30_000,
    refetchInterval: 30_000,
  });

  // Realtime: settings updates
  useEffect(() => {
    const ch = supabase
      .channel("lc-settings")
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "live_chat_settings" },
        () => qc.invalidateQueries({ queryKey: ["chat", "settings"] }),
      )
      .subscribe();
    return () => {
      supabase.removeChannel(ch);
    };
  }, [qc]);

  const settings = (settingsQ.data ?? {
    enabled: true,
    position: "bottom-right",
    theme_color: "#3b82f6",
    welcome_message: "Hi! How can we help today?",
    offline_message: "",
    email_notifications: true,
    sound_notifications: true,
    auto_assignment_enabled: false,
    attachment_max_mb: 10,
    rate_limit_per_minute: 20,
  }) as ChatSettings;

  const convQ = useQuery({
    queryKey: ["chat", "my-conversation"],
    queryFn: () => startConv(),
    enabled: !!authed && open,
    staleTime: Infinity,
  });
  const conversationId = convQ.data?.id ?? null;

  const messagesQ = useQuery({
    queryKey: ["chat", "messages", conversationId],
    queryFn: () => fetchMessages({ data: { conversation_id: conversationId! } }),
    enabled: !!conversationId,
    staleTime: 5_000,
  });

  // Realtime messages
  useEffect(() => {
    if (!conversationId) return;
    const ch = supabase
      .channel(`lc-conv-${conversationId}`)
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "live_chat_messages",
          filter: `conversation_id=eq.${conversationId}`,
        },
        (payload) => {
          const msg = payload.new as ChatMessage;
          qc.setQueryData<ChatMessage[]>(
            ["chat", "messages", conversationId],
            (prev = []) => (prev.find((m) => m.id === msg.id) ? prev : [...prev, msg]),
          );
          if (msg.sender_type === "staff") {
            if (!open) setUnread((u) => u + 1);
            playPing();
          }
        },
      )
      .subscribe();
    return () => {
      supabase.removeChannel(ch);
    };
  }, [conversationId, qc, open]);

  // When opened: mark read + reset badge
  useEffect(() => {
    if (open && conversationId) {
      setUnread(0);
      markRead({ data: { conversation_id: conversationId } }).catch(() => undefined);
    }
  }, [open, conversationId, markRead]);

  // Scroll to bottom on new message
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messagesQ.data, open]);

  // Background polling for unread when closed
  useEffect(() => {
    if (!authed || open) return;
    const id = setInterval(() => {
      qc.invalidateQueries({ queryKey: ["chat", "my-conversation"] });
    }, 30_000);
    return () => clearInterval(id);
  }, [authed, open, qc]);

  // Watch initial unread from conv
  useEffect(() => {
    if (convQ.data && !open) setUnread(convQ.data.unread_for_user ?? 0);
  }, [convQ.data, open]);

  const sendMutation = useMutation({
    mutationFn: async (body: string) => {
      if (!conversationId) throw new Error("No conversation");
      return sendMsg({ data: { conversation_id: conversationId, body } });
    },
    onSuccess: (msg) => {
      qc.setQueryData<ChatMessage[]>(
        ["chat", "messages", conversationId],
        (prev = []) => (prev.find((m) => m.id === msg.id) ? prev : [...prev, msg]),
      );
    },
  });

  const handleSend = useCallback(() => {
    const v = input.trim();
    if (!v || sendMutation.isPending) return;
    setInput("");
    sendMutation.mutate(v);
  }, [input, sendMutation]);

  const toggleSound = () => {
    setSoundOn((s) => {
      const next = !s;
      try {
        localStorage.setItem(SOUND_KEY, next ? "1" : "0");
      } catch {
        /* ignore */
      }
      return next;
    });
  };

  const messages = messagesQ.data ?? [];
  const positionClass = settings.position === "bottom-left" ? "left-4" : "right-4";
  const themeStyle = useMemo(
    () => ({ background: settings.theme_color || "#3b82f6" }),
    [settings.theme_color],
  );

  // Hidden states
  if (!authed) return null;
  if (!settings.enabled) return null;

  return (
    <div
      className={`fixed bottom-4 ${positionClass} z-50 flex flex-col items-end gap-3`}
      data-testid="live-chat-widget"
    >
      {open && (
        <div
          className="flex h-[540px] w-[360px] max-w-[calc(100vw-2rem)] flex-col overflow-hidden rounded-2xl border border-border bg-card shadow-2xl animate-in fade-in slide-in-from-bottom-4 duration-200"
          role="dialog"
          aria-label="Live support chat"
        >
          {/* Header */}
          <div className="flex items-center gap-3 px-4 py-3 text-white" style={themeStyle}>
            <div className="relative">
              <div className="flex h-9 w-9 items-center justify-center rounded-full bg-white/20">
                <MessageCircle className="h-5 w-5" />
              </div>
              <span className="absolute -bottom-0.5 -right-0.5 h-2.5 w-2.5 rounded-full border-2 border-white bg-emerald-400" />
            </div>
            <div className="flex-1 leading-tight">
              <p className="text-sm font-semibold">Support</p>
              <p className="text-[11px] opacity-80">We typically reply within minutes</p>
            </div>
            <button
              onClick={toggleSound}
              className="rounded-md p-1 text-white/80 hover:bg-white/15 hover:text-white"
              aria-label={soundOn ? "Mute notifications" : "Enable sound"}
              title={soundOn ? "Sound on" : "Sound off"}
            >
              <span className="text-xs">{soundOn ? "🔔" : "🔕"}</span>
            </button>
            <button
              onClick={() => setOpen(false)}
              className="rounded-md p-1 text-white/80 hover:bg-white/15 hover:text-white"
              aria-label="Close chat"
            >
              <X className="h-4 w-4" />
            </button>
          </div>

          {/* Body */}
          <div
            ref={scrollRef}
            className="flex-1 space-y-3 overflow-y-auto bg-muted/30 px-4 py-4"
          >
            {/* Welcome bubble */}
            <div className="flex gap-2">
              <div className="rounded-2xl rounded-bl-sm bg-card px-3 py-2 text-sm shadow-sm">
                {settings.welcome_message}
              </div>
            </div>

            {messagesQ.isLoading && (
              <div className="flex justify-center py-4">
                <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
              </div>
            )}

            {messages.map((m) => {
              const isUser = m.sender_type === "user";
              return (
                <div
                  key={m.id}
                  className={`flex ${isUser ? "justify-end" : "justify-start"}`}
                >
                  <div
                    className={`max-w-[80%] rounded-2xl px-3 py-2 text-sm shadow-sm ${
                      isUser
                        ? "rounded-br-sm text-white"
                        : "rounded-bl-sm bg-card text-foreground"
                    }`}
                    style={isUser ? themeStyle : undefined}
                  >
                    <p className="whitespace-pre-wrap break-words">{m.body}</p>
                    <p
                      className={`mt-1 text-[10px] ${isUser ? "text-white/70" : "text-muted-foreground"}`}
                    >
                      {timeAgo(m.created_at)}
                      {isUser && m.read_at ? " · Seen" : ""}
                    </p>
                  </div>
                </div>
              );
            })}
          </div>

          {/* Composer */}
          <div className="border-t border-border bg-card px-3 py-2">
            <div className="flex items-end gap-2">
              <textarea
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !e.shiftKey) {
                    e.preventDefault();
                    handleSend();
                  }
                }}
                placeholder="Type a message…"
                rows={1}
                className="max-h-32 flex-1 resize-none rounded-xl border border-input bg-background px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-ring"
              />
              <button
                onClick={handleSend}
                disabled={!input.trim() || sendMutation.isPending}
                className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl text-white shadow disabled:opacity-50"
                style={themeStyle}
                aria-label="Send"
              >
                {sendMutation.isPending ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Send className="h-4 w-4" />
                )}
              </button>
            </div>
            {sendMutation.error && (
              <p className="mt-1 text-[11px] text-destructive">
                {(sendMutation.error as Error).message}
              </p>
            )}
          </div>
        </div>
      )}

      <button
        onClick={() => setOpen((o) => !o)}
        className="relative flex h-14 w-14 items-center justify-center rounded-full text-white shadow-xl transition-transform hover:scale-105"
        style={themeStyle}
        aria-label={open ? "Close chat" : "Open chat"}
      >
        {open ? <X className="h-6 w-6" /> : <MessageCircle className="h-6 w-6" />}
        {!open && unread > 0 && (
          <span className="absolute -right-1 -top-1 flex h-5 min-w-5 items-center justify-center rounded-full bg-red-500 px-1 text-[11px] font-bold text-white shadow ring-2 ring-background">
            {unread > 9 ? "9+" : unread}
          </span>
        )}
      </button>
    </div>
  );
}
