/**
 * Home Assistant plugin — thin shim delegating to handlers.ts.
 */

import { Type } from "@sinclair/typebox";
import {
  type HomeAssistantConfig,
  CAMERAS, DEFAULT_COLLAGE_CAMERAS,
  stateGet, stateList, serviceCall, eventList, personFind,
  speakerVolumeGet, speakerVolumeSet, logbook, cameraList,
  cameraSnapshotHandler, cameraCollageHandler,
} from "./handlers.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type PluginApi = {
  registerTool: (tool: unknown) => void;
  pluginConfig?: Record<string, unknown>;
};

// ---------------------------------------------------------------------------
// Formatting
// ---------------------------------------------------------------------------

function formatResult(data: unknown) {
  return {
    content: [{ type: "text" as const, text: typeof data === "string" ? data : JSON.stringify(data) }],
    details: {},
  };
}

// ---------------------------------------------------------------------------
// Plugin entry
// ---------------------------------------------------------------------------

const CAPTURE_DIR = "/tmp/openclaw/camera_captures";

const configSchema = {
  type: "object" as const,
  additionalProperties: false,
  properties: {
    server: { type: "string" as const, description: "Home Assistant server URL (e.g. http://192.168.1.76:8123)" },
    token: { type: "string" as const, description: "Home Assistant long-lived access token" },
  },
};

function buildConfig(pluginConfig?: Record<string, unknown>): HomeAssistantConfig {
  return {
    server: ((pluginConfig?.server as string) ?? "http://192.168.1.76:8123").replace(/\/+$/, ""),
    token: (pluginConfig?.token as string) ?? "",
    captureDir: CAPTURE_DIR,
  };
}

