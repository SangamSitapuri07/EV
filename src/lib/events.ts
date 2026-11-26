import { EventEmitter } from "events";

export type PlatformEventType =
  | "AVAILABILITY_CHANGED"
  | "RESERVATION_UPDATED"
  | "CHARGING_TELEMETRY"
  | "NOTIFICATION_CREATED"
  | "FACILITY_STATUS_CHANGED";

export interface PlatformEvent {
  id: string;
  type: PlatformEventType;
  facilityId?: string;
  userId?: string;
  source: string;
  occurredAt: string;
  payload: Record<string, unknown>;
}

const globalForEvents = globalThis as unknown as {
  __smartMobilityEventBus?: EventEmitter;
  __smartMobilityRecentEvents?: PlatformEvent[];
};

function getBus(): EventEmitter {
  if (!globalForEvents.__smartMobilityEventBus) {
    const emitter = new EventEmitter();
    emitter.setMaxListeners(100);
    globalForEvents.__smartMobilityEventBus = emitter;
  }
  return globalForEvents.__smartMobilityEventBus;
}

export function publishPlatformEvent(
  event: Omit<PlatformEvent, "id" | "occurredAt">
): PlatformEvent {
  const fullEvent: PlatformEvent = {
    ...event,
    id: crypto.randomUUID(),
    occurredAt: new Date().toISOString(),
  };

  if (!globalForEvents.__smartMobilityRecentEvents) {
    globalForEvents.__smartMobilityRecentEvents = [];
  }
  globalForEvents.__smartMobilityRecentEvents.unshift(fullEvent);
  if (globalForEvents.__smartMobilityRecentEvents.length > 100) {
    globalForEvents.__smartMobilityRecentEvents.length = 100;
  }

  getBus().emit("platform_event", fullEvent);
  return fullEvent;
}

export function subscribePlatformEvents(
  listener: (event: PlatformEvent) => void
): () => void {
  const bus = getBus();
  bus.on("platform_event", listener);
  return () => {
    bus.off("platform_event", listener);
  };
}

export function getRecentPlatformEvents(limit = 25): PlatformEvent[] {
  return (globalForEvents.__smartMobilityRecentEvents ?? []).slice(0, limit);
}
