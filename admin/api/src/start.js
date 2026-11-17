// @ts-check

import express from "express";
import { text as streamToText, buffer as streamToBuffer } from "node:stream/consumers";
import { spawn } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import crypto from "node:crypto";
import cors from "cors";
import pinoHttp from "pino-http";
import os from "node:os";
import smacker from "smacker";

const app = express();

app.use(pinoHttp());

// Only the admin panel frontend legitimately calls this API cross-origin.
// CORS_ALLOWED_ORIGINS is a comma-separated allow-list rendered by the
// chart (default: the admin UI origin).
// TODO(v2.0.0): when no origins are configured, fail closed (no CORS at
// all, same-origin requests only) instead of falling back to the wildcard
// below. The permissive fallback exists only to preserve the pre-v1
// behavior for deployments that have not set the variable yet.
const corsAllowedOrigins = (process.env.CORS_ALLOWED_ORIGINS ?? "")
    .split(",")
    .map((origin) => origin.trim())
    .filter(Boolean);

if(corsAllowedOrigins.length) {
    app.use(cors({ origin: corsAllowedOrigins }));
}
else {
    console.warn("DEPRECATION WARNING: CORS_ALLOWED_ORIGINS is not set (or empty). The admin API answers with Access-Control-Allow-Origin: * (any origin). This wildcard fallback is deprecated and will be removed in v2.0.0, where an unset or empty CORS_ALLOWED_ORIGINS will disable cross-origin access entirely. Set CORS_ALLOWED_ORIGINS to a comma-separated allow-list (e.g. the admin UI origin) to silence this warning.");
    // Passing undefined keeps the pre-allow-list behavior: cors() then
    // defaults to Access-Control-Allow-Origin: *.
    app.use(cors(undefined));
}

app.post("/x509-parse", async (req, res) => {
    const x509Cert = new crypto.X509Certificate(await streamToBuffer(req));

    res.send({
        issuer: x509ParseAttribute(x509Cert.issuer),
        subject: x509ParseAttribute(x509Cert.subject),
        validFrom: x509Cert.validFromDate.getTime(),
        validTo: x509Cert.validToDate.getTime(),
    });
});

