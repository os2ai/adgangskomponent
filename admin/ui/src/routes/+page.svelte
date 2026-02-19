<script>
    import Api from "$lib/api";
    import { requireAuthentication } from "$lib/requireAuthentication";
    import { onMount } from "svelte";
    import axios from "axios";
    import { SvelteMap } from "svelte/reactivity";
    import UploadCert from "../components/UploadCert.svelte";
    import { PUBLIC_KEYCLOAK_REALM_BASEURL, PUBLIC_API_BASEURL } from "$env/static/public";

    const LOADING = /** @const @type {{_loading: true}} */({ _loading: true });

    /**
     * @type {import("axios").AxiosInstance | undefined}
     */
    let api = $state();
    let otherApi = axios.create({
        baseURL: PUBLIC_API_BASEURL,
    });
    onMount(async () => {
        const user = await requireAuthentication();
        api = Api(user);
    });

    let realms = $state([]);
    let orgRealms = $derived(realms.filter((realm) => realm.realm !== "master"));

    let activeRealm = $state(typeof localStorage !== "undefined" && localStorage.getItem("activeRealm") || undefined);

    let identityProviders = $state();
    let isIntegrationRealm = $derived(identityProviders?._loading ? LOADING : identityProviders?.some((idp) => idp.alias === "fka"));

    /**
     * @typedef {{
     *   name: string,
     *   config: {
     *     certificate?: [ string ],
     *     active?: [ "true" | "false" ],
     *     enabled?: [ "true" | "false" ],
     *     algorithm?: [ string ],
     *   },
     * }} KeyProvider
     * @type {KeyProvider[] | typeof LOADING | undefined}
     */
    let keyProviders = $state();
    let keyMetadata = new SvelteMap();

    /**
     * @type {KeyProvider | undefined}
     */
    let signingCert = $derived(keyProviders && !("_loading" in keyProviders) && keyProviders.find((keyProvider) => keyProvider.name === "rsa") || undefined);

    /**
     * @type {KeyProvider | undefined}
     */
    let encryptionCert = $derived(keyProviders && !("_loading" in keyProviders) && keyProviders.find((keyProvider) => keyProvider.name === "rsa-enc") || undefined);

    let certsMatch = $derived(signingCert && encryptionCert && signingCert.config.certificate?.[0] === encryptionCert.config.certificate?.[0] && signingCert.config.privateKey?.[0] === encryptionCert.config.privateKey?.[0]);
    let signingCertError = $derived(signingCert && getCertError(signingCert, keyMetadata, "RS256"));
    let encryptionCertError = $derived(encryptionCert && getCertError(encryptionCert, keyMetadata, "RSA-OAEP"));

    let encryptionCertMeta = $derived(keyMetadata.get(encryptionCert?.name));

    let dangerousActiveKeyProviders = $derived(keyProviders && !("_loading" in keyProviders) && keyProviders.filter((keyProvider) => keyProvider.name !== "rsa" && keyProvider.name !== "rsa-enc" && (keyProvider.config.active?.[0] !== "false" || keyProvider.config.enabled?.[0] !== "false")));

    $effect(async () => {
        for(const keyProvider of [signingCert, encryptionCert].filter(Boolean)) {
            const cert = keyProvider.config.certificate?.[0];
            if(!cert) {
                keyMetadata.set(keyProvider.name, new Error("No certificate found on provider"));
                continue;
            }
            keyMetadata.set(keyProvider.name, LOADING);
            
            let metadata;
            try {
                metadata = await getCertificateData(otherApi, cert);
            }
            catch(error) {
                keyMetadata.set(keyProvider.name, new Error("Failed to get certificate data", { cause: error }));
                continue;
            }

            keyMetadata.set(keyProvider.name, metadata);
        }
    });

    $effect(() => {
        if(!api) {
            return;
        }
        loadRealms(api);
    });

    $effect(() => {
        if(typeof localStorage !== "undefined") {
            if(activeRealm) {
                localStorage.setItem("activeRealm", activeRealm);
            }
            else {
                localStorage.removeItem("activeRealm");
            }
        }
    });

    $effect(() => {
        if(!api || !activeRealm) {
            return;
        }
        loadKeyProviders(api, activeRealm);
        loadIdentityProviders(api, activeRealm);
    });

    async function loadRealms(api) {
        const realmsResponse = await api.get("/realms");

        realms = realmsResponse.data;
        activeRealm ||= realms.filter((realm) => realm.realm !== "master")[0]?.realm;
    }

    async function loadKeyProviders(api, realm) {
        keyProviders = LOADING;
        const componentsResponse = await api.get(`/realms/${realm}/components`);
        keyProviders = componentsResponse.data.filter((com) => com.providerType === "org.keycloak.keys.KeyProvider");
    }

    async function loadIdentityProviders(api, realm) {
        identityProviders = LOADING;
        const identityProvidersResponse = await api.get(`/realms/${realm}/identity-provider/instances`);
        identityProviders = identityProvidersResponse.data;
    }

    async function getCertificateData(otherApi, cert) {
        const response = await otherApi.post("/x509-parse", new Blob([ cert ]));
        return response.data;
    }

    /**
     * @param {KeyProvider} keyProvider
     * @param {SvelteMap<string, CertMetadata | typeof LOADING | Error>} keyMetadata
     * @param {"RS256"|"RSA-OAEP"} algorithm
     * @returns {Error | typeof LOADING | undefined}
     */
    function getCertError(keyProvider, keyMetadata, algorithm) {
        const config = keyProvider.config;
        if(!config) {
            return new Error("No config found for key provider.");
        }

        if(config.algorithm?.[0] !== algorithm) {
            return new Error(`Algorithm mismatch: must use ${algorithm}, but found ${keyProvider.config.algorithm?.[0]}`);
        }

        if(config.active?.[0] !== "true") {
            return new Error("Key provider is not enabled.");
        }

        if(config.enabled?.[0] !== "true") {
            return new Error("Key provider is not enabled.");
        }

        const metadata = keyMetadata.get(keyProvider.name);

        if(!metadata) {
            return new Error("No metadata for key provider");
        }

        if(metadata._loading) {
            return LOADING;
        }

        if(metadata.issuer?.O !== "Den Danske Stat") {
            return new Error("Certificate not issued by the Danish Governmment.");
        }

        const now = Date.now();
        if(!metadata.validFrom || now < metadata.validFrom) {
            return new Error("Certificate not yet valid.");
        }

        if(!metadata.validTo || now > metadata.validTo) {
            return new Error("Certificate no longer valid.");
        }
    }

    async function deactivateAllDangerousKeyProviders() {
        for(const keyProvider of dangerousActiveKeyProviders) {
            deactivateDangerousKeyProvider(keyProvider);
        }
    }

    async function deactivateDangerousKeyProvider(keyProvider) {
        await api.put(`/realms/${activeRealm}/components/${keyProvider.id}`, {
            ...keyProvider,
            config: {
                ...keyProvider.config,
                enabled: [ "false" ],
                active: [ "false" ],
            },
        });

        keyProvider.config.enabled = [ "false" ];
        keyProvider.config.active = [ "false" ];
    }
