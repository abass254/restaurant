"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  type ReactNode,
} from "react";
import { useRouter } from "next/navigation";

type RegisterModalContextValue = {
  open: () => void;
  close: () => void;
  isOpen: boolean;
};

const RegisterModalContext = createContext<RegisterModalContextValue | null>(null);

/** Legacy provider — Get Started now routes to /signup. */
export function RegisterModalProvider({ children }: { children: ReactNode }) {
  const router = useRouter();

  const open = useCallback(() => {
    router.push("/signup");
  }, [router]);

  const close = useCallback(() => {}, []);

  useEffect(() => {
    const tryOpenFromHash = () => {
      if (window.location.hash === "#register") {
        router.replace("/signup");
      }
    };
    tryOpenFromHash();
    window.addEventListener("hashchange", tryOpenFromHash);
    return () => window.removeEventListener("hashchange", tryOpenFromHash);
  }, [router]);

  return (
    <RegisterModalContext.Provider value={{ open, close, isOpen: false }}>
      {children}
    </RegisterModalContext.Provider>
  );
}

export function useRegisterModal() {
  const ctx = useContext(RegisterModalContext);
  if (!ctx) {
    throw new Error("useRegisterModal must be used within RegisterModalProvider");
  }
  return ctx;
}
