/**
 * Web Bluetooth and Web Serial thermal printer driver for Dukai Merchants.
 * Generates ESC/POS byte streams for 58mm / 80mm receipt printers and manages
 * direct wireless/wired printer connections.
 */

import { useEffect, useState } from "react";
import {
  formatKesDigits,
  isTransChapReceiptPaid,
  transChapReceiptPayLabel,
  type TransChapReceipt,
} from "./trans-chap-receipt";
import { formatNairobiDateTime } from "./nairobi-time";

export type ThermalPrinterType = "bluetooth" | "serial";

export type ThermalPrinterState = {
  isConnected: boolean;
  type: ThermalPrinterType | null;
  name: string | null;
  paperWidth: 58 | 80;
};

type StateListener = (state: ThermalPrinterState) => void;

const PRINTER_STORAGE_KEY = "pos:thermal_printer_name";
const PRINTER_TYPE_KEY = "pos:thermal_printer_type";
const PRINTER_WIDTH_KEY = "pos:thermal_printer_width";

// Standard Bluetooth GATT services used by ESC/POS printers
const BLUETOOTH_PRINTER_SERVICES = [
  "000018f0-0000-1000-8000-00805f9b34fb",
  "e7810a71-73ae-499d-8c15-faa9aef0c3f2",
  "49535343-fe7d-4ae5-8fa9-9fafd205e455",
  0xffe0,
  0x18f0,
];

class ThermalPrinterManager {
  private state: ThermalPrinterState = {
    isConnected: false,
    type: null,
    name: null,
    paperWidth: 58,
  };

  private listeners = new Set<StateListener>();
  private bluetoothDevice: any = null;
  private bluetoothCharacteristic: any = null;
  private serialPort: any = null;

  constructor() {
    if (typeof window !== "undefined") {
      try {
        const savedName = localStorage.getItem(PRINTER_STORAGE_KEY);
        const savedType = localStorage.getItem(PRINTER_TYPE_KEY) as ThermalPrinterType | null;
        const savedWidth = Number(localStorage.getItem(PRINTER_WIDTH_KEY)) === 80 ? 80 : 58;
        this.state.name = savedName;
        this.state.type = savedType;
        this.state.paperWidth = savedWidth;
      } catch {
        /* ignore storage error */
      }
    }
  }

  public getState(): ThermalPrinterState {
    return { ...this.state };
  }

  public subscribe(listener: StateListener): () => void {
    this.listeners.add(listener);
    listener(this.getState());
    return () => {
      this.listeners.delete(listener);
    };
  }

  private notify() {
    const s = this.getState();
    this.listeners.forEach((fn) => fn(s));
  }

  public setPaperWidth(width: 58 | 80) {
    this.state.paperWidth = width;
    try {
      localStorage.setItem(PRINTER_WIDTH_KEY, String(width));
    } catch {
      /* ignore */
    }
    this.notify();
  }

  public isBluetoothSupported(): boolean {
    return typeof navigator !== "undefined" && "bluetooth" in navigator;
  }

  public isSerialSupported(): boolean {
    return typeof navigator !== "undefined" && "serial" in navigator;
  }

