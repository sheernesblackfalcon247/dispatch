"use client";

import { useEffect, useState } from "react";
import { motion } from "framer-motion";
import { Loader2, Save, Plus, Trash2, Check, X, Percent, PoundSterling, Users, Luggage, Backpack, Baby, Layers, Calculator, AlertTriangle } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import PageHeader from "@/components/admin/PageHeader";
import { carIcon } from "@/components/booking/CarIcon";
import { cn, money } from "@/lib/format";
import { logActivity } from "@/lib/activity";
import type { VehicleCategory, PricingRule } from "@/lib/types";

export default function PricingPage() {
  const supabase = createClient();
  const [cats, setCats] = useState<VehicleCategory[]>([]);
  const [rules, setRules] = useState<PricingRule[]>([]);
  const [loading, setLoading] = useState(true);
  const [savingId, setSavingId] = useState<string | null>(null);
  const [savedId, setSavedId] = useState<string | null>(null);
  const [childSeatPrice, setChildSeatPrice] = useState(0);
  const [savingCsp, setSavingCsp] = useState(false);
  const [savedCsp, setSavedCsp] = useState(false);

  const load = async () => {
    const [{ data: c }, { data: r }, { data: setting }] = await Promise.all([
      supabase.from("vehicle_categories").select("*").order("sort_order"),
      supabase.from("pricing_rules").select("*").order("sort_order"),
      supabase.from("app_settings").select("value").eq("key", "child_seat_price").maybeSingle(),
    ]);
    setCats((c as VehicleCategory[]) ?? []);
    setRules((r as PricingRule[]) ?? []);
    setChildSeatPrice(Number((setting?.value as { amount?: number } | null)?.amount) || 0);
    setLoading(false);
  };

  const saveChildSeatPrice = async () => {
    setSavingCsp(true);
    await supabase
      .from("app_settings")
      .upsert({ key: "child_seat_price", value: { amount: childSeatPrice } });
    await logActivity(supabase, "pricing_updated", `Updated child seat price to ${money(childSeatPrice)}`);
    setSavingCsp(false);
    setSavedCsp(true);
    setTimeout(() => setSavedCsp(false), 1500);
  };
  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const editCat = (id: string, field: keyof VehicleCategory, value: number) =>
    setCats((cs) => cs.map((c) => (c.id === id ? { ...c, [field]: value } : c)));

  // Fare = base fare + distance bands + extra charges. The old flat per-mile,
  // per-minute and minimum-fare columns are no longer priced by estimate_fare,
  // so they are neither shown nor written here.
  const saveCat = async (c: VehicleCategory) => {
    setSavingId(c.id);
    await supabase
      .from("vehicle_categories")
      .update({
        capacity: c.capacity,
        suitcases: c.suitcases,
        hand_bags: c.hand_bags,
        base_fare: c.base_fare,
      })
      .eq("id", c.id);
    await logActivity(supabase, "pricing_updated", `Updated pricing for ${c.name}`);
    setSavingId(null);
    setSavedId(c.id);
    setTimeout(() => setSavedId(null), 1500);
  };

  const toggleRule = async (r: PricingRule) => {
    await supabase.from("pricing_rules").update({ is_active: !r.is_active }).eq("id", r.id);
    load();
  };
  const deleteRule = async (id: string) => {
    await supabase.from("pricing_rules").delete().eq("id", id);
    load();
  };

  return (
    <div>
      <PageHeader title="Pricing" subtitle="Fare = base fare + distance bands + extra charges" />

      {loading ? (
        <div className="flex h-64 items-center justify-center">
          <Loader2 className="h-7 w-7 animate-spin text-emerald-600" />
        </div>
      ) : (
        <div className="space-y-8 px-5 pb-10 md:px-8">
          {/* Categories */}
          <section>
            <h2 className="mb-3 font-display text-sm font-bold uppercase tracking-wide text-gray-400">
              Vehicle Categories
            </h2>
            <div className="grid gap-4 lg:grid-cols-3">
              {cats.map((c, i) => {
                const Icon = carIcon(c.icon);
                return (
                  <motion.div
                    key={c.id}
                    initial={{ opacity: 0, y: 12 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ delay: i * 0.06 }}
                    className="rounded-2xl border border-gray-100 bg-white p-5 shadow-sm"
                  >
                    <div className="mb-4 flex items-center gap-3">
                      <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-brand-50 text-brand-600">
                        <Icon className="h-6 w-6" />
                      </div>
                      <div>
                        <p className="font-display font-bold text-ink-950">{c.name}</p>
                        <p className="text-xs text-gray-400">
                          {c.capacity} passengers · {c.suitcases} suitcases · {c.hand_bags} hand bags
                        </p>
                      </div>
                    </div>
                    <div className="mb-3 grid grid-cols-3 gap-3">
                      <IntField icon={Users} label="Passengers" value={c.capacity} onChange={(v) => editCat(c.id, "capacity", v)} />
                      <IntField icon={Luggage} label="Suitcases" value={c.suitcases} onChange={(v) => editCat(c.id, "suitcases", v)} />
                      <IntField icon={Backpack} label="Hand bags" value={c.hand_bags} onChange={(v) => editCat(c.id, "hand_bags", v)} />
                    </div>
                    <div className="grid grid-cols-2 items-end gap-3">
                      <NumField label="Base fare" value={c.base_fare} onChange={(v) => editCat(c.id, "base_fare", v)} />
                      <p className="pb-2 text-[11px] leading-snug text-gray-400">
                        Added once per trip. Distance is priced by the bands below.
                      </p>
                    </div>
                    <button
                      onClick={() => saveCat(c)}
                      disabled={savingId === c.id}
                      className={cn(
                        "mt-4 flex w-full items-center justify-center gap-2 rounded-xl py-2.5 text-sm font-semibold text-white transition-colors",
                        savedId === c.id ? "bg-green-600" : "bg-emerald-600 hover:bg-emerald-700"
                      )}
                    >
                      {savingId === c.id ? (
                        <Loader2 className="h-4 w-4 animate-spin" />
                      ) : savedId === c.id ? (
                        <><Check className="h-4 w-4" /> Saved</>
                      ) : (
                        <><Save className="h-4 w-4" /> Save changes</>
                      )}
                    </button>
                  </motion.div>
                );
              })}
            </div>
          </section>

          {/* Distance rate bands (tapered pricing) */}
          <DistancePricing cats={cats} />

          {/* Add-ons */}
          <section>
            <h2 className="mb-3 font-display text-sm font-bold uppercase tracking-wide text-gray-400">
              Add-ons
            </h2>
            <div className="flex flex-wrap items-end gap-4 rounded-2xl border border-gray-100 bg-white p-5 shadow-sm">
              <div className="flex items-center gap-3">
                <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-brand-50 text-brand-600">
                  <Baby className="h-6 w-6" />
                </div>
                <div>
                  <p className="font-display font-bold text-ink-950">Child seat</p>
                  <p className="text-xs text-gray-400">Added to the total when a customer requests one</p>
                </div>
              </div>
              <div className="ml-auto flex items-end gap-3">
                <NumField
                  label="Price"
                  value={childSeatPrice}
                  onChange={(v) => setChildSeatPrice(v)}
                />
                <button
                  onClick={saveChildSeatPrice}
                  disabled={savingCsp}
                  className={cn(
                    "flex h-[38px] items-center justify-center gap-2 rounded-xl px-4 text-sm font-semibold text-white transition-colors",
                    savedCsp ? "bg-green-600" : "bg-emerald-600 hover:bg-emerald-700"
                  )}
                >
                  {savingCsp ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : savedCsp ? (
                    <><Check className="h-4 w-4" /> Saved</>
                  ) : (
                    <><Save className="h-4 w-4" /> Save</>
                  )}
                </button>
              </div>
            </div>
          </section>

          {/* Charges */}
          <section>
            <div className="mb-3 flex items-center justify-between">
              <h2 className="font-display text-sm font-bold uppercase tracking-wide text-gray-400">
                Extra Charges &amp; Surge
              </h2>
            </div>
            <div className="overflow-hidden rounded-2xl border border-gray-100 bg-white shadow-sm">
              {rules.map((r) => (
                <div key={r.id} className="flex items-center justify-between border-b border-gray-50 px-5 py-3.5 last:border-0">
                  <div className="flex items-center gap-3">
                    <span className={cn("flex h-9 w-9 items-center justify-center rounded-lg", r.charge_type === "percentage" ? "bg-violet-50 text-violet-600" : "bg-brand-50 text-brand-600")}>
                      {r.charge_type === "percentage" ? <Percent className="h-[18px] w-[18px]" /> : <PoundSterling className="h-[18px] w-[18px]" />}
                    </span>
                    <div>
                      <p className="text-sm font-semibold text-ink-950">{r.name}</p>
                      <p className="text-xs text-gray-400">
                        {r.charge_type === "percentage" ? `+${r.amount}%` : `+£${Number(r.amount).toFixed(2)}`}
                        {r.keyword && ` · matches "${r.keyword}"`}
                        {r.start_time && ` · ${r.start_time.slice(0, 5)}–${r.end_time?.slice(0, 5)}`}
                      </p>
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <button
                      onClick={() => toggleRule(r)}
                      className={cn(
                        "relative h-6 w-11 rounded-full transition-colors",
                        r.is_active ? "bg-emerald-500" : "bg-gray-200"
                      )}
                    >
                      <span
                        className={cn(
                          "absolute top-0.5 h-5 w-5 rounded-full bg-white shadow transition-all",
                          r.is_active ? "left-[22px]" : "left-0.5"
                        )}
                      />
                    </button>
                    <button onClick={() => deleteRule(r.id)} className="rounded-lg p-2 text-gray-300 hover:bg-red-50 hover:text-red-500">
                      <Trash2 className="h-4 w-4" />
                    </button>
                  </div>
                </div>
              ))}
              <AddRule onAdded={load} />
            </div>
          </section>
        </div>
      )}
    </div>
  );
}

