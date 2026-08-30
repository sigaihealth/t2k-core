import { createServer } from "node:http";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { buildDemoModel, DEMO_ROOT } from "./src/demo-model.mjs";
import {
  InMemoryReviewStore,
  ReviewInputError,
} from "./src/review-store.mjs";

const STATIC_FILES = new Map([
  ["/", ["index.html", "text/html; charset=utf-8"]],
  ["/app.js", ["app.js", "text/javascript; charset=utf-8"]],
  ["/styles.css", ["styles.css", "text/css; charset=utf-8"]],
]);

const RESOURCE_METHODS = new Map([
  ["/health", ["GET", "HEAD"]],
  ["/api/demo", ["GET", "HEAD"]],
  ["/api/reviews", ["POST"]],
  ...[...STATIC_FILES.keys()].map((pathname) => [pathname, ["GET", "HEAD"]]),
]);

const SECURITY_HEADERS = {
  "Content-Security-Policy":
    "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self'; connect-src 'self'; object-src 'none'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'",
  "Referrer-Policy": "no-referrer",
  "X-Content-Type-Options": "nosniff",
  "X-Frame-Options": "DENY",
};

function jsonResponse(response, statusCode, payload, extraHeaders = {}) {
  const body = JSON.stringify(payload);
  response.writeHead(statusCode, {
    ...SECURITY_HEADERS,
    "Cache-Control": "no-store",
    "Content-Type": "application/json; charset=utf-8",
    "Content-Length": Buffer.byteLength(body),
    ...extraHeaders,
  });
  response.end(body);
}

function loopbackHost(hostHeader) {
  if (typeof hostHeader !== "string" || hostHeader.length === 0) return null;
  try {
    const parsed = new URL(`http://${hostHeader}`);
    if (!["127.0.0.1", "localhost", "[::1]"].includes(parsed.hostname)) {
      return null;
    }
    return parsed.host.toLowerCase();
  } catch {
    return null;
  }
}

function mutationOriginMatchesHost(request) {
  const origin = request.headers.origin;
  if (origin === undefined) return true;
  const expectedHost = loopbackHost(request.headers.host);
  try {
    const parsed = new URL(origin);
    return (
      parsed.protocol === "http:" &&
      loopbackHost(parsed.host) === expectedHost
    );
  } catch {
    return false;
  }
}

async function readJsonBody(request) {
  const contentType = request.headers["content-type"] ?? "";
  if (!contentType.toLowerCase().startsWith("application/json")) {
    throw new ReviewInputError("Content-Type must be application/json.", 415);
  }
  const chunks = [];
  let byteLength = 0;
  for await (const chunk of request) {
    byteLength += chunk.length;
    if (byteLength > 16_384) {
      throw new ReviewInputError("Review input exceeds 16 KB.", 413);
    }
    chunks.push(chunk);
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    throw new ReviewInputError("Request body must be valid JSON.");
  }
}

async function serveStatic(pathname, request, response) {
  const staticEntry = STATIC_FILES.get(pathname);
  if (!staticEntry) return false;

  const [fileName, contentType] = staticEntry;
  const body = await fs.readFile(path.join(DEMO_ROOT, "public", fileName));
  response.writeHead(200, {
    ...SECURITY_HEADERS,
    "Cache-Control": "no-cache",
    "Content-Type": contentType,
    "Content-Length": body.length,
  });
  if (request.method === "HEAD") response.end();
  else response.end(body);
  return true;
}

export async function createDemoServer({ clock } = {}) {
  const model = await buildDemoModel();
  const reviewStore = new InMemoryReviewStore({
    proposal: model.proposal,
    entityResolution: model.entityResolution.decision,
    clock,
  });

  return createServer(async (request, response) => {
    try {
      if (!loopbackHost(request.headers.host)) {
        return jsonResponse(response, 403, {
          error: "The demo accepts only loopback Host values.",
        });
      }
      const requestUrl = new URL(request.url ?? "/", "http://127.0.0.1");
      const { pathname } = requestUrl;
      const allowedMethods = RESOURCE_METHODS.get(pathname);

      if (allowedMethods && !allowedMethods.includes(request.method ?? "")) {
        response.writeHead(405, {
          ...SECURITY_HEADERS,
          Allow: allowedMethods.join(", "),
          "Content-Length": "0",
        });
        return response.end();
      }

      if (
        request.method === "POST" &&
        pathname === "/api/reviews" &&
        !mutationOriginMatchesHost(request)
      ) {
        return jsonResponse(response, 403, {
          error: "The review origin must match this loopback demo server.",
        });
      }

      if ((request.method === "GET" || request.method === "HEAD") && pathname === "/health") {
        return jsonResponse(response, 200, {
          status: "ok",
          ontologyValid: model.ontology.valid,
          deterministic: model.determinism.verified,
        });
      }
      if ((request.method === "GET" || request.method === "HEAD") && pathname === "/api/demo") {
        return jsonResponse(response, 200, {
          ...model,
          reviewLog: reviewStore.snapshot(),
        });
      }
      if (request.method === "POST" && pathname === "/api/reviews") {
        const input = await readJsonBody(request);
        const record = reviewStore.add(input);
        return jsonResponse(response, 201, {
          record,
          reviewLog: reviewStore.snapshot(),
        });
      }
      if (
        (request.method === "GET" || request.method === "HEAD") &&
        (await serveStatic(pathname, request, response))
      ) {
        return;
      }

      return jsonResponse(response, 404, { error: "Not found." });
    } catch (error) {
      const statusCode =
        error instanceof ReviewInputError ? error.statusCode : 500;
      if (statusCode === 500) console.error(error);
      return jsonResponse(response, statusCode, {
        error:
          statusCode === 500
            ? "The demo could not process this request."
            : error.message,
      });
    }
  });
}

const isDirectRun =
  process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (isDirectRun) {
  const requestedPort = Number.parseInt(process.env.T2K_DEMO_PORT ?? "4173", 10);
  const port = Number.isInteger(requestedPort) && requestedPort > 0
    ? requestedPort
    : 4173;
  const host = "127.0.0.1";
  const server = await createDemoServer();
  server.listen(port, host, () => {
    console.log(`T2K Integration Hub Demo: http://${host}:${port}`);
    console.log("Synthetic data only. Review decisions remain in memory and are not activated.");
  });
}