  /**
   * Connect via Web Bluetooth to an ESC/POS printer.
   */
  public async connectBluetooth(): Promise<boolean> {
    if (!this.isBluetoothSupported()) {
      throw new Error("Web Bluetooth is not supported in this browser. Use Chrome or Edge.");
    }

    try {
      const nav = navigator as any;
      const device = await nav.bluetooth.requestDevice({
        acceptAllDevices: true,
        optionalServices: BLUETOOTH_PRINTER_SERVICES,
      });

      if (!device) return false;

      const onDisconnect = () => {
        this.bluetoothDevice = null;
        this.bluetoothCharacteristic = null;
        this.state.isConnected = false;
        this.notify();
      };

      device.addEventListener("gattserverdisconnected", onDisconnect);

      const server = await device.gatt.connect();

      // Find writable characteristic across known services
      let targetChar: any = null;
      for (const serviceUuid of BLUETOOTH_PRINTER_SERVICES) {
        try {
          const service = await server.getPrimaryService(serviceUuid);
          const chars = await service.getCharacteristics();
          for (const c of chars) {
            if (c.properties.write || c.properties.writeWithoutResponse) {
              targetChar = c;
              break;
            }
          }
          if (targetChar) break;
        } catch {
          continue;
        }
      }

      // Fallback: search all primary services if specific service lookup failed
      if (!targetChar) {
        try {
          const services = await server.getPrimaryServices();
          for (const s of services) {
            try {
              const chars = await s.getCharacteristics();
              for (const c of chars) {
                if (c.properties.write || c.properties.writeWithoutResponse) {
                  targetChar = c;
                  break;
                }
              }
              if (targetChar) break;
            } catch {
              continue;
            }
          }
        } catch {
          /* ignore */
        }
      }

      if (!targetChar) {
        throw new Error("Could not find a writable print channel on this Bluetooth device.");
      }

      this.bluetoothDevice = device;
      this.bluetoothCharacteristic = targetChar;
      this.state.isConnected = true;
      this.state.type = "bluetooth";
      this.state.name = device.name || "Bluetooth Printer";

      try {
        localStorage.setItem(PRINTER_STORAGE_KEY, this.state.name || "Bluetooth Printer");
        localStorage.setItem(PRINTER_TYPE_KEY, "bluetooth");
      } catch {
        /* ignore */
      }

      this.notify();
      return true;
    } catch (err: any) {
      if (err.name === "NotFoundError") {
        // User cancelled selection
        return false;
      }
      throw err;
    }
  }

  /**
   * Connect via Web Serial (USB/COM cable connection).
   */
  public async connectSerial(baudRate = 9600): Promise<boolean> {
    if (!this.isSerialSupported()) {
      throw new Error("Web Serial is not supported in this browser. Use Chrome or Edge.");
    }

    try {
      const nav = navigator as any;
      const port = await nav.serial.requestPort();
      if (!port) return false;

      await port.open({ baudRate });

      this.serialPort = port;
      this.state.isConnected = true;
      this.state.type = "serial";
      this.state.name = "USB / Serial Printer";

      try {
        localStorage.setItem(PRINTER_STORAGE_KEY, this.state.name);
        localStorage.setItem(PRINTER_TYPE_KEY, "serial");
      } catch {
        /* ignore */
      }

      this.notify();
      return true;
    } catch (err: any) {
      if (err.name === "NotFoundError") {
        // User cancelled selection
        return false;
      }
      throw err;
    }
  }

  /**
   * Disconnect the current printer.
   */
  public async disconnect(): Promise<void> {
    if (this.bluetoothDevice?.gatt?.connected) {
      try {
        this.bluetoothDevice.gatt.disconnect();
      } catch {
        /* ignore */
      }
    }
    this.bluetoothDevice = null;
    this.bluetoothCharacteristic = null;

    if (this.serialPort) {
      try {
        await this.serialPort.close();
      } catch {
        /* ignore */
      }
      this.serialPort = null;
    }

    this.state.isConnected = false;
    this.notify();
  }

  /**
   * Send raw byte buffer to connected printer.
   */
  public async sendRaw(bytes: Uint8Array): Promise<boolean> {
    if (!this.state.isConnected) return false;

    if (this.state.type === "bluetooth" && this.bluetoothCharacteristic) {
      // Chunk into 50-byte packets for BLE MTU limits
      const CHUNK_SIZE = 50;
      for (let i = 0; i < bytes.length; i += CHUNK_SIZE) {
        const chunk = bytes.slice(i, i + CHUNK_SIZE);
        if (this.bluetoothCharacteristic.properties.writeWithoutResponse) {
          await this.bluetoothCharacteristic.writeValueWithoutResponse(chunk);
        } else {
          await this.bluetoothCharacteristic.writeValue(chunk);
        }
        await new Promise((resolve) => setTimeout(resolve, 15));
      }
      return true;
    }

    if (this.state.type === "serial" && this.serialPort?.writable) {
      const writer = this.serialPort.writable.getWriter();
      try {
        await writer.write(bytes);
        return true;
      } finally {
        writer.releaseLock();
      }
    }

    return false;
  }

