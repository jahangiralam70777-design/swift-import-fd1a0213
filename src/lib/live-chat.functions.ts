import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { noInput } from "@/lib/validate";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const asAny = (x: unknown) => x as any;

// ============================================================
// Types
// ============================================================
export type ChatStatus = "new" | "open" | "pending" | "waiting_user" | "resolved" | "closed";
export type ChatPriority = "low" | "normal" | "high" | "urgent";
export type ChatSender = "user" | "staff" | "system";

export type ChatSettings = {
  enabled: boolean;
  position: "bottom-right" | "bottom-left";
  theme_color: string;
  welcome_message: string;
  offline_message: string;
  email_notifications: boolean;
  sound_notifications: boolean;
  auto_assignment_enabled: boolean;
  attachment_max_mb: number;
  rate_limit_per_minute: number;
};

export type ChatConversation = {
  id: string;
  user_id: string | null;
  guest_name: string | null;
  guest_email: string | null;
  subject: string | null;
  status: ChatStatus;
  priority: ChatPriority;
  assigned_to: string | null;
  is_blocked: boolean;
  unread_for_user: number;
  unread_for_staff: number;
  last_message_at: string;
  last_message_preview: string | null;
  created_at: string;
  updated_at: string;
  // joined display fields
  display_name?: string | null;
  display_email?: string | null;
};

export type ChatMessage = {
  id: string;
  conversation_id: string;
  sender_type: ChatSender;
  sender_user_id: string | null;
  body: string | null;
  attachments: Array<{ path?: string; name?: string; type?: string; size?: number }>;
  delivered_at: string | null;
  read_at: string | null;
  is_deleted: boolean;
  created_at: string;
};

export type ChatNote = {
  id: string;
  conversation_id: string;
  author_id: string;
  body: string;
  created_at: string;
};

// ============================================================
// Helpers
// ============================================================
async function ensureStaff(supabase: any, userId: string, permission?: string) {
  const { data, error } = await supabase.rpc("is_chat_staff", { _user_id: userId });
  if (error) throw new Error(error.message);
  if (!data) throw new Error("Forbidden: not authorized for support");
  if (permission) {
    const { data: ok, error: e2 } = await supabase.rpc("has_chat_permission", {
      _user_id: userId,
      _permission: permission,
    });
    if (e2) throw new Error(e2.message);
    if (!ok) throw new Error(`Forbidden: missing '${permission}' permission`);
  }
}

const sanitizeBody = (s: string) =>
  s.replace(/[\u0000-\u001F\u007F]/g, "").trim().slice(0, 4000);

// ============================================================
// SETTINGS
// ============================================================
export const getChatSettings = createServerFn({ method: "GET" })
  .inputValidator(noInput)
  .handler(async () => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data, error } = await asAny(supabaseAdmin)
      .from("live_chat_settings")
      .select("*")
      .eq("id", 1)
      .single();
    if (error) throw new Error(error.message);
    return data as ChatSettings;
  });

