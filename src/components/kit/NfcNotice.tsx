"use client";

import { Capacitor } from "@capacitor/core";
import { openNfcSettings, type NfcAvailability } from "@/lib/nfc";

/** Is this an app build that has the NFC plugin at all? Older builds don't. */
function appHasNfcPlugin(): boolean {
  const platform = Capacitor.getPlatform();
  if (platform === "ios") return Capacitor.isPluginAvailable("HikingNfc");
  if (platform === "android") return Capacitor.isPluginAvailable("CapacitorNfc");
  return false;
}

/** Why this phone can't scan, and the fix where there is one. Nothing when it can. */
export function NfcNotice({ nfc, native }: { nfc: NfcAvailability | null; native: boolean }) {
  if (!nfc || nfc.support !== "none") return null;
  let text: string;
  if (nfc.disabled) text = "NFC is switched off on this phone.";
  else if (native && !appHasNfcPlugin()) text = "Update the app to scan tags.";
  else if (native) text = "This phone can't read NFC tags.";
  else text = "This phone can't read NFC tags. On Android, open the club site in Chrome to scan.";
  return (
    <div className="kit-nfc-notice" role="status">
      <span>{text} You can still find an item by its asset code.</span>
      {nfc.disabled && (
        <button type="button" className="kit-btn" onClick={() => void openNfcSettings()}>
          Open NFC settings
        </button>
      )}
    </div>
  );
}
