// @ts-check

// Variant-config server tests for the error contract (issue #7): the same
// contract when openssl is missing from PATH (spawn ENOENT), and the
// generic-500 branch of the central error handler via the
// ADMIN_API_TEST_FAULT test hook. Separate file from errors.test.js
// because each config needs its own server on the shared port 5701.

import { test, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, symlink } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { spawnServer, stopServer, post } from "./server.js";

/** @type {import("node:child_process").ChildProcess[]} */
const stragglers = [];

after(async () => {
    for(const server of stragglers) {
        await stopServer(server);
    }
});

/**
 * Run a test against a server started with extra env, stopping it after.
 * @param {Record<string, string>} extraEnv
 * @param {(server: import("node:child_process").ChildProcess) => Promise<void>} run
 */
async function withServer(extraEnv, run) {
    const server = await spawnServer(extraEnv);
    stragglers.push(server);
    await run(server);
    await stopServer(server);
}

test("missing openssl: 500 with curated message, no paths or internals leaked", async () => {
    // A bin dir containing only node: the server itself runs, but every
    // spawn("openssl", ...) fails with ENOENT.
    const binDir = await mkdtemp(path.join(os.tmpdir(), "adgang-test-bin-"));
    await symlink(process.execPath, path.join(binDir, "node"));
    await withServer({ PATH: binDir }, async () => {
        const { status, json, text } = await post("/pem-key-conversion", "junk");
        assert.equal(status, 500);
        assert.deepEqual(Object.keys(json), [ "error" ]);
        assert.match(json.error, /unavailable/i);
        // No spawn error internals, no filesystem paths, no stack frames.
        assert.doesNotMatch(text, /ENOENT|spawn|\n\s+at\s+\S/);
        assert.doesNotMatch(text, /\/usr\/|\/bin\/|openssl_tmp/);
    });
});

test("unexpected error: generic 500 without internals", async () => {
    await withServer({ ADMIN_API_TEST_FAULT: "1" }, async () => {
        const { status, json, text } = await post("/test-fault", "");
        assert.equal(status, 500);
        assert.deepEqual(Object.keys(json), [ "error" ]);
        assert.equal(json.error, "Internal server error.");
        // The thrown error's message and stack stay server-side.
        assert.doesNotMatch(text, /Injected test fault|\n\s+at\s+\S/);
    });
});