const settingsUpdateSchema = z.object({
  enabled: z.boolean().optional(),
  position: z.enum(["bottom-right", "bottom-left"]).optional(),
  theme_color: z.string().regex(/^#[0-9a-fA-F]{6}$/).optional(),
  welcome_message: z.string().min(1).max(500).optional(),
  offline_message: z.string().min(1).max(500).optional(),
  email_notifications: z.boolean().optional(),
  sound_notifications: z.boolean().optional(),
  auto_assignment_enabled: z.boolean().optional(),
  attachment_max_mb: z.number().int().min(1).max(50).optional(),
  rate_limit_per_minute: z.number().int().min(1).max(120).optional(),
});

export const updateChatSettings = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => settingsUpdateSchema.parse(input))
  .handler(async ({ data, context }) => {
    await ensureStaff(context.supabase, context.userId, "manage_settings");
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { error } = await asAny(supabaseAdmin)
      .from("live_chat_settings")
      .update(data)
      .eq("id", 1);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

// ============================================================
// USER SIDE
// ============================================================
export const getOrCreateMyConversation = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator(noInput)
  .handler(async ({ context }) => {
    const { supabase, userId } = context;
    // Try existing open conversation
    const { data: existing, error: e1 } = await asAny(supabase)
      .from("live_chat_conversations")
      .select("*")
      .eq("user_id", userId)
      .not("status", "eq", "closed")
      .order("last_message_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (e1) throw new Error(e1.message);
    if (existing) return existing as ChatConversation;

    const { data: created, error: e2 } = await asAny(supabase)
      .from("live_chat_conversations")
      .insert({ user_id: userId, status: "new" })
      .select("*")
      .single();
    if (e2) throw new Error(e2.message);
    return created as ChatConversation;
  });

export const listMyConversations = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator(noInput)
  .handler(async ({ context }) => {
    const { data, error } = await asAny(context.supabase)
      .from("live_chat_conversations")
      .select("*")
      .eq("user_id", context.userId)
      .order("last_message_at", { ascending: false });
    if (error) throw new Error(error.message);
    return (data ?? []) as ChatConversation[];
  });

const conversationIdSchema = z.object({ conversation_id: z.string().uuid() });

export const listConversationMessages = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => conversationIdSchema.parse(input))
  .handler(async ({ data, context }) => {
    const { data: rows, error } = await asAny(context.supabase)
      .from("live_chat_messages")
      .select("*")
      .eq("conversation_id", data.conversation_id)
      .eq("is_deleted", false)
      .order("created_at", { ascending: true })
      .limit(500);
    if (error) throw new Error(error.message);
    return (rows ?? []) as ChatMessage[];
  });

const sendMessageSchema = z.object({
  conversation_id: z.string().uuid(),
  body: z.string().min(1).max(4000),
});

export const userSendMessage = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => sendMessageSchema.parse(input))
  .handler(async ({ data, context }) => {
    const body = sanitizeBody(data.body);
    if (!body) throw new Error("Message is empty");

    // Verify ownership
    const { data: conv, error: cErr } = await asAny(context.supabase)
      .from("live_chat_conversations")
      .select("id, user_id, is_blocked")
      .eq("id", data.conversation_id)
      .single();
    if (cErr) throw new Error(cErr.message);
    if (!conv || conv.user_id !== context.userId) throw new Error("Not your conversation");
    if (conv.is_blocked) throw new Error("This conversation is blocked");

    const { data: msg, error } = await asAny(context.supabase)
      .from("live_chat_messages")
      .insert({
        conversation_id: data.conversation_id,
        sender_type: "user",
        sender_user_id: context.userId,
        body,
        delivered_at: new Date().toISOString(),
      })
      .select("*")
      .single();
    if (error) throw new Error(error.message);

    // Notify admins/assigned staff (best-effort via admin client)
    try {
      const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
      const { data: admins } = await asAny(supabaseAdmin)
        .from("user_roles")
        .select("user_id")
        .eq("role", "admin");
      const recipients = new Set<string>((admins ?? []).map((r: any) => r.user_id));
      const { data: convRow } = await asAny(supabaseAdmin)
        .from("live_chat_conversations")
        .select("assigned_to")
        .eq("id", data.conversation_id)
        .single();
      if (convRow?.assigned_to) recipients.add(convRow.assigned_to);
      if (recipients.size > 0) {
        await asAny(supabaseAdmin)
          .from("live_chat_notifications")
          .insert(
            Array.from(recipients).map((rid) => ({
              recipient_id: rid,
              conversation_id: data.conversation_id,
              kind: "new_message",
              payload: { preview: body.slice(0, 120) },
            })),
          );
      }
    } catch {
      /* non-blocking */
    }

    return msg as ChatMessage;
  });

export const userMarkRead = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => conversationIdSchema.parse(input))
  .handler(async ({ data, context }) => {
    const now = new Date().toISOString();
    const { error } = await asAny(context.supabase)
      .from("live_chat_conversations")
      .update({ unread_for_user: 0, user_last_seen_at: now })
      .eq("id", data.conversation_id)
      .eq("user_id", context.userId);
    if (error) throw new Error(error.message);
    // Mark staff messages as read
    await asAny(context.supabase)
      .from("live_chat_messages")
      .update({ read_at: now })
      .eq("conversation_id", data.conversation_id)
      .eq("sender_type", "staff")
      .is("read_at", null);
    return { ok: true };
  });

// ============================================================
// ADMIN / STAFF
// ============================================================
const adminListSchema = z
  .object({
    filter: z
      .enum(["all", "unread", "open", "pending", "closed", "mine", "high_priority"])
      .optional(),
    search: z.string().max(200).optional(),
    limit: z.number().int().min(1).max(200).optional(),
  })
  .optional()
  .default({});

