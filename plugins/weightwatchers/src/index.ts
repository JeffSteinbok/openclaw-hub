/**
 * WeightWatchers plugin — OpenClaw plugin shim.
 *
 * Constructs config from pluginConfig, registers tools that delegate to handlers.
 */

import { Type } from "@sinclair/typebox";
import {
  wwDaily,
  wwSearch,
  wwLog,
  wwPoints,
  wwBudget,
  wwQuickAdd,
  wwDelete,
  wwSearchMeals,
  wwLogMeal,
  type WWConfig,
} from "./handlers.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type PluginApi = {
  registerTool: (tool: unknown) => void;
  pluginConfig?: Record<string, unknown>;
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function formatResult(data: unknown) {
  return {
    content: [{ type: "text" as const, text: JSON.stringify(data) }],
    details: {},
  };
}

function buildConfig(pluginConfig?: Record<string, unknown>): WWConfig {
  return {
    jwt: pluginConfig?.jwt as string | undefined,
    email: pluginConfig?.email as string | undefined,
    password: pluginConfig?.password as string | undefined,
    tld: (pluginConfig?.tld as string | undefined) ?? "com",
  };
}

// ---------------------------------------------------------------------------
// Plugin entry
// ---------------------------------------------------------------------------

const configSchema = {
  type: "object" as const,
  additionalProperties: false,
  properties: {
    jwt: { type: "string" as const, description: "WW API JWT token (preferred auth method)" },
    email: { type: "string" as const, description: "WW account email used for fallback login" },
    password: { type: "string" as const, description: "WW account password used for fallback login" },
    tld: { type: "string" as const, description: "WW regional TLD (e.g. 'com')", default: "com" },
  },
};

