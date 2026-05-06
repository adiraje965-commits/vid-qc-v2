import { defineConfig } from "vite";
import react from "@vitejs/plugin-react-swc";
import path from "path";
import { componentTagger } from "lovable-tagger";
import type { Plugin } from "vite";

// https://vitejs.dev/config/
export default defineConfig(({ mode }) => ({
  server: {
    host: "::",
    port: 8080,
    hmr: {
      overlay: false,
    },
  },
  plugins: [react(), transcriptApi(), mode === "development" && componentTagger()].filter(Boolean),
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
    dedupe: ["react", "react-dom", "react/jsx-runtime", "react/jsx-dev-runtime", "@tanstack/react-query", "@tanstack/query-core"],
  },
}));

function transcriptApi(): Plugin {
  return {
    name: "vid-qc-transcript-api",
    configureServer(server) {
      server.middlewares.use("/api/transcript", async (req, res) => {
        if (req.method !== "POST") {
          res.statusCode = 405;
          res.end(JSON.stringify({ error: "Method not allowed" }));
          return;
        }

        try {
          const body = JSON.parse(await readBody(req));
          const videoUrl = String(body.videoUrl ?? "");
          const videoId = extractYouTubeId(videoUrl);
          if (!videoId) {
            res.statusCode = 400;
            res.setHeader("Content-Type", "application/json");
            res.end(JSON.stringify({ error: "Only YouTube caption pull is available in the local dev server." }));
            return;
          }

          const { YoutubeTranscript } = await import("youtube-transcript");
          const rows = await YoutubeTranscript.fetchTranscript(videoId);
          const segments = rows
            .map((row) => ({
              start: Math.max(0, Number(row.offset ?? 0) / 1000),
              end: Math.max(0, (Number(row.offset ?? 0) + Number(row.duration ?? 0)) / 1000),
              text: String(row.text ?? "").replace(/\s+/g, " ").trim(),
              speaker: "YouTube captions",
            }))
            .filter((row) => row.text);

          if (!segments.length) throw new Error("No captions returned for this YouTube video.");
          res.statusCode = 200;
          res.setHeader("Content-Type", "application/json");
          res.end(JSON.stringify({ ok: true, source: "youtube-captions", segments }));
        } catch (error) {
          res.statusCode = 500;
          res.setHeader("Content-Type", "application/json");
          res.end(JSON.stringify({ error: error instanceof Error ? error.message : String(error) }));
        }
      });
    },
  };
}

function readBody(req: import("node:http").IncomingMessage) {
  return new Promise<string>((resolve, reject) => {
    let raw = "";
    req.setEncoding("utf8");
    req.on("data", (chunk) => { raw += chunk; });
    req.on("end", () => resolve(raw || "{}"));
    req.on("error", reject);
  });
}

function extractYouTubeId(url: string) {
  return url.match(/(?:youtube\.com\/(?:watch\?v=|embed\/|shorts\/)|youtu\.be\/)([A-Za-z0-9_-]{11})/)?.[1] ?? null;
}
