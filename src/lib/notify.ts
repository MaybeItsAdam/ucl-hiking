import { importPKCS8, SignJWT } from "jose";
import { getSupabaseAdmin, isSupabaseConfigured } from "@/lib/supabase";

/**
 * Tell members something. Every notification lands in the in-app inbox; if the
 * member has the phone app and push is set up, it is also pushed through
 * Firebase Cloud Messaging (HTTP v1). Without FIREBASE_SERVICE_ACCOUNT the
 * inbox still works and push is skipped.
 */

export const NOTIFICATION_KINDS = ["event_changed", "reminder", "kit", "leader", "broadcast"] as const;
export type NotificationKind = (typeof NOTIFICATION_KINDS)[number];

export const NOTIFICATION_LABELS: Record<NotificationKind, { label: string; hint: string; optional: boolean }> = {
  event_changed: { label: "Walk changes", hint: "A walk you're on is moved or cancelled.", optional: false },
  reminder: { label: "Day-before reminders", hint: "Meet time, kit and the forecast.", optional: true },
  kit: { label: "Kit", hint: "Your request is approved or declined, or a loan is overdue.", optional: true },
  leader: { label: "Leading", hint: "You're made leader or backmarker of a walk.", optional: true },
  broadcast: { label: "Club news", hint: "Messages from the committee.", optional: true },
};

export interface NotificationMessage {
  kind: NotificationKind;
  title: string;
  body?: string | null;
  /** A path in the app, e.g. /portal/events/<id>. */
  url?: string | null;
}

export function isNotificationKind(value: unknown): value is NotificationKind {
  return typeof value === "string" && NOTIFICATION_KINDS.includes(value as NotificationKind);
}

/** Who still wants this kind: everyone, less anyone who switched an optional kind off. */
export function recipientsAfterPrefs(
  memberIds: string[],
  kind: NotificationKind,
  optedOut: { member_id: string; kind: string; enabled: boolean }[],
): string[] {
  const unique = [...new Set(memberIds)];
  if (!NOTIFICATION_LABELS[kind].optional) return unique;
  const off = new Set(optedOut.filter((p) => p.kind === kind && !p.enabled).map((p) => p.member_id));
  return unique.filter((id) => !off.has(id));
}

interface ServiceAccount {
  project_id: string;
  client_email: string;
  private_key: string;
}

function serviceAccount(): ServiceAccount | null {
  const raw = process.env.FIREBASE_SERVICE_ACCOUNT;
  if (!raw) return null;
  try {
    const json = raw.trim().startsWith("{") ? raw : Buffer.from(raw, "base64").toString("utf8");
    const parsed = JSON.parse(json) as ServiceAccount;
    return parsed.project_id && parsed.client_email && parsed.private_key ? parsed : null;
  } catch {
    console.error("[notify] FIREBASE_SERVICE_ACCOUNT is not a service account JSON");
    return null;
  }
}

export function pushConfigured(): boolean {
  return serviceAccount() !== null;
}

let cachedToken: { value: string; expiresAt: number } | null = null;

async function accessToken(account: ServiceAccount): Promise<string> {
  if (cachedToken && cachedToken.expiresAt > Date.now() + 60_000) return cachedToken.value;
  const key = await importPKCS8(account.private_key, "RS256");
  const assertion = await new SignJWT({ scope: "https://www.googleapis.com/auth/firebase.messaging" })
    .setProtectedHeader({ alg: "RS256", typ: "JWT" })
    .setIssuer(account.client_email)
    .setAudience("https://oauth2.googleapis.com/token")
    .setIssuedAt()
    .setExpirationTime("1h")
    .sign(key);
  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer", assertion }),
    signal: AbortSignal.timeout(10_000),
  });
  if (!res.ok) throw new Error(`Google token exchange returned ${res.status}`);
  const body = (await res.json()) as { access_token: string; expires_in: number };
  cachedToken = { value: body.access_token, expiresAt: Date.now() + body.expires_in * 1000 };
  return cachedToken.value;
}

