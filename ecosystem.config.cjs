/**
 * PM2 process definition for the Windows host.
 *
 * IIS no longer launches the application. PM2 owns the Node process and keeps
 * it alive; IIS sits in front only as a reverse proxy, terminating HTTPS for
 * the domain and forwarding to the port below. That split is the point of the
 * move away from iisnode: a crash is restarted by a process manager whose job
 * that is, rather than by a web server that also has to serve the request.
 *
 * CommonJS, not ESM, and named `.cjs` on purpose: the package is
 * `"type": "module"`, and PM2 reads its config file with `require`.
 */
module.exports = {
  apps: [
    {
      name: "sispl-ca-solution",
      script: "server.js",
      // Resolved from this file, so PM2 started from any directory still finds
      // the application. `server.js` takes the app root from its own location
      // for the same reason.
      cwd: __dirname,

      // Fork, not cluster. A Next custom server can be clustered, but a firm's
      // internal application gains nothing from it and every worker is another
      // process holding database connections from a pool sized for one.
      exec_mode: "fork",
      instances: 1,

      env: {
        NODE_ENV: "production",
        // The port IIS proxies to. `server.js` reads PORT and falls back to
        // this same number, so the two cannot disagree.
        PORT: 3022,
      },

      autorestart: true,
      // A restart loop is worse than a stopped app: it hides the cause and
      // fills the disk with logs. Ten failures inside a minute stops it.
      max_restarts: 10,
      min_uptime: "60s",
      // Next holds a lot of compiled output in memory; this is a ceiling for a
      // leak, not a working size.
      max_memory_restart: "1G",

      merge_logs: true,
      time: true,
      error_file: "logs/pm2-error.log",
      out_file: "logs/pm2-out.log",

      // Never watch in production. A file change during a deploy would restart
      // the process mid-write.
      watch: false,
    },
  ],
};