  /**
   * Print a TransChapReceipt directly to thermal printer.
   */
  public async printReceipt(receipt: TransChapReceipt): Promise<{ success: boolean; error?: string }> {
    if (!this.state.isConnected) {
      return { success: false, error: "No thermal printer connected." };
    }

    try {
      const bytes = generateEscPosReceipt(receipt, this.state.paperWidth);
      const ok = await this.sendRaw(bytes);
      return { success: ok };
    } catch (err: any) {
      return { success: false, error: err?.message || "Failed to send data to printer." };
    }
  }

  /**
   * Print a quick alignment test slip.
   */
  public async printTestSlip(): Promise<boolean> {
    if (!this.state.isConnected) return false;
    const bytes = generateEscPosTestSlip(this.state.name || "Thermal Printer", this.state.paperWidth);
    return await this.sendRaw(bytes);
  }
}

/**
 * Singleton instance.
 */
export const thermalPrinter = new ThermalPrinterManager();

export function useThermalPrinter() {
  const [state, setState] = useState<ThermalPrinterState>(() => thermalPrinter.getState());

  useEffect(() => {
    return thermalPrinter.subscribe(setState);
  }, []);

  return {
    ...state,
    connectBluetooth: () => thermalPrinter.connectBluetooth(),
    connectSerial: (baudRate?: number) => thermalPrinter.connectSerial(baudRate),
    disconnect: () => thermalPrinter.disconnect(),
    setPaperWidth: (w: 58 | 80) => thermalPrinter.setPaperWidth(w),
    printReceipt: (r: TransChapReceipt) => thermalPrinter.printReceipt(r),
    printTestSlip: () => thermalPrinter.printTestSlip(),
    isBluetoothSupported: thermalPrinter.isBluetoothSupported(),
    isSerialSupported: thermalPrinter.isSerialSupported(),
  };
}

// ESC/POS Command Byte Constants
const ESC = 0x1b;
const GS = 0x1d;
const LF = 0x0a;

/**
 * Builds standard ESC/POS bytes for a receipt.
 */
