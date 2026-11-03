const http = require("node:http");
const path = require("node:path");
const fs = require("node:fs");
const { execSync } = require("node:child_process");

const PORT = 3000;
const OUT_DIR = path.join(__dirname, "out");

const data = [
  { id: "07df7e91-ad83-4572-a1d9-0ab9556ec4e8", premium: false },
  { id: "48f32284-ce3e-4806-8f85-a120fc793e6e", premium: true },
  { id: "b7c56789-b338-4711-b3cb-f53725c69ee7", premium: true },
];

const detail = [
  { id: "07df7e91-ad83-4572-a1d9-0ab9556ec4e8", premium: false, data: "lorem ipsum" },
  { id: "48f32284-ce3e-4806-8f85-a120fc793e6e", premium: true, data: "premium lorem ipsum" },
  { id: "b7c56789-b338-4711-b3cb-f53725c69ee7", premium: true, data: "premium lorem ipsum" },
];

function sendJson(res, status, body) {
  res.writeHead(status, { "Content-Type": "application/json" });
  res.end(JSON.stringify(body));
}

/** Returns true if it handled the request (an API route), false otherwise. */
function handleApi(req, res) {
  const url = new URL(req.url, "http://localhost");

  if (url.pathname === "/api/data" && req.method === "GET") {
    sendJson(res, 200, data);
    return true;
  }

  // The one endpoint that actually enforces the premium gate server-side: used by the UI's normal
  // click flow for the query-param resource list, before it ever updates the visible URL.
  if (url.pathname === "/api/preview" && req.method === "GET") {
    const resource = detail.find((item) => item.id === url.searchParams.get("resourceId"));
    if (!resource) {
      sendJson(res, 404, { error: "Not found" });
    } else if (resource.premium) {
      sendJson(res, 403, { error: "Forbidden" });
    } else {
      sendJson(res, 200, resource);
    }
    return true;
  }

  // Deliberately vulnerable: no authorization check at all (the server-side IDOR this app demonstrates).
  if (url.pathname.startsWith("/api/detail/") && req.method === "GET") {
    const id = decodeURIComponent(url.pathname.split("/").pop());
    const resource = detail.find((item) => item.id === id);
    if (!resource) {
      sendJson(res, 404, { error: "Not found" });
    } else {
      sendJson(res, 200, resource);
    }
    return true;
  }

  return false;
}

const MIME_TYPES = {
  ".html": "text/html",
  ".js": "text/javascript",
  ".css": "text/css",
  ".json": "application/json",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon",
  ".png": "image/png",
  ".woff2": "font/woff2",
};

/** Serves `out/` (the `next build` static export), falling back to the root shell for unknown paths. */
function serveStatic(req, res) {
  const pathname = new URL(req.url, "http://localhost").pathname;
  const candidates = [
    path.join(OUT_DIR, pathname),
    path.join(OUT_DIR, pathname, "index.html"),
    `${path.join(OUT_DIR, pathname)}.html`,
  ];
  const file = candidates.find((candidate) => fs.existsSync(candidate) && fs.statSync(candidate).isFile());
  const resolved = file ?? path.join(OUT_DIR, "index.html");

  if (!fs.existsSync(resolved)) {
    res.writeHead(404, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: "Not found" }));
    return;
  }

  res.writeHead(200, { "Content-Type": MIME_TYPES[path.extname(resolved)] ?? "application/octet-stream" });
  fs.createReadStream(resolved).pipe(res);
}

if (!fs.existsSync(OUT_DIR)) {
  console.log("No static build found in out/, running `next build`...");
  execSync("npx next build", { cwd: __dirname, stdio: "inherit" });
}

const server = http.createServer((req, res) => {
  if (handleApi(req, res)) return;
  serveStatic(req, res);
});

server.listen(PORT, "127.0.0.1", () => {
  console.log(`react-app-target available on http://localhost:${PORT}`);
});
