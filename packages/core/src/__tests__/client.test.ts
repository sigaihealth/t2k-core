import { describe, expect, it, vi } from "vitest";

import { T2kApiError, T2kClient } from "../client.js";

describe("T2kClient", () => {
  it("sends API keys and normalizes the base URL", async () => {
    const fetcher = vi.fn(async () =>
      new Response(JSON.stringify({ graphs: [] }), {
        status: 200,
        headers: { "content-type": "application/json" },
      })
    );
    const client = new T2kClient({
      baseUrl: "https://studio.t2k.ai/",
      apiKey: "test-key",
      fetch: fetcher as typeof fetch,
    });

    await client.listKnowledgeGraphs();

    expect(fetcher).toHaveBeenCalledOnce();
    const [url, init] = fetcher.mock.calls[0] ?? [];
    expect(url).toBe("https://studio.t2k.ai/api/v1/knowledge-graphs");
    expect(new Headers(init?.headers).get("x-api-key")).toBe("test-key");
  });

  it("surfaces structured API failures", async () => {
    const client = new T2kClient({
      baseUrl: "https://studio.t2k.ai",
      fetch: (async () =>
        new Response(JSON.stringify({ error: "Denied" }), {
          status: 403,
          headers: { "content-type": "application/json" },
        })) as typeof fetch,
    });

    const error = await client.listKnowledgeGraphs().catch((value) => value);

    expect(error).toBeInstanceOf(T2kApiError);
    expect(error).toMatchObject({ status: 403, message: "Denied" });
  });

  it("rejects successful responses that violate the JSON contract", async () => {
    const client = new T2kClient({
      baseUrl: "https://studio.t2k.ai",
      fetch: (async () =>
        new Response("<html>proxy error</html>", {
          status: 200,
          headers: { "content-type": "text/html" },
        })) as typeof fetch,
    });

    const error = await client.listKnowledgeGraphs().catch((value) => value);

    expect(error).toBeInstanceOf(T2kApiError);
    expect(error).toMatchObject({
      status: 200,
      message: "T2K API returned a non-JSON response with status 200.",
    });
  });
});
