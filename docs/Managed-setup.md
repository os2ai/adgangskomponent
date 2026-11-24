# Managed Setup of Adgangskomponenten

This guide describes the configuration for a managed deployment where a single Keycloak instance serves multiple authorities.

## Overview

A managed setup follows the same installation and configuration process as the [Setup guide](Setup.md), with the following critical differences to ensure multi-tenancy and security isolation.

## Multi-Tenant Configuration

### 1. Dedicated Keycloak Clients
In a managed setup, every authority MUST have its own dedicated Keycloak client. Do not share clients between different authorities. This ensures that:
- Client secrets are unique per authority.
- Redirect URIs are restricted to the authority's own systems.
- Audit logs clearly distinguish which authority's system is being accessed.

### 2. Script Mapper Modification
The default `oidc-script-based-protocol-mapper` is designed for a single-tenant scenario. In a managed setup, the mapper script must be manually rewritten within the Keycloak admin console to implement authority-based isolation.

The script must be updated to:
1. **Identify the Authority**: Extract an authority identifier (such as the CVR number) from the user's FKA attributes.
2. **Validate Ownership**: Compare this identifier against the specific authority assigned to the client being used for the current session.
3. **Enforce Isolation**: If the user's authority identifier does not match the client's assigned authority, the script must throw an error or deny the token issuance.

**Risk**: Without this modification, a user from one authority who has valid FKA privileges could potentially authenticate against another authority's OIDC client and gain access to their systems.

## Summary of Differences

| Feature | Self-Managed | Managed |
| :--- | :--- | :--- |
| **Keycloak Instance** | One per authority | Shared |
| **Clients** | Single/Few per authority | Dedicated per authority |
| **Mapper Script** | Default repository version | Manually modified for CVR check |
| **Isolation** | Physical/Logical (Separate Realm) | Script-based (Attribute validation) |
