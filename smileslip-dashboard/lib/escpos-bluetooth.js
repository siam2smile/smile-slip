/**
 * เปิดลิ้นชักเงินสด + พิมพ์ใบเสร็จ ผ่านเครื่องพิมพ์ Bluetooth LE โดยตรงจากเบราว์เซอร์ (Web Bluetooth API)
 *
 * **ข้อจำกัดสำคัญที่ต้องรู้ก่อนใช้:**
 * - **ใช้ได้เฉพาะ Chrome บน Android เท่านั้น** — Safari/iOS บล็อก Web Bluetooth ไว้ในระดับเบราว์เซอร์
 *   เอง ไม่มีทางเลี่ยง (ตัดสินใจร่วมกับผู้ใช้แล้วว่ายอมรับได้ — ดู CLAUDE.md ข้อ 83 — iPhone ยังคง
 *   พิมพ์ใบเสร็จผ่าน AirPrint (window.print) ได้ปกติ แค่ไม่มีปุ่มพิมพ์/เปิดลิ้นชักผ่าน Bluetooth ตรง)
 * - **ไม่มีมาตรฐาน GATT UUID เดียวที่เครื่องพิมพ์ ESC/POS ทุกยี่ห้อใช้ร่วมกัน** — ผู้ใช้ต้องรองรับ
 *   ลูกค้าหลายรายที่มีเครื่องพิมพ์คนละรุ่น (ยืนยันจากผู้ใช้เอง: มี MP210 อยู่ แต่ลูกค้ารายอื่นอาจมี
 *   รุ่นอื่น ไม่อยากบังคับเปลี่ยน) — ไฟล์นี้จึงลองเชื่อมต่อด้วย UUID ที่พบบ่อยที่สุดในเครื่องพิมพ์
 *   ความร้อน Bluetooth ราคาถูกที่ขายทั่วไปก่อน (มักใช้ชิปเซ็ต BLE-UART คล้ายกันข้ามยี่ห้อ) แล้ว
 *   fallback ไปไล่หา characteristic ที่เขียนได้ตัวแรกถ้าไม่ตรงกับที่รู้จัก — **เป็น best-effort
 *   ไม่ใช่การรับประกันว่าใช้ได้กับทุกรุ่น** ต้องทดสอบกับเครื่องจริงของแต่ละร้านเอง
 * - **พิมพ์แบบรูปภาพ (raster bitmap) ไม่ใช่ข้อความ+codepage** — ตั้งใจเลือกวิธีนี้เพื่อเลี่ยงปัญหา
 *   การเข้ารหัสภาษาไทย (Thai codepage) ที่แตกต่างกันไปตามยี่ห้อเครื่องพิมพ์โดยสิ้นเชิง — วาดใบเสร็จ
 *   เป็นภาพ (canvas) แล้วแปลงเป็นจุดขาว-ดำส่งด้วยคำสั่ง ESC/POS `GS v 0` (raster bit image) ซึ่งเป็น
 *   มาตรฐานที่เครื่องพิมพ์ความร้อน ESC/POS แทบทุกยี่ห้อรองรับ ไม่ต้องพึ่งฟอนต์/ตารางอักขระของเครื่องพิมพ์เลย
 * - คำสั่งเปิดลิ้นชัก (`ESC p m t1 t2`) เป็นมาตรฐาน ESC/POS สากลที่เครื่องพิมพ์ใบเสร็จเกือบทุกยี่ห้อ
 *   รองรับ (ไม่ใช่จุดที่ต่างกันข้ามยี่ห้อ — ต่างกันแค่วิธีเชื่อมต่อ Bluetooth เท่านั้น)
 * - **ไม่ส่งคำสั่งตัดกระดาษ (`GS V`)** — เครื่องพิมพ์พกพา Bluetooth ราคาถูกส่วนใหญ่ (รวมถึงรุ่นแบบ
 *   MP210 ที่ผู้ใช้มี) ไม่มีใบมีดตัดกระดาษอัตโนมัติ ส่งคำสั่งตัดไปอาจพิมพ์ขยะ/error กับเครื่องที่ไม่รองรับ
 *   — จบด้วยการป้อนกระดาษเปล่าไม่กี่บรรทัดแทน ให้ดึงฉีกเองตามรอยตัดของม้วนกระดาษ
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
const ESC_INIT_BYTES = new Uint8Array([0x1b, 0x40]); // ESC @ — รีเซ็ตเครื่องพิมพ์ก่อนพิมพ์ทุกครั้ง
const FEED_LINES_BYTES = new Uint8Array([0x1b, 0x64, 0x04]); // ESC d 4 — ป้อนกระดาษ 4 บรรทัดหลังพิมพ์เสร็จ (ไม่มีคำสั่งตัด)

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
  cachedDevice = device; // จับคู่มือครั้งนี้ ใช้ต่อได้ทันทีโดยไม่ต้องรอ getDevices()
  return device;
}

// เก็บ BluetoothDevice ที่เชื่อมต่อสำเร็จล่าสุดไว้ในหน่วยความจำ (คงอยู่แค่ช่วงที่หน้าเว็บนี้ยังไม่
// รีโหลด) — เหตุผล: `navigator.bluetooth.getDevices()` (คืนอุปกรณ์ที่เคยได้สิทธิ์ถาวรไว้แล้ว) ไม่
// เสถียรเท่ากันในทุกรุ่น Chrome/Android (บางเครื่องคืนค่าว่างเปล่าแม้เคยจับคู่สำเร็จมาก่อน) ถ้าพึ่ง
// ฟังก์ชันนี้อย่างเดียวจะทำให้ต้องเปิดหน้าต่างเลือกเครื่องพิมพ์ใหม่ทุกครั้งที่กดพิมพ์ (บั๊กที่ผู้ใช้
// เจอจริง) — cache ตัวแปรนี้ไว้เป็นทางลัดอันดับแรกเสมอ ทำให้อย่างน้อยภายในเซสชันเดียวกัน (ไม่ปิด/
// รีเฟรชหน้า) กดพิมพ์กี่ครั้งก็ไม่ต้องเลือกอุปกรณ์ซ้ำอีกเลย
let cachedDevice = null;

async function connectGatt(device) {
  const server = await device.gatt.connect();
  const char = await findWritableCharacteristic(server);
  if (!char) {
    try { server.disconnect(); } catch {}
    throw new Error('หาช่องสำหรับส่งคำสั่งไปเครื่องพิมพ์ไม่เจอ — เครื่องพิมพ์รุ่นนี้อาจยังไม่รองรับ ลองเครื่องพิมพ์รุ่นอื่น หรือแจ้งยี่ห้อ/รุ่นเครื่องให้ทีมงานเพิ่มการรองรับ');
  }
  return { server, char };
}

/** เชื่อมต่อเครื่องพิมพ์ (ลองใช้อุปกรณ์ที่เพิ่งเชื่อมสำเร็จในเซสชันนี้ก่อน แล้วค่อย getDevices() แบบเงียบๆ สุดท้ายค่อยเปิด picker) คืน {server, char} — ใช้ร่วมกันทั้งเปิดลิ้นชักและพิมพ์ */
async function connectToPrinter() {
  if (cachedDevice) {
    try {
      return await connectGatt(cachedDevice);
    } catch {
      cachedDevice = null; // เชื่อมต่อซ้ำไม่ได้ (อุปกรณ์อาจถูกปิด/อยู่นอกระยะ) — ลองหาใหม่ด้านล่างแทน
    }
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

  const result = await connectGatt(device);
  cachedDevice = device;
  return result;
}

/** เขียนไบต์ไปเครื่องพิมพ์เป็นก้อนเล็กๆ (กัน BLE MTU เกิน/บัฟเฟอร์เครื่องพิมพ์ล้น) */
async function writeBytes(char, bytes, chunkSize = 180) {
  for (let i = 0; i < bytes.length; i += chunkSize) {
    const chunk = bytes.subarray(i, i + chunkSize);
    if (char.properties.writeWithoutResponse) {
      await char.writeValueWithoutResponse(chunk);
    } else {
      await char.writeValue(chunk);
    }
    await new Promise(r => setTimeout(r, 8));
  }
}

/** เปิดลิ้นชักเงินสด — ลองเชื่อมต่อเครื่องที่เคยจับคู่ไว้ก่อนแบบเงียบๆ ถ้าทำไม่ได้ค่อยเปิด picker ใหม่ */
export async function openCashDrawer() {
  if (!isBluetoothPrintSupported()) {
    throw new Error('รองรับเฉพาะ Chrome บน Android เท่านั้น (iPhone/เบราว์เซอร์อื่นเปิดลิ้นชักอัตโนมัติไม่ได้)');
  }
  const { server, char } = await connectToPrinter();
  try {
    await writeBytes(char, DRAWER_KICK_BYTES);
  } finally {
    try { server.disconnect(); } catch {}
  }
}

// ── วาดใบเสร็จเป็นภาพ (canvas) ────────────────────────────────────────────────

function wrapTextLines(ctx, text, maxWidth) {
  const str = String(text ?? '');
  if (!str) return [''];
  const lines = [];
  let current = '';
  for (const ch of str) {
    const test = current + ch;
    if (current && ctx.measureText(test).width > maxWidth) {
      lines.push(current);
      current = ch;
    } else {
      current = test;
    }
  }
  if (current) lines.push(current);
  return lines;
}

function loadImage(src) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('โหลดรูป QR ไม่สำเร็จ'));
    img.src = src;
  });
}

