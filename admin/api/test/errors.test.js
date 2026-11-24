// @ts-check

// Tests of the admin API error contract (issue #7): curated, non-leaking
// error responses, served by the real server (see test/server.js).
// Variant server configs (missing openssl binary, fault injection) live in
// errors-variant.test.js.

import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFile as fsReadFile, unlink as fsUnlink } from "node:fs/promises";
import { spawnServer, stopServer, post } from "./server.js";

/** @type {import("node:child_process").ChildProcess | undefined} */
let server;

before(async () => {
    server = await spawnServer();
});

after(async () => {
    await stopServer(server);
});

test("empty body on /x509-parse: 400 with curated message", async () => {
    const { status, json, text } = await post("/x509-parse", "");
    assert.equal(status, 400);
    assert.deepEqual(Object.keys(json), [ "error" ]);
    assert.match(json.error, /empty/i);
    // No stack-trace-shaped leak.
    assert.doesNotMatch(text, /\n\s+at\s+\S/);
});

test("garbage body on /x509-parse: 400, input not echoed", async () => {
    const sentinel = "CANARY-DO-NOT-ECHO";
    const { status, json, text } = await post("/x509-parse", `not a cert ${sentinel}`);
    assert.equal(status, 400);
    // Curated message, and the upload's content never comes back.
    assert.deepEqual(Object.keys(json), [ "error" ]);
    assert.match(json.error, /X\.509/);
    assert.doesNotMatch(text, new RegExp(sentinel));
    assert.doesNotMatch(text, /\n\s+at\s+\S/);
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
    const { status, json } = await post("/pem-key-conversion", "junk");
    assert.equal(status, 400);
    assert.deepEqual(Object.keys(json), [ "error", "errors" ]);
    assert.match(json.error, /could not be converted/i);
    assert.ok(Array.isArray(json.errors));
    assert.ok(json.errors.length > 0);
    for(const err of json.errors) {
        // Pinned contract: process, exitcode, stderr - and deliberately NO
        // stdout (dropped with this PR; stdout could grow unboundedly).
        assert.deepEqual(Object.keys(err).sort(), [ "exitcode", "process", "stderr" ]);
        assert.ok(typeof err.exitcode === "number");
        // Diagnostics survive the hardening cap (not truncated to nothing).
        assert.ok(err.stderr.length > 0);
        assert.match(err.stderr, /error|unknown|could not/i);
        assert.ok(err.stderr.length <= 4096, "stderr within the hardening cap");
    }
});
