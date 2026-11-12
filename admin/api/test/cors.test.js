// @ts-check

// Tests of the admin API CORS contract (issue #8): the wildcard origin is
// replaced by a configured allow-list; empty config means no CORS at all.
// Each case runs the real server with its own CORS_ALLOWED_ORIGINS.

import { test } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";

const BASE = "http://127.0.0.1:5701";

/**
 * @param {Record<string, string>} env extra environment for the server
 * @returns {Promise<import("node:child_process").ChildProcess>}
 */
async function startServer(env) {
    await waitForPortFree();
    const server = spawn(process.execPath, ["src/start.js"], {
        cwd: new URL("..", import.meta.url).pathname,
        env: { ...process.env, ...env },
        stdio: "ignore",
    });

    // Wait until the port answers; any HTTP response counts as up.
    const deadline = Date.now() + 15_000;
    while(Date.now() < deadline) {
        try {
            const response = await fetch(`${BASE}/x509-parse`, { method: "POST", body: "" });
            await response.body?.cancel();
            return server;
        }
        catch {
            await new Promise((resolve) => setTimeout(resolve, 100));
        }
    }
    await stopServer(server);
    throw new Error("server did not come up");
}

/**
 * SIGKILL (the server traps SIGTERM via smacker) and wait for the exit.
 * @param {import("node:child_process").ChildProcess} server
 */
async function stopServer(server) {
    const exited = new Promise((resolve) => server.once("exit", resolve));
    server.kill("SIGKILL");
    await Promise.race([
        exited,
        new Promise((_, reject) => setTimeout(() => reject(new Error("server did not exit")), 5_000)),
    ]);
}

/** Wait until nothing answers on the port any more. */
async function waitForPortFree() {
    const deadline = Date.now() + 10_000;
    while(Date.now() < deadline) {
        try {
            const response = await fetch(`${BASE}/x509-parse`, { method: "POST", body: "" });
            await response.body?.cancel();
        }
        catch {
            return;
        }
        await new Promise((resolve) => setTimeout(resolve, 200));
    }
    throw new Error("port never freed");
}

/**
 * Send a CORS preflight.
 * @param {string} origin
 */
async function preflight(origin) {
    const response = await fetch(`${BASE}/x509-parse`, {
        method: "OPTIONS",
        headers: {
            Origin: origin,
            "Access-Control-Request-Method": "POST",
            Connection: "close",
        },
    });
    await response.body?.cancel();
    return response;
}

/**
 * Run one scenario against a server configured with the given env.
 * @param {Record<string, string>} env
 * @param {(request: (origin: string) => Promise<Response>) => Promise<void>} scenario
 */
async function withServer(env, scenario) {
    const server = await startServer(env);
    try {
        await scenario(preflight);
    }
    finally {
        await stopServer(server);
    }
}

test("origin on the allow-list is reflected", { timeout: 60_000 }, async () => {
    await withServer({ CORS_ALLOWED_ORIGINS: "https://admin.example.dk" }, async (request) => {
        const response = await request("https://admin.example.dk");
        assert.equal(response.headers.get("access-control-allow-origin"), "https://admin.example.dk");
    });
});

test("origin off the allow-list gets no CORS headers", { timeout: 60_000 }, async () => {
    await withServer({ CORS_ALLOWED_ORIGINS: "https://admin.example.dk" }, async (request) => {
        const response = await request("https://evil.example.com");
        assert.equal(response.headers.get("access-control-allow-origin"), null);
    });
});

test("comma-separated list allows each listed origin only", { timeout: 60_000 }, async () => {
    await withServer({ CORS_ALLOWED_ORIGINS: "https://a.example.dk, https://b.example.dk" }, async (request) => {
        for(const origin of ["https://a.example.dk", "https://b.example.dk"]) {
            const response = await request(origin);
            assert.equal(response.headers.get("access-control-allow-origin"), origin);
        }
        const refused = await request("https://c.example.dk");
        assert.equal(refused.headers.get("access-control-allow-origin"), null);
    });
});

test("empty allow-list disables CORS entirely", { timeout: 60_000 }, async () => {
    await withServer({ CORS_ALLOWED_ORIGINS: "" }, async (request) => {
        const response = await request("https://admin.example.dk");
        assert.equal(response.headers.get("access-control-allow-origin"), null);
    });
});
