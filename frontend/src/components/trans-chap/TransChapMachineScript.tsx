import Script from "next/script";
import { transChapMachineInit } from "@/lib/trans-chap-machine";

export function TransChapMachineScript() {
  return (
    <Script
      id="trans-chap-machine-init"
      strategy="beforeInteractive"
      dangerouslySetInnerHTML={{ __html: transChapMachineInit }}
    />
  );
}
