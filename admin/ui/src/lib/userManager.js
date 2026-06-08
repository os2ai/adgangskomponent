import { UserManager } from "oidc-client-ts";
import { clientId, authority, redirectUri } from "$lib/keycloakConfig.js";
import { setUser, signin } from "$lib/requireAuthentication.js";

export default () => {
    const userManager = new UserManager({
        client_id: clientId,
        authority,
        redirect_uri: redirectUri,
        accessTokenExpiringNotificationTimeInSeconds: 60, // default - but good to be explicit
    });

    // This event is fired when we are close to the access token expiring.
    // See above for `accessTokenExpiringNotificationTimeInSeconds` in UserManager
    userManager.events.addAccessTokenExpiring(refreshUser);

    // This event is fired on login and when the users tokens are refreshed
    const onUserListeners = [];
    userManager.events.addUserLoaded((userInfo) => {
        const user = setUser(userInfo);
        onUserListeners.forEach((listener) => listener(user));
    });

    console.log("UserManager: Token refresh loop started");

    async function refreshUser() {
        const user = await userManager.getUser();

        // No user, no state exists as far as we know, no reason to refresh.
        if(!user) {
            return;
        }

        // Try to refresh user
        try {
            await userManager.signinSilent();
        }
        catch(error) {
            // If no longer active, end session.
            if(["Session not active", "Token is not active", "Session doesn't have required client", "refre(sh token issued before the client session started"].includes(error?.message)) {
                await userManager.removeUser();
                return signin({ returnUrl: location.href });
            }
            else if(["Stale token", "User session not found", "auth_time in id_token does not match original auth_time"].includes(error?.message)) {
                await userManager.signoutSilent();
                return signin({ returnUrl: location.href });
            }
            else {
                throw error;
            }
        }

        // Return what user is after refresh
        const newUser = await userManager.getUser();
        console.log("UserManager: Tokens refreshed", { user: newUser , expiresIn: user.expires_in });

        return newUser;
    }

    userManager.refreshUser = refreshUser;
    userManager.onUserChanged = (listener) => onUserListeners.push(listener);

    return userManager;
}
