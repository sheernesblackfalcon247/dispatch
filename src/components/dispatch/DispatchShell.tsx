"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { motion } from "framer-motion";
import { Radio, ClipboardList, CarFront, Users, LogOut } from "lucide-react";
import SignOutButton from "@/components/dashboard/SignOutButton";
import { createClient } from "@/lib/supabase/client";
import { cn } from "@/lib/format";

const NAV = [
  { href: "/dispatch", label: "Live board", short: "Live", icon: Radio },
  { href: "/dispatch/bookings", label: "Bookings", short: "Bookings", icon: ClipboardList },
  { href: "/dispatch/drivers", label: "Drivers", short: "Drivers", icon: CarFront },
  { href: "/dispatch/customers", label: "Customers", short: "Customers", icon: Users },
];

export default function DispatchShell({
  name,
  isAdmin = false,
  children,
}: {
  name: string;
  isAdmin?: boolean;
  children: React.ReactNode;
}) {
  const pathname = usePathname();
  const router = useRouter();

  const signOut = async () => {
    await createClient().auth.signOut();
    router.push("/login");
    router.refresh();
  };

  return (
    <div className="flex min-h-screen bg-gray-50">
      {/* Sidebar — tablet / desktop */}
      <aside className="fixed inset-y-0 left-0 z-30 hidden w-56 flex-col border-r border-gray-200 bg-white md:flex">
        <div className="flex items-center gap-2.5 px-5 py-5">
          <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-blue-600">
            <Radio className="h-5 w-5 text-white" strokeWidth={2.3} />
          </div>
          <div>
            <p className="font-display text-sm font-bold leading-tight text-ink-950">Dispatch</p>
            <p className="text-xs text-gray-400">Black Falcon 247 Taxi</p>
          </div>
        </div>

        <nav className="flex-1 space-y-1 px-3 py-2">
          {NAV.map((item) => {
            const active = pathname === item.href;
            return (
              <Link
                key={item.href}
                href={item.href}
                className={cn(
                  "relative flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium transition-colors",
                  active ? "text-blue-700" : "text-gray-500 hover:bg-gray-50 hover:text-ink-950"
                )}
              >
                {active && (
                  <motion.span
                    layoutId="dispatch-active"
                    className="absolute inset-0 rounded-xl bg-blue-50"
                    transition={{ type: "spring", stiffness: 400, damping: 32 }}
                  />
                )}
                <item.icon className="relative h-[18px] w-[18px]" />
                <span className="relative">{item.label}</span>
              </Link>
            );
          })}
        </nav>

        <div className="space-y-2 border-t border-gray-100 p-3">
          <div className="flex min-w-0 items-center gap-2.5 px-2 py-1.5">
            <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-blue-100 text-xs font-bold text-blue-700">
              {name.charAt(0)}
            </div>
            <div className="min-w-0 leading-tight">
              <p className="truncate text-sm font-semibold text-ink-950">{name}</p>
              <p className="text-[11px] text-gray-400">{isAdmin ? "Admin" : "Dispatcher"}</p>
            </div>
          </div>
          <SignOutButton dark={false} full />
        </div>
      </aside>

      {/* Main — on phones leave room for the bottom tab bar */}
      {/* min-w-0 stops long content stretching the flex child past the viewport (horizontal scroll on phones) */}
      <main className="min-h-screen min-w-0 flex-1 overflow-x-hidden pb-[calc(64px+env(safe-area-inset-bottom))] md:ml-56 md:pb-0">
        {children}
      </main>

      {/* Bottom tab bar — phones only */}
      <nav
        aria-label="Dispatch navigation"
        className="fixed inset-x-0 bottom-0 z-30 border-t border-gray-200 bg-white/95 pb-[env(safe-area-inset-bottom)] backdrop-blur md:hidden"
      >
        <div className="grid h-16 grid-cols-5">
          {NAV.map((item) => {
            const active = pathname === item.href;
            return (
              <Link
                key={item.href}
                href={item.href}
                className={cn(
                  "flex flex-col items-center justify-center gap-1 text-[10.5px] font-semibold transition-colors",
                  active ? "text-blue-600" : "text-gray-400 active:text-ink-950"
                )}
              >
                <span
                  className={cn(
                    "flex h-8 w-12 items-center justify-center rounded-full transition-colors",
                    active && "bg-blue-50"
                  )}
                >
                  <item.icon className="h-[20px] w-[20px]" strokeWidth={active ? 2.4 : 2} />
                </span>
                {item.short}
              </Link>
            );
          })}
          <button
            onClick={signOut}
            className="flex flex-col items-center justify-center gap-1 text-[10.5px] font-semibold text-gray-400 active:text-red-600"
          >
            <span className="flex h-8 w-12 items-center justify-center rounded-full">
              <LogOut className="h-[20px] w-[20px]" strokeWidth={2} />
            </span>
            Sign out
          </button>
        </div>
      </nav>
    </div>
  );
}
