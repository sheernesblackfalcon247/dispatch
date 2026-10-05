"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import Image from "next/image";
import { motion } from "framer-motion";
import {
  Download,
  Share,
  PlusSquare,
  MoreVertical,
  MonitorDown,
  CheckCircle2,
  Zap,
  BellRing,
  Smartphone,
  ArrowRight,
  Loader2,
  type LucideIcon,
} from "lucide-react";

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
}

type Platform = "ios" | "android" | "desktop";
type State = "checking" | "ready" | "installing" | "installed" | "manual";

/**
 * /install — one-tap PWA install page. Linked from both the staff welcome
 * email and the customer booking-confirmation email; the page itself is
 * generic (one card, no role-specific wording).
 *
 * Browsers only allow an install prompt from a page (never from an email), so
 * the email's "Install the app" button lands here. Chrome / Edge / Android fire
 * `beforeinstallprompt`, which we capture and trigger on tap. iOS Safari has no
 * prompt API, so we show Add-to-Home-Screen steps instead; other browsers get
 * matching manual steps.
 */
export default function InstallPage() {
  const [deferred, setDeferred] = useState<BeforeInstallPromptEvent | null>(null);
  const [state, setState] = useState<State>("checking");
  const [platform, setPlatform] = useState<Platform>("desktop");

  useEffect(() => {
    const ua = navigator.userAgent;
    const isIOS =
      /iphone|ipad|ipod/i.test(ua) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
    const isAndroid = /android/i.test(ua);
    setPlatform(isIOS ? "ios" : isAndroid ? "android" : "desktop");

    const nav = navigator as Navigator & { standalone?: boolean };
    const standalone = window.matchMedia("(display-mode: standalone)").matches || nav.standalone === true;
    if (standalone) {
      setState("installed");
      return;
    }

    const onPrompt = (e: Event) => {
      e.preventDefault();
      setDeferred(e as BeforeInstallPromptEvent);
      setState("ready");
    };
    const onInstalled = () => setState("installed");
    window.addEventListener("beforeinstallprompt", onPrompt);
    window.addEventListener("appinstalled", onInstalled);

    // The prompt event arrives shortly after load on supporting browsers. If it
    // hasn't by then (iOS, Firefox, already-installed-but-opened-in-tab), fall
    // back to step-by-step instructions instead of a dead button.
    const t = setTimeout(() => setState((s) => (s === "checking" ? "manual" : s)), isIOS ? 0 : 2500);

    return () => {
      clearTimeout(t);
      window.removeEventListener("beforeinstallprompt", onPrompt);
      window.removeEventListener("appinstalled", onInstalled);
    };
  }, []);

  const install = async () => {
    if (!deferred) return;
    setState("installing");
    try {
      await deferred.prompt();
      const { outcome } = await deferred.userChoice;
      setDeferred(null);
      // On dismiss the browser won't re-fire the prompt on this page, so show
      // the manual steps instead of a dead button.
      setState(outcome === "accepted" ? "installed" : "manual");
    } catch {
      setState("manual");
    }
  };

  return (
    <main className="min-h-screen bg-gradient-to-b from-brand-50/70 via-white to-white">
      <div className="mx-auto flex min-h-screen w-full max-w-md flex-col justify-center px-5 py-10 sm:py-16">
        <motion.div
          initial={{ opacity: 0, y: 18 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5, ease: [0.16, 1, 0.3, 1] }}
          className="rounded-3xl border border-gray-100 bg-white p-6 text-center shadow-xl shadow-gray-200/60 sm:p-7"
        >
          <div className="relative mx-auto mb-4 h-20 w-20">
            <div className="absolute inset-0 rounded-[22px] bg-brand-500/25 blur-2xl" />
            <Image
              src="/icon.svg"
              alt="Black Falcon 247 Taxi"
              width={80}
              height={80}
              priority
              className="relative h-20 w-20 rounded-[22px] shadow-xl shadow-brand-500/30"
            />
          </div>
          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-brand-600">Black Falcon 247 Taxi</p>
          <h1 className="mt-1 font-display text-2xl font-extrabold tracking-tight text-ink-950 sm:text-3xl">
            Get the app
          </h1>
          <p className="mx-auto mt-2 max-w-xs text-sm text-gray-500">
            Install it on this device so it opens full-screen, one tap away. No browser tabs.
          </p>

          {/* Perks + note sit ABOVE the action so the Install button is the last thing on the card */}
          <p className="mt-5 text-xs text-gray-400">Free · takes 2 seconds · no app store needed</p>
          <div className="mt-3 grid grid-cols-3 gap-2">
            <Perk icon={Zap} label="Opens instantly" />
            <Perk icon={BellRing} label="Live updates" />
            <Perk icon={Smartphone} label="Phone & desktop" />
          </div>

          <div className="mt-5 border-t border-gray-100 pt-5">
            {state === "checking" && (
              <div className="flex items-center justify-center gap-2 py-4 text-sm text-gray-400">
                <Loader2 className="h-4 w-4 animate-spin" /> Checking this device...
              </div>
            )}

            {(state === "ready" || state === "installing") && (
              <button
                onClick={install}
                disabled={state === "installing"}
                className="flex w-full items-center justify-center gap-2.5 rounded-2xl bg-ink-950 py-4 text-base font-bold text-white shadow-lg shadow-ink-950/20 transition-all hover:bg-ink-800 active:scale-[0.99] disabled:opacity-70"
              >
                {state === "installing" ? (
                  <Loader2 className="h-5 w-5 animate-spin" />
                ) : (
                  <Download className="h-5 w-5 text-brand-400" />
                )}
                {state === "installing" ? "Confirm in the popup..." : "Install app"}
              </button>
            )}

            {state === "installed" && (
              <div>
                <div className="mx-auto mb-3 flex h-14 w-14 items-center justify-center rounded-full bg-green-50 text-green-600">
                  <CheckCircle2 className="h-8 w-8" />
                </div>
                <p className="font-display text-lg font-bold text-ink-950">App installed</p>
                <p className="mt-1 text-sm text-gray-500">You&apos;re all set. Find Black Falcon with your other apps.</p>
                <Link
                  href="/"
                  className="mt-4 flex w-full items-center justify-center gap-2 rounded-2xl bg-brand-500 py-3.5 font-bold text-ink-950 shadow-lg shadow-brand-500/30 transition-colors hover:bg-brand-400"
                >
                  Open the app <ArrowRight className="h-4 w-4" />
                </Link>
              </div>
            )}

            {state === "manual" && <ManualSteps platform={platform} />}
          </div>
        </motion.div>
      </div>
    </main>
  );
}