app.post("/pem-key-conversion", async (req, res) => {
    const opensslTmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "os2adgang_openssl_tmp_dir"));

    /** @type {NodeJS.ProcessEnv} */
    const env = {};

    const certEncryptionPassword = req.get("x-cert-encryption-password");
    if(certEncryptionPassword) {
        env.CERT_ENCRYPTION_PASSWORD = certEncryptionPassword;
    }

    const inputFilePath = path.join(opensslTmpDir, "input.p12");
    await fs.writeFile(inputFilePath, req);

    const opensslCertExtractInputFile = await fs.open(inputFilePath);
    const opensslCertExtractProcess = spawn("openssl", [
        "x509",
        "-nokeys",
        ...(certEncryptionPassword ? [
            "-passin",
            "env:CERT_ENCRYPTION_PASSWORD"
        ] : []),
    ], {
        env,
        stdio: [
            opensslCertExtractInputFile.fd,
            "pipe",
            "pipe",
        ],
    });

    const opensslPrivateKeyExtractInputFile = await fs.open(inputFilePath);
    const opensslPrivateKeyExtractProcess = spawn("openssl", [
        "pkcs12",
        "-nocerts",
        "-noenc",
        ...(certEncryptionPassword ? [
            "-passin",
            "env:CERT_ENCRYPTION_PASSWORD"
        ] : []),
    ], {
        env,
        stdio: [
            opensslPrivateKeyExtractInputFile.fd,
            "pipe",
            "pipe",
        ],
    });

    const opensslPrivateKeyCleanupProcess = spawn("openssl", [ "rsa" ], { stdio: [ opensslPrivateKeyExtractProcess.stdout, "pipe", "pipe" ]});

    req.log.info("Started processes");

    const opensslCertExtractOutputPromise = opensslCertExtractProcess.stdout ? streamToText(opensslCertExtractProcess.stdout) : "";
    const opensslCertExtractErrorsPromise = opensslCertExtractProcess.stderr ? streamToText(opensslCertExtractProcess.stderr) : "";
    const opensslPrivateKeyExtractErrorsPromise = opensslPrivateKeyExtractProcess.stderr ? streamToText(opensslPrivateKeyExtractProcess.stderr) : "";
    const opensslPrivateKeyCleanupOutputPromise = opensslPrivateKeyCleanupProcess.stdout ? streamToText(opensslPrivateKeyCleanupProcess.stdout) : "";
    const opensslPrivateKeyCleanupErrorsPromise = opensslPrivateKeyCleanupProcess.stderr ? streamToText(opensslPrivateKeyCleanupProcess.stderr) : "";

    await Promise.all([
        new Promise((resolve) => opensslCertExtractProcess.once("exit", resolve)),
        new Promise((resolve) => opensslPrivateKeyExtractProcess.once("exit", resolve)),
    ]);

    const opensslCertExtractOutput = await opensslCertExtractOutputPromise;
    const opensslCertExtractErrors = await opensslCertExtractErrorsPromise;
    const opensslPrivateKeyExtractErrors = await opensslPrivateKeyExtractErrorsPromise;
    const opensslPrivateKeyCleanupOutput = await opensslPrivateKeyCleanupOutputPromise;
    const opensslPrivateKeyCleanupErrors = await opensslPrivateKeyCleanupErrorsPromise;

    // Clean up files
    await opensslCertExtractInputFile.close();
    await opensslPrivateKeyExtractInputFile.close();
    await fs.rm(opensslTmpDir, { recursive: true });

    req.log.info("Processes concluded, files cleaned up");

    const errors = [];
    if(opensslCertExtractProcess.exitCode) {
        errors.push({
            process: "openssl x509 -nokeys",
            exitcode: opensslCertExtractProcess.exitCode,
            stderr: opensslCertExtractErrors,
            stdout: opensslCertExtractOutput,
        });
    }
    if(opensslPrivateKeyExtractProcess.exitCode) {
        errors.push({
            process: "openssl pkcs12 -nocerts",
            exitcode: opensslPrivateKeyExtractProcess.exitCode,
            stderr: opensslPrivateKeyExtractErrors + "\n\n" + opensslPrivateKeyCleanupErrors,
            stdout: opensslPrivateKeyCleanupOutput,
        });
    }

    if(errors.length) {
        return res.status(400).send({ errors });
    }

    const x509Cert = new crypto.X509Certificate(Buffer.from(opensslCertExtractOutput));

    res.send({
        cert: opensslCertExtractOutput,
        privateKey: opensslPrivateKeyCleanupOutput,
        meta: {
            issuer: x509ParseAttribute(x509Cert.issuer),
            subject: x509ParseAttribute(x509Cert.subject),
            validFrom: x509Cert.validFromDate.getTime(),
            validTo: x509Cert.validToDate.getTime(),
        }
    });
});

/**
 * @param {string} data
 * @returns {Record<string, string>}
 */
function x509ParseAttribute(data) {
    /** @type {ReturnType<typeof x509ParseAttribute>} */
    const result = {};

    for (const line of data.split("\n")) {
        const [ key, value ] = line.split("=");
        result[key] = value;
    }
    return result;
}

/** @type {import("http").Server | undefined} */
let server;

smacker.start({
    start: () => {
        return new Promise((resolve, reject) => {
            server = app.listen(5701, (error) => {
                if(error) {
                    return reject(error);
                }
                resolve();
            });
        });
    },
    stop: () => {
        return new Promise((resolve, reject) => {
            if(!server) {
                return resolve();
            }
            server.close((error) => {
                if(error) {
                    return reject(error);
                }
                resolve();
            });
        });
    },
});
