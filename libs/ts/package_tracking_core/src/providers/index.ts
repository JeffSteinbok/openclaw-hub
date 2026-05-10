/**
 * Built-in carrier status providers.
 *
 * Currently backed by Camoufox (a stealth Firefox fork for web scraping).
 * Individual carriers can be swapped to API-based providers without
 * changing the public interface.
 */

export {
  uspsProvider,
  fedexProvider,
  upsProvider,
  builtinProviders,
} from "./camoufox.js";