function IntField({
  icon: Icon,
  label,
  value,
  onChange,
}: {
  icon: React.ElementType;
  label: string;
  value: number;
  onChange: (v: number) => void;
}) {
  return (
    <label className="block">
      <span className="mb-1 block text-[11px] font-semibold uppercase tracking-wide text-gray-400">{label}</span>
      <div className="relative">
        <Icon className="pointer-events-none absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-gray-400" />
        <input
          type="number"
          min={0}
          step={1}
          value={value}
          onChange={(e) => onChange(Math.max(0, Math.round(Number(e.target.value))))}
          className="w-full rounded-lg border border-gray-200 bg-white py-2 pl-7 pr-2 text-sm outline-none focus:border-emerald-400 focus:ring-2 focus:ring-emerald-500/10"
        />
      </div>
    </label>
  );
}

function NumField({ label, value, onChange }: { label: string; value: number; onChange: (v: number) => void }) {
  return (
    <label className="block">
      <span className="mb-1 block text-[11px] font-semibold uppercase tracking-wide text-gray-400">{label}</span>
      <div className="relative">
        <span className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-sm text-gray-400">£</span>
        <input
          type="number"
          step="0.01"
          value={value}
          onChange={(e) => onChange(Number(e.target.value))}
          className="w-full rounded-lg border border-gray-200 bg-white py-2 pl-6 pr-2 text-sm outline-none focus:border-emerald-400 focus:ring-2 focus:ring-emerald-500/10"
        />
      </div>
    </label>
  );
}

