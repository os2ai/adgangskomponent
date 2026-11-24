// @ts-check

// Tests of the admin API health endpoint (issue #10): /healthz answers for
// the chart's probes and stays out of the access log, while other requests
// are still logged.

import { test } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";

const BASE = "http://127.0.0.1:5701";

/**
 * Run a scenario against a server whose stdout/stderr are captured.
 * @param {(helpers: {
 *     healthz: () => Promise<{ status: number, contentType: string | null, body: string }>,
 *     otherRequest: () => Promise<number>,
 *     logs: () => string,
 * }) => Promise<void>} scenario
 */
async function withServer(scenario) {
    const server = spawn(process.execPath, ["src/start.js"], {
        cwd: new URL("..", import.meta.url).pathname,
        stdio: ["ignore", "pipe", "pipe"],
    });

    /** @type {string} */
    let logs = "";
    server.stdout.setEncoding("utf8");
    server.stdout.on("data", (chunk) => { logs += chunk; });
    server.stderr.setEncoding("utf8");
    server.stderr.on("data", (chunk) => { logs += chunk; });

    // Wait until the port answers; any HTTP response counts as up.
    const deadline = Date.now() + 15_000;
    while(Date.now() < deadline) {
        try {
            const response = await fetch(`${BASE}/healthz`);
            await response.body?.cancel();
            break;
        }
        catch {
            await new Promise((resolve) => setTimeout(resolve, 100));
        }
    }
    if(Date.now() >= deadline) {
        server.kill("SIGKILL");
        throw new Error("server did not come up");
    }

    try {
        await scenario({
            healthz: async () => {
                const response = await fetch(`${BASE}/healthz`, { headers: { Connection: "close" } });
                const body = await response.text();
                return {
                    status: response.status,
                    contentType: response.headers.get("content-type"),
                    body,
                };
            },
            otherRequest: async () => {
                // An invalid x509-parse: an early client error (status value
                // differs by release); the point here is that the request
                // completes and must be access-logged.
                const response = await fetch(`${BASE}/x509-parse`, { method: "POST", body: "" });
                await response.body?.cancel();
                return response.status;
            },
            logs: () => logs,
        });
    }
    finally {
        // SIGKILL: the server traps SIGTERM (smacker) and its graceful close
        // can hang; flush pending log writes before killing.
        await new Promise((resolve) => setTimeout(resolve, 100));
        const exited = new Promise((resolve) => server.once("exit", resolve));
        server.kill("SIGKILL");
        await Promise.race([
            exited,
            new Promise((_, reject) => setTimeout(() => reject(new Error("server did not exit")), 5_000)),
        ]);
    }
}

test("healthz answers 200 ok as text/plain", { timeout: 60_000 }, async () => {
    await withServer(async ({ healthz }) => {
        const { status, contentType, body } = await healthz();
        assert.equal(status, 200);
        assert.match(contentType ?? "", /^text\/plain/);
        assert.equal(body, "ok");
    });
});

test("healthz calls stay out of the access log, other requests are logged", { timeout: 60_000 }, async () => {
    await withServer(async ({ healthz, otherRequest, logs }) => {
        await healthz();
        await healthz();

        const status = await otherRequest();
        assert.ok(status >= 400, `expected a failing request, got ${status}`);

        // pino-http logs each completed request as a JSON line with resInfo.
        // Give the final flush a moment.
        await new Promise((resolve) => setTimeout(resolve, 300));

        assert.doesNotMatch(logs(), /"url":"\/healthz"/, "healthz must not be access-logged");
        assert.match(logs(), /"url":"\/x509-parse"/, "other requests must still be logged");
    });
});
