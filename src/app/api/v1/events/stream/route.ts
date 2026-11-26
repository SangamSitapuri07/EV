import {
  getRecentPlatformEvents,
  subscribePlatformEvents,
} from "@/lib/events";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const url = new URL(req.url);
  const facilityIdFilter = url.searchParams.get("facilityId");
  const encoder = new TextEncoder();

  let cleanup: (() => void) | null = null;
  let heartbeat: ReturnType<typeof setInterval> | null = null;

  const stream = new ReadableStream({
    start(controller) {
      const send = (eventName: string, data: unknown) => {
        try {
          controller.enqueue(
            encoder.encode(`event: ${eventName}\ndata: ${JSON.stringify(data)}\n\n`)
          );
        } catch {
          // stream closed
        }
      };

      send("connected", {
        connectedAt: new Date().toISOString(),
        recentEvents: getRecentPlatformEvents(10),
      });

      cleanup = subscribePlatformEvents((event) => {
        if (facilityIdFilter && event.facilityId && event.facilityId !== facilityIdFilter) {
          return;
        }
        send("platform_event", event);
      });

      heartbeat = setInterval(() => {
        send("heartbeat", { ts: new Date().toISOString() });
      }, 15_000);
    },
    cancel() {
      if (cleanup) cleanup();
      if (heartbeat) clearInterval(heartbeat);
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
    },
  });
}
