import { copyFileSync, createReadStream, existsSync, mkdirSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import react from "@vitejs/plugin-react";
import { defineConfig, type Plugin } from "vite";

/** The repo's committed data directory (two levels up from src/web). */
const repoDataDir = path.resolve(import.meta.dirname, "../../data");

/**
 * Dev-only middleware serving the repo's real data/ directory at /data, so
 * `bun run dev` reads the same committed files the production bundle copies.
 */
function serveRepoData(): Plugin {
  return {
    name: "serve-repo-data",
    apply: "serve",
    configureServer(server) {
      server.middlewares.use("/data", (req, res, next) => {
        const urlPath = decodeURIComponent((req.url ?? "").split("?")[0] ?? "");
        const filePath = path.join(repoDataDir, urlPath);
        if (
          !filePath.startsWith(repoDataDir + path.sep) ||
          !existsSync(filePath) ||
          !statSync(filePath).isFile()
        ) {
          next();
          return;
        }
        res.setHeader("Content-Type", "application/json; charset=utf-8");
        createReadStream(filePath).pipe(res);
      });
    },
  };
}

/**
 * Build-only step copying the committed data files into the bundle, so dist
 * is fully self-contained: data/derived/map/*.json + data/boundaries/*.geojson.
 */
function copyRepoData(): Plugin {
  let outDir = "dist";
  return {
    name: "copy-repo-data",
    apply: "build",
    configResolved(config) {
      outDir = path.resolve(config.root, config.build.outDir);
    },
    closeBundle() {
      // Zip-level files are excluded: the zip layer is deliberately unexposed
      // in the UI, and zips.geojson alone is ~17 MB.
      const targets: [string, string, (name: string) => boolean][] = [
        ["derived/map", "data/derived/map", (n) => n.endsWith(".json") && n !== "zip.json"],
        ["boundaries", "data/boundaries", (n) => n.endsWith(".geojson") && n !== "zips.geojson"],
      ];
      for (const [srcRel, destRel, match] of targets) {
        const srcDir = path.join(repoDataDir, srcRel);
        const destDir = path.join(outDir, destRel);
        mkdirSync(destDir, { recursive: true });
        for (const name of readdirSync(srcDir).filter(match)) {
          copyFileSync(path.join(srcDir, name), path.join(destDir, name));
        }
      }
    },
  };
}

export default defineConfig(({ command }) => ({
  // GitHub Pages serves the project site under /<repo-name>/.
  base: command === "build" ? "/medi-cal-disenrollment/" : "/",
  plugins: [react(), serveRepoData(), copyRepoData()],
}));