/**
 * วาดใบเสร็จลง canvas ตามข้อมูลที่ส่งมา (โครงเดียวกับ buildReceiptHtml ใน pos.js แค่วาดเป็นภาพ
 * แทน HTML) — คืน canvas ที่ตัดความสูงพอดีกับเนื้อหาจริงแล้ว (ไม่เหลือพื้นที่ขาวเปล่าด้านล่าง)
 * qrDataUrl (ถ้ามี — QR ไลน์ร้านค้าที่ปรับแต่งไว้ในหน้าตั้งค่า) วาดคั่นก่อนข้อความท้ายใบเสร็จ
 */
async function renderReceiptCanvas({ widthDots, shopInfo, docNo, dateStr, items, subtotal, vat, discount, total, payMethod, cashReceived, change, showVat, footerLines, qrDataUrl }) {
  const MAX_HEIGHT = 4000; // ผืนผ้าใบชั่วคราวสูงพอสำหรับบิลยาวๆ — ตัดเหลือแค่ส่วนที่ใช้จริงตอนท้าย
  const draft = document.createElement('canvas');
  draft.width = widthDots;
  draft.height = MAX_HEIGHT;
  const ctx = draft.getContext('2d');
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, draft.width, draft.height);
  ctx.fillStyle = '#000';

  const margin = Math.round(widthDots * 0.035);
  const contentWidth = widthDots - margin * 2;
  const baseSize = widthDots >= 500 ? 26 : 22;
  let y = 14;

  function setFont(size, bold) {
    ctx.font = `${bold ? 'bold ' : ''}${size}px sans-serif`;
  }
  function center(text, size = baseSize, bold = false, gap = 6) {
    setFont(size, bold);
    for (const line of wrapTextLines(ctx, text, contentWidth)) {
      y += size;
      ctx.textAlign = 'center';
      ctx.fillText(line, widthDots / 2, y);
    }
    y += gap;
  }
  function left(text, size = baseSize, bold = false, gap = 4) {
    setFont(size, bold);
    for (const line of wrapTextLines(ctx, text, contentWidth)) {
      y += size;
      ctx.textAlign = 'left';
      ctx.fillText(line, margin, y);
    }
    y += gap;
  }
  function row(leftText, rightText, size = baseSize, bold = false, gap = 4) {
    setFont(size, bold);
    y += size;
    ctx.textAlign = 'left';
    ctx.fillText(String(leftText), margin, y);
    ctx.textAlign = 'right';
    ctx.fillText(String(rightText), widthDots - margin, y);
    y += gap;
  }
  function dashedLine() {
    y += 8;
    ctx.save();
    ctx.setLineDash([4, 3]);
    ctx.beginPath();
    ctx.moveTo(margin, y);
    ctx.lineTo(widthDots - margin, y);
    ctx.strokeStyle = '#000';
    ctx.lineWidth = 2;
    ctx.stroke();
    ctx.restore();
    y += 10;
  }
  const money = n => Number(n || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });

  if (shopInfo?.shop_name) center(shopInfo.shop_name, baseSize + 4, true);
  if (shopInfo?.address) center(shopInfo.address, baseSize - 4);
  if (shopInfo?.tax_id) center('เลขผู้เสียภาษี ' + shopInfo.tax_id, baseSize - 4);
  if (shopInfo?.phone) center('โทร ' + shopInfo.phone, baseSize - 4);
  dashedLine();
  center('ใบเสร็จรับเงิน', baseSize + 2, true);
  left('เลขที่: ' + (docNo || ''));
  left('วันที่: ' + (dateStr || ''));
  dashedLine();

  for (const item of items || []) {
    left(item.name, baseSize, false, 2);
    row(`${item.qty} × ${Number(item.price).toLocaleString()}`, money(item.qty * item.price), baseSize - 2, false, 4);
    if (item.returned_qty !== undefined) {
      const returnedQty = parseInt(item.returned_qty) || 0;
      const borrowedQty = Math.max(0, item.qty - returnedQty);
      const parts = [];
      if (returnedQty > 0) parts.push(`↔️ แลกเปลี่ยน ${returnedQty} ${item.unit || ''}`);
      if (borrowedQty > 0) parts.push(`📦 ยืม ${borrowedQty} ${item.unit || ''} (ยังไม่คืน)`);
      if (parts.length) left(parts.join(' + '), baseSize - 6, false, 2);
    }
  }
  dashedLine();

  if (discount > 0) row('ส่วนลด', '-' + money(discount));
  if (showVat && vat > 0) {
    row('ยอดก่อน VAT', money(subtotal));
    row('ภาษีมูลค่าเพิ่ม 7%', money(vat));
  }
  row('ยอดรวมสุทธิ', money(total), baseSize + 2, true, 6);
  if (payMethod) left('วิธีชำระ: ' + payMethod);
  if (cashReceived > 0) row('รับเงิน', money(cashReceived));
  if (change > 0) row('เงินทอน', money(change));
  dashedLine();

  if (qrDataUrl) {
    try {
      const qrImg = await loadImage(qrDataUrl);
      const qrSize = Math.round(widthDots * 0.42);
      y += 4;
      ctx.drawImage(qrImg, (widthDots - qrSize) / 2, y, qrSize, qrSize);
      y += qrSize + 8;
    } catch {
      // โหลดรูป QR ไม่สำเร็จ — ข้ามไปพิมพ์ต่อโดยไม่มี QR แทนที่จะทำให้พิมพ์ทั้งใบไม่ได้เลย
    }
  }

  for (const line of footerLines || []) center(line, baseSize - 6, false, 2);
  y += 30; // เผื่อพื้นที่ก่อนดึงกระดาษ (ไม่มีคำสั่งตัดกระดาษ — ดูเหตุผลบนสุดของไฟล์)

  const finalHeight = Math.min(MAX_HEIGHT, Math.ceil(y));
  const final = document.createElement('canvas');
  final.width = widthDots;
  final.height = finalHeight;
  final.getContext('2d').drawImage(draft, 0, 0, widthDots, finalHeight, 0, 0, widthDots, finalHeight);
  return final;
}

