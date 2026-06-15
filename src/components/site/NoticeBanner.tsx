import { useEffect } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Info, CheckCircle2, AlertTriangle, Megaphone, Sparkles, X } from "lucide-react";
import { useSetting, SITE_SETTINGS_KEY } from "@/hooks/use-site-content";
import { supabase } from "@/integrations/supabase/client";

export type NoticeType = "info" | "success" | "warning" | "important" | "custom";
export type NoticeMode = "static" | "ticker";
export type NoticeSpeed = "slow" | "medium" | "fast";

export type NoticeBannerValue = {
  enabled: boolean;
  title: string;
  content: string;
  type: NoticeType;
  mode: NoticeMode;
  speed: NoticeSpeed;
  pauseOnHover: boolean;
  loop: boolean;
  startAt: string | null;
  endAt: string | null;
};

export const NOTICE_BANNER_DEFAULTS: NoticeBannerValue = {
  enabled: false,
  title: "",
  content: "",
  type: "info",
  mode: "static",
  speed: "medium",
  pauseOnHover: true,
  loop: true,
  startAt: null,
  endAt: null,
};

const TYPE_STYLES: Record<NoticeType, { bar: string; chip: string; icon: React.ComponentType<{ className?: string }> }> = {
  info: {
    bar: "border-sky-500/40 bg-sky-50 text-sky-950 dark:bg-sky-950/50 dark:text-sky-50",
    chip: "bg-sky-500/15 text-sky-900 border-sky-500/40 dark:bg-sky-400/20 dark:text-sky-100",
    icon: Info,
  },
  success: {
    bar: "border-emerald-500/40 bg-emerald-50 text-emerald-950 dark:bg-emerald-950/50 dark:text-emerald-50",
    chip: "bg-emerald-500/15 text-emerald-900 border-emerald-500/40 dark:bg-emerald-400/20 dark:text-emerald-100",
    icon: CheckCircle2,
  },
  warning: {
    bar: "border-amber-500/50 bg-amber-50 text-amber-950 dark:bg-amber-950/50 dark:text-amber-50",
    chip: "bg-amber-500/20 text-amber-900 border-amber-500/50 dark:bg-amber-400/25 dark:text-amber-100",
    icon: AlertTriangle,
  },
  important: {
    bar: "border-rose-500/50 bg-rose-50 text-rose-950 dark:bg-rose-950/50 dark:text-rose-50",
    chip: "bg-rose-500/20 text-rose-900 border-rose-500/50 dark:bg-rose-400/25 dark:text-rose-100",
    icon: Megaphone,
  },
  custom: {
    bar: "border-fuchsia-500/40 bg-fuchsia-50 text-fuchsia-950 dark:bg-fuchsia-950/50 dark:text-fuchsia-50",
    chip: "bg-fuchsia-500/15 text-fuchsia-900 border-fuchsia-500/40 dark:bg-fuchsia-400/20 dark:text-fuchsia-100",
    icon: Sparkles,
  },
};

const SPEED_DURATION: Record<NoticeSpeed, string> = {
  slow: "60s",
  medium: "35s",
  fast: "18s",
};

export function coerceNoticeBanner(v: unknown): NoticeBannerValue {
  const o = (v ?? {}) as Partial<NoticeBannerValue>;
  return {
    enabled: Boolean(o.enabled),
    title: typeof o.title === "string" ? o.title : "",
    content: typeof o.content === "string" ? o.content : "",
    type: (["info", "success", "warning", "important", "custom"] as const).includes(o.type as NoticeType)
      ? (o.type as NoticeType)
      : "info",
    mode: o.mode === "ticker" ? "ticker" : "static",
    speed: (["slow", "medium", "fast"] as const).includes(o.speed as NoticeSpeed)
      ? (o.speed as NoticeSpeed)
      : "medium",
    pauseOnHover: o.pauseOnHover === undefined ? true : Boolean(o.pauseOnHover),
    loop: o.loop === undefined ? true : Boolean(o.loop),
    startAt: typeof o.startAt === "string" && o.startAt ? o.startAt : null,
    endAt: typeof o.endAt === "string" && o.endAt ? o.endAt : null,
  };
}

