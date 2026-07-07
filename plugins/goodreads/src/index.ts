/**
 * Goodreads plugin — tool definitions.
 * Uses carapace-plugin-sdk definePlugin pattern (modeled after withings).
 */

import path from "node:path";
import { definePlugin } from "carapace-plugin-sdk";
import { Type } from "@sinclair/typebox";
import {
  handleAuthStatus,
  handleLogin,
  handleListShelf,
  handleSearch,
  handleMoveShelf,
  handleRemoveShelf,
  type GoodreadsConfig,
} from "./handlers.js";

const HOME = process.env.HOME ?? "/home/openclaw";
const DEFAULT_STATE_PATH = path.join(HOME, ".openclaw/state/goodreads.json");

function buildConfig(config: {
  username?: string;
  password?: string;
  stateFilePath?: string;
}): GoodreadsConfig {
  return {
    username: config.username?.trim() || process.env.GOODREADS_USERNAME || "",
    password: config.password?.trim() || process.env.GOODREADS_PASSWORD || "",
    stateFilePath: config.stateFilePath?.trim() || process.env.GOODREADS_STATE_FILE || DEFAULT_STATE_PATH,
  };
}

export const createEntry = definePlugin({
  id: "goodreads",
  name: "Goodreads",
  description: "Read Goodreads shelves and search books via headless Playwright with anti-403 browser context",
  contracts: {
    tools: [
      "goodreads_auth_status",
      "goodreads_login",
      "goodreads_list_shelf",
      "goodreads_search",
      "goodreads_move_shelf",
      "goodreads_remove_shelf",
    ],
  },

  configSchema: Type.Object({
    username: Type.Optional(Type.String({ description: "Goodreads email/username (or set GOODREADS_USERNAME env var)" })),
    password: Type.Optional(Type.String({ description: "Goodreads password (or set GOODREADS_PASSWORD env var)" })),
    stateFilePath: Type.Optional(Type.String({ description: "Path where Goodreads session state is stored" })),
  }),

  tools: (tool) => [
    tool({
      name: "goodreads_auth_status",
      label: "Goodreads Auth Status",
      description: "Check if the Goodreads session is valid. Returns authenticated status and username if logged in.",
      parameters: Type.Object({}),
      async execute(_params, config) {
        return handleAuthStatus(buildConfig(config));
      },
    }),

    tool({
      name: "goodreads_login",
      label: "Goodreads Login",
      description: "Log in to Goodreads using username/password from config or env vars (GOODREADS_USERNAME, GOODREADS_PASSWORD). Persists session state for future calls.",
      parameters: Type.Object({}),
      async execute(_params, config) {
        return handleLogin(buildConfig(config));
      },
    }),

    tool({
      name: "goodreads_list_shelf",
      label: "Goodreads List Shelf",
      description: "List books from a Goodreads shelf (read, currently-reading, to-read). Returns structured book records with title, author, rating, and dates.",
      parameters: Type.Object({
        shelf: Type.String({
          description: "Shelf to fetch: 'read', 'currently-reading', or 'to-read'",
          enum: ["read", "currently-reading", "to-read"],
        }),
        page: Type.Optional(Type.Integer({ description: "Page number (default: 1)", minimum: 1 })),
        limit: Type.Optional(Type.Integer({ description: "Books per page (default: 20, max: 200)", minimum: 1, maximum: 200 })),
      }),
      async execute({ shelf, page, limit }, config) {
        return handleListShelf(buildConfig(config), { shelf, page, limit });
      },
    }),

    tool({
      name: "goodreads_search",
      label: "Goodreads Search",
      description: "Search Goodreads for books by title, author, or ISBN. Returns title, author, URL, and ratings.",
      parameters: Type.Object({
        query: Type.String({ description: "Search query (title, author, ISBN, etc.)" }),
        limit: Type.Optional(Type.Integer({ description: "Max results to return (default: 10)", minimum: 1, maximum: 50 })),
      }),
      async execute({ query, limit }, config) {
        return handleSearch(buildConfig(config), { query, limit });
      },
    }),

    tool({
      name: "goodreads_move_shelf",
      label: "Goodreads Move to Shelf",
      description: "Move a book to a different Goodreads shelf (read, currently-reading, to-read). Requires the book's Goodreads URL.",
      parameters: Type.Object({
        book_url: Type.String({ description: "Goodreads book URL (e.g. https://www.goodreads.com/book/show/...)" }),
        shelf: Type.String({
          description: "Target shelf: 'read', 'currently-reading', or 'to-read'",
          enum: ["read", "currently-reading", "to-read"],
        }),
      }),
      async execute({ book_url, shelf }, config) {
        return handleMoveShelf(buildConfig(config), { book_url, shelf });
      },
    }),

    tool({
      name: "goodreads_remove_shelf",
      label: "Goodreads Remove from Shelves",
      description: "Remove a book from all Goodreads shelves (Did Not Finish / remove). Requires the book's Goodreads URL.",
      parameters: Type.Object({
        book_url: Type.String({ description: "Goodreads book URL (e.g. https://www.goodreads.com/book/show/...)" }),
      }),
      async execute({ book_url }, config) {
        return handleRemoveShelf(buildConfig(config), { book_url });
      },
    }),
  ],
});
