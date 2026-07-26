# `httpServerHandler` streaming reproduction

This directory isolates one question:

> Can a Node-style HTTP response stream through `httpServerHandler` in the same
> way under Node.js and workerd?

It removes Express, React, authentication, and the reference application from
the request path. The remaining code uses `node:http`,
`httpServerHandler`, and React Router's stream-writing helper.

## Working hypothesis

The hypothesis is that the response body streaming machinery works, but the
`ServerResponse` lifecycle events do not currently match the lifecycle expected
by Node stream consumers.

More specifically:

1. The first `ServerResponse.write()` sends the response headers.
2. workerd creates and returns a Fetch `Response` whose body is a
   `ReadableStream`.
3. In the same `_headersSent` handler, workerd marks the `ServerResponse` as
   closed and emits `close`.
4. React Router's `writeReadableStreamToWritable()` treats any `close` event
   before the source stream finishes as an interrupted writable.
5. React Router stops reading the source stream and destroys the response.
6. When the delayed source later attempts to enqueue its tail, workerd reports
   that the `ReadableByteStreamController` is already closed.

The suspected mismatch is therefore not “workerd cannot stream.” The direct
`ServerResponse.write()` test streams successfully. The suspected mismatch is:

> workerd emits the Node `ServerResponse` `close` event when headers are sent,
> while React Router and the Node baseline expect that response to remain open
> until completion or interruption.

This is a hypothesis supported by the reproduction, not yet an upstream
workerd determination. A possible alternative is that React Router's writable
monitor is too strict for workerd's Fetch-backed response lifecycle. The Node
baseline supports React Router's expectation, because the same writer completes
there without an early `close`.

## Exact location of the suspected issue

