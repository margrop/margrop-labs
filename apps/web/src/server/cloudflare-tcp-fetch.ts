const maximumResponseHeaderBytes = 16 * 1024;
const requestUserAgent = "margrop-labs-token-forge/1";
const textEncoder = new TextEncoder();
const headerDecoder = new TextDecoder("utf-8", { fatal: true });

export type CloudflareTcpSocket = {
  readable: ReadableStream<Uint8Array>;
  writable: WritableStream<Uint8Array>;
  opened: Promise<unknown>;
  closed: Promise<void>;
  close(): Promise<void>;
};

export type CloudflareTcpConnect = (
  address: { hostname: string; port: number },
  options: {
    secureTransport: "on";
    allowHalfOpen: true;
  },
) => CloudflareTcpSocket;

type CloudflareTcpFetchOptions = {
  connect: CloudflareTcpConnect;
  maxResponseBytes: number;
};

const abortError = (): DOMException =>
  new DOMException("Provider request aborted.", "AbortError");

const concatenate = (chunks: Uint8Array[], totalBytes: number): Uint8Array => {
  const combined = new Uint8Array(totalBytes);
  let offset = 0;
  for (const chunk of chunks) {
    combined.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return combined;
};

const findSequence = (
  bytes: Uint8Array,
  sequence: readonly number[],
  start = 0,
): number => {
  for (
    let index = start;
    index <= bytes.byteLength - sequence.length;
    index += 1
  ) {
    if (sequence.every((value, offset) => bytes[index + offset] === value)) {
      return index;
    }
  }
  return -1;
};

const parseChunkedBody = (
  encoded: Uint8Array,
  maximumBytes: number,
): Uint8Array => {
  const chunks: Uint8Array[] = [];
  let decodedBytes = 0;
  let cursor = 0;

  while (cursor < encoded.byteLength) {
    const lineEnd = findSequence(encoded, [13, 10], cursor);
    if (lineEnd < 0 || lineEnd - cursor > 128) {
      throw new TypeError("invalid-chunked-response");
    }

    const sizeLine = headerDecoder
      .decode(encoded.slice(cursor, lineEnd))
      .split(";", 1)[0]
      ?.trim();
    if (sizeLine === undefined || !/^[0-9a-f]+$/i.test(sizeLine)) {
      throw new TypeError("invalid-chunked-response");
    }

    const size = Number.parseInt(sizeLine, 16);
    if (!Number.isSafeInteger(size) || size < 0) {
      throw new TypeError("invalid-chunked-response");
    }
    cursor = lineEnd + 2;

    if (size === 0) {
      const trailerEnd = findSequence(encoded, [13, 10, 13, 10], cursor);
      const hasEmptyTrailer =
        encoded[cursor] === 13 && encoded[cursor + 1] === 10;
      if (!hasEmptyTrailer && trailerEnd < 0) {
        throw new TypeError("invalid-chunked-response");
      }
      return concatenate(chunks, decodedBytes);
    }

    decodedBytes += size;
    if (decodedBytes > maximumBytes) {
      throw new RangeError("response-too-large");
    }
    if (
      cursor + size + 2 > encoded.byteLength ||
      encoded[cursor + size] !== 13 ||
      encoded[cursor + size + 1] !== 10
    ) {
      throw new TypeError("invalid-chunked-response");
    }

    chunks.push(encoded.slice(cursor, cursor + size));
    cursor += size + 2;
  }

  throw new TypeError("invalid-chunked-response");
};

const parseHttpResponse = (raw: Uint8Array, maximumBytes: number): Response => {
  const headerEnd = findSequence(raw, [13, 10, 13, 10]);
  if (headerEnd < 0 || headerEnd > maximumResponseHeaderBytes) {
    throw new TypeError("invalid-provider-response");
  }

  let headerText: string;
  try {
    headerText = headerDecoder.decode(raw.slice(0, headerEnd));
  } catch {
    throw new TypeError("invalid-provider-response");
  }

  const [statusLine, ...headerLines] = headerText.split("\r\n");
  const statusMatch = /^HTTP\/1\.[01] ([2-5]\d{2})(?: (.*))?$/.exec(
    statusLine ?? "",
  );
  if (statusMatch === null) {
    throw new TypeError("invalid-provider-response");
  }

  const status = Number(statusMatch[1]);
  const statusText = statusMatch[2] ?? "";
  const headers = new Headers();
  for (const line of headerLines) {
    const separator = line.indexOf(":");
    if (
      separator <= 0 ||
      /^[ \t]/.test(line) ||
      !/^[!#$%&'*+\-.^_`|~0-9A-Za-z]+$/.test(line.slice(0, separator))
    ) {
      throw new TypeError("invalid-provider-response");
    }
    headers.append(line.slice(0, separator), line.slice(separator + 1).trim());
  }

  if (
    headers.has("content-encoding") &&
    headers.get("content-encoding")?.toLowerCase() !== "identity"
  ) {
    throw new TypeError("unsupported-content-encoding");
  }

  const encodedBody = raw.slice(headerEnd + 4);
  const transferEncoding = headers.get("transfer-encoding")?.toLowerCase();
  const contentLength = headers.get("content-length");
  let body: Uint8Array;

  if (transferEncoding !== undefined) {
    if (transferEncoding !== "chunked" || contentLength !== null) {
      throw new TypeError("invalid-provider-response");
    }
    body = parseChunkedBody(encodedBody, maximumBytes);
    headers.delete("transfer-encoding");
  } else if (contentLength !== null) {
    if (!/^(?:0|[1-9]\d*)$/.test(contentLength)) {
      throw new TypeError("invalid-provider-response");
    }
    const declaredBytes = Number(contentLength);
    if (!Number.isSafeInteger(declaredBytes) || declaredBytes > maximumBytes) {
      throw new RangeError("response-too-large");
    }
    if (encodedBody.byteLength < declaredBytes) {
      throw new TypeError("invalid-provider-response");
    }
    body = encodedBody.slice(0, declaredBytes);
  } else {
    if (encodedBody.byteLength > maximumBytes) {
      throw new RangeError("response-too-large");
    }
    body = encodedBody;
  }

  headers.delete("connection");
  headers.delete("keep-alive");
  const responseBody =
    status === 204 || status === 205 || status === 304
      ? null
      : Uint8Array.from(body).buffer;
  return new Response(responseBody, {
    status,
    statusText,
    headers,
  });
};

const serializeRequest = (url: URL, init: RequestInit): Uint8Array => {
  const method = (init.method ?? "GET").toUpperCase();
  if (
    method !== "POST" ||
    (init.redirect !== undefined && init.redirect !== "error") ||
    typeof init.body !== "string"
  ) {
    throw new TypeError("unsupported-provider-request");
  }

  const body = textEncoder.encode(init.body);
  const headers = new Headers(init.headers);
  for (const name of [
    "accept-encoding",
    "connection",
    "content-length",
    "host",
    "transfer-encoding",
    "user-agent",
  ]) {
    headers.delete(name);
  }
  headers.set("accept-encoding", "identity");
  headers.set("connection", "close");
  headers.set("content-length", String(body.byteLength));
  headers.set("host", url.host);
  headers.set("user-agent", requestUserAgent);

  const requestTarget = `${url.pathname}${url.search}`;
  const head = [
    `${method} ${requestTarget} HTTP/1.1`,
    ...Array.from(headers, ([name, value]) => `${name}: ${value}`),
    "",
    "",
  ].join("\r\n");
  const headBytes = textEncoder.encode(head);
  const request = new Uint8Array(headBytes.byteLength + body.byteLength);
  request.set(headBytes);
  request.set(body, headBytes.byteLength);
  return request;
};

export const createCloudflareTcpFetch = (
  options: CloudflareTcpFetchOptions,
): typeof fetch => {
  if (
    !Number.isSafeInteger(options.maxResponseBytes) ||
    options.maxResponseBytes < 1
  ) {
    throw new TypeError("invalid-response-limit");
  }

  const tcpFetch = async (
    input: RequestInfo | URL,
    init: RequestInit = {},
  ): Promise<Response> => {
    if (typeof input !== "string" && !(input instanceof URL)) {
      throw new TypeError("unsupported-provider-request");
    }
    const url = new URL(input.toString());
    const port = url.port.length === 0 ? 443 : Number(url.port);
    if (
      url.protocol !== "https:" ||
      url.username.length > 0 ||
      url.password.length > 0 ||
      url.hash.length > 0 ||
      !Number.isInteger(port) ||
      port < 1 ||
      port > 65_535
    ) {
      throw new TypeError("unsupported-provider-url");
    }
    if (init.signal?.aborted === true) {
      throw abortError();
    }

    const request = serializeRequest(url, init);
    const socket = options.connect(
      {
        hostname: url.hostname,
        port,
      },
      {
        allowHalfOpen: true,
        secureTransport: "on",
      },
    );
    void socket.closed.catch(() => undefined);

    let closePromise: Promise<void> | undefined;
    const closeSocket = (): Promise<void> => {
      closePromise ??= socket.close().catch(() => undefined);
      return closePromise;
    };
    let rejectAborted: ((reason: DOMException) => void) | undefined;
    const aborted = new Promise<never>((_resolve, reject) => {
      rejectAborted = reject;
    });
    const onAbort = (): void => {
      void closeSocket();
      rejectAborted?.(abortError());
    };
    init.signal?.addEventListener("abort", onAbort, { once: true });
    if (Boolean(init.signal?.aborted)) {
      onAbort();
    }

    try {
      await Promise.race([socket.opened, aborted]);
      const writer = socket.writable.getWriter();
      try {
        await Promise.race([writer.write(request), aborted]);
      } finally {
        writer.releaseLock();
      }

      const reader = socket.readable.getReader();
      const chunks: Uint8Array[] = [];
      let totalBytes = 0;
      const maximumTransportBytes =
        maximumResponseHeaderBytes + options.maxResponseBytes * 8 + 4_096;
      try {
        while (true) {
          const next = await Promise.race([reader.read(), aborted]);
          if (next.done) {
            break;
          }
          totalBytes += next.value.byteLength;
          if (totalBytes > maximumTransportBytes) {
            throw new RangeError("response-too-large");
          }
          chunks.push(next.value.slice());
        }
      } finally {
        reader.releaseLock();
      }

      return parseHttpResponse(
        concatenate(chunks, totalBytes),
        options.maxResponseBytes,
      );
    } finally {
      init.signal?.removeEventListener("abort", onAbort);
      await closeSocket();
    }
  };

  return tcpFetch as typeof fetch;
};
