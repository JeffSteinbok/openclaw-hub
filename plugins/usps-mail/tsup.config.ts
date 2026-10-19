import { defineConfig } from "tsup";
import base from "../tsup.base";

/**
 * @openclaw/mail-action-usps is a private workspace library (not published to
 * npm), so inline it into dist/ — a packed managed install can't resolve it.
 */
export default defineConfig({
  ...base,
  noExternal: [...(base.noExternal ?? []), "@openclaw/mail-action-usps"],
});
