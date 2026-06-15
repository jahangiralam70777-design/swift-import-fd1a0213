# Enterprise Live Chat System

This is a very large feature (~15–25 files, 7 new DB tables, RLS, realtime, storage, admin inbox, analytics). I'll deliver it in phases so each phase is reviewable, testable, and shippable. You already have a `LiveChatWidget` and `LiveChatWidgetSettings` stub — I'll replace those with the full system.

## Phase 1 — Database & Security Foundation
- Tables: `live_chat_conversations`, `live_chat_messages`, `live_chat_assignments`, `live_chat_notes`, `live_chat_settings`, `live_chat_permissions`, `live_chat_notifications`
- Storage bucket `chat-attachments` (private) + RLS
- RLS policies (strict per-user isolation; staff via `has_role` + per-permission checks)
- Indexes, FKs, `updated_at` triggers, realtime publication, REPLICA IDENTITY FULL
- Enum: status (`new|open|pending|waiting_user|resolved|closed`), priority, permission keys

## Phase 2 — Server Functions (RPC layer)
- `chat-conversations.functions.ts` (list/get/create/update status/assign/priority/close/reopen/block)
- `chat-messages.functions.ts` (send, mark read/delivered, typing broadcast, attachment sign URL)
- `chat-notes.functions.ts` (internal staff notes)
- `chat-settings.functions.ts` (admin settings + public read for widget)
- `chat-permissions.functions.ts` (grant/revoke moderator perms)
- `chat-analytics.functions.ts` (totals, response times, per-moderator)
- Guest conversation token flow (signed cookie) for non-logged-in users

## Phase 3 — Student Widget (`src/components/site/LiveChatWidget.tsx`)
- Floating button (configurable position, theme color, unread badge, online dot)
- Pre-chat form for guests (name/email/message + Zod validation)
- Auto-identify for logged-in users
- Realtime message stream, typing indicator, read receipts
- Attachments (image/pdf), emoji picker, sound toggle (localStorage)
- Auto-reconnect + resync, persistent conversation across sessions
- Light/dark, mobile responsive, framer-motion animations
- Mount in `_student.tsx` + landing layout

## Phase 4 — Admin Live Chat Manager
- Route `admin.live-chat.tsx` + sidebar entry "Support Center → Live Chat Manager"
- 3-pane Intercom-style layout: filters/list | thread | user details + actions
- Filters (All/Unread/Open/Pending/Closed/Assigned to me/High priority) + search
- Reply composer, internal notes tab, assign dropdown, status/priority controls, block, export (JSON/CSV)
- Realtime list + thread updates
- Notifications bell integration

## Phase 5 — Settings, Permissions, Analytics
- `LiveChatWidgetSettings.tsx` rebuilt: enable/disable, position, color, welcome/offline msg, business hours, auto-assign, notification prefs, attachment limits — instant realtime apply
- Moderator permissions manager (per-user grants)
- Analytics dashboard tab with recharts: volumes, response times, moderator leaderboard, daily/weekly/monthly

## Phase 6 — Polish & Hardening
- Rate limiting (messages/min per conversation) via DB function
- XSS sanitization via existing `sanitize-html.ts`
- Attachment MIME/size validation server-side
- Audit log entries
- Empty states, skeletons, error boundaries
- Manual QA checklist

## Technical Notes
- **Realtime**: Supabase `postgres_changes` on conversations + messages; presence channel per conversation for typing/online
- **Privacy**: RLS — students filter on `user_id = auth.uid() OR guest_token = current_setting('request.headers')::json->>'x-guest-token'`; staff via `has_role('admin') OR has_chat_permission(auth.uid(), 'view')`
- **Guest flow**: server fn issues opaque `guest_token`, stored httpOnly cookie; messages keyed by token
- **Attachments**: signed URLs from private bucket; 10MB cap; allowed MIME list
- **Performance**: paginated message load (50/page reverse), virtualized list for >200 messages, indexed on `(conversation_id, created_at desc)`

## Scope Confirmation
Given the size, please confirm:
1. **Proceed phase-by-phase** (I implement Phase 1, you review, then Phase 2, etc.) — safest
2. **Build all phases in one go** — fastest but very large diff, harder to review
3. **Trim scope** — e.g. skip analytics, skip attachments, skip moderator permissions for v1

Which do you prefer?