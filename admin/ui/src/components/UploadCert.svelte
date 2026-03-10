<script>
    let { api, otherApi, realm } = $props();

    let p12FileList = $state();
    let certFileList = $state();
    let privateKeyFileList = $state();

    let p12File = $derived(p12FileList?.[0]);
    let certFile = $derived(certFileList?.[0]);
    let privateKeyFile = $derived(privateKeyFileList?.[0]);

    let password = $state("");

    let uploadError = $state(undefined);

    async function handlePkcsForm(e) {
        e.preventDefault();
        uploadError = undefined;

        const headers = {};
        if(password) {
            headers["X-Cert-Encryption-Password"] = password;
        }
        
        let pemResponse;
        try {
            pemResponse = await otherApi.post("/pem-key-conversion", p12File, { headers });
        }
        catch(error) {
            if(error?.response?.status === 400) {
                uploadError = error.response.data;
                console.error("Got 400 response", error.response.data);
                return;
            }
            uploadError = error?.response?.data || error;
            throw error;
        }

        console.log("e", pemResponse.data);

        const metadata = pemResponse.data.meta;

        // TODO: repeated validation from +page.svelte
        // TODO: handle these errors better
        if(metadata.issuer?.O !== "Den Danske Stat") {
            throw new Error("Certificate not issued by the Danish Governmment.");
        }

        const now = Date.now();
        if(!metadata.validFrom || now < metadata.validFrom) {
            throw new Error("Certificate not yet valid.");
        }

        if(!metadata.validTo || now > metadata.validTo) {
            throw new Error("Certificate no longer valid.");
        }

        await uploadNewCerts(pemResponse.data.cert, pemResponse.data.privateKey);
    }

    async function handlePemForm(e) {
        e.preventDefault();
        uploadError = undefined;

        // TODO: duplicated code from +page
        const certParseResponse = await otherApi.post("/x509-parse", certFile);
        // TODO: handle errors
        const metadata = certParseResponse.data;

        // TODO: repeated validation from +page.svelte
        // TODO: handle these errors better
        if(metadata.issuer?.O !== "Den Danske Stat") {
            throw new Error("Certificate not issued by the Danish Governmment.");
        }

        const now = Date.now();
        if(!metadata.validFrom || now < metadata.validFrom) {
            throw new Error("Certificate not yet valid.");
        }

        if(!metadata.validTo || now > metadata.validTo) {
            throw new Error("Certificate no longer valid.");
        }

        await uploadNewCerts(await fileDataToString(certFile), await fileDataToString(privateKeyFile));
    }

    function fileDataToString(file) {
        return new Promise((resolve) => {
            const reader = new FileReader();
            reader.addEventListener("load", () => resolve(reader.result));
            reader.readAsText(file);
        });
    }

    async function uploadNewCerts(certData, privateKeyData) {
        // TODO: handle errors
        const componentsResponse = await api.get(`/realms/${realm}/components`);
        const keyProviders = componentsResponse.data.filter((com) => com.providerType === "org.keycloak.keys.KeyProvider");
        const encryptionProvider = keyProviders.find((com) => com.name === "rsa-enc");
        const signingProvider = keyProviders.find((com) => com.name === "rsa");

        // Clear up existing providers
        if(encryptionProvider) {
            await api.delete(`/realms/${realm}/components/${encryptionProvider.id}`);
        }
        if(signingProvider) {
            await api.delete(`/realms/${realm}/components/${signingProvider.id}`);
        }

        // Create new providers
        for(const { name, alg } of [ { name: "rsa", alg: "RS256" }, { name: "rsa-enc", alg: "RSA-OAEP" } ]) {
            await api.post(`/realms/${realm}/components`, {
                name,
                providerId: name,
                providerType: "org.keycloak.keys.KeyProvider",
                parentId: realm,
                config: {
                    privateKey: [ privateKeyData ],
                    certificate: [ certData ],
                    active: [ "true" ],
                    priority: [ "0" ],
                    enabled: [ "true" ],
                    algorithm: [ alg ],
                },
            });
        }

        location.reload();
    }
</script>

<fieldset>
    <legend><h3>Upload certifikat</h3></legend>

    <p>Upload enten et PKCS#12 (.p12) certifikat, evt. krypteret, eller hhv. et x509 certifikat og en ukrypteret RSA private key i .pem fil.</p>
    <p>Certifikatet skal være udstedet af Den Danske Stat til din organisation.</p>

    {#if uploadError}
        <div class="error">
            <h4>Fejl</h4>
            <pre>{typeof uploadError === "object" && !(uploadError instanceof Error) ? JSON.stringify(uploadError) : uploadError.toString()}</pre>
        </div>
    {/if}

    <table>
        <tbody>
            <tr>
                <td>
                    <h4>Upload PKCS#12</h4>
                    <form onsubmit={handlePkcsForm}>
                        <label>
                            <span>PKCS#12 (.p12) fil</span>
                            <input type="file" name="p12_file" accept=".p12" bind:files={p12FileList}>
                        </label>
                        <label>
                            <span>Password:</span>
                            <input type="password" name="password" bind:value={password}>
                        </label>
                        <button
                            type="submit"
                            disabled={!Boolean(p12File)}
                        >
                            Upload
                        </button>
                    </form>
                </td>
                <td>
                    <h4>Upload X509 certifikat og RSA private key</h4>
                    <form onsubmit={handlePemForm}>
                        <label>
                            <span>X509 certifikat (.pem) fil</span>
                            <input type="file" name="x509_cert_file" accept=".pem" bind:files={certFileList}>
                        </label>
                        <label>
                            <span>RSA private key (.pem) fil</span>
                            <input type="file" name="rsa_private_key_file" accept=".pem" bind:files={privateKeyFileList}>
                        </label>
                        <button
                            type="submit"
                            disabled={!Boolean(certFile) || !Boolean(privateKeyFile)}
                        >
                            Upload
                        </button>
                    </form>
                </td>
            </tr>
        </tbody>
    </table>

</fieldset>

<style>
    form {
        display: flex;
        flex-direction: column;
        align-items: start;
        gap: 1.5rem;
    }
    h4 {
        margin-bottom: 0;
    }
    label span {
        display: block;
    }
    table {
        width: 100%;
    }
    table td {
        width: 50%;
    }

    .error {
        border: 3px solid red;
        padding: 5px;
    }
</style>
