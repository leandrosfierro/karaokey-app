import { useEffect } from "react";
import { useRouter } from "next/router";
import { useAuth } from "../lib/auth";
import { supabase } from "../lib/supabase";

const HEARTBEAT_MS = 55_000;

export function ActivityTracker() {
  const router = useRouter();
  const { user, modo } = useAuth();

  useEffect(() => {
    if (!user) return;
    const ping = () => {
      if (document.visibilityState !== "visible") return;
      void supabase.rpc("rpc_activity_ping", {
        p_page: router.asPath.split("?")[0] || "/",
        p_mode: modo ?? null,
      });
    };
    ping();
    const timer = window.setInterval(ping, HEARTBEAT_MS);
    document.addEventListener("visibilitychange", ping);
    return () => {
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", ping);
    };
  }, [user, modo, router.asPath]);

  return null;
}
