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

const TYPE_STYLES: Record<
  NoticeType,
  {
    bar: string;
    chip: string;
    icon: React.ComponentType<{ className?: string }>;
    glow: string;
  }
> = {
  info: {
    bar: "border-l-[3px] border-sky-500 bg-gradient-to-r from-sky-50/90 to-sky-100/60 dark:from-sky-950/70 dark:to-sky-900/40 text-sky-900 dark:text-sky-100",
    chip: "bg-sky-500/12 text-sky-700 border-sky-500/25 dark:bg-sky-400/15 dark:text-sky-200 dark:border-sky-400/25",
    icon: Info,
    glow: "bg-sky-500/5",
  },
  success: {
    bar: "border-l-[3px] border-emerald-500 bg-gradient-to-r from-emerald-50/90 to-emerald-100/60 dark:from-emerald-950/70 dark:to-emerald-900/40 text-emerald-900 dark:text-emerald-100",
    chip: "bg-emerald-500/12 text-emerald-700 border-emerald-500/25 dark:bg-emerald-400/15 dark:text-emerald-200 dark:border-emerald-400/25",
    icon: CheckCircle2,
    glow: "bg-emerald-500/5",
  },
  warning: {
    bar: "border-l-[3px] border-amber-500 bg-gradient-to-r from-amber-50/90 to-amber-100/60 dark:from-amber-950/70 dark:to-amber-900/40 text-amber-900 dark:text-amber-100",
    chip: "bg-amber-500/12 text-amber-700 border-amber-500/25 dark:bg-amber-400/15 dark:text-amber-200 dark:border-amber-400/25",
    icon: AlertTriangle,
    glow: "bg-amber-500/5",
  },
  important: {
    bar: "border-l-[3px] border-rose-500 bg-gradient-to-r from-rose-50/90 to-rose-100/60 dark:from-rose-950/70 dark:to-rose-900/40 text-rose-900 dark:text-rose-100",
    chip: "bg-rose-500/12 text-rose-700 border-rose-500/25 dark:bg-rose-400/15 dark:text-rose-200 dark:border-rose-400/25",
    icon: Megaphone,
    glow: "bg-rose-500/5",
  },
  custom: {
    bar: "border-l-[3px] border-violet-500 bg-gradient-to-r from-violet-50/90 to-violet-100/60 dark:from-violet-950/70 dark:to-violet-900/40 text-violet-900 dark:text-violet-100",
    chip: "bg-violet-500/12 text-violet-700 border-violet-500/25 dark:bg-violet-400/15 dark:text-violet-200 dark:border-violet-400/25",
    icon: Sparkles,
    glow: "bg-violet-500/5",
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
      className={`group relative overflow-hidden rounded-xl ${styles.bar} shadow-[0_2px_8px_rgba(0,0,0,0.06),0_1px_3px_rgba(0,0,0,0.04)] dark:shadow-[0_2px_8px_rgba(0,0,0,0.25),0_1px_3px_rgba(0,0,0,0.15)] ring-1 ring-black/[0.03] dark:ring-white/[0.04]`}
    >
      {/* Subtle ambient glow */}
      <div className={`pointer-events-none absolute -right-8 -top-8 h-24 w-24 rounded-full blur-3xl ${styles.glow}`} />
      <div className={`pointer-events-none absolute -bottom-6 -left-4 h-16 w-16 rounded-full blur-2xl ${styles.glow}`} />

      <div className="relative flex items-center gap-3.5 px-4 py-3 sm:px-5 sm:py-3.5">
        {/* Icon badge */}
        <span
          className={`inline-flex shrink-0 items-center gap-1.5 rounded-lg border px-3 py-1.5 text-[11px] font-bold uppercase tracking-wider ${styles.chip} shadow-[inset_0_1px_0_rgba(255,255,255,0.5)] dark:shadow-[inset_0_1px_0_rgba(255,255,255,0.08)]`}
        >
          <Icon className="h-3.5 w-3.5" />
          {title || (value.type === "important" ? "Important" : value.type === "warning" ? "Alert" : "Notice")}
        </span>

        {isTicker ? (
          <div
            className="relative min-w-0 flex-1 overflow-hidden"
            style={{ maskImage: "linear-gradient(to right, transparent, #000 4%, #000 96%, transparent)", WebkitMaskImage: "linear-gradient(to right, transparent, #000 4%, #000 96%, transparent)" }}
          >
            <div
              className={`notice-ticker flex w-max whitespace-nowrap text-[13px] font-semibold tracking-wide ${
                value.pauseOnHover ? "hover:[animation-play-state:paused]" : ""
              }`}
              style={{
                animationDuration: SPEED_DURATION[value.speed],
                animationIterationCount: value.loop ? "infinite" : 1,
              }}
            >
              {/* Two identical halves; translateX(-50%) yields a seamless loop */}
              <span className="pr-16">{content}</span>
              <span aria-hidden className="pr-16">{content}</span>
            </div>
          </div>
        ) : (
          <div className="min-w-0 flex-1 whitespace-pre-line text-[13px] font-semibold leading-relaxed tracking-wide">
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