export const adminListConversations = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => adminListSchema.parse(input ?? {}))
  .handler(async ({ data, context }) => {
    await ensureStaff(context.supabase, context.userId, "view");
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    let q = asAny(supabaseAdmin)
      .from("live_chat_conversations")
      .select("*")
      .order("last_message_at", { ascending: false })
      .limit(data.limit ?? 100);

    switch (data.filter) {
      case "unread":
        q = q.gt("unread_for_staff", 0);
        break;
      case "open":
        q = q.in("status", ["new", "open", "waiting_user"]);
        break;
      case "pending":
        q = q.eq("status", "pending");
        break;
      case "closed":
        q = q.in("status", ["resolved", "closed"]);
        break;
      case "mine":
        q = q.eq("assigned_to", context.userId);
        break;
      case "high_priority":
        q = q.in("priority", ["high", "urgent"]);
        break;
    }
    const { data: rows, error } = await q;
    if (error) throw new Error(error.message);
    const convs = (rows ?? []) as ChatConversation[];

    // Enrich with profile display name/email
    const userIds = Array.from(new Set(convs.map((c) => c.user_id).filter(Boolean) as string[]));
    let profilesById = new Map<string, { full_name: string | null; email: string | null }>();
    if (userIds.length > 0) {
      const { data: profs } = await asAny(supabaseAdmin)
        .from("profiles")
        .select("id, full_name, email")
        .in("id", userIds);
      profilesById = new Map(
        (profs ?? []).map((p: any) => [p.id, { full_name: p.full_name, email: p.email }]),
      );
    }
    const enriched = convs.map((c) => {
      const p = c.user_id ? profilesById.get(c.user_id) : undefined;
      return {
        ...c,
        display_name: p?.full_name ?? c.guest_name ?? "User",
        display_email: p?.email ?? c.guest_email ?? null,
      };
    });

    if (data.search && data.search.trim()) {
      const s = data.search.toLowerCase();
      return enriched.filter(
        (c) =>
          (c.display_name ?? "").toLowerCase().includes(s) ||
          (c.display_email ?? "").toLowerCase().includes(s) ||
          c.id.toLowerCase().includes(s) ||
          (c.last_message_preview ?? "").toLowerCase().includes(s),
      );
    }
    return enriched;
  });

export const adminGetConversation = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => conversationIdSchema.parse(input))
  .handler(async ({ data, context }) => {
    await ensureStaff(context.supabase, context.userId, "view");
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: conv, error } = await asAny(supabaseAdmin)
      .from("live_chat_conversations")
      .select("*")
      .eq("id", data.conversation_id)
      .single();
    if (error) throw new Error(error.message);

    let profile: any = null;
    if (conv?.user_id) {
      const { data: p } = await asAny(supabaseAdmin)
        .from("profiles")
        .select("id, full_name, email, avatar_url, created_at")
        .eq("id", conv.user_id)
        .maybeSingle();
      profile = p ?? null;
    }
    return { conversation: conv as ChatConversation, profile };
  });

export const adminListMessages = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => conversationIdSchema.parse(input))
  .handler(async ({ data, context }) => {
    await ensureStaff(context.supabase, context.userId, "view");
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: rows, error } = await asAny(supabaseAdmin)
      .from("live_chat_messages")
      .select("*")
      .eq("conversation_id", data.conversation_id)
      .order("created_at", { ascending: true });
    if (error) throw new Error(error.message);
    return (rows ?? []) as ChatMessage[];
  });

export const adminSendReply = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => sendMessageSchema.parse(input))
  .handler(async ({ data, context }) => {
    await ensureStaff(context.supabase, context.userId, "reply");
    const body = sanitizeBody(data.body);
    if (!body) throw new Error("Message empty");
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: msg, error } = await asAny(supabaseAdmin)
      .from("live_chat_messages")
      .insert({
        conversation_id: data.conversation_id,
        sender_type: "staff",
        sender_user_id: context.userId,
        body,
        delivered_at: new Date().toISOString(),
      })
      .select("*")
      .single();
    if (error) throw new Error(error.message);
    return msg as ChatMessage;
  });

export const adminMarkRead = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => conversationIdSchema.parse(input))
  .handler(async ({ data, context }) => {
    await ensureStaff(context.supabase, context.userId, "view");
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const now = new Date().toISOString();
    await asAny(supabaseAdmin)
      .from("live_chat_conversations")
      .update({ unread_for_staff: 0, staff_last_seen_at: now })
      .eq("id", data.conversation_id);
    await asAny(supabaseAdmin)
      .from("live_chat_messages")
      .update({ read_at: now })
      .eq("conversation_id", data.conversation_id)
      .eq("sender_type", "user")
      .is("read_at", null);
    return { ok: true };
  });

const updateConvSchema = z.object({
  conversation_id: z.string().uuid(),
  status: z.enum(["new", "open", "pending", "waiting_user", "resolved", "closed"]).optional(),
  priority: z.enum(["low", "normal", "high", "urgent"]).optional(),
  assigned_to: z.string().uuid().nullable().optional(),
  is_blocked: z.boolean().optional(),
});

