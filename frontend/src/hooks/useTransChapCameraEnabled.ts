"use client";

import { useEffect, useState } from "react";
import {
  isCameraScanningEnabled,
  subscribeCameraScanningEnabled,
} from "@/lib/trans-chap-camera";

export function useTransChapCameraEnabled(): boolean {
  const [enabled, setEnabled] = useState(false);

  useEffect(() => {
    setEnabled(isCameraScanningEnabled());
    return subscribeCameraScanningEnabled(setEnabled);
  }, []);

  return enabled;
}
