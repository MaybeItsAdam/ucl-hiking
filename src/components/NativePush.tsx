"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { Capacitor } from "@capacitor/core";
import { PushNotifications } from "@capacitor/push-notifications";

/**
 * Registers the phone app for push once a member is signed in. Off unless
 * NEXT_PUBLIC_PUSH_ENABLED=true: calling register() in a build without
 * google-services.json crashes the app, so the switch is flipped only once a
 * build with it has shipped.
 */
export function NativePush() {
  const router = useRouter();

  useEffect(() => {
    if (!Capacitor.isNativePlatform() || process.env.NEXT_PUBLIC_PUSH_ENABLED !== "true") return;
    let cancelled = false;
    const platform = Capacitor.getPlatform() === "ios" ? "ios" : "android";

    const handles = Promise.all([
      PushNotifications.addListener("registration", ({ value }) => {
        void fetch("/api/push/tokens", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ token: value, platform }),
        });
      }),
      PushNotifications.addListener("registrationError", (err) => console.warn("[push] registration failed", err.error)),
      // Tapping a notification opens the page it is about.
      PushNotifications.addListener("pushNotificationActionPerformed", ({ notification }) => {
        const url = (notification.data as { url?: string } | undefined)?.url;
        if (url?.startsWith("/")) router.push(url);
      }),
    ]);

    (async () => {
      let status = await PushNotifications.checkPermissions();
      if (status.receive === "prompt" || status.receive === "prompt-with-rationale") {
        status = await PushNotifications.requestPermissions();
      }
      if (cancelled || status.receive !== "granted") return;
      if (platform === "android") {
        await PushNotifications.createChannel({ id: "club", name: "Club", description: "Walks, reminders and club news", importance: 4 }).catch(() => undefined);
      }
      await PushNotifications.register();
    })().catch((e) => console.warn("[push]", e));

    return () => {
      cancelled = true;
      void handles.then((list) => list.forEach((h) => h.remove()));
    };
  }, [router]);

  return null;
}
