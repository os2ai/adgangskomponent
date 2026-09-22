This JAR registers the built-in ScriptBasedOIDCProtocolMapper via SPI.
It simply contains the service file: META-INF/services/org.keycloak.protocol.ProtocolMapper
with the entry: org.keycloak.protocol.oidc.mappers.ScriptBasedOIDCProtocolMapper