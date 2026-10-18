import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import type { BotPollResult } from "../src/types.js";

export interface RecordedCall {
  readonly kind: string;
  readonly path: string;
  readonly args: Record<string, unknown>;
  readonly authorization: string | null;
}

export interface Failure {
  readonly path?: string;
  readonly status?: number;
  readonly body?: unknown;
  readonly network?: boolean;
  remaining: number;
}

export type ApiHandler = (
  args: Record<string, unknown>,
  kind: string,
) => unknown | Promise<unknown>;

/** Thrown by a test handler to make the fake server answer with a Convex error. */
export class FakeConvexError extends Error {
  constructor(
    message: string,
    readonly data?: unknown,
  ) {
    super(message);
    this.name = "FakeConvexError";
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

async function readBody(request: IncomingMessage): Promise<string> {
  let body = "";
  for await (const chunk of request) {
    body += String(chunk);
  }
  return body;
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function takeFailure(failures: Failure[], path?: string): Failure | null {
  const index = failures.findIndex(
    (failure) =>
      failure.remaining > 0 &&
      (path === undefined || failure.path === undefined || failure.path === path),
  );
  if (index === -1) {
    return null;
  }
  const failure = failures[index];
  if (failure === undefined) {
    return null;
  }
  failure.remaining -= 1;
  if (failure.remaining <= 0) {
    failures.splice(index, 1);
  }
  return failure;
}

/**
 * A local stand-in for `POST /bots/token` and Convex's HTTP API. Tests mutate
 * the public fields (handlers, failures, poll queue) between requests.
 */
export class FakeAulora {
  readonly calls: RecordedCall[] = [];
  readonly handlers = new Map<string, ApiHandler>();
  readonly tokenAuthorizations: string[] = [];
  readonly tokenFailures: Failure[] = [];
  readonly apiFailures: Failure[] = [];
  readonly pollQueue: BotPollResult[] = [];

  tokenRequests = 0;
  tokenExpiresInMs = 3_600_000;
  pollDelayMs = 0;
  initialCursor = 100;
  userId = "bot_1";
  botId = "botdoc_1";
  name = "Test Bot";

  private server: Server | null = null;
  url = "";

  async start(): Promise<void> {
    const server = createServer((request, response) => {
      void this.handle(request, response).catch(() => {
        if (!response.headersSent) {
          response.writeHead(500, { "content-type": "application/json" });
        }
        response.end(JSON.stringify({ error: "fake_server_error" }));
      });
    });
    this.server = server;
    await new Promise<void>((resolve, reject) => {
      server.once("error", reject);
      server.listen(0, "127.0.0.1", () => {
        const address = server.address() as AddressInfo;
        this.url = `http://127.0.0.1:${address.port}`;
        resolve();
      });
    });
  }

  async close(): Promise<void> {
    const server = this.server;
    if (server === null) {
      return;
    }
    await new Promise<void>((resolve) => {
      server.close(() => resolve());
      server.closeAllConnections();
    });
    this.server = null;
  }

  pollCalls(): RecordedCall[] {
    return this.calls.filter((call) => call.path === "botEvents:poll");
  }

  private async handle(request: IncomingMessage, response: ServerResponse): Promise<void> {
    const url = new URL(request.url ?? "/", this.url);
    if (request.method !== "POST") {
      this.send(response, 405, { error: "method_not_allowed" });
      return;
    }
    if (url.pathname === "/bots/token") {
      await this.handleToken(request, response);
      return;
    }
    const match = /^\/api\/(query|mutation|action)$/.exec(url.pathname);
    if (match !== null) {
      await this.handleApi(request, response, match[1] ?? "query");
      return;
    }
    this.send(response, 404, { error: "not_found" });
  }

  private async handleToken(request: IncomingMessage, response: ServerResponse): Promise<void> {
    this.tokenAuthorizations.push(request.headers.authorization ?? "");
    const failure = takeFailure(this.tokenFailures);
    if (failure !== null) {
      this.respondWithFailure(response, failure);
      return;
    }
    this.tokenRequests += 1;
    this.send(response, 200, {
      token: `jwt-${this.tokenRequests}`,
      expiresAt: Date.now() + this.tokenExpiresInMs,
      userId: this.userId,
      botId: this.botId,
      name: this.name,
    });
  }

  private async handleApi(
    request: IncomingMessage,
    response: ServerResponse,
    kind: string,
  ): Promise<void> {
    const body = await readBody(request);
    let parsed: unknown = null;
    try {
      parsed = JSON.parse(body);
    } catch {
      parsed = null;
    }
    const record = isRecord(parsed) ? parsed : {};
    const path = typeof record.path === "string" ? record.path : "";
    const args = isRecord(record.args) ? record.args : {};
    this.calls.push({
      kind,
      path,
      args,
      authorization: request.headers.authorization ?? null,
    });

    const failure = takeFailure(this.apiFailures, path);
    if (failure !== null) {
      this.respondWithFailure(response, failure);
      return;
    }
    if (path === "botEvents:poll" && this.pollDelayMs > 0) {
      await delay(this.pollDelayMs);
    }
    try {
      const handler = this.handlers.get(path);
      const value =
        handler !== undefined
          ? await handler(args, kind)
          : path === "botEvents:poll"
            ? this.poll(args)
            : null;
      this.send(response, 200, { status: "success", value });
    } catch (error) {
      if (error instanceof FakeConvexError) {
        this.send(response, 200, {
          status: "error",
          errorMessage: error.message,
          errorData: error.data ?? null,
        });
        return;
      }
      this.send(response, 500, { error: "handler_failed" });
    }
  }

  private poll(args: Record<string, unknown>): BotPollResult {
    const next = this.pollQueue.shift();
    if (next !== undefined) {
      return next;
    }
    const cursor = typeof args.cursor === "number" ? args.cursor : this.initialCursor;
    return { events: [], cursor, me: { userId: this.userId, name: this.name } };
  }

  private respondWithFailure(response: ServerResponse, failure: Failure): void {
    if (failure.network === true) {
      response.destroy();
      return;
    }
    const status = failure.status ?? 500;
    this.send(
      response,
      status,
      failure.body ?? { status: "error", errorMessage: `HTTP ${status}` },
    );
  }

  private send(response: ServerResponse, status: number, body: unknown): void {
    if (response.writableEnded) {
      return;
    }
    response.writeHead(status, { "content-type": "application/json" });
    response.end(JSON.stringify(body));
  }
}
