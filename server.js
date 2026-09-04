/**
 * Production entry point for Windows Server + Plesk (iisnode).
 *
 * iisnode never gives the application a TCP port. It sets PORT to a named pipe
 * path — `\\.\pipe\<guid>` — and waits for the process to listen on that pipe.
 * Any arithmetic on that value (`Number()`, `parseInt()`, a leading `+`)
 * produces NaN, and `listen(NaN)` throws ERR_SOCKET_BAD_PORT before a single
 * request is served, which IIS then reports as a 500 with subStatus 1002.
 *
 * So PORT is handed to `listen()` exactly as it arrives. Node reads a numeric
 * string as a TCP port and any other string as a pipe path, so the same line
 * serves iisnode in production and `node server.js` on 3000 locally.
 *
 * The package is ESM (`"type": "module"`), so this file is ESM too.
 */
import { createServer } from "node:http";

import next from "next";

const listenTarget = process.env.PORT ?? 3000;

// The working directory iisnode starts the process in is not guaranteed to be
// the site root, so the app directory is taken from this file's own location.
const app = next({ dev: false, dir: import.meta.dirname });
const handle = app.getRequestHandler();

await app.prepare();

const server = createServer((request, response) => {
  handle(request, response).catch((error) => {
    console.error("Unhandled request error", error);
    response.statusCode = 500;
    response.end("Internal Server Error");
  });
});

// Without this, a failed bind is an unhandled rejection and the only evidence
// is the stack iisnode happens to capture in stderr.
server.on("error", (error) => {
  console.error("Server failed to bind to", listenTarget, error);
  process.exit(1);
});

server.listen(listenTarget, () => {
  console.log(`Ready on ${listenTarget}`);
});
