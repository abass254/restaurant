"use client";

import { useState } from "react";
import { useThermalPrinter } from "@/lib/thermal-printer";
import { showError, toastSuccess } from "@/lib/alerts";

interface PosPrinterModalProps {
  onClose: () => void;
}

export function PosPrinterModal({ onClose }: PosPrinterModalProps) {
  const printer = useThermalPrinter();
  const [busy, setBusy] = useState(false);
  const [testing, setTesting] = useState(false);

  const handleConnectBluetooth = async () => {
    setBusy(true);
    try {
      const ok = await printer.connectBluetooth();
      if (ok) {
        await toastSuccess(`Connected to ${printer.name || "Bluetooth printer"}`);
      }
    } catch (err: any) {
      await showError("Bluetooth printer error", err?.message || "Could not connect to Bluetooth printer.");
    } finally {
      setBusy(false);
    }
  };

  const handleConnectSerial = async () => {
    setBusy(true);
    try {
      const ok = await printer.connectSerial();
      if (ok) {
        await toastSuccess(`Connected to ${printer.name || "USB/Serial printer"}`);
      }
    } catch (err: any) {
      await showError("USB printer error", err?.message || "Could not connect to USB/Serial printer.");
    } finally {
      setBusy(false);
    }
  };

  const handleTestPrint = async () => {
    setTesting(true);
    try {
      const ok = await printer.printTestSlip();
      if (ok) {
        await toastSuccess("Test slip sent to printer");
      } else {
        await showError("Printer error", "Failed to print test slip. Check paper and connection.");
      }
    } catch (err: any) {
      await showError("Printer error", err?.message || "Failed to print test slip.");
    } finally {
      setTesting(false);
    }
  };

  const handleDisconnect = async () => {
    try {
      await printer.disconnect();
      await toastSuccess("Printer disconnected");
    } catch (err: any) {
      await showError("Disconnect error", err?.message || "Could not disconnect printer.");
    }
  };

  return (
    <div className="pos-printer-modal-overlay" onClick={onClose}>
      <div
        className="pos-printer-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="pos-printer-title"
        onClick={(e) => e.stopPropagation()}
      >
        <header className="pos-printer-modal__head">
          <div className="pos-printer-modal__title-wrap">
            <i className="fa-solid fa-print pos-printer-modal__icon" aria-hidden="true" />
            <div>
              <h3 id="pos-printer-title">Thermal Receipt Printer</h3>
              <p>58mm / 80mm ESC/POS wireless &amp; USB direct printing</p>
            </div>
          </div>
          <button
            type="button"
            className="pos-printer-modal__close"
            onClick={onClose}
            aria-label="Close printer settings"
          >
            <i className="fa-solid fa-xmark" aria-hidden="true" />
          </button>
        </header>

        <div className="pos-printer-modal__body">
          {printer.isConnected ? (
            <div className="pos-printer-card is-connected">
              <div className="pos-printer-card__status">
                <span className="pos-printer-dot is-connected" />
                <div className="pos-printer-card__info">
                  <span className="pos-printer-card__label">Active Printer</span>
                  <strong className="pos-printer-card__name">
                    {printer.name || "Thermal Printer"}
                  </strong>
                  <span className="pos-printer-card__type">
                    Connection: {printer.type === "bluetooth" ? "Bluetooth Wireless" : "USB / Serial Port"}
                  </span>
                </div>
              </div>

              <div className="pos-printer-card__options">
                <label className="pos-printer-opt-label">Paper Width:</label>
                <div className="pos-printer-width-toggle">
                  <button
                    type="button"
                    className={printer.paperWidth === 58 ? "is-active" : ""}
                    onClick={() => printer.setPaperWidth(58)}
                  >
                    58 mm (Standard)
                  </button>
                  <button
                    type="button"
                    className={printer.paperWidth === 80 ? "is-active" : ""}
                    onClick={() => printer.setPaperWidth(80)}
                  >
                    80 mm (Wide)
                  </button>
                </div>
              </div>

              <div className="pos-printer-card__actions">
                <button
                  type="button"
                  className="pos-printer-btn pos-printer-btn--test"
                  onClick={handleTestPrint}
                  disabled={testing || busy}
                >
                  <i
                    className={`fa-solid ${testing ? "fa-spinner fa-spin" : "fa-file-lines"}`}
                    aria-hidden="true"
                  />
                  <span>{testing ? "Printing…" : "Print Test Slip"}</span>
                </button>

                <button
                  type="button"
                  className="pos-printer-btn pos-printer-btn--disconnect"
                  onClick={handleDisconnect}
                  disabled={busy}
                >
                  <i className="fa-solid fa-unlink" aria-hidden="true" />
                  <span>Disconnect</span>
                </button>
              </div>
            </div>
          ) : (
            <div className="pos-printer-card is-disconnected">
              <div className="pos-printer-card__status">
                <span className="pos-printer-dot is-disconnected" />
                <div className="pos-printer-card__info">
                  <span className="pos-printer-card__label">Printer Status</span>
                  <strong className="pos-printer-card__name">No printer connected</strong>
                  <span className="pos-printer-card__hint">
                    When Auto-print is enabled with no printer connected, DukAI displays the full in-built receipt page automatically.
                  </span>
                </div>
              </div>

              <div className="pos-printer-connect-actions">
                <button
                  type="button"
                  className="pos-printer-connect-option"
                  onClick={handleConnectBluetooth}
                  disabled={busy || !printer.isBluetoothSupported}
                >
                  <div className="pos-printer-connect-option__icon is-bt">
                    <i className="fa-brands fa-bluetooth-b" aria-hidden="true" />
                  </div>
                  <div className="pos-printer-connect-option__text">
                    <strong>Connect Bluetooth Printer</strong>
                    <span>Pair wireless 58mm / 80mm mini receipt printer</span>
                  </div>
                  <i className="fa-solid fa-chevron-right" aria-hidden="true" />
                </button>

                <button
                  type="button"
                  className="pos-printer-connect-option"
                  onClick={handleConnectSerial}
                  disabled={busy || !printer.isSerialSupported}
                >
                  <div className="pos-printer-connect-option__icon is-usb">
                    <i className="fa-solid fa-usb" aria-hidden="true" />
                  </div>
                  <div className="pos-printer-connect-option__text">
                    <strong>Connect USB / Cable Printer</strong>
                    <span>Connect thermal printer via USB cable or COM port</span>
                  </div>
                  <i className="fa-solid fa-chevron-right" aria-hidden="true" />
                </button>
              </div>

              {!printer.isBluetoothSupported && !printer.isSerialSupported && (
                <p className="pos-printer-warning">
                  <i className="fa-solid fa-triangle-exclamation" aria-hidden="true" />
                  Web Bluetooth &amp; Web Serial are available in Chrome, Edge, and Android browsers. DukAI will automatically show the in-built print page after sales.
                </p>
              )}
            </div>
          )}

          <div className="pos-printer-modal__footer-note">
            <i className="fa-solid fa-circle-info" aria-hidden="true" />
            <span>
              <strong>Auto-print workflow:</strong> When enabled, sales print instantly to your connected thermal printer. If disconnected or offline, DukAI automatically opens the in-built receipt page.
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}
