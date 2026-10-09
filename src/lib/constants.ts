import type { BookingStatus, JobStatus } from "./types";

export const CURRENCY_SYMBOL = "£";

/** Display label + color for each booking status (used across dashboards). */
export const STATUS_META: Record<
  BookingStatus,
  { label: string; color: string; bg: string; dot: string }
> = {
  pending: { label: "Pending", color: "text-amber-700", bg: "bg-amber-50", dot: "bg-amber-500" },
  assigned: { label: "Assigned", color: "text-blue-700", bg: "bg-blue-50", dot: "bg-blue-500" },
  accepted: { label: "Accepted", color: "text-indigo-700", bg: "bg-indigo-50", dot: "bg-indigo-500" },
  driver_arrived: { label: "Driver Arrived", color: "text-cyan-700", bg: "bg-cyan-50", dot: "bg-cyan-500" },
  in_progress: { label: "In Progress", color: "text-violet-700", bg: "bg-violet-50", dot: "bg-violet-500" },
  completed: { label: "Completed", color: "text-green-700", bg: "bg-green-50", dot: "bg-green-500" },
  cancelled: { label: "Cancelled", color: "text-red-700", bg: "bg-red-50", dot: "bg-red-500" },
  declined: { label: "Declined", color: "text-red-700", bg: "bg-red-50", dot: "bg-red-500" },
  no_driver_found: { label: "No Driver", color: "text-red-700", bg: "bg-red-50", dot: "bg-red-500" },
};

export const DRIVER_ACCEPT_TIMEOUT = 15; // seconds

/** Job statuses in the order staff pick from, with their badge colours. */
export const JOB_STATUS_META: Record<JobStatus, { label: string; color: string; bg: string; dot: string }> = {
  processing: { label: "Processing", color: "text-blue-700", bg: "bg-blue-50", dot: "bg-blue-500" },
  on_hold: { label: "On hold", color: "text-amber-700", bg: "bg-amber-50", dot: "bg-amber-500" },
  completed: { label: "Completed", color: "text-green-700", bg: "bg-green-50", dot: "bg-green-500" },
  cancelled: { label: "Cancelled", color: "text-red-700", bg: "bg-red-50", dot: "bg-red-500" },
  refunded: { label: "Refunded", color: "text-gray-700", bg: "bg-gray-100", dot: "bg-gray-500" },
};