export function fcmMessage(token: string, message: NotificationMessage) {
  return {
    message: {
      token,
      notification: { title: message.title, ...(message.body ? { body: message.body } : {}) },
      data: { kind: message.kind, url: message.url ?? "/portal/inbox" },
      android: { priority: "high", notification: { channel_id: "club" } },
      apns: { payload: { aps: { sound: "default" } } },
    },
  };
}

/** FCM says this token will never work again: the app was uninstalled or the token rotated. */
export function isDeadToken(status: number, body: string): boolean {
  return status === 404 || (status === 400 && /UNREGISTERED|registration token is not a valid/i.test(body));
}

async function push(tokens: { token: string }[], message: NotificationMessage): Promise<{ sent: number; dead: string[] }> {
  const account = serviceAccount();
  if (!account || !tokens.length) return { sent: 0, dead: [] };
  let bearer: string;
  try {
    bearer = await accessToken(account);
  } catch (e) {
    console.error(`[notify] no FCM access token: ${(e as Error).message}`);
    return { sent: 0, dead: [] };
  }
  const endpoint = `https://fcm.googleapis.com/v1/projects/${account.project_id}/messages:send`;
  const dead: string[] = [];
  let sent = 0;
  await Promise.all(
    tokens.map(async ({ token }) => {
      try {
        const res = await fetch(endpoint, {
          method: "POST",
          headers: { Authorization: `Bearer ${bearer}`, "Content-Type": "application/json" },
          body: JSON.stringify(fcmMessage(token, message)),
          signal: AbortSignal.timeout(10_000),
        });
        if (res.ok) sent += 1;
        else if (isDeadToken(res.status, await res.text())) dead.push(token);
      } catch {
        // One slow phone never holds up the rest.
      }
    }),
  );
  return { sent, dead };
}

/**
 * Notify members. Best effort: a failure is logged and never fails the action
 * that caused it (a cancelled walk is still cancelled if FCM is down).
 */
export async function notify(memberIds: string[], message: NotificationMessage): Promise<{ inbox: number; pushed: number }> {
  if (!memberIds.length || !isSupabaseConfigured()) return { inbox: 0, pushed: 0 };
  const supabase = getSupabaseAdmin();
  try {
    const { data: prefs } = await supabase
      .from("notification_prefs")
      .select("member_id, kind, enabled")
      .in("member_id", [...new Set(memberIds)])
      .eq("kind", message.kind);
    const recipients = recipientsAfterPrefs(memberIds, message.kind, prefs ?? []);
    if (!recipients.length) return { inbox: 0, pushed: 0 };

    const rows = recipients.map((member_id) => ({
      member_id,
      kind: message.kind,
      title: message.title.slice(0, 140),
      body: message.body?.slice(0, 1000) ?? null,
      url: message.url ?? null,
    }));
    const { error } = await supabase.from("notifications").insert(rows);
    if (error) console.error(`[notify] inbox write failed: ${error.message}`);

    let pushed = 0;
    if (pushConfigured()) {
      const { data: tokens } = await supabase.from("push_tokens").select("token").in("member_id", recipients);
      const result = await push(tokens ?? [], message);
      pushed = result.sent;
      if (result.dead.length) await supabase.from("push_tokens").delete().in("token", result.dead);
    }
    return { inbox: error ? 0 : rows.length, pushed };
  } catch (e) {
    console.error(`[notify] ${message.kind} failed: ${(e as Error).message}`);
    return { inbox: 0, pushed: 0 };
  }
}

/** Members on a walk's register who have an account, for walk notifications. */
export async function walkRecipients(eventSuuId: string): Promise<string[]> {
  if (!isSupabaseConfigured()) return [];
  const { data } = await getSupabaseAdmin()
    .from("event_attendees")
    .select("member_id")
    .eq("event_suu_id", eventSuuId)
    .eq("removed", false)
    .not("member_id", "is", null);
  return (data ?? []).map((r) => r.member_id as string);
}
