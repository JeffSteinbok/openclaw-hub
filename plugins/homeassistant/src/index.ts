/**
 * Home Assistant plugin — thin shim delegating to handlers.ts.
 */

import { definePlugin } from "carapace-plugin-sdk";
import { Type } from "@sinclair/typebox";
import {
  type HomeAssistantConfig,
  CAMERAS, DEFAULT_COLLAGE_CAMERAS,
  stateGet, stateList, serviceCall, lovelaceGet, lovelaceSet, eventList, personFind,
  configList, configGet, configSet,
  speakerVolumeGet, speakerVolumeSet, logbook, cameraList,
  cameraSnapshotHandler, cameraCollageHandler,
} from "./handlers.js";

const CAPTURE_DIR = "/tmp/openclaw/camera_captures";

function stripTrailingSlashes(s: string): string {
  while (s.endsWith("/")) s = s.slice(0, -1);
  return s;
}

/** The server URL comes only from config (no built-in address). */
function requireServer(server: string | undefined): string {
  const value = stripTrailingSlashes(server?.trim() ?? "");
  if (!value) {
    throw new Error("Home Assistant server is not configured: set the plugin's `server` (e.g. ${HASS_SERVER}).");
  }
  return value;
}

export const createEntry = definePlugin({
  id: "homeassistant",
  name: "Home Assistant",
  description: "Control devices, query state, and inspect activity in Home Assistant",

  configSchema: Type.Object({
    server: Type.Optional(
      Type.String({
        description: "Home Assistant server URL (e.g. http://<home-assistant-host>:8123). Required; set it from the environment, e.g. ${HASS_SERVER}.",
      }),
    ),
    token: Type.Optional(
      Type.String({ description: "Home Assistant long-lived access token" }),
    ),
  }),

  tools: (tool) => [
    tool({
      name: "hass_state_get",
      label: "HA State Get",
      description: "Get the current state of one Home Assistant entity by its exact entity ID. If you don't know the ID, find it with hass_state_list using domain and search.",
      parameters: Type.Object({
        entity_id: Type.String({ description: "The entity ID to query (e.g. light.living_room, sensor.temperature)." }),
      }),
      async execute({ entity_id }, config) {
        try {
          const resolvedConfig: HomeAssistantConfig = {
            server: requireServer(config.server),
            token: config.token ?? "",
            captureDir: CAPTURE_DIR,
          };
          return await stateGet(resolvedConfig, { entity_id: String(entity_id ?? "") });
        } catch (e) {
          return { error: (e as Error).message };
        }
      },
    }),

    tool({
      name: "hass_state_list",
      label: "HA State List",
      description:
        "Find Home Assistant entities by type. Always pass domain (the entity type) and/or search — a home can have thousands of entities. " +
        "With neither, this returns only entity counts per domain, not the entities. " +
        "To control a device, look it up by its domain plus a room or name search (e.g. domain \"light\", search \"bonus room\"); " +
        "for several types, pass them together (e.g. \"light,fan,switch\") instead of listing everything. " +
        "Common domains: light, switch, fan, cover (blinds, garage doors), climate (thermostats), lock, media_player (speakers, TVs), " +
        "scene, script, automation, sensor, binary_sensor (doors, motion, leaks), camera, person, device_tracker, " +
        "alarm_control_panel, water_heater, vacuum, remote, button, select, number, input_boolean, update, weather, calendar, zone.",
      parameters: Type.Object({
        domain: Type.Optional(Type.String({
          description: "Entity domain(s) to return — the part of the entity ID before the dot. One (\"light\") or several comma-separated (\"light,fan,switch\").",
        })),
        search: Type.Optional(Type.String({
          description: "Case-insensitive text matched against entity IDs and friendly names, e.g. \"bonus room\" or \"garage\". Combine with domain to find one room's devices.",
        })),
      }),
      async execute({ domain, search }, config) {
        try {
          const resolvedConfig: HomeAssistantConfig = {
            server: requireServer(config.server),
            token: config.token ?? "",
            captureDir: CAPTURE_DIR,
          };
          return await stateList(resolvedConfig, { domain, search });
        } catch (e) {
          return { error: (e as Error).message };
        }
      },
    }),

    tool({
      name: "hass_service_call",
      label: "HA Service Call",
      description:
        "Call a Home Assistant service, e.g. light.turn_off. Pass the entity as the top-level entity_id — there is no target or area parameter. " +
        "If you don't know the entity ID, find it first with hass_state_list (domain + search); don't guess. " +
        "The output lists entities whose state changed; an empty list comes with a warning and means nothing changed.",
      parameters: Type.Object({
        domain: Type.String({ description: "Service domain (e.g. light, switch, fan, scene, climate)." }),
        service: Type.String({ description: "Service name (e.g. turn_on, turn_off, toggle)." }),
        entity_id: Type.Optional(Type.String({ description: "Entity ID to act on (e.g. light.living_room), or several comma-separated. Top-level only, not inside data." })),
        data: Type.Optional(Type.Record(Type.String(), Type.Unknown(), {
          description: "Additional service data as key-value pairs (e.g. {\"brightness\": 128}).",
        })),
      }),
      async execute({ domain, service, entity_id, data }, config) {
        try {
          const resolvedConfig: HomeAssistantConfig = {
            server: requireServer(config.server),
            token: config.token ?? "",
            captureDir: CAPTURE_DIR,
          };
          return await serviceCall(resolvedConfig, {
            domain: String(domain ?? ""),
            service: String(service ?? ""),
            entity_id,
            data,
          });
        } catch (e) {
          return { error: (e as Error).message };
        }
      },
    }),

    tool({
      name: "hass_lovelace_get",
      label: "HA Lovelace Get",
      description: "Read a Home Assistant Lovelace dashboard config or a single view.",
      parameters: Type.Object({
        dashboard: Type.Optional(Type.String({
          description: "Optional dashboard ID or title. Defaults to the main Lovelace dashboard.",
        })),
        view: Type.Optional(Type.String({
          description: "Optional Lovelace view title or path to return from the dashboard config.",
        })),
      }),
      async execute({ dashboard, view }, config) {
        try {
          const resolvedConfig: HomeAssistantConfig = {
            server: requireServer(config.server),
            token: config.token ?? "",
            captureDir: CAPTURE_DIR,
          };
          return await lovelaceGet(resolvedConfig, { dashboard, view });
        } catch (e) {
          return { error: (e as Error).message };
        }
      },
    }),

    tool({
      name: "hass_lovelace_set",
      label: "HA Lovelace Set",
      description: "Write a Home Assistant Lovelace dashboard config.",
      parameters: Type.Object({
        dashboard: Type.Optional(Type.String({
          description: "Optional dashboard ID or title. Defaults to the main Lovelace dashboard.",
        })),
        config: Type.Record(Type.String(), Type.Unknown(), {
          description: "Full Lovelace dashboard config object to write.",
        }),
      }),
      async execute({ dashboard, config: dashboardConfig }, config) {
        try {
          const resolvedConfig: HomeAssistantConfig = {
            server: requireServer(config.server),
            token: config.token ?? "",
            captureDir: CAPTURE_DIR,
          };
          return await lovelaceSet(resolvedConfig, {
            dashboard,
            config: dashboardConfig as Record<string, unknown>,
          });
        } catch (e) {
          return { error: (e as Error).message };
        }
      },
    }),

    ...(["automation", "script"] as const).flatMap((kind) => {
      const label = kind === "automation" ? "Automation" : "Script";
      const idDescription = kind === "automation"
        ? "Automation config id (the `id` attribute, as returned by hass_automation_list) or its entity ID (e.g. automation.porch_lights)."
        : "Script id (e.g. bedtime) or its entity ID (e.g. script.bedtime).";
      const resolve = (config: { server?: string; token?: string }): HomeAssistantConfig => ({
        server: requireServer(config.server),
        token: config.token ?? "",
        captureDir: CAPTURE_DIR,
      });

      return [
        tool({
          name: `hass_${kind}_list`,
          label: `HA ${label} List`,
          description: `List Home Assistant ${kind}s with their config id, alias, state, and last triggered time.`,
          parameters: Type.Object({}),
          async execute(_params, config) {
            try {
              return await configList(resolve(config), { kind });
            } catch (e) {
              return { error: (e as Error).message };
            }
          },
        }),

        tool({
          name: `hass_${kind}_get`,
          label: `HA ${label} Get`,
          description: `Read the full config of a Home Assistant ${kind}. Requires an admin token.`,
          parameters: Type.Object({
            id: Type.String({ description: idDescription }),
          }),
          async execute({ id }, config) {
            try {
              return await configGet(resolve(config), { kind, id: String(id ?? "") });
            } catch (e) {
              return { error: (e as Error).message };
            }
          },
        }),

        tool({
          name: `hass_${kind}_set`,
          label: `HA ${label} Set`,
          description: kind === "automation"
            ? "Create or replace a Home Assistant automation config. HA validates and reloads it. Omit id to create a new automation. Read the existing config with hass_automation_get first and send the full object. Requires an admin token."
            : "Create or replace a Home Assistant script config. HA validates and reloads it. Read the existing config with hass_script_get first and send the full object. Requires an admin token.",
          parameters: Type.Object({
            id: kind === "automation"
              ? Type.Optional(Type.String({ description: `${idDescription} Omit to create a new automation.` }))
              : Type.String({ description: `${idDescription} A new id creates a new script.` }),
            config: Type.Record(Type.String(), Type.Unknown(), {
              description: kind === "automation"
                ? "Full automation config object (alias, description, triggers, conditions, actions, mode)."
                : "Full script config object (alias, description, sequence, mode, fields).",
            }),
          }),
          async execute({ id, config: itemConfig }, config) {
            try {
              return await configSet(resolve(config), {
                kind,
                id: id as string | undefined,
                config: itemConfig as Record<string, unknown>,
              });
            } catch (e) {
              return { error: (e as Error).message };
            }
          },
        }),
      ];
    }),

    tool({
      name: "hass_event_list",
      label: "HA Event List",
      description: "List Home Assistant event types.",
      parameters: Type.Object({
        entity_id: Type.Optional(Type.String({ description: "Optional keyword to filter event types by string match." })),
      }),
      async execute({ entity_id }, config) {
        try {
          const resolvedConfig: HomeAssistantConfig = {
            server: requireServer(config.server),
            token: config.token ?? "",
            captureDir: CAPTURE_DIR,
          };
          return await eventList(resolvedConfig, { entity_id });
        } catch (e) {
          return { error: (e as Error).message };
        }
      },
    }),

    tool({
      name: "hass_person_find",
      label: "HA Person Find",
      description: "Find a Home Assistant person by name or entity ID.",
      parameters: Type.Object({
        name: Type.Optional(Type.String({ description: "Name of the person to search for (case-insensitive substring match)." })),
        entity_id: Type.Optional(Type.String({ description: "Exact entity ID to look up (e.g. person.john)." })),
      }),
      async execute({ name, entity_id }, config) {
        try {
          const resolvedConfig: HomeAssistantConfig = {
            server: requireServer(config.server),
            token: config.token ?? "",
            captureDir: CAPTURE_DIR,
          };
          return await personFind(resolvedConfig, { name, entity_id });
        } catch (e) {
          return { error: (e as Error).message };
        }
      },
    }),

    tool({
      name: "hass_speaker_volume_get",
      label: "HA Speaker Volume Get",
      description: "Get the volume level of one speaker or all speakers.",
      parameters: Type.Object({
        entity_id: Type.Optional(Type.String({ description: "Optional entity ID of the speaker (e.g. media_player.living_room)." })),
      }),
      async execute({ entity_id }, config) {
        try {
          const resolvedConfig: HomeAssistantConfig = {
            server: requireServer(config.server),
            token: config.token ?? "",
            captureDir: CAPTURE_DIR,
          };
          return await speakerVolumeGet(resolvedConfig, { entity_id });
        } catch (e) {
          return { error: (e as Error).message };
        }
      },
    }),

    tool({
      name: "hass_speaker_volume_set",
      label: "HA Speaker Volume Set",
      description: "Set the volume level of a speaker.",
      parameters: Type.Object({
        entity_id: Type.String({ description: "Entity ID of the speaker to adjust (e.g. media_player.living_room)." }),
        volume_level: Type.Number({ description: "Desired volume level between 0.0 (silent) and 1.0 (maximum).", minimum: 0, maximum: 1 }),
      }),
      async execute({ entity_id, volume_level }, config) {
        try {
          const resolvedConfig: HomeAssistantConfig = {
            server: requireServer(config.server),
            token: config.token ?? "",
            captureDir: CAPTURE_DIR,
          };
          return await speakerVolumeSet(resolvedConfig, {
            entity_id: String(entity_id ?? ""),
            volume_level: Number(volume_level),
          });
        } catch (e) {
          return { error: (e as Error).message };
        }
      },
    }),

    tool({
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
      async execute({ entity_id, hours, start_time, end_time, keyword, limit }, config) {
        try {
          const resolvedConfig: HomeAssistantConfig = {
            server: requireServer(config.server),
            token: config.token ?? "",
            captureDir: CAPTURE_DIR,
          };
          return await logbook(resolvedConfig, {
            entity_id,
            hours,
            start_time,
            end_time,
            keyword,
            limit,
          });
        } catch (e) {
          return { error: (e as Error).message };
        }
      },
    }),

    tool({
      name: "hass_camera_list",
      label: "HA Camera List",
      description: "List available Home Assistant cameras.",
      parameters: Type.Object({}),
      async execute(_params, _config) {
        try {
          return await cameraList();
        } catch (e) {
          return { error: (e as Error).message };
        }
      },
    }),

    tool({
      name: "hass_camera_snapshot",
      label: "HA Camera Snapshot",
      description: "Take a snapshot from a Home Assistant camera.",
      parameters: Type.Object({
        camera_name: Type.String({
          description:
            "Name of the camera to snapshot. One of: living-room, front-doorbell, front-doorbell-package, backyard-right, backyard-left, driveway, family-room, garage, all",
        }),
      }),
      async execute({ camera_name }, config) {
        try {
          const resolvedConfig: HomeAssistantConfig = {
            server: requireServer(config.server),
            token: config.token ?? "",
            captureDir: CAPTURE_DIR,
          };
          return await cameraSnapshotHandler(resolvedConfig, { camera_name: String(camera_name ?? "") });
        } catch (e) {
          return { error: (e as Error).message };
        }
      },
    }),

    tool({
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
      async execute({ camera_names, label }, config) {
        try {
          const resolvedConfig: HomeAssistantConfig = {
            server: requireServer(config.server),
            token: config.token ?? "",
            captureDir: CAPTURE_DIR,
          };
          return await cameraCollageHandler(resolvedConfig, { camera_names, label });
        } catch (e) {
          return { error: (e as Error).message };
        }
      },
    }),
  ],
});
