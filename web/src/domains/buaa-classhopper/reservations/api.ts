import { z } from "zod";
import { reservationEventsSchema, reservationPageSchema, reservationSchema } from "../../../../../src/domains/buaa-classhopper/reservations/schema";
import { createAdminClient } from "../../../platform/api";

const request = createAdminClient("buaa-classhopper");

export function listReservations(page: number, search: string, status: string, signal?: AbortSignal) {
  const params = new URLSearchParams({ page: String(page), pageSize: "10" });
  if (search) params.set("search", search);
  if (status) params.set("status", status);
  return request(`/reservations?${params}`, reservationPageSchema, { signal });
}

export function listReservationEvents(id: string, signal?: AbortSignal) {
  return request(`/reservations/${encodeURIComponent(id)}/events`, reservationEventsSchema, { signal });
}

export function changeReservation(id: string, action: "cancel" | "restore" | "checkin") {
  return request(`/reservations/${encodeURIComponent(id)}/${action}`, reservationSchema, { method: "POST" });
}

export function deleteReservation(id: string) {
  return request(`/reservations/${encodeURIComponent(id)}`, z.object({ id: z.string() }), { method: "DELETE" });
}
