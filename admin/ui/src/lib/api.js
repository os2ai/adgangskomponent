import { PUBLIC_KEYCLOAK_API_BASEURL } from "$env/static/public";
import axios from "axios";

export default (user) => {
    console.log("u", user);

    return axios.create({
        baseURL: PUBLIC_KEYCLOAK_API_BASEURL,
        headers: {
            Authorization: `Bearer ${user.accessToken}`,
        },
    });
};