export function createEntry() {
  return {
    id: "weightwatchers",
    name: "WeightWatchers",
    description: "Search foods, log meals, view diary and points budget via the unofficial WW API",
    contracts: { tools: ["ww_daily", "ww_search", "ww_log", "ww_points", "ww_budget", "ww_quick_add", "ww_delete", "ww_search_meals", "ww_log_meal"] },
    configSchema,
    register(api: PluginApi) {
      const config = buildConfig(api.pluginConfig);

      // ww_daily
      api.registerTool({
        name: "ww_daily",
        label: "WW Daily Diary",
        description: "Get daily WW food diary. Returns tracked meals and points summary.",
        parameters: Type.Object({
          date: Type.Optional(Type.String({ description: "Date in YYYY-MM-DD format (default: today)" })),
        }),
        async execute(_id: string, params: Record<string, unknown>) {
          const result = await wwDaily({ date: params.date as string | undefined }, config);
          return formatResult(result);
        },
      });

      // ww_search
      api.registerTool({
        name: "ww_search",
        label: "WW Food Search",
        description: "Search the WW food database. Returns food IDs, points, and portion options needed for logging.",
        parameters: Type.Object({
          query: Type.String({ description: "Food search query (e.g. 'grilled chicken breast')" }),
          limit: Type.Optional(Type.Integer({ description: "Max results to return (default: 10)" })),
        }),
        async execute(_id: string, params: Record<string, unknown>) {
          const result = await wwSearch({
            query: String(params.query ?? ""),
            limit: params.limit != null ? Number(params.limit) : undefined,
          }, config);
          return formatResult(result);
        },
      });

      // ww_log
      api.registerTool({
        name: "ww_log",
        label: "WW Log Food",
        description: "Log a food item to the WW diary. Requires food_id, version_id, and portion_id from ww_search results.",
        parameters: Type.Object({
          food_id: Type.String({ description: "WW food ID (from ww_search results)" }),
          version_id: Type.String({ description: "Food version ID (from ww_search results)" }),
          portion_id: Type.String({ description: "Portion ID (from ww_search results)" }),
          portion_size: Type.Optional(Type.Number({ description: "Portion multiplier (default: 1.0)" })),
          date: Type.Optional(Type.String({ description: "Date in YYYY-MM-DD format (default: today)" })),
          meal_type: Type.Optional(Type.Union([Type.Literal("breakfast"), Type.Literal("lunch"), Type.Literal("dinner"), Type.Literal("snacks")], { description: "Meal slot (default: snacks)" })),
          source_type: Type.Optional(Type.String({ description: "Food source type: WWFOOD, WWRECIPE, MEMBERFOOD (default: WWFOOD)" })),
        }),
        async execute(_id: string, params: Record<string, unknown>) {
          const result = await wwLog({
            food_id: String(params.food_id ?? ""),
            version_id: String(params.version_id ?? ""),
            portion_id: String(params.portion_id ?? ""),
            portion_size: params.portion_size != null ? Number(params.portion_size) : undefined,
            date: params.date as string | undefined,
            meal_type: params.meal_type as string | undefined,
            source_type: params.source_type as string | undefined,
          }, config);
          return formatResult(result);
        },
      });

      // ww_points
      api.registerTool({
        name: "ww_points",
        label: "WW Calculate Points",
        description: "Calculate WW SmartPoints offline from nutrition data. No authentication required.",
        parameters: Type.Object({
          calories: Type.Number({ description: "Total calories" }),
          saturated_fat: Type.Number({ description: "Saturated fat in grams" }),
          sugar: Type.Number({ description: "Sugar in grams" }),
          protein: Type.Number({ description: "Protein in grams" }),
        }),
        async execute(_id: string, params: Record<string, unknown>) {
          const result = wwPoints({
            calories: Number(params.calories),
            saturated_fat: Number(params.saturated_fat),
            sugar: Number(params.sugar),
            protein: Number(params.protein),
          });
          return formatResult(result);
        },
      });

      // ww_budget
      api.registerTool({
        name: "ww_budget",
        label: "WW Points Budget",
        description: "Get remaining WW points budget for a date. Shows daily and weekly allowances.",
        parameters: Type.Object({
          date: Type.Optional(Type.String({ description: "Date in YYYY-MM-DD format (default: today)" })),
        }),
        async execute(_id: string, params: Record<string, unknown>) {
          const result = await wwBudget({ date: params.date as string | undefined }, config);
          return formatResult(result);
        },
      });

      // ww_quick_add
      api.registerTool({
        name: "ww_quick_add",
        label: "WW Quick Add",
        description: "Quick-add a points value to the WW diary without specifying a food item. Useful when you know the points but not the exact food.",
        parameters: Type.Object({
          points: Type.Integer({ description: "Number of SmartPoints to add" }),
          name: Type.Optional(Type.String({ description: "Label for the diary entry (default: 'Quick Add')" })),
          meal_type: Type.Optional(Type.Union([Type.Literal("breakfast"), Type.Literal("lunch"), Type.Literal("dinner"), Type.Literal("snacks")], { description: "Meal slot (default: snacks)" })),
          date: Type.Optional(Type.String({ description: "Date in YYYY-MM-DD format (default: today)" })),
        }),
        async execute(_id: string, params: Record<string, unknown>) {
          const result = await wwQuickAdd({
            points: Number(params.points),
            name: params.name as string | undefined,
            meal_type: params.meal_type as string | undefined,
            date: params.date as string | undefined,
          }, config);
          return formatResult(result);
        },
      });

      // ww_delete
      api.registerTool({
        name: "ww_delete",
        label: "WW Delete Entry",
        description: "Delete a tracked food entry from the WW diary by its tracking ID. Use ww_daily to get tracking IDs.",
        parameters: Type.Object({
          tracking_id: Type.String({ description: "Tracking ID of the diary entry to delete (from ww_daily results)" }),
          date: Type.Optional(Type.String({ description: "Date of the entry in YYYY-MM-DD format (default: today)" })),
        }),
        async execute(_id: string, params: Record<string, unknown>) {
          const result = await wwDelete({
            tracking_id: String(params.tracking_id ?? ""),
            date: params.date as string | undefined,
          }, config);
          return formatResult(result);
        },
      });

      // ww_search_meals
      api.registerTool({
        name: "ww_search_meals",
        label: "WW Search Saved Meals",
        description: "List saved WW meals, recipes, and custom foods. Returns meal_id, name, points, and type needed for ww_log_meal.",
        parameters: Type.Object({
          query: Type.Optional(Type.String({ description: "Filter by name (case-insensitive substring match)" })),
          type: Type.Optional(Type.Union([
            Type.Literal("meal"), Type.Literal("recipe"), Type.Literal("food"), Type.Literal("all"),
          ], { description: "Type filter: meal, recipe, food, or all (default: all)" })),
        }),
        async execute(_id: string, params: Record<string, unknown>) {
          const result = await wwSearchMeals({
            query: params.query as string | undefined,
            type: params.type as string | undefined,
          }, config);
          return formatResult(result);
        },
      });

      // ww_log_meal
      api.registerTool({
        name: "ww_log_meal",
        label: "WW Log Saved Meal",
        description: "Log a saved WW meal, recipe, or custom food to the diary by its meal_id from ww_search_meals.",
        parameters: Type.Object({
          meal_id: Type.String({ description: "Meal/recipe/food ID from ww_search_meals results" }),
          type: Type.Union([
            Type.Literal("meal"), Type.Literal("recipe"), Type.Literal("food"),
          ], { description: "Type: meal, recipe, or food" }),
          meal_type: Type.Optional(Type.Union([
            Type.Literal("morning"), Type.Literal("midday"), Type.Literal("evening"), Type.Literal("anytime"),
          ], { description: "Time of day: morning, midday, evening, anytime (default: morning)" })),
          date: Type.Optional(Type.String({ description: "Date in YYYY-MM-DD format (default: today)" })),
        }),
        async execute(_id: string, params: Record<string, unknown>) {
          const result = await wwLogMeal({
            meal_id: String(params.meal_id ?? ""),
            type: String(params.type ?? "meal"),
            meal_type: params.meal_type as string | undefined,
            date: params.date as string | undefined,
          }, config);
          return formatResult(result);
        },
      });
    },
  };
}
