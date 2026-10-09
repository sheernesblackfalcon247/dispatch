"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { motion } from "framer-motion";
import {
  LayoutDashboard,
  BarChart3,
  ClipboardList,
  CreditCard,
  Tags,
  CarFront,
  Users,
  Code2,
  ShieldCheck,
  Radio,
  Headset,
  ScrollText,
  Settings,
} from "lucide-react";
import SignOutButton from "@/components/dashboard/SignOutButton";
import { cn } from "@/lib/format";

const NAV = [
  { href: "/admin", label: "Overview", icon: LayoutDashboard },
  { href: "/admin/dispatch", label: "Dispatch", icon: Radio },
  { href: "/admin/analytics", label: "Analytics", icon: BarChart3 },
  { href: "/admin/bookings", label: "Bookings", icon: ClipboardList },
  { href: "/admin/payments", label: "Payments", icon: CreditCard },
  { href: "/admin/pricing", label: "Pricing", icon: Tags },
  { href: "/admin/drivers", label: "Drivers", icon: CarFront },
  { href: "/admin/dispatchers", label: "Dispatchers", icon: Headset },
  { href: "/admin/customers", label: "Customers", icon: Users },
  { href: "/admin/websites", label: "Widgets", icon: Code2 },
  { href: "/admin/logs", label: "Activity Logs", icon: ScrollText },
  { href: "/admin/settings", label: "Settings", icon: Settings },
];

export default function AdminShell({
  name,
  role = "Administrator",
  children,
}: {
  name: string;
  role?: string;
  children: React.ReactNode;
}) {
  const pathname = usePathname();

  return (
    <div className="flex min-h-screen bg-gray-50">
      {/* Sidebar */}
      <aside className="fixed inset-y-0 left-0 hidden w-60 flex-col border-r border-gray-200 bg-white md:flex print:hidden">
        <div className="flex items-center gap-2.5 px-5 py-5">
          <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-gradient-to-br from-emerald-500 to-teal-600">
            <ShieldCheck className="h-5 w-5 text-white" strokeWidth={2.3} />
          </div>
          <div>
            <p className="font-display text-sm font-bold leading-tight text-ink-950">Super Admin</p>
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
                  active ? "text-emerald-700" : "text-gray-500 hover:bg-gray-50 hover:text-ink-950"
                )}
              >
                {active && (
                  <motion.span
                    layoutId="admin-active"
                    className="absolute inset-0 rounded-xl bg-emerald-50"
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
            <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-emerald-100 text-xs font-bold text-emerald-700">
              {name.charAt(0)}
            </div>
            <div className="min-w-0 leading-tight">
              <p className="truncate text-sm font-semibold text-ink-950">{name}</p>
              <p className="text-[11px] text-gray-400">{role}</p>
            </div>
          </div>
          <SignOutButton dark={false} full />
        </div>
      </aside>

      {/* Main */}
      <main className="flex-1 md:ml-60 print:ml-0">{children}</main>
    </div>
  );
}