export function generateEscPosReceipt(
  receipt: TransChapReceipt,
  widthCols: 58 | 80 = 58,
): Uint8Array {
  const cols = widthCols === 80 ? 42 : 32;
  const parts: number[] = [];

  const add = (...bytes: number[]) => parts.push(...bytes);
  const addText = (text: string) => {
    const encoder = new TextEncoder();
    const encoded = encoder.encode(text);
    for (let i = 0; i < encoded.length; i++) {
      parts.push(encoded[i]);
    }
  };
  const addLine = (text = "") => {
    addText(text);
    add(LF);
  };

  const divider = (char = "-") => addLine(char.repeat(cols));

  const padRow = (left: string, right: string) => {
    const maxLeft = cols - right.length - 1;
    let l = left;
    if (l.length > maxLeft) {
      l = l.substring(0, maxLeft);
    }
    const spaces = Math.max(1, cols - l.length - right.length);
    addLine(l + " ".repeat(spaces) + right);
  };

  // Initialize printer
  add(ESC, 0x40);

  // Center alignment
  add(ESC, 0x61, 0x01);

  // Double size & Bold for Shop Name
  add(ESC, 0x45, 0x01);
  add(GS, 0x21, 0x11);
  addLine(receipt.shopName || "DukAI Merchant");

  // Normal text size
  add(GS, 0x21, 0x00);
  add(ESC, 0x45, 0x00);
  addLine("SALES RECEIPT");
  add(LF);

  divider("=");

  // Left alignment for receipt info
  add(ESC, 0x61, 0x00);
  padRow(`Order #${receipt.orderNumber}`, formatNairobiDateTime(receipt.paidAt) || "");
  padRow("Customer:", receipt.customerName?.trim() || "Walk-in");
  padRow("Payment:", transChapReceiptPayLabel(receipt));

  if (receipt.mpesaReceiptNumber) {
    padRow("M-PESA Ref:", receipt.mpesaReceiptNumber);
  }

  const isPaid = isTransChapReceiptPaid(receipt);
  padRow("Status:", isPaid ? "PAID" : receipt.payMode === "credit" ? "ON CREDIT" : "PENDING");

  divider("-");

  // Items table
  addLine("ITEM".padEnd(cols - 12) + "QTY".padStart(4) + "TOTAL".padStart(8));
  divider("-");

  const lines = receipt.items?.length
    ? receipt.items
    : [{ name: receipt.productName, quantity: 1, unitPrice: receipt.amount, lineTotal: receipt.amount }];

  for (const item of lines) {
    const name = item.name || "Item";
    const qtyStr = String(item.quantity);
    const totalStr = formatKesDigits(item.lineTotal);

    if (name.length <= cols - 13) {
      const spaces = cols - name.length - qtyStr.length - totalStr.length;
      addLine(name + " ".repeat(Math.max(1, spaces - 4)) + qtyStr.padStart(4) + totalStr.padStart(8));
    } else {
      addLine(name);
      const rightPart = `${qtyStr} x ${formatKesDigits(item.unitPrice)}`.padStart(cols - totalStr.length - 1);
      addLine(rightPart + " " + totalStr);
    }

    if (item.modifiers?.length) {
      for (const mod of item.modifiers) {
        const modName = `+ ${mod.name}`;
        const modPrice = mod.price > 0 ? formatKesDigits(mod.price) : "";
        padRow(`  ${modName}`, modPrice);
      }
    }
  }

  divider("-");

  // Financial totals
  padRow("Subtotal:", `Ksh ${formatKesDigits(receipt.amount)}`);

  if (receipt.tax && receipt.tax > 0) {
    padRow("Tax (16%):", `Ksh ${formatKesDigits(receipt.tax)}`);
  }

  divider("=");

  // Grand Total in Bold & Double Height
  add(ESC, 0x45, 0x01);
  add(GS, 0x21, 0x01); // double height
  padRow("TOTAL:", `Ksh ${formatKesDigits(receipt.amount)}`);
  add(GS, 0x21, 0x00);
  add(ESC, 0x45, 0x00);

  divider("=");

  // Center alignment for footer
  add(ESC, 0x61, 0x01);
  add(LF);
  addLine("Thank you for your business!");
  addLine("Powered by DukAI");
  add(LF);

  // Feed 4 lines and cut paper
  add(ESC, 0x64, 0x04);
  add(GS, 0x56, 0x41, 0x00);

  return new Uint8Array(parts);
}

/**
 * Builds a test print slip to verify printer connection and roll width.
 */
function generateEscPosTestSlip(printerName: string, widthCols: 58 | 80): Uint8Array {
  const cols = widthCols === 80 ? 42 : 32;
  const parts: number[] = [];

  const add = (...bytes: number[]) => parts.push(...bytes);
  const addText = (text: string) => {
    const encoder = new TextEncoder();
    const encoded = encoder.encode(text);
    for (let i = 0; i < encoded.length; i++) {
      parts.push(encoded[i]);
    }
  };
  const addLine = (text = "") => {
    addText(text);
    add(LF);
  };

  add(ESC, 0x40);
  add(ESC, 0x61, 0x01);
  add(ESC, 0x45, 0x01);
  add(GS, 0x21, 0x11);
  addLine("PRINTER TEST");
  add(GS, 0x21, 0x00);
  add(ESC, 0x45, 0x00);
  addLine("-".repeat(cols));
  addLine(`Connected to: ${printerName}`);
  addLine(`Width: ${widthCols}mm (${cols} cols)`);
  addLine(new Date().toLocaleTimeString());
  addLine("-".repeat(cols));
  addLine("Ready for auto-print receipts!");
  add(LF);
  add(ESC, 0x64, 0x04);
  add(GS, 0x56, 0x41, 0x00);

  return new Uint8Array(parts);
}
