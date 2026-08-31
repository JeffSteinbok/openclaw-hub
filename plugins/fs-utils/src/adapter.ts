import { createRequire } from "node:module";
import { register } from "./index.js";

const req = createRequire(import.meta.url);
const sdk = req("openclaw/plugin-sdk/plugin-entry");
export default sdk.definePluginEntry({
  id: "fs-utils",
  name: "File System Utilities",
  description: "Copy, move, and list files within the agent workspace.",
  register,
});