/** แปลง canvas เป็นชุดคำสั่ง ESC/POS `GS v 0` (raster bit image) แบ่งเป็นแถบๆ กันบัฟเฟอร์เครื่องพิมพ์ล้น */
function canvasToRasterBands(canvas) {
  const width = canvas.width;
  const height = canvas.height;
  const widthBytes = Math.ceil(width / 8);
  const bandHeight = Math.max(8, Math.min(240, Math.floor(6000 / widthBytes)));
  const ctx = canvas.getContext('2d');
  const imageData = ctx.getImageData(0, 0, width, height).data;
  const bands = [];

  for (let bandStart = 0; bandStart < height; bandStart += bandHeight) {
    const h = Math.min(bandHeight, height - bandStart);
    const bytes = new Uint8Array(widthBytes * h);
    for (let row = 0; row < h; row++) {
      const srcY = bandStart + row;
      for (let col = 0; col < width; col++) {
        const idx = (srcY * width + col) * 4;
        const luminance = imageData[idx] * 0.299 + imageData[idx + 1] * 0.587 + imageData[idx + 2] * 0.114;
        const alpha = imageData[idx + 3];
        if (alpha > 64 && luminance < 160) {
          const byteIndex = row * widthBytes + (col >> 3);
          bytes[byteIndex] |= (1 << (7 - (col & 7)));
        }
      }
    }
    const header = new Uint8Array([
      0x1d, 0x76, 0x30, 0x00, // GS v 0 m(=0)
      widthBytes & 0xff, (widthBytes >> 8) & 0xff,
      h & 0xff, (h >> 8) & 0xff,
    ]);
    const command = new Uint8Array(header.length + bytes.length);
    command.set(header, 0);
    command.set(bytes, header.length);
    bands.push(command);
  }
  return bands;
}

