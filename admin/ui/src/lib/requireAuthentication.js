// @ts-check

// TODO: if user does not have realm-admin permission, error: not an admin user!

import UserManager from "$lib/userManager.js";

export function getAuthentication() {
    if(typeof window === "undefined") {
        return undefined;
    }

    let user;
    try {
        user = JSON.parse(localStorage.getItem("user"));
    }
    catch(error) {
        window?.localStorage.removeItem("user");
        return undefined;
    }

    if(!user?.id || !user?.organizationCvr) {
        window?.localStorage.removeItem("user");
        return undefined;
    }

    return user;
}

/**
 * @param {{
 *     disableRedirect?: boolean,
 * }} [options]
 * @returns
 */
export function requireAuthentication(options) {
    if(typeof window === "undefined") {
        return undefined;
    }

    let user;
    try {
        user = JSON.parse(localStorage.getItem("user"));
    }
    catch(error) {
        unsetUser();
        if(!options?.disableRedirect) {
            return signin({ returnUrl: location.href });
        }
        throw {
            trace: new Error("Failed to load user data, deleting local storage item (logging out)."),
            previous: error,
            code: "Unauthorized",
            reason: {
                "da-DK": "Ingen adgang: Kontroller dine loginoplysninger og prøv igen.",
                "en-US": "No valid user state found."
            },
        };
    }

    if(!user?.expiresAt || !Number.isInteger(user.expiresAt) || user.expiresAt < Math.round(Date.now() / 1000)) {
        unsetUser();
        if(!options?.disableRedirect) {
            return signin({ returnUrl: location.href });
        }
        throw {
            trace: new Error("User token expired or had no expiry set"),
            code: "Expired",
            reason: {
                "da-DK": "Du er ikke korrekt logget ind. Prøv at logge ind igen.",
                "en-US": "You need a new token to continue."
            },
        };
    }

    return user;
}

export function setUser(u) {
    const profile = u.profile;

    let data;
    try {
      data = JSON.parse(atob(u.access_token.split(".")[1]));
    }
    catch(e) {
      console.warn("Failed to decode data in access token", e);
    }

    localStorage.setItem("user", JSON.stringify({
        id: profile.sub,
        accessToken: u.access_token,
        data,
        expiresAt: u.expires_at,
    }));

    return requireAuthentication({ disableRedirect: true });
}

export function unsetUser() {
    localStorage.removeItem("user");
}

function renderLoginError(error) {
  const errorHeader = {
    "da-DK": "Kunne ikke logge ind",
    "en-US": "Could not login",
  };
  let errorDescription = {
    "da-DK": "En uventet fejl opstod. Prøv at logge igen.",
    "en-US": "An unexpected error occurred. Please try logging in again."
  };
  if(error?.response) {
    // Axios errors
    if (error.response?.status == 401) {
      errorDescription = {
        "da-DK": "Ingen adgang: Kontroller dine loginoplysninger og prøv igen.",
        "en-US": "Unauthorized: Please check your credentials and try again."
      };
    }
    if(error.response?.status == 403) {
      errorDescription = {
        "da-DK": "Adgang nægtet: Kontroller dine loginoplysninger og prøv igen.",
        "en-US": "Forbidden: Please check your credentials and try again."
      };
    }
    if (error.response?.status == 500) {
      errorDescription = {
        "da-DK": "Serverfejl: Noget gik galt på serveren. Prøv igen senere.",
        "en-US": "Server Error: Something went wrong on the server. Please try again later."
      };
    }
  } else {
    // Non axios errors
    if (error.code === "Malformed" || error.code === "Forbidden" || error.code === "Expired" || error.code === "Unauthorized") {
      errorDescription = error.reason;
    }
  }

  return {
    errorHeader,
    errorDescription,
    error,
  };
}

export async function signin({ returnUrl, forceRelogin }) {
  const userManager = UserManager();

  const url = new URL(location.href);
  const searchParams = url.searchParams;

  returnUrl ||= localStorage.getItem("returnUrl");
  if(returnUrl) {
    const returnUrlAsUrlObject = new URL(returnUrl, location.href);
    if(returnUrlAsUrlObject.host === location.host) {
      returnUrl = returnUrlAsUrlObject.toString();
    }
    else {
      console.warn("Thwarted attempt at injecting return url to external domain.");
      returnUrl = undefined;
    }
  }

  if(returnUrl) {
    localStorage.setItem("returnUrl", returnUrl);
  }

  if(forceRelogin) {
    await userManager.signinRedirect();
    return;
  }

  let u = await userManager.refreshUser();

  if(u) {
    postSignin(u, returnUrl, userManager);
    return;
  }

  if(searchParams.get("error") || searchParams.get("error_description")) {
    console.error("Error while logging in:", searchParams.get("error"), searchParams.get("error_description"));
    return renderLoginError({ error: searchParams.get("error") || searchParams.get("error_description") });
  }

  if(!searchParams.get("state") || !searchParams.get("session_state")) {
    try {
      await userManager.signinRedirect();
    }
    catch(error) {
      console.error("Got error from signin redirect", error);
      return renderLoginError(error);
    }
    return;
  }

  try {
    await userManager.signinCallback(location.href);
  }
  catch(error) {
    if(["No matching state found in storage", "Code not valid"].includes(error?.message)) {
      console.error("Got error from signin callback", error);
      return signin({ returnUrl, forceRelogin: true });
    }
    console.error("Got error from signin callback", error);
    return renderLoginError(error);
  }

  try {
    u = await userManager.getUser();
  }
  catch(error) {
    console.error("Got error from getUser", error);
    return renderLoginError(error);
  }

  postSignin(u, returnUrl, userManager);
}

async function postSignin(u, returnUrl, userManager) {
  try {
    setUser(u);
  }
  catch(error) {
    await userManager.signoutSilent();
    // TODO: handle errors from setUser + requireAuthentication
    // TODO: prettier error: 403 error page with hints as to whether it is level of access or non-org user?
    console.error("Got error from setUser", error);
    renderLoginError(error);
    return;
  }

  location.href = returnUrl || "/";
}
