// @ts-check

// Shared helper for admin/api tests: start/stop the real server on port
// 5701 and issue requests against it. Suites run with
// --test-concurrency=1, so they share the port sequentially: always wait
// for the port to be FREE before spawning and for the child to be gone
// afterwards (smacker traps SIGTERM and its graceful close can hang on
// keep-alive sockets, hence SIGKILL + an exit race).

import { spawn } from "node:child_process";
import { once } from "node:events";

export const BASE = "http://127.0.0.1:5701";

/**
 * @param {number} ms
 * @returns {Promise<void>}
 */
function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Poll until nothing answers on the port (connection refused).
 * @returns {Promise<void>}
 */
async function waitFree() {
    for(let i = 0; i < 50; i++) {
        try {
            await fetch(`${BASE}/healthz`);
            await sleep(100);
        }
        catch {
            return;
        }
    }
    throw new Error("port 5701 still in use before spawn");
}

/**
 * Poll until the server answers anything (even a 4xx counts as up).
 * @returns {Promise<void>}
 */
async function waitReady() {
    for(let i = 0; i < 50; i++) {
        try {
            await fetch(`${BASE}/healthz`);
            return;
        }
        catch {
            await sleep(100);
        }
    }
    throw new Error("server did not come up");
}

/**
 * Spawn src/start.js with extra env vars and wait for readiness.
 * @param {Record<string, string>} [extraEnv]
 * @returns {Promise<import("node:child_process").ChildProcess>}
 */
export async function spawnServer(extraEnv = {}) {
    await waitFree();
    const stderrChunks = /** @type {Buffer[]} */ ([]);
    const child = spawn(process.execPath, ["src/start.js"], {
        cwd: new URL("..", import.meta.url).pathname,
        env: { ...process.env, ...extraEnv },
        stdio: [ "ignore", "ignore", "pipe" ],
    });
    child.stderr?.on("data", (chunk) => {
        stderrChunks.push(chunk);
        if(stderrChunks.length > 50) {
            stderrChunks.shift();
        }
    });
    try {
        await waitReady();
    }
    catch (error) {
        await stopServer(child);
        throw new Error(`${String(error)}; server stderr tail:\n${Buffer.concat(stderrChunks).toString("utf8")}`);
    }
    return child;
}

/**
 * SIGKILL the server and wait for its exit (bounded, so a stuck child
 * cannot hang the runner).
 * @param {import("node:child_process").ChildProcess} child
 * @returns {Promise<void>}
 */
export async function stopServer(child) {
    if(!child) {
        return;
    }
    const exited = Promise.race([ once(child, "exit"), sleep(5000) ]);
    try {
        child.kill("SIGKILL");
    }
    catch {}
    await exited;
}

/**
 * POST a body and parse the reply.
 * @param {string} pathWithQuery
 * @param {BodyInit} body
 * @returns {Promise<{status: number, json: any, text: string}>}
 */
export async function post(pathWithQuery, body) {
    const response = await fetch(`${BASE}${pathWithQuery}`, {
        method: "POST",
        body,
        headers: { Connection: "close" },
    });
    const text = await response.text();
    /** @type {any} */
    let json = undefined;
    try {
        json = JSON.parse(text);
    }
    catch {}
    return { status: response.status, json, text };
}
