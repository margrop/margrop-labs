import { describe, expect, it, vi } from "vitest";

import {
  createCloudflareTcpFetch,
  type CloudflareTcpSocket,
} from "./cloudflare-tcp-fetch";

const textEncoder = new TextEncoder();
const textDecoder = new TextDecoder();

const createSocket = (
  responseChunks: string[],
): {
  socket: CloudflareTcpSocket;
  requestText: () => string;
  close: ReturnType<typeof vi.fn>;
} => {
  const writes: Uint8Array[] = [];
  const close = vi.fn().mockResolvedValue(undefined);
  const socket: CloudflareTcpSocket = {
    readable: new ReadableStream<Uint8Array>({
      start(controller) {
        for (const chunk of responseChunks) {
          controller.enqueue(textEncoder.encode(chunk));
        }
        controller.close();
      },
    }),
    writable: new WritableStream<Uint8Array>({
      write(chunk) {
        writes.push(chunk.slice());
      },
    }),
    opened: Promise.resolve({}),
    closed: Promise.resolve(),
    close,
  };

  return {
    socket,
    requestText: () =>
      textDecoder.decode(
        writes.reduce((combined, chunk) => {
          const next = new Uint8Array(combined.byteLength + chunk.byteLength);
          next.set(combined);
          next.set(chunk, combined.byteLength);
          return next;
        }, new Uint8Array()),
      ),
    close,
  };
};

describe("Cloudflare TCP fetch", () => {
  it("sends a bounded HTTPS POST over a TLS socket and maps Content-Length", async () => {
    const body = JSON.stringify({ status: "ok" });
    const synthetic = createSocket([
      "HTTP/1.1 200 OK\r\nContent-Type: application/json\r\n",
      `Content-Length: ${textEncoder.encode(body).byteLength}\r\nConnection: close\r\n\r\n${body}`,
    ]);
    const connect = vi.fn().mockReturnValue(synthetic.socket);
    const tcpFetch = createCloudflareTcpFetch({
      connect,
      maxResponseBytes: 64 * 1024,
    });

    const response = await tcpFetch(
      "https://api-gpt.speedtest.margrop.net:16666/v1/chat/completions",
      {
        method: "POST",
        redirect: "error",
        headers: {
          authorization: "Bearer synthetic-provider-key",
          "content-type": "application/json",
        },
        body: JSON.stringify({ model: "qwen-latest" }),
      },
    );

    expect(connect).toHaveBeenCalledWith(
      {
        hostname: "api-gpt.speedtest.margrop.net",
        port: 16_666,
      },
      {
        allowHalfOpen: true,
        secureTransport: "on",
      },
    );
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ status: "ok" });
    expect(synthetic.requestText()).toContain(
      "POST /v1/chat/completions HTTP/1.1\r\n",
    );
    expect(synthetic.requestText()).toContain(
      "host: api-gpt.speedtest.margrop.net:16666\r\n",
    );
    expect(synthetic.requestText()).toContain(
      "authorization: Bearer synthetic-provider-key\r\n",
    );
    expect(synthetic.requestText()).toContain("connection: close\r\n");
    expect(synthetic.requestText()).toContain("accept-encoding: identity\r\n");
    expect(synthetic.requestText()).toContain(
      "user-agent: margrop-labs-token-forge/1\r\n",
    );
    expect(synthetic.close).toHaveBeenCalledOnce();
  });

  it("decodes a chunked JSON response without exposing transport headers", async () => {
    const body = JSON.stringify({ status: "ok", model: "minimax-latest" });
    const midpoint = Math.floor(body.length / 2);
    const first = body.slice(0, midpoint);
    const second = body.slice(midpoint);
    const synthetic = createSocket([
      "HTTP/1.1 200 OK\r\nContent-Type: application/json\r\n",
      "Transfer-Encoding: chunked\r\nConnection: close\r\n\r\n",
      `${first.length.toString(16)}\r\n${first}\r\n`,
      `${second.length.toString(16)}\r\n${second}\r\n0\r\n\r\n`,
    ]);
    const tcpFetch = createCloudflareTcpFetch({
      connect: vi.fn().mockReturnValue(synthetic.socket),
      maxResponseBytes: 64 * 1024,
    });

    const response = await tcpFetch(
      "https://api-gpt.speedtest.margrop.net:16666/v1/chat/completions",
      {
        method: "POST",
        body: "{}",
      },
    );

    await expect(response.json()).resolves.toEqual({
      status: "ok",
      model: "minimax-latest",
    });
    expect(response.headers.has("transfer-encoding")).toBe(false);
    expect(response.headers.has("connection")).toBe(false);
  });

  it("fails closed when the declared response body exceeds the gateway limit", async () => {
    const synthetic = createSocket([
      "HTTP/1.1 200 OK\r\nContent-Type: application/json\r\n",
      "Content-Length: 65537\r\nConnection: close\r\n\r\n{}",
    ]);
    const tcpFetch = createCloudflareTcpFetch({
      connect: vi.fn().mockReturnValue(synthetic.socket),
      maxResponseBytes: 64 * 1024,
    });

    await expect(
      tcpFetch(
        "https://api-gpt.speedtest.margrop.net:16666/v1/chat/completions",
        {
          method: "POST",
          body: "{}",
        },
      ),
    ).rejects.toThrow("response-too-large");
    expect(synthetic.close).toHaveBeenCalledOnce();
  });

  it("closes an opening socket when the shared Provider signal aborts", async () => {
    const close = vi.fn().mockResolvedValue(undefined);
    const socket: CloudflareTcpSocket = {
      readable: new ReadableStream<Uint8Array>(),
      writable: new WritableStream<Uint8Array>(),
      opened: new Promise(() => undefined),
      closed: Promise.resolve(),
      close,
    };
    const tcpFetch = createCloudflareTcpFetch({
      connect: vi.fn().mockReturnValue(socket),
      maxResponseBytes: 64 * 1024,
    });
    const controller = new AbortController();
    const request = tcpFetch(
      "https://api-gpt.speedtest.margrop.net:16666/v1/chat/completions",
      {
        method: "POST",
        body: "{}",
        signal: controller.signal,
      },
    );

    controller.abort();

    await expect(request).rejects.toMatchObject({ name: "AbortError" });
    expect(close).toHaveBeenCalledOnce();
  });
});