function createEntry() {
  return {
    id: "homeassistant",
    name: "Home Assistant",
    description: "Control devices, query state, and inspect activity in Home Assistant",
    configSchema,
    register(api: PluginApi) {
      const cfg = () => buildConfig(api.pluginConfig);

      api.registerTool({
        name: "hass_state_get",
        label: "HA State Get",
        description: "Get the current state of a Home Assistant entity.",
        parameters: Type.Object({
          entity_id: Type.String({ description: "The entity ID to query (e.g. light.living_room, sensor.temperature)." }),
        }),
        async execute(_id: string, params: Record<string, unknown>) {
          try { return formatResult(await stateGet(cfg(), { entity_id: String(params.entity_id ?? "") })); }
          catch (e) { return formatResult({ error: (e as Error).message }); }
        },
      });

      api.registerTool({
        name: "hass_state_list",
        label: "HA State List",
        description: "List Home Assistant entities, optionally filtered by domain.",
        parameters: Type.Object({
          domain: Type.Optional(Type.String({ description: "Optional domain to filter by (e.g. light, switch, sensor)." })),
        }),
        async execute(_id: string, params: Record<string, unknown>) {
          try { return formatResult(await stateList(cfg(), { domain: params.domain as string | undefined })); }
          catch (e) { return formatResult({ error: (e as Error).message }); }
        },
      });

      api.registerTool({
        name: "hass_service_call",
        label: "HA Service Call",
        description: "Call a Home Assistant service.",
        parameters: Type.Object({
          domain: Type.String({ description: "Service domain (e.g. light, switch, scene, climate)." }),
          service: Type.String({ description: "Service name (e.g. turn_on, turn_off, toggle)." }),
          entity_id: Type.Optional(Type.String({ description: "Target entity ID (e.g. light.living_room)." })),
          data: Type.Optional(Type.Record(Type.String(), Type.Unknown(), {
            description: "Additional service data as key-value pairs (e.g. {\"brightness\": 128}).",
          })),
        }),
        async execute(_id: string, params: Record<string, unknown>) {
          try {
            return formatResult(await serviceCall(cfg(), {
              domain: String(params.domain ?? ""),
              service: String(params.service ?? ""),
              entity_id: params.entity_id as string | undefined,
              data: params.data as Record<string, unknown> | undefined,
            }));
          } catch (e) { return formatResult({ error: (e as Error).message }); }
        },
      });

      api.registerTool({
        name: "hass_event_list",
        label: "HA Event List",
        description: "List Home Assistant event types.",
        parameters: Type.Object({
          entity_id: Type.Optional(Type.String({ description: "Optional keyword to filter event types by string match." })),
        }),
        async execute(_id: string, params: Record<string, unknown>) {
          try { return formatResult(await eventList(cfg(), { entity_id: params.entity_id as string | undefined })); }
          catch (e) { return formatResult({ error: (e as Error).message }); }
        },
      });

      api.registerTool({
        name: "hass_person_find",
        label: "HA Person Find",
        description: "Find a Home Assistant person by name or entity ID.",
        parameters: Type.Object({
          name: Type.Optional(Type.String({ description: "Name of the person to search for (case-insensitive substring match)." })),
          entity_id: Type.Optional(Type.String({ description: "Exact entity ID to look up (e.g. person.john)." })),
        }),
        async execute(_id: string, params: Record<string, unknown>) {
          try { return formatResult(await personFind(cfg(), { name: params.name as string | undefined, entity_id: params.entity_id as string | undefined })); }
          catch (e) { return formatResult({ error: (e as Error).message }); }
        },
      });

      api.registerTool({
        name: "hass_speaker_volume_get",
        label: "HA Speaker Volume Get",
        description: "Get the volume level of one speaker or all speakers.",
        parameters: Type.Object({
          entity_id: Type.Optional(Type.String({ description: "Optional entity ID of the speaker (e.g. media_player.living_room)." })),
        }),
        async execute(_id: string, params: Record<string, unknown>) {
          try { return formatResult(await speakerVolumeGet(cfg(), { entity_id: params.entity_id as string | undefined })); }
          catch (e) { return formatResult({ error: (e as Error).message }); }
        },
      });

      api.registerTool({
        name: "hass_speaker_volume_set",
        label: "HA Speaker Volume Set",
        description: "Set the volume level of a speaker.",
        parameters: Type.Object({
          entity_id: Type.String({ description: "Entity ID of the speaker to adjust (e.g. media_player.living_room)." }),
          volume_level: Type.Number({ description: "Desired volume level between 0.0 (silent) and 1.0 (maximum).", minimum: 0, maximum: 1 }),
        }),
        async execute(_id: string, params: Record<string, unknown>) {
          try { return formatResult(await speakerVolumeSet(cfg(), { entity_id: String(params.entity_id ?? ""), volume_level: Number(params.volume_level) })); }
          catch (e) { return formatResult({ error: (e as Error).message }); }
        },
      });

      api.registerTool({
        name: "hass_logbook",
        label: "HA Logbook",
        description: "Get Home Assistant logbook entries with optional filters.",
        parameters: Type.Object({
          entity_id: Type.Optional(Type.String({ description: "Filter entries for a specific entity." })),
          hours: Type.Optional(Type.Number({ description: "Rolling window in hours from now (default: 24). Ignored if start_time is provided." })),
          start_time: Type.Optional(Type.String({ description: "Start of the time range as an ISO 8601 string." })),
          end_time: Type.Optional(Type.String({ description: "End of the time range as an ISO 8601 string. Defaults to now." })),
          keyword: Type.Optional(Type.String({ description: "Optional keyword to filter entries." })),
          limit: Type.Optional(Type.Integer({ description: "Maximum number of entries to return (default: 100, max: 500)." })),
        }),
        async execute(_id: string, params: Record<string, unknown>) {
          try {
            return formatResult(await logbook(cfg(), {
              entity_id: params.entity_id as string | undefined,
              hours: params.hours as number | undefined,
              start_time: params.start_time as string | undefined,
              end_time: params.end_time as string | undefined,
              keyword: params.keyword as string | undefined,
              limit: params.limit as number | undefined,
            }));
          } catch (e) { return formatResult({ error: (e as Error).message }); }
        },
      });

      api.registerTool({
        name: "hass_camera_list",
        label: "HA Camera List",
        description: "List available Home Assistant cameras.",
        parameters: Type.Object({}),
        async execute() {
          try { return formatResult(await cameraList()); }
          catch (e) { return formatResult({ error: (e as Error).message }); }
        },
      });

      api.registerTool({
        name: "hass_camera_snapshot",
        label: "HA Camera Snapshot",
        description: "Take a snapshot from a Home Assistant camera.",
        parameters: Type.Object({
          camera_name: Type.String({
            description:
              "Name of the camera to snapshot. One of: living-room, front-doorbell, front-doorbell-package, backyard-right, backyard-left, driveway, family-room, garage, all",
          }),
        }),
        async execute(_id: string, params: Record<string, unknown>) {
          try { return formatResult(await cameraSnapshotHandler(cfg(), { camera_name: String(params.camera_name ?? "") })); }
          catch (e) { return formatResult({ error: (e as Error).message }); }
        },
      });

      api.registerTool({
        name: "hass_camera_collage",
        label: "HA Camera Collage",
        description:
          "Snapshot multiple cameras simultaneously and compose them into a grid collage image. Defaults to all outdoor + garage cameras. Returns a single local file path to the collage image.",
        parameters: Type.Object({
          camera_names: Type.Optional(Type.Array(Type.String(), {
            description:
              "List of camera names to include. Defaults to all outdoor + garage cameras: front-doorbell, front-doorbell-package, driveway, backyard-left, backyard-right, garage. Available: living-room, front-doorbell, front-doorbell-package, backyard-right, backyard-left, driveway, family-room, garage.",
          })),
          label: Type.Optional(Type.Boolean({ description: "Draw camera name labels on each cell (default: true)." })),
        }),
        async execute(_id: string, params: Record<string, unknown>) {
          try { return formatResult(await cameraCollageHandler(cfg(), { camera_names: params.camera_names as string[] | undefined, label: params.label as boolean | undefined })); }
          catch (e) { return formatResult({ error: (e as Error).message }); }
        },
      });
    },
  };
}

export { createEntry };