interface Band {
  id?: string;
  from_km: number;
  to_km: number;
  price_per_km: number;
}

function DistancePricing({ cats }: { cats: VehicleCategory[] }) {
  const supabase = createClient();
  const [bands, setBands] = useState<Record<string, Band[]>>({});
  const [loading, setLoading] = useState(true);
  const [savingCat, setSavingCat] = useState<string | null>(null);
  const [savedCat, setSavedCat] = useState<string | null>(null);
  // true: each band charges the miles inside it and they add up (tapered).
  // false: the whole trip is charged at the rate of the band it ends in.
  const [addUp, setAddUp] = useState(true);
  const [savingMode, setSavingMode] = useState(false);

  const toggleAddUp = async () => {
    const next = !addUp;
    setSavingMode(true);
    const { error } = await supabase
      .from("app_settings")
      .upsert({ key: "distance_bands", value: { add_up: next } });
    if (!error) {
      setAddUp(next);
      await logActivity(
        supabase,
        "pricing_updated",
        next ? "Distance bands now add up (tapered)" : "Distance now charged at one band's rate for the whole trip"
      );
    }
    setSavingMode(false);
  };

  const loadBands = async () => {
    const { data: mode } = await supabase.from("app_settings").select("value").eq("key", "distance_bands").maybeSingle();
    setAddUp((mode?.value as { add_up?: boolean } | null)?.add_up !== false);
    const { data } = await supabase.from("pricing_bands").select("*").order("from_km");
    const grouped: Record<string, Band[]> = {};
    ((data as (Band & { category_id: string })[]) ?? []).forEach((b) => {
      (grouped[b.category_id] ??= []).push({
        id: b.id,
        from_km: Number(b.from_km),
        to_km: Number(b.to_km),
        price_per_km: Number(b.price_per_km),
      });
    });
    setBands(grouped);
    setLoading(false);
  };
  useEffect(() => {
    loadBands();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const rowsFor = (id: string) => bands[id] ?? [];
  const setRows = (id: string, rows: Band[]) => setBands((b) => ({ ...b, [id]: rows }));

  const addRow = (id: string) => {
    const rows = rowsFor(id);
    const from = rows.length ? rows[rows.length - 1].to_km : 0;
    setRows(id, [...rows, { from_km: from, to_km: from === 0 ? 3 : from + 10, price_per_km: 0 }]);
  };
  const editRow = (id: string, i: number, field: keyof Band, v: number) =>
    setRows(id, rowsFor(id).map((r, idx) => (idx === i ? { ...r, [field]: v } : r)));
  const removeRow = (id: string, i: number) =>
    setRows(id, rowsFor(id).filter((_, idx) => idx !== i));

  // Distance inside a gap between bands (or before the first band) is NOT
  // charged, so warn before saving a band set that would leave holes.
  const bandProblems = (rows: Band[]): string[] => {
    const issues: string[] = [];
    const sorted = [...rows].sort((a, b) => a.from_km - b.from_km);
    if (sorted.length && sorted[0].from_km !== 0) issues.push(`first band starts at ${sorted[0].from_km} mi, not 0`);
    sorted.forEach((r, i) => {
      if (r.to_km <= r.from_km) issues.push(`"${r.from_km} → ${r.to_km}" has To ≤ From`);
      if (i > 0 && r.from_km !== sorted[i - 1].to_km)
        issues.push(`gap/overlap between ${sorted[i - 1].to_km} and ${r.from_km} mi`);
    });
    if (sorted.length && sorted[sorted.length - 1].to_km < 500)
      issues.push(`last band ends at ${sorted[sorted.length - 1].to_km} mi — longer trips won't be charged beyond it`);
    return issues;
  };

  const saveCat = async (id: string) => {
    const rows = rowsFor(id);
    const name = cats.find((c) => c.id === id)?.name ?? "this vehicle";
    if (rows.length === 0) {
      if (!confirm(`${name} has NO distance bands. Customers would only pay the base fare. Save anyway?`)) return;
    } else {
      const issues = bandProblems(rows);
      if (issues.length && !confirm(`Check the bands for ${name}:\n• ${issues.join("\n• ")}\n\nSave anyway?`)) return;
    }
    setSavingCat(id);
    await supabase.from("pricing_bands").delete().eq("category_id", id);
    if (rows.length) {
      await supabase.from("pricing_bands").insert(
        rows.map((r, i) => ({
          category_id: id,
          from_km: r.from_km,
          to_km: r.to_km,
          price_per_km: r.price_per_km,
          sort_order: i,
        }))
      );
    }
    await logActivity(
      supabase,
      "pricing_bands_updated",
      `Updated distance bands for ${cats.find((c) => c.id === id)?.name ?? "a vehicle"}`
    );
    setSavingCat(null);
    setSavedCat(id);
    setTimeout(() => setSavedCat(null), 1500);
    loadBands();
  };

  return (
    <section>
      <div className="mb-1 flex items-center gap-2">
        <Layers className="h-4 w-4 text-emerald-600" />
        <h2 className="font-display text-sm font-bold uppercase tracking-wide text-gray-400">
          Distance rate bands (per mile)
        </h2>
      </div>
      <p className="mb-3 max-w-2xl text-xs text-gray-400">
        This is the only place distance is priced. Keep bands contiguous (each “From” = previous “To”)
        starting at 0, and make the last “To” large (e.g. 1000). Airport / night charges and the child
        seat are added on top.
      </p>

      <label
        className={cn(
          "mb-4 flex max-w-2xl cursor-pointer items-start gap-3 rounded-2xl border border-gray-100 bg-white p-4 shadow-sm",
          (loading || savingMode) && "pointer-events-none opacity-60"
        )}
      >
        <input
          type="checkbox"
          checked={addUp}
          onChange={toggleAddUp}
          disabled={loading || savingMode}
          className="mt-0.5 h-4 w-4 shrink-0 accent-emerald-600"
        />
        <span>
          <span className="flex items-center gap-2 text-sm font-semibold text-ink-950">
            Add up distance bands
            {savingMode && <Loader2 className="h-3.5 w-3.5 animate-spin text-emerald-600" />}
          </span>
          <span className="mt-1 block text-xs leading-relaxed text-gray-500">
            {addUp ? (
              <>
                <b className="font-semibold text-gray-700">On:</b> each band charges just the miles inside it, and
                they are added together. With 0–10 @ £5 and 10–25 @ £4.50, a 15 mi trip is (10 × £5) + (5 × £4.50).
              </>
            ) : (
              <>
                <b className="font-semibold text-gray-700">Off:</b> the whole trip is charged at the rate of the band
                it ends in. With 0–10 @ £5 and 10–25 @ £4.50, a 15 mi trip is 15 × £4.50. A trip just past a
                band’s end can cost less than one just before it — check the prices around each boundary.
              </>
            )}
          </span>
        </span>
      </label>

      <FareCalculator key={String(addUp)} cats={cats} />

      {loading ? (
        <div className="flex h-24 items-center justify-center">
          <Loader2 className="h-6 w-6 animate-spin text-emerald-600" />
        </div>
      ) : (
        <div className="mt-4 grid gap-4 lg:grid-cols-3">
          {cats.map((c) => {
            const rows = rowsFor(c.id);
            return (
              <div key={c.id} className="rounded-2xl border border-gray-100 bg-white p-4 shadow-sm">
                <p className="mb-2 font-display font-bold text-ink-950">{c.name}</p>
                {rows.length === 0 ? (
                  <p className="mb-2 flex items-start gap-1.5 rounded-lg border border-red-100 bg-red-50 px-3 py-2 text-xs font-medium text-red-700">
                    <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                    No bands — distance is NOT charged. Customers pay only the base fare (£{Number(c.base_fare).toFixed(2)}).
                  </p>
                ) : (
                  <div className="mb-2 space-y-1.5">
                    <div className="grid grid-cols-[1fr_1fr_1fr_28px] gap-1.5 px-1 text-[10px] font-semibold uppercase tracking-wide text-gray-400">
                      <span>From mi</span>
                      <span>To mi</span>
                      <span>£/mi</span>
                      <span />
                    </div>
                    {rows.map((r, i) => (
                      <div key={i} className="grid grid-cols-[1fr_1fr_1fr_28px] items-center gap-1.5">
                        <BandInput value={r.from_km} onChange={(v) => editRow(c.id, i, "from_km", v)} />
                        <BandInput value={r.to_km} onChange={(v) => editRow(c.id, i, "to_km", v)} />
                        <BandInput value={r.price_per_km} onChange={(v) => editRow(c.id, i, "price_per_km", v)} step={0.05} />
                        <button
                          onClick={() => removeRow(c.id, i)}
                          className="flex h-8 w-7 items-center justify-center rounded-lg text-gray-300 hover:bg-red-50 hover:text-red-500"
                          aria-label="Remove band"
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </button>
                      </div>
                    ))}
                  </div>
                )}
                <div className="flex gap-2">
                  <button
                    onClick={() => addRow(c.id)}
                    className="flex flex-1 items-center justify-center gap-1.5 rounded-lg border border-gray-200 py-2 text-xs font-semibold text-gray-600 hover:border-emerald-300 hover:text-emerald-700"
                  >
                    <Plus className="h-3.5 w-3.5" /> Add band
                  </button>
                  <button
                    onClick={() => saveCat(c.id)}
                    disabled={savingCat === c.id}
                    className={cn(
                      "flex flex-1 items-center justify-center gap-1.5 rounded-lg py-2 text-xs font-semibold text-white transition-colors",
                      savedCat === c.id ? "bg-green-600" : "bg-emerald-600 hover:bg-emerald-700"
                    )}
                  >
                    {savingCat === c.id ? (
                      <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    ) : savedCat === c.id ? (
                      <><Check className="h-3.5 w-3.5" /> Saved</>
                    ) : (
                      <><Save className="h-3.5 w-3.5" /> Save</>
                    )}
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
}

function BandInput({ value, onChange, step = 0.1 }: { value: number; onChange: (v: number) => void; step?: number }) {
  return (
    <input
      type="number"
      min={0}
      step={step}
      value={value}
      onChange={(e) => onChange(Math.max(0, Number(e.target.value)))}
      className="w-full rounded-lg border border-gray-200 bg-white px-2 py-1.5 text-sm outline-none focus:border-emerald-400 focus:ring-2 focus:ring-emerald-500/10"
    />
  );
}

function FareCalculator({ cats }: { cats: VehicleCategory[] }) {
  const supabase = createClient();
  const [km, setKm] = useState("");
  const [results, setResults] = useState<{ name: string; base: number; dist: number; total: number }[] | null>(null);
  const [busy, setBusy] = useState(false);

  // Daytime, no airport keyword → shows base + bands only (extra charges are situational).
  const calc = async () => {
    setBusy(true);
    const out = await Promise.all(
      cats.map(async (c) => {
        const { data } = await supabase.rpc("estimate_fare", {
          p_category_id: c.id,
          p_distance_km: Number(km) || 0,
          p_duration_min: 0,
          p_pickup: "",
          p_dropoff: "",
          p_at: new Date(new Date().setHours(12, 0, 0, 0)).toISOString(),
        });
        const d = data as { base_fare?: number; distance_cost?: number; total?: number } | null;
        return {
          name: c.name,
          base: Number(d?.base_fare ?? 0),
          dist: Number(d?.distance_cost ?? 0),
          total: Number(d?.total ?? 0),
        };
      })
    );
    setResults(out);
    setBusy(false);
  };

  return (
    <div className="rounded-2xl border border-emerald-100 bg-emerald-50/40 p-4">
      <div className="mb-3 flex items-center gap-2">
        <Calculator className="h-4 w-4 text-emerald-600" />
        <p className="text-sm font-bold text-ink-950">Price calculator</p>
        <span className="text-xs text-gray-400">Base fare + bands for a distance (daytime, no airport)</span>
      </div>
      <div className="flex flex-wrap items-end gap-3">
        <label className="block">
          <span className="mb-1 block text-[11px] font-semibold uppercase tracking-wide text-gray-400">Distance (mi)</span>
          <input
            type="number"
            min={0}
            step="0.1"
            value={km}
            onChange={(e) => setKm(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && km && calc()}
            placeholder="e.g. 12"
            className="w-28 rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm outline-none focus:border-emerald-400"
          />
        </label>
        <button
          onClick={calc}
          disabled={busy || !km}
          className="flex h-[38px] items-center gap-2 rounded-lg bg-emerald-600 px-4 text-sm font-semibold text-white hover:bg-emerald-700 disabled:bg-gray-300"
        >
          {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : "Calculate"}
        </button>
      </div>
      {results && (
        <div className="mt-3 flex flex-wrap gap-2">
          {results.map((r) => (
            <span
              key={r.name}
              title={`${money(r.base)} base + ${money(r.dist)} distance`}
              className="inline-flex items-center gap-1.5 rounded-full bg-white px-3 py-1.5 text-sm shadow-sm"
            >
              <span className="text-gray-500">{r.name}</span>
              <span className="font-display font-bold text-ink-950">{money(r.total)}</span>
              <span className="text-[11px] text-gray-400">
                ({money(r.base)} + {money(r.dist)})
              </span>
            </span>
          ))}
        </div>
      )}
    </div>
  );
}

function AddRule({ onAdded }: { onAdded: () => void }) {
  const supabase = createClient();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [type, setType] = useState<"fixed" | "percentage">("fixed");
  const [amount, setAmount] = useState("");
  const [keyword, setKeyword] = useState("");
  const [saving, setSaving] = useState(false);

  const add = async () => {
    if (!name.trim() || !amount) return;
    setSaving(true);
    await supabase.from("pricing_rules").insert({
      name,
      charge_type: type,
      amount: Number(amount),
      keyword: keyword.trim() || null,
      is_active: true,
    });
    setSaving(false);
    setName("");
    setAmount("");
    setKeyword("");
    setOpen(false);
    onAdded();
  };

  if (!open) {
    return (
      <button
        onClick={() => setOpen(true)}
        className="flex w-full items-center justify-center gap-2 py-3.5 text-sm font-semibold text-emerald-600 hover:bg-emerald-50"
      >
        <Plus className="h-4 w-4" /> Add charge
      </button>
    );
  }

  return (
    <div className="space-y-3 bg-gray-50 p-4">
      <div className="grid grid-cols-2 gap-3">
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Name (e.g. Airport)"
          className="col-span-2 rounded-lg border border-gray-200 px-3 py-2 text-sm outline-none focus:border-emerald-400"
        />
        <select
          value={type}
          onChange={(e) => setType(e.target.value as "fixed" | "percentage")}
          className="rounded-lg border border-gray-200 px-3 py-2 text-sm outline-none focus:border-emerald-400"
        >
          <option value="fixed">Fixed £</option>
          <option value="percentage">Percentage %</option>
        </select>
        <input
          type="number"
          value={amount}
          onChange={(e) => setAmount(e.target.value)}
          placeholder="Amount"
          className="rounded-lg border border-gray-200 px-3 py-2 text-sm outline-none focus:border-emerald-400"
        />
        <input
          value={keyword}
          onChange={(e) => setKeyword(e.target.value)}
          placeholder="Address keyword (optional, e.g. airport)"
          className="col-span-2 rounded-lg border border-gray-200 px-3 py-2 text-sm outline-none focus:border-emerald-400"
        />
      </div>
      <div className="flex gap-2">
        <button onClick={add} disabled={saving} className="flex flex-1 items-center justify-center gap-1.5 rounded-lg bg-emerald-600 py-2 text-sm font-semibold text-white hover:bg-emerald-700">
          {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <><Check className="h-4 w-4" /> Add</>}
        </button>
        <button onClick={() => setOpen(false)} className="rounded-lg bg-gray-200 px-4 py-2 text-sm font-semibold text-gray-600 hover:bg-gray-300">
          <X className="h-4 w-4" />
        </button>
      </div>
    </div>
  );
}
