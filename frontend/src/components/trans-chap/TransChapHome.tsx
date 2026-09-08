"use client";

import { useAuthUser } from "@/components/app/AuthProvider";
import { TransChapHomePies } from "@/components/trans-chap/TransChapHomePies";

function firstName(name: string): string {
  const part = name.trim().split(/\s+/)[0];
  return part || "there";
}

function todayLabel(): string {
  return new Intl.DateTimeFormat("en-KE", {
    timeZone: "Africa/Nairobi",
    weekday: "long",
    day: "numeric",
    month: "long",
  }).format(new Date());
}

export function TransChapHome() {
  const user = useAuthUser();
  const name = firstName(user.name);
  const shop =
    user.active_account?.business_name?.trim() ||
    user.account?.business_name?.trim() ||
    "";

  return (
    <div className="trans-chap-home trans-chap-dash">
      <section className="trans-chap-dash__hero" aria-label="Welcome">
        <p className="trans-chap-dash__hero-date">{todayLabel()}</p>
        <h2>Hi, {name}</h2>
        {shop ? <p className="trans-chap-dash__hero-shop">{shop}</p> : null}
      </section>

      <TransChapHomePies />
    </div>
  );
}
