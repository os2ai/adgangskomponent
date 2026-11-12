// @ts-check

// Zero-dependency tests of the admin API error contract (issue #7):
// curated, non-leaking error responses. Runs the real server via the
// built-in test runner: node --test from admin/api.

import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { spawn, execFileSync } from "node:child_process";
import { readFile as fsReadFile, unlink as fsUnlink } from "node:fs/promises";

const BASE = "http://127.0.0.1:5701";

/** @type {import("node:child_process").ChildProcess} */
let server;

/**
 * @param {string} path
 * @param {BodyInit} body
 * @returns {Promise<{status: number, json: any, text: string}>}
 */
async function post(path, body) {
    const response = await fetch(`${BASE}${path}`, { method: "POST", body });
    const text = await response.text();
    /** @type {any} */
    let json = undefined;
    try {
        json = JSON.parse(text);
    }
    catch {}
    return { status: response.status, json, text };
}

before(async () => {
    server = spawn(process.execPath, ["src/start.js"], {
        cwd: new URL("..", import.meta.url).pathname,
        stdio: "ignore",
    });

    // Wait for the port to answer (any response counts as up).
    for(let i = 0; i < 50; i++) {
        try {
            await fetch(`${BASE}/x509-parse`, { method: "POST", body: "" });
            return;
        }
        catch {
            await new Promise((resolve) => setTimeout(resolve, 100));
        }
    }
    throw new Error("server did not come up");
});

after(async () => {
    if(!server) {
        return;
    }
    // SIGKILL: the server traps SIGTERM (smacker) and its graceful close can
    // wait on keep-alive sockets; the exit event must not hang the runner.
    const exited = new Promise((resolve) => server.once("exit", resolve));
    server.kill("SIGKILL");
    await exited;
});

test("empty body on /x509-parse: 400 with curated message", async () => {
    const { status, json, text } = await post("/x509-parse", "");
    assert.equal(status, 400);
    assert.equal(typeof json.error, "string");
    assert.match(json.error, /empty/i);
    // Nothing that looks like a stack trace or Node internals.
    assert.doesNotMatch(text, /at |Error:|X509Certificate/);
});

test("garbage body on /x509-parse: 400, input not echoed", async () => {
    const sentinel = "CANARY-DO-NOT-ECHO";
    const { status, text } = await post("/x509-parse", `not a cert ${sentinel}`);
    assert.equal(status, 400);
    assert.match(text, /X\.509/);
    assert.doesNotMatch(text, new RegExp(sentinel));
    assert.doesNotMatch(text, /at |error:/);
});

test("valid certificate on /x509-parse: 200 with parsed metadata", async () => {
    const certPath = `/tmp/adgangskomponent-test-cert-${process.pid}.pem`;
    execFileSync("openssl", [
        "req", "-x509", "-newkey", "rsa:2048", "-nodes", "-days", "1",
        "-keyout", "/dev/null", "-out", certPath,
        "-subj", "/O=Den Danske Stat/CN=test.example.dk",
    ], { stdio: "ignore" });
    const pem = await fsReadFile(certPath, "utf8");
    await fsUnlink(certPath);

    const { status, json } = await post("/x509-parse", pem);
    assert.equal(status, 200);
    assert.equal(json.issuer.O, "Den Danske Stat");
    assert.equal(json.subject.CN, "test.example.dk");
    assert.ok(json.validFrom <= json.validTo);
});

test("garbage body on /pem-key-conversion: 400 with bounded openssl diagnostics", async () => {
    const { status, json, text } = await post("/pem-key-conversion", "junk");
    assert.equal(status, 400);
    assert.match(json.error, /could not be converted/i);
    assert.ok(Array.isArray(json.errors));
    for(const err of json.errors) {
        assert.ok(typeof err.stderr === "string" && err.stderr.length <= 4096, "stderr bounded");
    }
    // No stack traces from our own code.
    assert.doesNotMatch(text, /\n\s+at\s+\S/);
});