</script>

<header class="header">
    <a href="/">Adgangskomponent administrationspanel</a>
    <nav>
        <form>
            <label>
                <span>Vælg organisation</span>
                <select
                    bind:value={activeRealm}
                >
                    {#each orgRealms as realm}
                        <option value={realm.realm}>{realm.displayName || realm.realm}</option>
                    {/each}
                </select>
            </label>
        </form>
    </nav>
</header>

<main>
    <h1>Opsætningsstatus</h1>
    <table>
        <tbody>
            <tr>
                <th>Realm type</th>
                <td>
                    {#if !identityProviders}
                        Mangler data
                    {:else if identityProviders._loading}
                        Henter data...
                    {:else if isIntegrationRealm}
                        FKA-integration
                    {:else}
                        Ukendt type
                    {/if}
                </td> <!-- TODO: detect: is FKA idp set up? -->
            </tr>
            <tr>
                <th>Certifikatstatus</th>
                <td>
                    {#if !identityProviders || identityProviders._loading}
                        Undersøger...
                    {:else if !isIntegrationRealm}
                        N/A - ikke FKA-integrations-realm
                    {:else if !signingCert || !encryptionCert}
                        Mangler certifikat
                    {:else if !certsMatch}
                        Certifikatmismatch
                    {:else if signingCertError?._loading || encryptionCertError?._loading}
                        Undersøger...
                    {:else if signingCertError || encryptionCertError}
                        Fejl i certifikopsætning ({[signingCertError?.message, encryptionCertError?.message].filter(Boolean).join(", ")})
                    {:else}
                        Gyldig
                    {/if}
                </td>
            </tr>
            <tr>
                <th>SAML metadata URL</th>
                <td>
                    <a
                        href={`${PUBLIC_KEYCLOAK_REALM_BASEURL}/${activeRealm}/broker/fka/endpoint/descriptor`}
                        target="_blank"
                        rel="noopener"
                    >
                        {PUBLIC_KEYCLOAK_REALM_BASEURL}/{activeRealm}/broker/fka/endpoint/descriptor
                    </a>
                </td>
            </tr>
        </tbody>
    </table>

    {#if isIntegrationRealm === true}
        <h1>Certifikatopsætning</h1>

        {#if !encryptionCert && !signingCert}
            <p>Ingen certifikater oprettet til FKA-integration.</p>
            <UploadCert {api} {otherApi} realm={activeRealm} />
        {:else if !certsMatch}
            <div class="warning-box">
                <strong>Certifikaterne matcher ikke</strong>
                <p>Lige nu er integrationen sat op med forskellige certifikater til kryptering og signering.</p>
                <p>Fælleskommunal Adgangsstyring kræver at der bruges ét certifikat til både signering og kryptering.</p>
                {#if !signingCertError}
                    <p>Signeringscertifikatet er gyldigt.</p>
                    <!-- TODO: summary -->
                    <!--button type="button">Brug til alt</button--><!-- TODO: make button work -->
                {/if}
                {#if !encryptionCertError}
                    <p>Krypteringscertifikatet er gyldigt.</p>
                    <!-- TOOD: summary -->
                    <!--button type="button">Brug til alt</button--><!-- TODO: make button work -->
                {/if}
                {#if encryptionCertError && signingCertError}
                    <p>Ingen af de eksisterende certifikater er gyldige.</p>
                {/if}
            </div>
            <UploadCert {api} {otherApi} realm={activeRealm} />
        {:else if signingCertError || encryptionCertError}
            <!-- TODO: ugyldigt certifikat. Forklar problemet. -->
            {#if signingCertError}
                <p>Der er fejl i signeringscertifikatet. {signingCertError.message}</p>
            {/if}
            {#if encryptionCertError}
                <p>Der er fejl i krypteringscertifikatet. {encryptionCertError.message}</p>
            {/if}
            <UploadCert {api} {otherApi} realm={activeRealm} />
        {:else}
            <div>
                <p>
                    <strong>Gyldigt certifikat.</strong>
                    Udstedt af {encryptionCertMeta?.issuer?.O} til {encryptionCertMeta?.subject?.O}.
                    Gyldigt fra {new Date(encryptionCertMeta?.validFrom).toLocaleString("da-DK")} til {new Date(encryptionCertMeta?.validTo).toLocaleString("da-DK")}.
                </p>
            </div>
            <details>
                <summary>Opdater certifikat</summary>
                <UploadCert {api} {otherApi} realm={activeRealm} />
            </details>
        {/if}

        {#if dangerousActiveKeyProviders && dangerousActiveKeyProviders.length}
            <details>
                <summary>{dangerousActiveKeyProviders.length} forkerte certifikater fundet &ndash; kan give problemer.</summary>
                <div class="info-box">
                    Der er andre aktive krypteringsnøgler og certifikater i opsætningen i dette realm.
                    Det kan føre til problemer, hvis den forkerte krypteringsnøgle meldes til eller bruges i FKA-integrationen.
                    <button onclick={deactivateAllDangerousKeyProviders} type="button">Deaktiver alle forkerte certifikater</button> <!-- TODO -->
                </div>
                <ul>
                    {#each dangerousActiveKeyProviders as keyProvider}
                        <li>
                            {keyProvider.name} {keyProvider.config.algorithm?.[0] || ""}
                            <button type="button" onclick={() => deactivateDangerousKeyProvider(keyProvider)}>Deaktiver</button> <!-- TODO -->
                        </li>
                    {/each}
                </ul>
            </details>
        {/if}
        <!-- TODO: Clean up unused certs -->
    {:else if isIntegrationRealm === false}
        <div class="info-box">
            <strong>Dette ligner ikke et FKA-integrations-realm.</strong>
            Der mangler basal opsætning af konfiguratoin af Fælleskommunal Adgangsstyring som Identity Provider i dette realm.
            Hvis du mener at dette <em>bør</em> være en FKA-integrations-realm, bør du kontakte din systemadministrator, for at få rettet opsætningen.
        </div>
    {/if}

    <!--
        TODO:
        - for each realm, detect:
        - idp fka exits, and is defined correctly, including most recent certs (pull from source)
        - authentication flow is correctly defined. otherwise allow aligning
        - key providers: reomve all not rsa and rsa-enc
        - key providers: ensure rsa and rsa-enc are defined and contain keys that match (private key + cert) and that cert belongs to an org
            - if not, prompt upload of p12 file or 2 .pem files. Turn into correct format and save
    -->
</main>

<style>
    .header {
        display: flex;
        flex-direction: row;
        gap: 2rem;
        padding: 2rem;
        border-bottom: 1px solid black;
    }
    main {
        padding: 2rem;
        padding-bottom: 5rem;
        max-width: 800px;
    }
    h1, h2, h3, h4, h5, h6 {
        margin-bottom: 1rem;
        margin-top: 1.75em;
    }
    table {
        text-align: left;
    }
    table th, table td {
        padding: 0 2rem 0 0;
        border-bottom: 1px dotted black;
    }
    .info-box {
        border: 1px solid black;
        margin: 0.2rem;
        padding: 0.2rem;
        background-color: #eee;
    }

    details {
        margin-top: 1.5rem;
        margin-left: 1.5rem;
    }
    details summary {
        margin-left: -1.5rem;
    }
</style>