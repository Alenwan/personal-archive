import type { Hono } from "hono";
import { z } from "zod";
import type { PublicUser } from "../../../src/shared/types";
import { requirePermission } from "../../../src/server/auth/permissions";
import type { AppEnv } from "../../../src/server/env";
import type { AppRepository } from "../../../src/server/repositories/types";
import { listRecentPbxCallEvents, subscribePbxCallEvents } from "../../../src/server/services/pbxCallEvents";

type ApiApp = Hono<{ Bindings: AppEnv; Variables: { repo: AppRepository; user: PublicUser } }>;

const pbxSettingsSchema = z.object({
  isEnabled: z.boolean(),
  allowedDids: z.array(z.string()).default([]),
  allowedDestinations: z.array(z.string()).default([]),
  ignoredDids: z.array(z.string()).default([]),
  ignoredDestinations: z.array(z.string()).default([]),
  showUnknownCallers: z.boolean(),
  popupRetentionSeconds: z.coerce.number().int().min(5).max(600)
});

function cleanSettingList(values: string[]): string[] {
  return [...new Set(values.map((value) => value.trim()).filter(Boolean))];
}

function sseFrame(event: string, data: unknown, id?: string): Uint8Array {
  const lines = [`event: ${event}`, id ? `id: ${id}` : "", `data: ${JSON.stringify(data)}`, ""].filter(Boolean);
  return new TextEncoder().encode(`${lines.join("\n")}\n`);
}

export function registerPbxRoutes(app: ApiApp) {
  app.get("/pbx/calls/recent", async (context) => {
    const user = context.get("user");
    requirePermission(user, "view", "contact");
    requirePermission(user, "view", "case");
    return context.json(listRecentPbxCallEvents());
  });

  app.get("/pbx/calls/stream", async (context) => {
    const user = context.get("user");
    requirePermission(user, "view", "contact");
    requirePermission(user, "view", "case");

    let unsubscribe: (() => void) | null = null;
    let keepAlive: ReturnType<typeof setInterval> | null = null;
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        const close = () => {
          if (keepAlive) clearInterval(keepAlive);
          unsubscribe?.();
          unsubscribe = null;
        };
        controller.enqueue(sseFrame("ready", { ok: true, recentCount: listRecentPbxCallEvents().length }));
        for (const event of listRecentPbxCallEvents().slice().reverse()) {
          controller.enqueue(sseFrame("call", event, event.eventId));
        }
        unsubscribe = subscribePbxCallEvents((event) => {
          controller.enqueue(sseFrame("call", event, event.eventId));
        });
        keepAlive = setInterval(() => {
          controller.enqueue(new TextEncoder().encode(`: keepalive ${Date.now()}\n\n`));
        }, 25_000);
        context.req.raw.signal.addEventListener("abort", close, { once: true });
      },
      cancel() {
        if (keepAlive) clearInterval(keepAlive);
        unsubscribe?.();
        unsubscribe = null;
      }
    });

    return new Response(stream, {
      headers: {
        "content-type": "text/event-stream; charset=utf-8",
        "cache-control": "no-cache, no-transform",
        connection: "keep-alive"
      }
    });
  });

  app.get("/pbx/settings", async (context) => {
    requirePermission(context.get("user"), "view", "settings");
    return context.json(await context.get("repo").getPbxSettings());
  });

  app.put("/pbx/settings", async (context) => {
    const user = context.get("user");
    requirePermission(user, "edit", "settings");
    const input = pbxSettingsSchema.parse(await context.req.json());
    const settings = await context.get("repo").updatePbxSettings(
      {
        ...input,
        allowedDids: cleanSettingList(input.allowedDids),
        allowedDestinations: cleanSettingList(input.allowedDestinations),
        ignoredDids: cleanSettingList(input.ignoredDids),
        ignoredDestinations: cleanSettingList(input.ignoredDestinations)
      },
      user
    );
    await context.get("repo").createAuditLog({
      action: "pbx.settings_updated",
      entityType: "pbx_settings",
      entityId: settings.pbxSettingsId,
      user,
      metadata: {
        isEnabled: settings.isEnabled,
        allowedDids: settings.allowedDids,
        allowedDestinations: settings.allowedDestinations,
        ignoredDids: settings.ignoredDids,
        ignoredDestinations: settings.ignoredDestinations,
        showUnknownCallers: settings.showUnknownCallers,
        popupRetentionSeconds: settings.popupRetentionSeconds
      }
    });
    return context.json(settings);
  });
}
