"use client";

import { createContext, useCallback, useContext, useState } from "react";
import { apiFetch } from "@/lib/api";
import { apiRoutes } from "@/lib/config";
import type { AuthUser } from "@/lib/types";

type AuthContextValue = {
  user: AuthUser;
  refreshUser: () => Promise<AuthUser | null>;
  switchMerchant: (accountId: string) => Promise<AuthUser | null>;
};

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({
  user: initialUser,
  children,
}: {
  user: AuthUser;
  children: React.ReactNode;
}) {
  const [user, setUser] = useState(initialUser);

  const refreshUser = useCallback(async () => {
    try {
      const data = await apiFetch<AuthUser>(apiRoutes.user);
      setUser(data);
      return data;
    } catch {
      return null;
    }
  }, []);

  const switchMerchant = useCallback(async (accountId: string) => {
    try {
      const data = await apiFetch<AuthUser>(apiRoutes.switchMerchant, {
        method: "POST",
        body: JSON.stringify({ account_id: accountId }),
      });
      setUser(data);
      return data;
    } catch {
      return null;
    }
  }, []);

  return (
    <AuthContext.Provider value={{ user, refreshUser, switchMerchant }}>
      {children}
    </AuthContext.Provider>
  );
}

function useAuthContext(): AuthContextValue {
  const value = useContext(AuthContext);
  if (!value) {
    throw new Error("useAuthUser must be used within AuthProvider");
  }
  return value;
}

export function useAuthUser(): AuthUser {
  return useAuthContext().user;
}

export function useAuthRefresh(): () => Promise<AuthUser | null> {
  return useAuthContext().refreshUser;
}

export function useAuthSwitchMerchant(): (
  accountId: string,
) => Promise<AuthUser | null> {
  return useAuthContext().switchMerchant;
}

export function useOptionalAuthUser(): AuthUser | null {
  return useContext(AuthContext)?.user ?? null;
}
