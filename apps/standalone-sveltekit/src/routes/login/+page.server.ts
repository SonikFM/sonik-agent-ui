import { error, fail, redirect } from "@sveltejs/kit";
import {
  isAmplifyLoginProxyEnabled,
  mintLoginProxyEnvelope,
  writeLoginProxySessionCookie,
  AmplifyLoginProxyError,
  ProductionSessionResolutionError,
  type AmplifyLoginProxyEnv,
} from "$lib/server/amplify-login-proxy";
import type { Actions, PageServerLoad } from "./$types";

const MAX_CREDENTIAL_CHARS = 320;

export const load: PageServerLoad = async ({ platform }) => {
  const env = (platform?.env ?? {}) as AmplifyLoginProxyEnv;
  if (!isAmplifyLoginProxyEnabled(env)) {
    throw error(404, "Login is not enabled on this deployment.");
  }
  return {};
};

export const actions: Actions = {
  default: async ({ request, cookies, platform }) => {
    const env = (platform?.env ?? {}) as AmplifyLoginProxyEnv;
    if (!isAmplifyLoginProxyEnabled(env)) {
      throw error(404, "Login is not enabled on this deployment.");
    }

    const form = await request.formData();
    const email = readFormString(form, "email");
    const password = readFormString(form, "password");
    if (!email || !password) {
      return fail(400, { error: "Email and password are required.", email });
    }

    try {
      const session = await mintLoginProxyEnvelope({ email, password }, env);
      writeLoginProxySessionCookie(cookies, session, env);
    } catch (caught) {
      return fail(401, { error: describeLoginError(caught), email });
    }

    throw redirect(303, "/");
  },
};

function readFormString(form: FormData, key: string): string {
  const value = form.get(key);
  return typeof value === "string" ? value.trim().slice(0, MAX_CREDENTIAL_CHARS) : "";
}

function describeLoginError(caught: unknown): string {
  if (caught instanceof ProductionSessionResolutionError) {
    if (caught.message === "AMPLIFY_SIGN_IN_INVALID_CREDENTIALS") {
      return "Incorrect email or password.";
    }
    if (caught.message === "AMPLIFY_SIGN_IN_TIMEOUT") {
      return "Amplify did not respond in time. Please try again.";
    }
    if (caught.message === "AMPLIFY_SIGN_IN_SESSION_UNRESOLVED") {
      return "Signed in, but no organization membership was found for this account.";
    }
    return "Could not sign in through Amplify. Please try again.";
  }
  if (caught instanceof AmplifyLoginProxyError) {
    return "Login is misconfigured on this deployment.";
  }
  return "Something went wrong. Please try again.";
}
