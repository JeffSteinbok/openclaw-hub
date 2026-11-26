import { defineConfig } from "tsup";
import base from "../tsup.base";

/**
 * @openclaw/mail-action-usps is a private workspace library (not published to
 * npm), so inline it and its JSON5 parser into dist for managed installs.
 */
export default defineConfig({
  ...base,
  noExternal: [...(base.noExternal ?? []), "@openclaw/mail-action-usps", "json5"],
});
