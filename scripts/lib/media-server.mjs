import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import { createHash } from "node:crypto";

const MIME = {
  ".mp3": "audio/mpeg",
  ".m4a": "audio/mp4",
  ".wav": "audio/wav",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".mp4": "video/mp4",
  ".mov": "video/quicktime",
};

function routeExtension(filePath) {
  const extension = path.extname(filePath).toLowerCase();
  if (extension) return extension;
  const header = fs.readFileSync(filePath).subarray(0, 12);
  if (header.length >= 8 && header[0] === 0x89 && header.subarray(1, 4).toString() === "PNG") return ".png";
  return "";
}

export async function startMediaServer(filePaths, options = {}) {
  const host = options.host || "127.0.0.1";
  const port = Number(options.port || 39091);
  const routeMap = new Map();
  for (const filePath of [...new Set(filePaths.map((item) => path.resolve(item)))]) {
    if (!fs.existsSync(filePath) || !fs.statSync(filePath).isFile()) throw new Error(`无法共享不存在的素材：${filePath}`);
    const token = createHash("sha256").update(filePath).digest("hex").slice(0, 20);
    routeMap.set(`/media/${token}${routeExtension(filePath)}`, filePath);
  }

  const server = http.createServer((request, response) => {
    const pathname = new URL(request.url || "/", `http://${host}`).pathname;
    if (pathname === "/health") {
      response.writeHead(200, { "content-type": "application/json" });
      response.end(JSON.stringify({ ok: true, files: routeMap.size }));
      return;
    }
    const filePath = routeMap.get(pathname);
    if (!filePath) {
      response.writeHead(404);
      response.end("not found");
      return;
    }
    response.writeHead(200, {
      "content-type": MIME[routeExtension(filePath)] || "application/octet-stream",
      "content-length": fs.statSync(filePath).size,
      "cache-control": "no-store",
    });
    fs.createReadStream(filePath).pipe(response);
  });

  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, host, resolve);
  });

  const baseUrl = `http://${host}:${port}`;
  return {
    urlFor(filePath) {
      const absolute = path.resolve(filePath);
      for (const [route, item] of routeMap) if (item === absolute) return `${baseUrl}${route}`;
      throw new Error(`素材未注册到本地服务：${absolute}`);
    },
    close: () => new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve())),
  };
}
