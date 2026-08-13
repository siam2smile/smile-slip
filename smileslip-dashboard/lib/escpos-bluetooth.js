/**
 * เปิดลิ้นชักเงินสดผ่านเครื่องพิมพ์ใบเสร็จ Bluetooth LE โดยตรงจากเบราว์เซอร์ (Web Bluetooth API)
 *
 * **ข้อจำกัดสำคัญที่ต้องรู้ก่อนใช้:**
 * - **ใช้ได้เฉพาะ Chrome บน Android เท่านั้น** — Safari/iOS บล็อก Web Bluetooth ไว้ในระดับเบราว์เซอร์
 *   เอง ไม่มีทางเลี่ยง (ตัดสินใจร่วมกับผู้ใช้แล้วว่ายอมรับได้ — ดู CLAUDE.md ข้อ 83 — iPhone ยังคง
 *   พิมพ์ใบเสร็จผ่าน AirPrint ได้ปกติ แค่ไม่มีปุ่มเปิดลิ้นชักอัตโนมัติ)
 * - **ไม่มีมาตรฐาน GATT UUID เดียวที่เครื่องพิมพ์ ESC/POS ทุกยี่ห้อใช้ร่วมกัน** — ผู้ใช้ต้องรองรับ
 *   ลูกค้าหลายรายที่มีเครื่องพิมพ์คนละรุ่น (ยืนยันจากผู้ใช้เอง: มี MP210 อยู่ แต่ลูกค้ารายอื่นอาจมี
 *   รุ่นอื่น ไม่อยากบังคับเปลี่ยน) — ไฟล์นี้จึงลองเชื่อมต่อด้วย UUID ที่พบบ่อยที่สุดในเครื่องพิมพ์
 *   ความร้อน Bluetooth ราคาถูกที่ขายทั่วไปก่อน (มักใช้ชิปเซ็ต BLE-UART คล้ายกันข้ามยี่ห้อ) แล้ว
 *   fallback ไปไล่หา characteristic ที่เขียนได้ตัวแรกถ้าไม่ตรงกับที่รู้จัก — **เป็น best-effort
 *   ไม่ใช่การรับประกันว่าใช้ได้กับทุกรุ่น** ต้องทดสอบกับเครื่องจริงของแต่ละร้านเอง
 * - คำสั่งเปิดลิ้นชัก (`ESC p m t1 t2`) เป็นมาตรฐาน ESC/POS สากลที่เครื่องพิมพ์ใบเสร็จเกือบทุกยี่ห้อ
 *   รองรับ (ไม่ใช่จุดที่ต่างกันข้ามยี่ห้อ — ต่างกันแค่วิธีเชื่อมต่อ Bluetooth เท่านั้น)
 */

// GATT service/characteristic UUID ที่พบบ่อยที่สุดในเครื่องพิมพ์ความร้อน Bluetooth LE ราคาถูก —
// เรียงจากที่พบบ่อยที่สุดก่อน — ลองทีละตัวจนกว่าจะเจอตัวที่เครื่องพิมพ์จริงมีอยู่
const KNOWN_PRINTER_SERVICES = [
  { service: '000018f0-0000-1000-8000-00805f9b34fb', write: '00002af1-0000-1000-8000-00805f9b34fb' }, // "BLE Printer Service" ทั่วไป — พบมากในเครื่องพิมพ์ white-label ราคาถูก
  { service: '0000ff00-0000-1000-8000-00805f9b34fb', write: '0000ff02-0000-1000-8000-00805f9b34fb' }, // UART-like pattern ที่พบบ่อยเช่นกัน
  { service: '49535343-fe7d-4ae5-8fa9-9fafd205e455', write: '49535343-8841-43f4-a8d4-ecbe34729bb3' }, // Microchip Transparent UART — พบในโมดูล BLE cheap หลายเจ้า
  { service: '6e400001-b5a3-f393-e0a9-e50e24dcca9e', write: '6e400002-b5a3-f393-e0a9-e50e24dcca9e' }, // Nordic UART Service (NUS) — มาตรฐานเปิดที่หลายเจ้านำไปใช้
];

