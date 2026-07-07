import { defineConfig } from "tsup";
export default defineConfig({ entry:["src/index.ts","src/adapter.ts","src/handlers.ts"], format:["esm"], outDir:"dist", dts:false, sourcemap:true, clean:true, target:"node20", splitting:false, shims:false, skipNodeModulesBundle:true });