function isWithinSchedule(v: NoticeBannerValue, now = Date.now()): boolean {
  if (v.startAt) {
    const t = Date.parse(v.startAt);
    if (Number.isFinite(t) && now < t) return false;
  }
  if (v.endAt) {
    const t = Date.parse(v.endAt);
    if (Number.isFinite(t) && now > t) return false;
  }
  return true;
}

/**
 * Self-subscribes to `site_settings` realtime changes so notice updates land
 * in every active student session within seconds — no refresh required.
 */
function useNoticeBannerRealtime() {
  const qc = useQueryClient();
  useEffect(() => {
    const channel = supabase.channel(`notice-banner-${Math.random().toString(36).slice(2, 8)}`);
    channel.on(
      "postgres_changes" as never,
      { event: "*", schema: "public", table: "site_settings" },
      () => {
        qc.invalidateQueries({ queryKey: SITE_SETTINGS_KEY });
      },
    );
    channel.subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, [qc]);
}

export function NoticeBannerPreview({ value }: { value: NoticeBannerValue }) {
  return <NoticeBannerView value={value} />;
}

function NoticeBannerView({ value }: { value: NoticeBannerValue }) {
  const styles = TYPE_STYLES[value.type] ?? TYPE_STYLES.info;
  const Icon = styles.icon;
  const content = value.content.trim();
  if (!content) return null;

  const title = value.title.trim();
  const isTicker = value.mode === "ticker";

  return (
    <div
      role="status"
      aria-live="polite"
      className={`group relative overflow-hidden rounded-2xl border ${styles.bar} backdrop-blur-md shadow-sm`}
    >
      <div className="flex items-center gap-3 px-4 py-2.5 sm:px-5">
        <span
          className={`inline-flex shrink-0 items-center gap-1.5 rounded-full border px-2.5 py-1 text-[10px] font-semibold uppercase tracking-widest ${styles.chip}`}
        >
          <Icon className="h-3 w-3" />
          {title || (value.type === "important" ? "Important" : value.type === "warning" ? "Alert" : "Notice")}
        </span>

        {isTicker ? (
          <div
            className="relative min-w-0 flex-1 overflow-hidden"
            style={{ maskImage: "linear-gradient(to right, transparent, #000 6%, #000 94%, transparent)" }}
          >
            <div
              className={`notice-ticker flex w-max items-center gap-16 whitespace-nowrap text-sm font-medium ${
                value.pauseOnHover ? "hover:[animation-play-state:paused]" : ""
              }`}
              style={{
                animationDuration: SPEED_DURATION[value.speed],
                animationIterationCount: value.loop ? "infinite" : 1,
              }}
            >
              {/* Duplicate the content twice so the loop is seamless */}
              <span className="px-2">{content}</span>
              <span aria-hidden className="px-2">{content}</span>
            </div>
          </div>
        ) : (
          <div className="min-w-0 flex-1 whitespace-pre-line text-sm font-medium leading-relaxed">
            {content}
          </div>
        )}

        <X className="hidden h-4 w-4 opacity-0" aria-hidden />
      </div>
    </div>
  );
}

/**
 * Global Notice Banner — renders the admin-configured notice across the
 * student portal. Returns null (and reserves no space) when disabled,
 * empty, or outside the scheduled window.
 */
export function NoticeBanner() {
  useNoticeBannerRealtime();
  const value = useSetting<NoticeBannerValue>("notice_banner", NOTICE_BANNER_DEFAULTS);
  if (!value.enabled) return null;
  if (!value.content.trim()) return null;
  if (!isWithinSchedule(value)) return null;
  return <NoticeBannerView value={value} />;
}