function ManualSteps({ platform }: { platform: Platform }) {
  const steps: { icon: LucideIcon; text: React.ReactNode }[] =
    platform === "ios"
      ? [
          { icon: Share, text: <>Tap the <b>Share</b> button at the bottom of Safari.</> },
          { icon: PlusSquare, text: <>Scroll down and tap <b>Add to Home Screen</b>.</> },
          { icon: CheckCircle2, text: <>Tap <b>Add</b>. Black Falcon now lives on your home screen.</> },
        ]
      : platform === "android"
        ? [
            { icon: MoreVertical, text: <>Tap the <b>three-dot menu</b> in the top-right of Chrome.</> },
            { icon: Download, text: <>Choose <b>Install app</b> (or <b>Add to Home screen</b>).</> },
            { icon: CheckCircle2, text: <>Tap <b>Install</b>. Done. Find it with your other apps.</> },
          ]
        : [
            { icon: MonitorDown, text: <>In Chrome or Edge, click the <b>install icon</b> at the right end of the address bar.</> },
            { icon: MoreVertical, text: <>Or open the <b>three-dot menu</b>, then <b>Cast, save and share</b>, then <b>Install page as app</b>.</> },
            { icon: CheckCircle2, text: <>Click <b>Install</b>. It opens in its own window and pins to your taskbar.</> },
          ];

  const title =
    platform === "ios" ? "Add to your iPhone / iPad" : platform === "android" ? "Install on Android" : "Install on this computer";

  return (
    <div className="text-left">
      <p className="mb-3 flex items-center gap-2 font-display text-sm font-bold text-ink-950">
        <Download className="h-4 w-4 text-brand-500" /> {title}
      </p>
      <ol className="space-y-2.5">
        {steps.map((s, i) => (
          <li key={i} className="flex items-start gap-3 rounded-xl bg-gray-50 px-3 py-2.5">
            <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-brand-500 text-xs font-extrabold text-ink-950">
              {i + 1}
            </span>
            <span className="flex min-w-0 flex-1 items-start gap-2 pt-0.5 text-sm text-gray-600">
              <s.icon className="mt-0.5 h-4 w-4 shrink-0 text-gray-400" />
              <span>{s.text}</span>
            </span>
          </li>
        ))}
      </ol>
      {platform === "desktop" && (
        <p className="mt-3 text-xs text-gray-400">
          Using Firefox or Safari on desktop? Open this page in <b>Chrome</b> or <b>Edge</b> to install.
        </p>
      )}
    </div>
  );
}

function Perk({ icon: Icon, label }: { icon: LucideIcon; label: string }) {
  return (
    <div className="flex flex-col items-center gap-1.5 rounded-2xl bg-gray-50 px-2 py-3 text-center">
      <Icon className="h-4 w-4 text-brand-600" />
      <span className="text-[11px] font-medium leading-tight text-gray-500">{label}</span>
    </div>
  );
}
