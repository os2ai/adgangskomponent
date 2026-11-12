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
app.use(cors());

/**
 * Wrap an async route so rejections reach our error handler instead of
 * Express' implicit behaviour.
 * @param {(req: import("express").Request, res: import("express").Response) => Promise<void>} handler
 * @returns {import("express").RequestHandler}
 */
function asyncRoute(handler) {
    return (req, res, next) => {
        handler(req, res).catch(next);
    };
}

/**
 * Deliberate, safe-to-show-to-the-client error.
 */
class ClientError extends Error {
    /**
     * @param {number} status
     * @param {string} message
     */
    constructor(status, message) {
        super(message);
        this.status = status;
    }
}

app.post("/x509-parse", asyncRoute(async (req, res) => {
    const body = await streamToBuffer(req);
    if(body.byteLength === 0) {
        throw new ClientError(400, "Request body is empty; expected a PEM-encoded X.509 certificate.");
    }

    /** @type {crypto.X509Certificate} */
    let x509Cert;
    try {
        x509Cert = new crypto.X509Certificate(body);
    }
    catch {
        // Do not surface the Node error verbatim: its message embeds the
        // offending input. State the problem, not the internals.
        throw new ClientError(400, "Could not parse the supplied data as an X.509 certificate.");
    }

    res.send({
        issuer: x509ParseAttribute(x509Cert.issuer),
        subject: x509ParseAttribute(x509Cert.subject),
        validFrom: x509Cert.validFromDate.getTime(),
        validTo: x509Cert.validToDate.getTime(),
    });
}));

app.post("/pem-key-conversion", asyncRoute(async (req, res) => {
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
        new Promise((resolve) => opensslCertExtractProcess.once("exit", resolve).once("error", resolve)),
        new Promise((resolve) => opensslPrivateKeyExtractProcess.once("exit", resolve).once("error", resolve)),
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

    // openssl may not be present at all (spawn ENOENT): that is a server
    // fault, not a bad certificate - report it without details.
    if(opensslCertExtractProcess.exitCode === null && opensslPrivateKeyExtractProcess.exitCode === null) {
        throw new ClientError(500, "Certificate conversion is unavailable on this server.");
    }

    const errors = [];
    if(opensslCertExtractProcess.exitCode) {
        errors.push({
            process: "openssl x509 -nokeys",
            exitcode: opensslCertExtractProcess.exitCode,
            // stderr describes the client's own upload; safe to return,
            // bounded so a pathological upload cannot blow up the response.
            stderr: opensslCertExtractErrors.slice(0, 4096),
        });
    }
    if(opensslPrivateKeyExtractProcess.exitCode) {
        errors.push({
            process: "openssl pkcs12 -nocerts",
            exitcode: opensslPrivateKeyExtractProcess.exitCode,
            stderr: (opensslPrivateKeyExtractErrors + "\n\n" + opensslPrivateKeyCleanupErrors).slice(0, 4096),
        });
    }

    if(errors.length) {
        return res.status(400).send({
            error: "The supplied certificate could not be converted. See errors for the openssl diagnostics.",
            errors,
        });
    }

    /** @type {crypto.X509Certificate} */
    let x509Cert;
    try {
        x509Cert = new crypto.X509Certificate(Buffer.from(opensslCertExtractOutput));
    }
    catch {
        throw new ClientError(400, "The converted data is not a valid X.509 certificate.");
    }

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
}));

// Central error handler: ClientError messages are curated above and safe to
// show; anything else is logged server-side and answered with a generic 500
// so stack traces and dependency errors never reach clients.
/** @type {import("express").ErrorRequestHandler} */
app.use((error, req, res, next) => {
    if(error instanceof ClientError) {
        return res.status(error.status).send({ error: error.message });
    }
    req.log.error({ err: error }, "Unhandled error");
    res.status(500).send({ error: "Internal server error." });
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