| Layer                      | Relevant code                                                                                                                            | Role                                                                                                                                                         |
| -------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Reproduction               | [`server.ts`](./server.ts)                                                                                                               | Produces the raw and React Router-managed streams.                                                                                                           |
| workerd Fetch bridge       | [`src/cloudflare/node.ts`](https://github.com/cloudflare/workerd/blob/main/src/cloudflare/node.ts)                                       | `httpServerHandler` locates the Node-style server registered for a port and forwards the Fetch request.                                                      |
| workerd response lifecycle | [`src/node/internal/internal_http_server.ts`](https://github.com/cloudflare/workerd/blob/main/src/node/internal/internal_http_server.ts) | Resolves the Fetch `Response` when headers are sent, then currently marks `ServerResponse` closed and emits `close`. This is the primary suspected location. |
| React Router stream pump   | [`packages/react-router-node/stream.ts`](https://github.com/remix-run/react-router/blob/main/packages/react-router-node/stream.ts)       | Rejects the stream pump when the destination writable emits `close` before the source stream finishes.                                                       |

The important boundary is between the last two rows: workerd emits the event,
and React Router assigns meaning to it.

## Expected and observed behavior

| Case                      | Expected from Node baseline                           | Observed with pinned workerd                                                                                          |
| ------------------------- | ----------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------- |
| Direct `response.write()` | Shell is observable before `end()`; no early `close`. | Shell is observable before `end()`, but `close` has already fired.                                                    |
| React Router writer       | Shell and tail are both delivered.                    | Early `close` interrupts the writer before it completes.                                                              |
| Delayed tail              | Tail is written and the response finishes.            | The interrupted writer leaves the response controller closed; the delayed enqueue produces a closed-controller error. |

## Where `ServerResponse` comes from

The reproduction creates a server with `node:http.createServer()`. The callback
receives two familiar Node objects:

```ts
createServer((request, response) => {
	// request is an IncomingMessage
	// response is a ServerResponse
});
```

Under regular Node.js, Node provides those objects. Inside a Cloudflare Worker,
workerd provides Node-style implementations of the supported APIs, backed by
the Workers Fetch and Streams APIs. The application creates the server and
writes the response, but it does not implement `ServerResponse`. The
reproduction exists because the supported surface does not currently behave
identically to Node for this response lifecycle.

`server.listen(8080)` also has a different job in this environment. It registers
the Node-style server with workerd's internal port mapping; it does not expose a
new public TCP server. `httpServerHandler({ port: 8080 })` returns the Worker's
Fetch handler and forwards each incoming Worker request to that registered
server. See the [`httpServerHandler` implementation](https://github.com/cloudflare/workerd/blob/main/src/cloudflare/node.ts)
and the [Workers Node.js HTTP documentation](https://developers.cloudflare.com/workers/runtime-apis/nodejs/http/).

## Incoming request flow

```mermaid
sequenceDiagram
    participant Caller as Reproduction test
    participant Worker as Worker fetch entrypoint
    participant Bridge as httpServerHandler
    participant Registry as workerd port mapping
    participant Server as node:http Server
    participant App as Server request callback
    participant Response as workerd ServerResponse

    Caller->>Worker: Fetch Request
    Worker->>Bridge: fetch(request)
    Bridge->>Registry: Find the server registered on port 8080
    Registry->>Server: Dispatch the request
    Server->>App: IncomingMessage + ServerResponse
    App->>Response: write("shell")
    Response-->>Caller: Chunk in returned Fetch Response body
    App->>Response: end("tail")
    Response-->>Caller: Final chunk
```

Think of the full path as an in-process adapter chain. `httpServerHandler`
locates the server registered for a port and forwards the Fetch request.
workerd's `Server`, `IncomingMessage`, and `ServerResponse` implementations
adapt between the Node HTTP API and Fetch `Request`, `Response`, and
`ReadableStream`. Unlike a traditional proxy, this adaptation does not involve
a separate network service.

## What the reproduction tests

The server exposes two endpoints:

- `/raw` calls `ServerResponse.write()` directly.
- `/react-router-writer` passes a Web `ReadableStream` to
  `@react-router/node`'s `writeReadableStreamToWritable()`.

Both endpoints produce an HTML shell immediately and schedule a tail 500
milliseconds later. The raw endpoint writes both pieces successfully. Under
Node.js, the React Router writer also writes both pieces; under the pinned
workerd runtime, the early `close` event interrupts that writer before it can
complete. Receiving the shell before the delay expires proves that the returned
Fetch response exposes the shell before the scheduled tail and before `end()`.

This reproduction stops at the returned Fetch response body. It does not test
whether a deployed Cloudflare network path or a particular HTTP client adds its
own buffering. workerd may also buffer writes made before response headers are
sent; that is separate from the incremental behavior tested here.

## Run the comparison

```sh
cd repro/http-server-streaming
npm ci
npm test
```

The Node baseline expects both endpoints to stream. It also observes that no
`close` event is emitted before `ServerResponse.end()`.

The workerd tests use the runtime pinned by this reproduction. The direct
`ServerResponse.write()` test passes, which shows that the underlying adapter
can stream. Two additional tests assert the currently observed mismatch:

1. the reproduction observes a `close` event before `end()`;
2. React Router interprets that event as an interrupted writable and stops
   pumping the body. The runtime also logs a closed
   `ReadableByteStreamController` when the delayed source attempts its next
   write.

The relevant runtime behavior is in workerd's
[`ServerResponse` implementation](https://github.com/cloudflare/workerd/blob/main/src/node/internal/internal_http_server.ts).
React Router's corresponding behavior is in
[`writeReadableStreamToWritable()`](https://github.com/remix-run/react-router/blob/main/packages/react-router-node/stream.ts).
Node documents the meaning of the response events in its
[`ServerResponse` API](https://nodejs.org/api/http.html#class-httpserverresponse).

## What would confirm or reject the hypothesis

The hypothesis is confirmed if changing the workerd response lifecycle so that
`close` is not emitted from `_headersSent` causes both workerd tests to match
the Node baseline without changing React Router.

The hypothesis is rejected or incomplete if:

- React Router still stops pumping after the early `close` is removed;
- the delayed tail still reaches a closed controller for another reason; or
- an equivalent Node.js test emits `close` at the same point under the same
  conditions.

When the lifecycle behavior is aligned, invert the current-behavior assertions
in `workerd.spec.ts` so the workerd suite expects the same successful result as
the Node baseline.
