"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

/** Stock is added via Purchases now — keep this route as a redirect. */
export default function TransChapStockUpPage() {
  const router = useRouter();
  useEffect(() => {
    router.replace("/trans-chap/purchases/new");
  }, [router]);
  return <p className="trans-chap-form__lead">Opening Purchases…</p>;
}
