"use client";

import { useFormStatus } from "react-dom";

type Props = {
  children: React.ReactNode;
  loadingLabel?: string;
  className?: string;
};

export function AuthSubmitButton({
  children,
  loadingLabel = "Signing in…",
  className = "cta-btn auth-submit",
}: Props) {
  const { pending } = useFormStatus();

  return (
    <button
      type="submit"
      className={className}
      disabled={pending}
      aria-busy={pending}
    >
      {pending ? (
        <>
          <i className="fas fa-spinner fa-spin" aria-hidden="true" />
          {loadingLabel}
        </>
      ) : (
        children
      )}
    </button>
  );
}