export const adminUpdateConversation = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => updateConvSchema.parse(input))
  .handler(async ({ data, context }) => {
    await ensureStaff(context.supabase, context.userId, "view");
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { conversation_id, ...patch } = data;

    if ("assigned_to" in patch) {
      await ensureStaff(context.supabase, context.userId, "assign");
      await asAny(supabaseAdmin)
        .from("live_chat_assignments")
        .insert({
          conversation_id,
          assigned_to: patch.assigned_to ?? null,
          assigned_by: context.userId,
        });
    }
    if (patch.status === "closed" || patch.status === "resolved") {
      await ensureStaff(context.supabase, context.userId, "close");
    }

    const { error } = await asAny(supabaseAdmin)
      .from("live_chat_conversations")
      .update(patch)
      .eq("id", conversation_id);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

// Notes
export const adminListNotes = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => conversationIdSchema.parse(input))
  .handler(async ({ data, context }) => {
    await ensureStaff(context.supabase, context.userId, "view");
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: rows, error } = await asAny(supabaseAdmin)
      .from("live_chat_notes")
      .select("*")
      .eq("conversation_id", data.conversation_id)
      .order("created_at", { ascending: true });
    if (error) throw new Error(error.message);
    return (rows ?? []) as ChatNote[];
  });

const noteSchema = z.object({
  conversation_id: z.string().uuid(),
  body: z.string().min(1).max(2000),
});

export const adminAddNote = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => noteSchema.parse(input))
  .handler(async ({ data, context }) => {
    await ensureStaff(context.supabase, context.userId, "view");
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: row, error } = await asAny(supabaseAdmin)
      .from("live_chat_notes")
      .insert({
        conversation_id: data.conversation_id,
        author_id: context.userId,
        body: sanitizeBody(data.body),
      })
      .select("*")
      .single();
    if (error) throw new Error(error.message);
    return row as ChatNote;
  });

// Staff list for assignment dropdown
export const adminListStaff = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator(noInput)
  .handler(async ({ context }) => {
    await ensureStaff(context.supabase, context.userId, "view");
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: admins } = await asAny(supabaseAdmin)
      .from("user_roles")
      .select("user_id")
      .eq("role", "admin");
    const { data: perms } = await asAny(supabaseAdmin)
      .from("live_chat_permissions")
      .select("user_id");
    const ids = Array.from(
      new Set<string>([
        ...((admins ?? []).map((r: any) => r.user_id) as string[]),
        ...((perms ?? []).map((r: any) => r.user_id) as string[]),
      ]),
    );
    if (ids.length === 0) return [] as { id: string; name: string; email: string | null }[];
    const { data: profs } = await asAny(supabaseAdmin)
      .from("profiles")
      .select("id, full_name, email")
      .in("id", ids);
    return (profs ?? []).map((p: any) => ({
      id: p.id,
      name: p.full_name ?? "Staff",
      email: p.email,
    }));
  });

// Analytics
export const adminChatAnalytics = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator(noInput)
  .handler(async ({ context }) => {
    await ensureStaff(context.supabase, context.userId, "view");
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: convs } = await asAny(supabaseAdmin)
      .from("live_chat_conversations")
      .select("id, status, created_at, last_message_at");
    const list = (convs ?? []) as Array<{
      id: string;
      status: ChatStatus;
      created_at: string;
      last_message_at: string;
    }>;
    const total = list.length;
    const active = list.filter((c) => !["closed", "resolved"].includes(c.status)).length;
    const closed = list.filter((c) => ["closed", "resolved"].includes(c.status)).length;
    const open = list.filter((c) => c.status === "open" || c.status === "new").length;
    // 7-day trend
    const days: Record<string, number> = {};
    for (let i = 6; i >= 0; i--) {
      const d = new Date();
      d.setDate(d.getDate() - i);
      days[d.toISOString().slice(0, 10)] = 0;
    }
    list.forEach((c) => {
      const k = c.created_at.slice(0, 10);
      if (k in days) days[k]++;
    });
    return { total, active, closed, open, trend: Object.entries(days).map(([day, count]) => ({ day, count })) };
  });

// Notifications
export const listMyChatNotifications = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator(noInput)
  .handler(async ({ context }) => {
    const { data, error } = await asAny(context.supabase)
      .from("live_chat_notifications")
      .select("*")
      .eq("recipient_id", context.userId)
      .order("created_at", { ascending: false })
      .limit(50);
    if (error) throw new Error(error.message);
    return data ?? [];
  });

export const markChatNotificationsRead = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator(noInput)
  .handler(async ({ context }) => {
    await asAny(context.supabase)
      .from("live_chat_notifications")
      .update({ read_at: new Date().toISOString() })
      .eq("recipient_id", context.userId)
      .is("read_at", null);
    return { ok: true };
  });
