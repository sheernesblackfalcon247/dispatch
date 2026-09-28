// Database entity types (mirror the Supabase schema)

export type UserRole = "driver" | "dispatcher" | "admin";
export type DriverAvailability = "offline" | "online" | "on_trip";
export type PaymentMethod = "cash" | "card";
export type PaymentStatus = "pending" | "paid" | "failed" | "refunded";
export type ChargeType = "fixed" | "percentage";

export type BookingStatus =
  | "pending"
  | "assigned"
  | "accepted"
  | "driver_arrived"
  | "in_progress"
  | "completed"
  | "cancelled"
  | "declined"
  | "no_driver_found";

export interface VehicleCategory {
  id: string;
  name: string;
  description: string | null;
  icon: string;
  capacity: number;
  suitcases: number;
  hand_bags: number;
  base_fare: number;
  price_per_km: number;
  price_per_minute: number;
  minimum_fare: number;
  sort_order: number;
  is_active: boolean;
}

export interface Website {
  id: string;
  name: string;
  slug: string;
  domain: string | null;
  color: string;
  api_key: string;
  is_active: boolean;
  created_at: string;
}

export interface Customer {
  id: string;
  full_name: string;
  whatsapp: string;
  email: string | null;
  is_blocked: boolean;
  total_rides: number;
  created_at: string;
}

export interface Driver {
  id: string;
  profile_id: string | null;
  full_name: string;
  phone: string | null;
  whatsapp: string | null;
  email: string | null;
  service_area: string | null;
  license_number: string | null;
  availability: DriverAvailability;
  current_lat: number | null;
  current_lng: number | null;
  last_location_at: string | null;
  rating: number;
  total_trips: number;
  is_approved: boolean;
  is_blocked: boolean;
  created_at: string;
}

export interface Vehicle {
  id: string;
  driver_id: string;
  category_id: string | null;
  make: string | null;
  model: string | null;
  color: string | null;
  license_plate: string | null;
  year: number | null;
  is_active: boolean;
}

export interface ViaPoint {
  address: string;
  lat: number | null;
  lng: number | null;
}

/**
 * Fare = base_fare + distance_cost (per-mile bands, added up or one rate) + extras
 * (airport / night / child seat). Per-minute cost and minimum fare were
 * removed on 2026-09-05; the optional fields only appear on older bookings.
 */
export interface FareBreakdown {
  category: string;
  base_fare: number;
  distance_cost: number;
  time_cost?: number;
  extras: { name: string; amount: number; type: ChargeType }[];
  extras_total: number;
  minimum_fare?: number;
  total: number;
}

export interface Booking {
  id: string;
  booking_number: string;
  website_id: string | null;
  customer_id: string | null;
  customer_name: string;
  customer_whatsapp: string;
  customer_email: string | null;
  pickup_address: string;
  pickup_lat: number | null;
  pickup_lng: number | null;
  dropoff_address: string;
  dropoff_lat: number | null;
  dropoff_lng: number | null;
  via_points: ViaPoint[];
  trip_group_id: string | null;
  is_return: boolean;
  vehicle_category_id: string | null;
  distance_km: number | null;
  duration_min: number | null;
  estimated_fare: number | null;
  final_fare: number | null;
  fare_breakdown: FareBreakdown | null;
  payment_method: PaymentMethod;
  payment_status: PaymentStatus;
  status: BookingStatus;
  child_seat: boolean;
  passengers: number;
  suitcases: number;
  hand_luggage: number;
  driver_id: string | null;
  /** Outside service this job was arranged through (Uber, Bolt, a partner firm). */
  external_provider: string | null;
  /** Outside driver this one ride was handed to. Set instead of driver_id. */
  external_driver_name: string | null;
  external_driver_phone: string | null;
  external_driver_company: string | null;
  /** The car that outside driver is actually turning up in. */
  external_vehicle_category_id: string | null;
  external_vehicle_make: string | null;
  external_vehicle_model: string | null;
  external_vehicle_color: string | null;
  external_vehicle_plate: string | null;
  dispatcher_id: string | null;
  scheduled_at: string | null;
  notes: string | null;
  created_at: string;
  updated_at: string;
  assigned_at: string | null;
  accepted_at: string | null;
  arrived_at: string | null;
  started_at: string | null;
  completed_at: string | null;
  cancelled_at: string | null;
}

export interface Payment {
  id: string;
  booking_id: string | null;
  amount: number;
  amount_refunded: number;
  currency: string;
  method: PaymentMethod;
  status: PaymentStatus;
  stripe_payment_intent_id: string | null;
  receipt_url: string | null;
  /** Money moved but something did not line up — staff must check it. */
  needs_review: boolean;
  review_reason: string | null;
  failure_reason: string | null;
  disputed_at: string | null;
  /** When the "unmatched payment" alert went out. Null = not yet alerted. */
  alerted_at: string | null;
  refunded_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface PricingRule {
  id: string;
  name: string;
  charge_type: ChargeType;
  amount: number;
  applies_all: boolean;
  keyword: string | null;
  start_time: string | null;
  end_time: string | null;
  category_id: string | null;
  is_active: boolean;
  sort_order: number;
}

export interface Profile {
  id: string;
  full_name: string;
  email: string | null;
  phone: string | null;
  role: UserRole;
  avatar_url: string | null;
  is_active: boolean;
}

export interface CreateBookingResult {
  ok: boolean;
  error?: string;
  booking_id?: string;
  booking_number?: string;
  estimated_fare?: number;
  fare_breakdown?: FareBreakdown;
  website?: string;
}