/**
 * พิมพ์ใบเสร็จตรงผ่านเครื่องพิมพ์ Bluetooth (วาดเป็นภาพแล้วส่งด้วย ESC/POS raster — ดูหมายเหตุบนสุด
 * ของไฟล์) — receiptData: { paperSize:'58mm'|'80mm', shopInfo, docNo, dateStr, items, subtotal, vat,
 * discount, total, payMethod, cashReceived, change, showVat, footerLines:string[] }
 */
export async function printReceiptViaBluetooth(receiptData) {
  if (!isBluetoothPrintSupported()) {
    throw new Error('รองรับเฉพาะ Chrome บน Android เท่านั้น (iPhone พิมพ์ผ่านปุ่ม "พิมพ์ใบเสร็จ" ปกติแทนได้)');
  }
  const { server, char } = await connectToPrinter();
  try {
    const widthDots = receiptData.paperSize === '58mm' ? 384 : 576;
    const canvas = await renderReceiptCanvas({ ...receiptData, widthDots });
    const bands = canvasToRasterBands(canvas);
    await writeBytes(char, ESC_INIT_BYTES);
    for (const band of bands) {
      await writeBytes(char, band);
    }
    await writeBytes(char, FEED_LINES_BYTES);
  } finally {
    try { server.disconnect(); } catch {}
  }
}
