# WeightWatchers

Use WeightWatchers tracking data from OpenClaw: search foods, log meals and saved meals/recipes, review the diary, quick-add points, delete entries, and check remaining points. It supports both live WW lookups and an offline points calculator for quick estimates.

## Tools

| Tool | Description |
|------|-------------|
| [`ww_daily`](#tool-ww_daily) | Get daily food diary with tracked meals and points summary |
| [`ww_search`](#tool-ww_search) | Search the WW food database for food IDs, points, and portion options |
| [`ww_log`](#tool-ww_log) | Log a food item to the diary using IDs returned by `ww_search` |
| [`ww_points`](#tool-ww_points) | Calculate SmartPoints offline from nutrition data |
| [`ww_budget`](#tool-ww_budget) | Get remaining points budget for a date |
| [`ww_quick_add`](#tool-ww_quick_add) | Quick-add a points value without choosing a specific food |
| [`ww_delete`](#tool-ww_delete) | Delete a tracked diary entry by tracking ID |
| [`ww_search_meals`](#tool-ww_search_meals) | List saved WW meals, recipes, and custom foods |
| [`ww_log_meal`](#tool-ww_log_meal) | Log a saved meal, recipe, or custom food by ID |

## Configuration Schema

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `jwt` | string | Optional | WW API JWT token (preferred auth method) |
| `email` | string | Optional | WW account email used for fallback login |
| `password` | string | Optional | WW account password used for fallback login |
| `tld` | string | Optional | WW regional TLD (for example `com`) |

## Example config

Set WeightWatchers under `plugins.entries["weightwatchers"].config`:

```json
{
  "plugins": {
    "entries": {
      "weightwatchers": {
        "enabled": true,
        "config": {
          "jwt": "${WW_JWT}",
          "email": "${WW_EMAIL}",
          "password": "${WW_PASSWORD}",
          "tld": "${WW_TLD}"
        }
      }
    }
  }
}
```

`jwt` is preferred. `email` and `password` are only needed when the plugin has to log in and refresh auth automatically. If `tld` is omitted, the plugin defaults to `com`.

## Environment Variables

| Variable | Required | Description |
|----------|----------|-------------|
| `WW_JWT` | No | Backing value for plugin config `jwt` |
| `WW_EMAIL` | No | Backing value for plugin config `email` |
| `WW_PASSWORD` | No | Backing value for plugin config `password` |
| `WW_TLD` | No | Backing value for plugin config `tld` |

## Tool Parameters

<a id="tool-ww_daily"></a>

### `ww_daily`

- `date` — optional date in `YYYY-MM-DD` format (default today)

<a id="tool-ww_search"></a>

### `ww_search`

- `query` — required food search query
- `limit` — optional maximum result count (default `10`)

<a id="tool-ww_log"></a>

### `ww_log`

- `food_id` — required WW food ID from `ww_search`
- `portion_id` — required portion ID from `ww_search`
- `version_id` — required version ID from `ww_search`
- `portion_size` — optional portion multiplier (default `1.0`)
- `date` — optional date in `YYYY-MM-DD` format (default today)
- `meal_type` — optional meal slot: `breakfast`, `lunch`, `dinner`, or `snacks`
- `source_type` — optional WW source type such as `WWFOOD`

<a id="tool-ww_points"></a>

### `ww_points`

- `calories` — required calories
- `saturated_fat` — required saturated fat in grams
- `sugar` — required sugar in grams
- `protein` — required protein in grams

<a id="tool-ww_budget"></a>

### `ww_budget`

- `date` — optional date in `YYYY-MM-DD` format (default today)

<a id="tool-ww_quick_add"></a>

### `ww_quick_add`

- `points` — required SmartPoints value to add
- `name` — optional diary label (default `Quick Add`)
- `meal_type` — optional meal slot: `breakfast`, `lunch`, `dinner`, or `snacks`
- `date` — optional date in `YYYY-MM-DD` format (default today)

<a id="tool-ww_delete"></a>

### `ww_delete`

- `tracking_id` — required tracking ID from `ww_daily` (use `tracking_id` for regular foods, meal `tracking_id` for meals which batch-deletes all components)
- `date` — optional date in `YYYY-MM-DD` format (default today)

<a id="tool-ww_search_meals"></a>

### `ww_search_meals`

- `query` — optional name filter (case-insensitive substring match)
- `type` — optional type filter: `meal`, `recipe`, `food`, or `all` (default `all`)

Returns `meal_id`, `version_id`, `name`, `type`, and `points` for each result.

<a id="tool-ww_log_meal"></a>

### `ww_log_meal`

- `meal_id` — required meal/recipe/food ID from `ww_search_meals`
- `type` — required type: `meal`, `recipe`, or `food`
- `meal_type` — optional time of day: `morning`, `midday`, `evening`, or `anytime` (default `morning`)
- `date` — optional date in `YYYY-MM-DD` format (default today)

## Notes

- Uses the unofficial WW API. JWT token may need periodic refresh.
- Offline points formula: `max(0, round(calories × 0.0305 + sat_fat × 0.275 + sugar × 0.12 − protein × 0.098))`.
- After logging food, always show what was added and remaining points.
- `ww_daily` returns `entry_id` and `is_meal` on each entry. Meals also include `entry_ids[]` (all component entry IDs).
- `ww_delete` handles meals automatically — pass the meal's `tracking_id` and it batch-deletes all components.
- `ww_log_meal` handles saved meals by fetching the meal definition and posting all food components with proper `mealId`/`mealVersionId` grouping.

## Plugin Structure

```
openclaw.plugin.json
src/index.ts
src/adapter.ts
```

## API Endpoints Reference

Endpoints discovered via reverse engineering the unofficial WW API:

| Endpoint | Method | Purpose |
|----------|--------|---------|
| `/api/v3/cmx/operations/composed/members/~/my-day/{date}` | GET | Daily diary + budget |
| `/api/v3/cmx/members/~/trackedFoods/{date}` | GET | Flat entry list with `entryId`/`mealId` |
| `/api/v4/cmx/members/~/trackedFoods/{date}` | POST | Log food/meal entries |
| `/api/v3/cmx/members/~/trackedFoods/{date}` | DELETE (body) | Delete entries by `entryId` |
| `/api/v3/search/foods` | GET | Search WW food database |
| `/api/v3/public/foods/{_id}` | GET | Food details (WWFOOD) |
| `/api/v3/public/recipes/{_id}` | GET | Recipe details (WWRECIPE) |
| `/api/v3/cmx/members/~/custom-foods/meals` | GET | List saved member meals |
| `/api/v3/cmx/members/~/custom-foods/meals/{_id}` | GET | Meal definition with components |
| `/api/v3/cmx/members/~/custom-foods/recipes` | GET | List member recipes |
| `/api/v3/cmx/members/~/custom-foods/recipes/{_id}` | GET | Recipe details (MEMBERRECIPE) |
| `/api/v3/cmx/members/~/custom-foods/foods` | GET | List custom member foods |
| `/api/v3/cmx/members/~/custom-foods/foods/{_id}` | GET | Custom food details (MEMBERFOOD) |

### Delete body format
```json
[{ "entryId": "<uuid>", "isQuickAdd": false }]
```

### Log meal format
Post all component foods with `mealId` and `mealVersionId` set — WW groups them automatically.

---

## CLI

Built with [Carapace Plugin SDK](https://github.com/JeffSteinbok/carapace-plugin-sdk).
