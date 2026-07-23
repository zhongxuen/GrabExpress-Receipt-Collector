import type { NextAuthOptions } from "next-auth";
import GoogleProvider from "next-auth/providers/google";

const GMAIL_READONLY_SCOPE = "https://www.googleapis.com/auth/gmail.readonly";

interface RefreshedTokens {
  access_token: string;
  expires_in: number;
  refresh_token?: string;
  scope?: string;
  token_type?: string;
}

async function refreshAccessToken(refreshToken: string): Promise<RefreshedTokens> {
  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: process.env.GOOGLE_CLIENT_ID as string,
      client_secret: process.env.GOOGLE_CLIENT_SECRET as string,
      grant_type: "refresh_token",
      refresh_token: refreshToken,
    }),
  });

  const data = await res.json();
  if (!res.ok) {
    throw new Error(`Failed to refresh access token: ${JSON.stringify(data)}`);
  }
  return data;
}

export const authOptions: NextAuthOptions = {
  providers: [
    GoogleProvider({
      clientId: process.env.GOOGLE_CLIENT_ID as string,
      clientSecret: process.env.GOOGLE_CLIENT_SECRET as string,
      authorization: {
        params: {
          scope: `openid email profile ${GMAIL_READONLY_SCOPE}`,
          access_type: "offline",
          prompt: "consent",
        },
      },
    }),
  ],
  session: {
    strategy: "jwt",
  },
  callbacks: {
    async jwt({ token, account }) {
      // Initial sign-in: persist the tokens Google just issued.
      if (account) {
        return {
          ...token,
          accessToken: account.access_token,
          refreshToken: account.refresh_token,
          accessTokenExpires: account.expires_at ? account.expires_at * 1000 : 0,
        };
      }

      // Subsequent requests: reuse the access token until it's close to expiry.
      if (typeof token.accessTokenExpires === "number" && Date.now() < token.accessTokenExpires - 60_000) {
        return token;
      }

      // Expired: refresh it using the stored refresh token.
      if (!token.refreshToken) {
        return { ...token, error: "MissingRefreshToken" as const };
      }

      try {
        const refreshed = await refreshAccessToken(token.refreshToken as string);
        return {
          ...token,
          accessToken: refreshed.access_token,
          accessTokenExpires: Date.now() + refreshed.expires_in * 1000,
          refreshToken: refreshed.refresh_token ?? token.refreshToken,
          error: undefined,
        };
      } catch {
        return { ...token, error: "RefreshAccessTokenError" as const };
      }
    },
    async session({ session, token }) {
      session.accessToken = token.accessToken as string | undefined;
      session.error = token.error as string | undefined;
      return session;
    },
  },
};
