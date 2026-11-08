import { verifyToken } from "@clerk/backend";

export function webSessionVerifier(env: NodeJS.ProcessEnv) {
  const secretKey = env.CLERK_SECRET_KEY;
  const jwtKey = env.CLERK_JWT_KEY;
  const issuer = env.CLERK_ISSUER;
  const authorizedParties = env.WEB_ORIGINS?.split(",")
    .map((value) => value.trim())
    .filter(Boolean);
  if ((!secretKey && !jwtKey) || !issuer || !authorizedParties?.length) return null;
  return async (request: Request): Promise<string | null> => {
    const bearer = /^Bearer (\S+)$/.exec(request.headers.get("authorization") ?? "")?.[1];
    if (!bearer) return null;
    try {
      const claims = await verifyToken(bearer, { secretKey, jwtKey, issuer, authorizedParties });
      // Accept browser sessions only, not machine/API keys or arbitrary subjects.
      if (
        typeof claims.sub !== "string" ||
        !/^user_[A-Za-z0-9]+$/.test(claims.sub) ||
        typeof claims.sid !== "string" ||
        !claims.sid.startsWith("sess_") ||
        typeof claims.azp !== "string" ||
        !authorizedParties.includes(claims.azp)
      )
        return null;
      return claims.sub;
    } catch {
      return null;
    }
  };
}
