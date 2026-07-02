/// <reference types="vite/client" />
import {
  CognitoUserPool,
  CognitoUser,
  AuthenticationDetails,
  CognitoUserSession,
} from "amazon-cognito-identity-js";

const USER_POOL_ID = import.meta.env.VITE_COGNITO_USER_POOL_ID || "";
const CLIENT_ID = import.meta.env.VITE_COGNITO_CLIENT_ID || "";

const userPool =
  USER_POOL_ID && CLIENT_ID
    ? new CognitoUserPool({ UserPoolId: USER_POOL_ID, ClientId: CLIENT_ID })
    : null;

/**
 * Se o Cognito não está configurado (dev local sem pool), a app opera sem auth
 * e authFetch faz fetch simples. Em produção, VITE_COGNITO_* vêm do Terraform.
 */
export function isAuthConfigured(): boolean {
  return userPool !== null;
}

export function signIn(
  username: string,
  password: string,
): Promise<CognitoUserSession> {
  return new Promise((resolve, reject) => {
    if (!userPool) {
      reject(new Error("Cognito não configurado."));
      return;
    }
    const user = new CognitoUser({ Username: username, Pool: userPool });
    const details = new AuthenticationDetails({
      Username: username,
      Password: password,
    });
    user.authenticateUser(details, {
      onSuccess: (session) => resolve(session),
      onFailure: (err) => reject(err),
      // newPasswordRequired etc. ficam para uma iteração futura da UI.
    });
  });
}

export function signOut(): void {
  const user = userPool?.getCurrentUser();
  user?.signOut();
}

/**
 * Retorna o idToken (JWT) da sessão válida atual, ou null se não houver sessão.
 * Faz refresh automático quando o token expirou mas o refresh token é válido.
 */
export function getIdToken(): Promise<string | null> {
  return new Promise((resolve) => {
    const user = userPool?.getCurrentUser();
    if (!user) {
      resolve(null);
      return;
    }
    user.getSession((err: Error | null, session: CognitoUserSession | null) => {
      if (err || !session || !session.isValid()) {
        resolve(null);
        return;
      }
      resolve(session.getIdToken().getJwtToken());
    });
  });
}

/**
 * Wrapper de fetch que injeta Authorization: Bearer <idToken>.
 * Sem Cognito configurado, comporta-se como fetch normal (dev).
 */
export async function authFetch(
  input: RequestInfo | URL,
  init: RequestInit = {},
): Promise<Response> {
  const headers = new Headers(init.headers);
  const token = await getIdToken();
  if (token) {
    headers.set("Authorization", `Bearer ${token}`);
  }
  return fetch(input, { ...init, headers });
}