// ESC/POS: ESC p m t1 t2 — สั่งเปิดลิ้นชักเงินสด (m=0 = พิน 2 ซึ่งเป็นพินที่นิยมต่อสายลิ้นชักที่สุด)
const DRAWER_KICK_BYTES = new Uint8Array([0x1b, 0x70, 0x00, 0x19, 0xfa]);

const STORAGE_KEY = 'pos_bt_printer_device_id';

export function isBluetoothPrintSupported() {
  return typeof navigator !== 'undefined' && !!navigator.bluetooth;
}

async function findWritableCharacteristic(server) {
  for (const candidate of KNOWN_PRINTER_SERVICES) {
    try {
      const service = await server.getPrimaryService(candidate.service);
      const char = await service.getCharacteristic(candidate.write);
      return char;
    } catch {
      // ไม่มี service/characteristic นี้ในเครื่องพิมพ์รุ่นนี้ — ลองตัวถัดไป
    }
  }
  // fallback — ไล่ดูทุก service ของอุปกรณ์ หา characteristic ที่เขียนได้ตัวแรก (เผื่อเป็นรุ่น/ยี่ห้อ
  // ที่ไม่ตรงกับรายการที่รู้จักด้านบนเลย) — เป็นความพยายามสุดท้ายก่อนจะถือว่าใช้ไม่ได้
  try {
    const services = await server.getPrimaryServices();
    for (const service of services) {
      const chars = await service.getCharacteristics();
      const writable = chars.find(c => c.properties.write || c.properties.writeWithoutResponse);
      if (writable) return writable;
    }
  } catch {
    // ไม่มีทางเลือกอื่นแล้ว
  }
  return null;
}

/** เปิด picker ของระบบให้ผู้ใช้เลือกเครื่องพิมพ์ที่จับคู่ Bluetooth ไว้แล้ว (ไม่ hardcode ยี่ห้อ/รุ่น) */
export async function pairPrinter() {
  if (!isBluetoothPrintSupported()) {
    throw new Error('เบราว์เซอร์นี้ไม่รองรับ Web Bluetooth — ใช้ได้เฉพาะ Chrome บน Android เท่านั้น');
  }
  const device = await navigator.bluetooth.requestDevice({
    acceptAllDevices: true,
    optionalServices: KNOWN_PRINTER_SERVICES.map(c => c.service),
  });
  try { localStorage.setItem(STORAGE_KEY, device.id); } catch {}
  return device;
}

/** เปิดลิ้นชักเงินสด — ลองเชื่อมต่อเครื่องที่เคยจับคู่ไว้ก่อนแบบเงียบๆ ถ้าทำไม่ได้ค่อยเปิด picker ใหม่ */
export async function openCashDrawer() {
  if (!isBluetoothPrintSupported()) {
    throw new Error('รองรับเฉพาะ Chrome บน Android เท่านั้น (iPhone/เบราว์เซอร์อื่นเปิดลิ้นชักอัตโนมัติไม่ได้)');
  }

  let device = null;
  try {
    const savedId = localStorage.getItem(STORAGE_KEY);
    if (savedId && navigator.bluetooth.getDevices) {
      const known = await navigator.bluetooth.getDevices();
      device = known.find(d => d.id === savedId) || null;
    }
  } catch {
    // เบราว์เซอร์รุ่นเก่าไม่รองรับ getDevices() — ข้ามไปเปิด picker แทน
  }

  if (!device) device = await pairPrinter();

  const server = await device.gatt.connect();
  try {
    const char = await findWritableCharacteristic(server);
    if (!char) {
      throw new Error('หาช่องสำหรับส่งคำสั่งไปเครื่องพิมพ์ไม่เจอ — เครื่องพิมพ์รุ่นนี้อาจยังไม่รองรับ ลองเครื่องพิมพ์รุ่นอื่น หรือแจ้งยี่ห้อ/รุ่นเครื่องให้ทีมงานเพิ่มการรองรับ');
    }
    if (char.properties.writeWithoutResponse) {
      await char.writeValueWithoutResponse(DRAWER_KICK_BYTES);
    } else {
      await char.writeValue(DRAWER_KICK_BYTES);
    }
  } finally {
    try { server.disconnect(); } catch {}
  }
}
