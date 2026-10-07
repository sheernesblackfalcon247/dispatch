import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";

/**
 * Daily keep-alive, called by the Vercel cron in vercel.json.
 *
 * Supabase pauses free-tier projects after a week without activity, which
 * takes the booking form and dispatch board down with it. One one-row read a
 * day is enough to keep the project awake and costs next to nothing.
 *
 * Vercel sends `Authorization: Bearer <CRON_SECRET>` on cron calls when that
 * env var is set. Without it this route refuses everyone, so it can't be used
 * to hammer the database from outside.
 */
export async function GET(req: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret || req.headers.get("authorization") !== `Bearer ${secret}`) {
    return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  }

  const { error } = await createAdminClient().from("app_settings").select("key").limit(1);
  if (error) {
    console.error("[keepalive] supabase ping failed", error);
    return NextResponse.json({ ok: false, error: "db_error" }, { status: 500 });
  }

  return NextResponse.json({ ok: true, at: new Date().toISOString() });
}
