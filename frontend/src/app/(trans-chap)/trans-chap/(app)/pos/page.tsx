"use client";

import { PosWorkspace } from "@/components/pos/PosWorkspace";
import { PlatformRuntimeProvider } from "@/lib/platform-runtime";

export default function TransChapPosPage() {
  return (
    <PlatformRuntimeProvider>
      <div className="trans-chap-pos-host fb-app">
        <PosWorkspace completeInPlace salesProfile="transchap" />
      </div>
    </PlatformRuntimeProvider>
  );
}
