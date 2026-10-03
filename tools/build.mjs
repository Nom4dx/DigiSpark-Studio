import { build } from "esbuild";
import { cp, mkdir } from "node:fs/promises";
await mkdir("static", { recursive: true });
await build({
  entryPoints: ["frontend/app.js"],
  bundle: true,
  minify: true,
  outfile: "static/app.js",
  legalComments: "linked",
});
await cp("node_modules/blockly/media", "static/blockly-media", {
  recursive: true,
});
