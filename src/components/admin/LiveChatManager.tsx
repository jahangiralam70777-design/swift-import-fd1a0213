import { useEffect, useMemo, useRef, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import {
  Search,
  Send,
  Loader2,
  StickyNote,
  Shield,
  Ban,
  CheckCircle2,
  RefreshCw,
  Download,
  UserCircle2,
  Inbox,
} from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import {
  adminListConversations,
  adminGetConversation,
  adminListMessages,
  adminSendReply,
  adminMarkRead,
  adminUpdateConversation,
  adminListNotes,
  adminAddNote,
  adminListStaff,
  type ChatConversation,
  type ChatMessage,
  type ChatNote,
  type ChatStatus,
} from "@/lib/live-chat.functions";

const FILTERS: { key: string; label: string }[] = [
  { key: "all", label: "All" },
  { key: "unread", label: "Unread" },
  { key: "open", label: "Open" },
  { key: "pending", label: "Pending" },
  { key: "closed", label: "Closed" },
  { key: "mine", label: "Assigned to me" },
  { key: "high_priority", label: "High priority" },
];

const STATUS_COLORS: Record<ChatStatus, string> = {
  new: "bg-blue-500/15 text-blue-700 dark:text-blue-300",
  open: "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300",
  pending: "bg-amber-500/15 text-amber-700 dark:text-amber-300",
  waiting_user: "bg-violet-500/15 text-violet-700 dark:text-violet-300",
  resolved: "bg-slate-500/15 text-slate-700 dark:text-slate-300",
  closed: "bg-slate-500/15 text-slate-700 dark:text-slate-300",
};

function fmtTime(iso: string) {
  return new Date(iso).toLocaleString();
}

export function LiveChatManager() {
  const qc = useQueryClient();
  const listFn = useServerFn(adminListConversations);
  const getFn = useServerFn(adminGetConversation);
  const msgsFn = useServerFn(adminListMessages);
  const replyFn = useServerFn(adminSendReply);
  const markReadFn = useServerFn(adminMarkRead);
  const updateFn = useServerFn(adminUpdateConversation);
  const notesFn = useServerFn(adminListNotes);
  const addNoteFn = useServerFn(adminAddNote);
  const staffFn = useServerFn(adminListStaff);

  const [filter, setFilter] = useState<string>("all");
  const [search, setSearch] = useState("");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [tab, setTab] = useState<"reply" | "notes">("reply");
  const [reply, setReply] = useState("");
  const [note, setNote] = useState("");
  const scrollRef = useRef<HTMLDivElement | null>(null);

  const convsQ = useQuery({
    queryKey: ["admin", "chat", "list", filter, search],
    queryFn: () => listFn({ data: { filter: filter as any, search } }),
    refetchInterval: 15_000,
  });

  const detailQ = useQuery({
    queryKey: ["admin", "chat", "detail", selectedId],
    queryFn: () => getFn({ data: { conversation_id: selectedId! } }),
    enabled: !!selectedId,
  });
  const msgsQ = useQuery({
    queryKey: ["admin", "chat", "messages", selectedId],
    queryFn: () => msgsFn({ data: { conversation_id: selectedId! } }),
    enabled: !!selectedId,
  });
  const notesQ = useQuery({
    queryKey: ["admin", "chat", "notes", selectedId],
    queryFn: () => notesFn({ data: { conversation_id: selectedId! } }),
    enabled: !!selectedId && tab === "notes",
  });
  const staffQ = useQuery({
    queryKey: ["admin", "chat", "staff"],
    queryFn: () => staffFn(),
  });

  // Realtime: conversations + messages
  useEffect(() => {
    const ch = supabase
      .channel("admin-lc-all")
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "live_chat_conversations" },
        () => qc.invalidateQueries({ queryKey: ["admin", "chat", "list"] }),
      )
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "live_chat_messages" },
        (payload) => {
          const m = payload.new as ChatMessage;
          if (m.conversation_id === selectedId) {
            qc.setQueryData<ChatMessage[]>(
              ["admin", "chat", "messages", selectedId],
              (prev = []) => (prev.find((x) => x.id === m.id) ? prev : [...prev, m]),
            );
          }
          qc.invalidateQueries({ queryKey: ["admin", "chat", "list"] });
        },
      )
      .subscribe();
    return () => {
      supabase.removeChannel(ch);
    };
  }, [qc, selectedId]);

  // Auto-select first conversation
  useEffect(() => {
    if (!selectedId && convsQ.data && convsQ.data.length > 0) {
      setSelectedId(convsQ.data[0].id);
    }
  }, [convsQ.data, selectedId]);

  // Mark read on open
  useEffect(() => {
    if (selectedId) {
      markReadFn({ data: { conversation_id: selectedId } }).catch(() => undefined);
    }
  }, [selectedId, markReadFn]);

  // Scroll to bottom
  useEffect(() => {
    if (scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
  }, [msgsQ.data, selectedId]);

  const replyMut = useMutation({
    mutationFn: async (body: string) => {
      if (!selectedId) throw new Error("No conversation");
      return replyFn({ data: { conversation_id: selectedId, body } });
    },
    onSuccess: (m) => {
      setReply("");
      qc.setQueryData<ChatMessage[]>(
        ["admin", "chat", "messages", selectedId],
        (prev = []) => (prev.find((x) => x.id === m.id) ? prev : [...prev, m]),
      );
      qc.invalidateQueries({ queryKey: ["admin", "chat", "list"] });
    },
    onError: (e) => toast.error((e as Error).message),
  });

  const noteMut = useMutation({
    mutationFn: async (body: string) => {
      if (!selectedId) throw new Error("No conversation");
      return addNoteFn({ data: { conversation_id: selectedId, body } });
    },
    onSuccess: () => {
      setNote("");
      qc.invalidateQueries({ queryKey: ["admin", "chat", "notes", selectedId] });
      toast.success("Internal note added");
    },
    onError: (e) => toast.error((e as Error).message),
  });

  type UpdatePatch = {
    conversation_id: string;
    status?: ChatStatus;
    priority?: "low" | "normal" | "high" | "urgent";
    assigned_to?: string | null;
    is_blocked?: boolean;
  };
  const updateMut = useMutation({
    mutationFn: async (patch: UpdatePatch) => updateFn({ data: patch }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["admin", "chat", "list"] });
      qc.invalidateQueries({ queryKey: ["admin", "chat", "detail", selectedId] });
    },
    onError: (e) => toast.error((e as Error).message),
  });

  const conv = detailQ.data?.conversation ?? null;
  const profile = detailQ.data?.profile ?? null;
  const messages = msgsQ.data ?? [];
  const notes = notesQ.data ?? [];
  const conversations = convsQ.data ?? [];

  const exportConv = () => {
    if (!conv) return;
    const blob = new Blob(
      [JSON.stringify({ conversation: conv, profile, messages, notes }, null, 2)],
      { type: "application/json" },
    );
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `conversation-${conv.id}.json`;
    a.click();
  };

  return (
    <div className="grid h-[calc(100vh-8rem)] grid-cols-12 gap-3 overflow-hidden rounded-2xl border border-border bg-card">
      {/* ──────────── LEFT: Filter + list ──────────── */}
      <aside className="col-span-12 flex h-full flex-col border-r border-border md:col-span-4 lg:col-span-3">
        <div className="border-b border-border p-3">
          <div className="relative">
            <Search className="absolute left-2 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search name, email, ID…"
              className="pl-8"
            />
          </div>
          <div className="mt-2 flex flex-wrap gap-1">
            {FILTERS.map((f) => (
              <button
                key={f.key}
                onClick={() => setFilter(f.key)}
                className={`rounded-full px-2.5 py-1 text-[11px] font-medium transition ${
                  filter === f.key
                    ? "bg-primary text-primary-foreground"
                    : "bg-muted text-foreground/70 hover:bg-muted/70"
                }`}
              >
                {f.label}
              </button>
            ))}
          </div>
        </div>

        <div className="flex-1 overflow-y-auto">
          {convsQ.isLoading && (
            <div className="flex justify-center p-6">
              <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
            </div>
          )}
          {!convsQ.isLoading && conversations.length === 0 && (
            <div className="flex flex-col items-center justify-center gap-2 p-8 text-center text-muted-foreground">
              <Inbox className="h-8 w-8" />
              <p className="text-sm">No conversations</p>
            </div>
          )}
          <ul>
            {conversations.map((c: ChatConversation) => (
              <li key={c.id}>
                <button
                  onClick={() => setSelectedId(c.id)}
                  className={`w-full border-b border-border px-3 py-3 text-left transition hover:bg-muted/50 ${
                    selectedId === c.id ? "bg-muted/70" : ""
                  }`}
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-semibold">{c.display_name}</p>
                      <p className="truncate text-[11px] text-muted-foreground">
                        {c.display_email}
                      </p>
                    </div>
                    <span
                      className={`shrink-0 rounded-full px-1.5 py-0.5 text-[9px] font-bold uppercase ${STATUS_COLORS[c.status]}`}
                    >
                      {c.status}
                    </span>
                  </div>
                  <p className="mt-1 truncate text-xs text-foreground/70">
                    {c.last_message_preview ?? "No messages yet"}
                  </p>
                  <div className="mt-1 flex items-center justify-between text-[10px] text-muted-foreground">
                    <span>{fmtTime(c.last_message_at)}</span>
                    {c.unread_for_staff > 0 && (
                      <span className="flex h-4 min-w-4 items-center justify-center rounded-full bg-red-500 px-1 text-[9px] font-bold text-white">
                        {c.unread_for_staff}
                      </span>
                    )}
                  </div>
                </button>
              </li>
            ))}
          </ul>
        </div>
      </aside>

      {/* ──────────── CENTER: Thread ──────────── */}
      <section className="col-span-12 flex h-full flex-col md:col-span-5 lg:col-span-6">
        {!conv ? (
          <div className="flex flex-1 items-center justify-center text-muted-foreground">
            Select a conversation
          </div>
        ) : (
          <>
            {/* Header */}
            <div className="flex items-center justify-between border-b border-border px-4 py-3">
              <div>
                <p className="text-sm font-semibold">{conv.display_name ?? "User"}</p>
                <p className="text-[11px] text-muted-foreground">{conv.display_email}</p>
              </div>
              <div className="flex items-center gap-1">
                <span
                  className={`rounded-full px-2 py-0.5 text-[10px] font-bold uppercase ${STATUS_COLORS[conv.status]}`}
                >
                  {conv.status}
                </span>
              </div>
            </div>

            {/* Tabs */}
            <div className="flex gap-1 border-b border-border px-3 py-2">
              <button
                onClick={() => setTab("reply")}
                className={`rounded-md px-3 py-1 text-xs font-medium ${tab === "reply" ? "bg-primary text-primary-foreground" : "text-foreground/70 hover:bg-muted"}`}
              >
                Reply
              </button>
              <button
                onClick={() => setTab("notes")}
                className={`flex items-center gap-1 rounded-md px-3 py-1 text-xs font-medium ${tab === "notes" ? "bg-primary text-primary-foreground" : "text-foreground/70 hover:bg-muted"}`}
              >
                <StickyNote className="h-3 w-3" /> Internal notes
              </button>
            </div>

            {/* Messages */}
            <div ref={scrollRef} className="flex-1 space-y-3 overflow-y-auto bg-muted/20 px-4 py-4">
              {msgsQ.isLoading && (
                <div className="flex justify-center py-4">
                  <Loader2 className="h-4 w-4 animate-spin" />
                </div>
              )}
              {messages.map((m) => {
                const isStaff = m.sender_type === "staff";
                return (
                  <div
                    key={m.id}
                    className={`flex ${isStaff ? "justify-end" : "justify-start"}`}
                  >
                    <div
                      className={`max-w-[75%] rounded-2xl px-3 py-2 text-sm shadow-sm ${
                        isStaff
                          ? "rounded-br-sm bg-primary text-primary-foreground"
                          : "rounded-bl-sm bg-card"
                      }`}
                    >
                      <p className="whitespace-pre-wrap break-words">{m.body}</p>
                      <p
                        className={`mt-1 text-[10px] ${isStaff ? "text-primary-foreground/70" : "text-muted-foreground"}`}
                      >
                        {fmtTime(m.created_at)}
                        {isStaff && m.read_at ? " · Seen" : ""}
                      </p>
                    </div>
                  </div>
                );
              })}
            </div>

            {/* Composer */}
            <div className="border-t border-border bg-card px-3 py-3">
              {tab === "reply" ? (
                <div className="flex items-end gap-2">
                  <Textarea
                    value={reply}
                    onChange={(e) => setReply(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
                        e.preventDefault();
                        if (reply.trim()) replyMut.mutate(reply.trim());
                      }
                    }}
                    placeholder="Type your reply… (Cmd/Ctrl+Enter to send)"
                    rows={2}
                    className="flex-1 resize-none"
                  />
                  <Button
                    onClick={() => reply.trim() && replyMut.mutate(reply.trim())}
                    disabled={!reply.trim() || replyMut.isPending}
                    className="h-10"
                  >
                    {replyMut.isPending ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : (
                      <Send className="h-4 w-4" />
                    )}
                  </Button>
                </div>
              ) : (
                <div className="space-y-2">
                  <div className="max-h-32 space-y-1 overflow-y-auto">
                    {notes.length === 0 && (
                      <p className="text-xs text-muted-foreground">No internal notes yet.</p>
                    )}
                    {notes.map((n: ChatNote) => (
                      <div
                        key={n.id}
                        className="rounded-lg border border-amber-500/30 bg-amber-50 px-2 py-1.5 text-xs dark:bg-amber-950/30"
                      >
                        <p className="whitespace-pre-wrap">{n.body}</p>
                        <p className="mt-0.5 text-[10px] text-muted-foreground">
                          {fmtTime(n.created_at)}
                        </p>
                      </div>
                    ))}
                  </div>
                  <div className="flex items-end gap-2">
                    <Textarea
                      value={note}
                      onChange={(e) => setNote(e.target.value)}
                      placeholder="Internal note (only staff can see)"
                      rows={2}
                      className="flex-1 resize-none"
                    />
                    <Button
                      onClick={() => note.trim() && noteMut.mutate(note.trim())}
                      disabled={!note.trim() || noteMut.isPending}
                      variant="secondary"
                      className="h-10"
                    >
                      {noteMut.isPending ? (
                        <Loader2 className="h-4 w-4 animate-spin" />
                      ) : (
                        <StickyNote className="h-4 w-4" />
                      )}
                    </Button>
                  </div>
                </div>
              )}
            </div>
          </>
        )}
      </section>

      {/* ──────────── RIGHT: Details / actions ──────────── */}
      <aside className="col-span-12 hidden h-full flex-col gap-3 overflow-y-auto border-l border-border p-4 md:col-span-3 md:flex">
        {!conv ? (
          <p className="text-sm text-muted-foreground">No conversation selected</p>
        ) : (
          <>
            <div className="flex items-center gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-full bg-primary/15 text-primary">
                <UserCircle2 className="h-6 w-6" />
              </div>
              <div>
                <p className="text-sm font-semibold">{conv.display_name}</p>
                <p className="text-[11px] text-muted-foreground">{conv.display_email}</p>
              </div>
            </div>

            <div className="space-y-2 text-xs">
              <Row label="Conversation ID" value={conv.id.slice(0, 8)} />
              <Row label="Created" value={fmtTime(conv.created_at)} />
              <Row label="Last activity" value={fmtTime(conv.last_message_at)} />
              {profile?.created_at && (
                <Row label="User since" value={fmtTime(profile.created_at)} />
              )}
            </div>

            <div className="space-y-2">
              <label className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
                Status
              </label>
              <select
                value={conv.status}
                onChange={(e) =>
                  updateMut.mutate({
                    conversation_id: conv.id,
                    status: e.target.value as ChatStatus,
                  })
                }
                className="w-full rounded-lg border border-input bg-background px-2 py-1.5 text-xs"
              >
                <option value="new">New</option>
                <option value="open">Open</option>
                <option value="pending">Pending</option>
                <option value="waiting_user">Waiting for user</option>
                <option value="resolved">Resolved</option>
                <option value="closed">Closed</option>
              </select>
            </div>

            <div className="space-y-2">
              <label className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
                Priority
              </label>
              <select
                value={conv.priority}
                onChange={(e) =>
                  updateMut.mutate({
                    conversation_id: conv.id,
                    priority: e.target.value as any,
                  })
                }
                className="w-full rounded-lg border border-input bg-background px-2 py-1.5 text-xs"
              >
                <option value="low">Low</option>
                <option value="normal">Normal</option>
                <option value="high">High</option>
                <option value="urgent">Urgent</option>
              </select>
            </div>

            <div className="space-y-2">
              <label className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
                Assigned to
              </label>
              <select
                value={conv.assigned_to ?? ""}
                onChange={(e) =>
                  updateMut.mutate({
                    conversation_id: conv.id,
                    assigned_to: e.target.value || null,
                  })
                }
                className="w-full rounded-lg border border-input bg-background px-2 py-1.5 text-xs"
              >
                <option value="">Unassigned</option>
                {(staffQ.data ?? []).map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
              </select>
            </div>

            <div className="grid grid-cols-2 gap-2 pt-2">
              <Button
                size="sm"
                variant="outline"
                onClick={() =>
                  updateMut.mutate({ conversation_id: conv.id, status: "resolved" })
                }
              >
                <CheckCircle2 className="mr-1 h-3 w-3" /> Resolve
              </Button>
              <Button
                size="sm"
                variant="outline"
                onClick={() => updateMut.mutate({ conversation_id: conv.id, status: "open" })}
              >
                <RefreshCw className="mr-1 h-3 w-3" /> Reopen
              </Button>
              <Button
                size="sm"
                variant={conv.is_blocked ? "default" : "outline"}
                onClick={() =>
                  updateMut.mutate({
                    conversation_id: conv.id,
                    is_blocked: !conv.is_blocked,
                  })
                }
              >
                <Ban className="mr-1 h-3 w-3" />
                {conv.is_blocked ? "Unblock" : "Block"}
              </Button>
              <Button size="sm" variant="outline" onClick={exportConv}>
                <Download className="mr-1 h-3 w-3" /> Export
              </Button>
            </div>

            <div className="mt-auto rounded-lg border border-border bg-muted/30 p-2 text-[11px] text-muted-foreground">
              <Shield className="mr-1 inline h-3 w-3" />
              All conversations are RLS-isolated per user. Staff actions are logged.
            </div>
          </>
        )}
      </aside>
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between gap-2">
      <span className="text-muted-foreground">{label}</span>
      <span className="truncate font-medium">{value}</span>
    </div>
  );
}
