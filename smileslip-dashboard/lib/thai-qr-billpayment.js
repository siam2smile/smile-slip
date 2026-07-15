/**
 * Thai QR Payment — Bill Payment / Merchant Presented Mode (EMVCo Tag 30)
 *
 * ต่างจาก PromptPay ส่วนบุคคล (Tag 29, ไลบรารี `promptpay-qr`) ตรงที่ผูกกับ "Biller ID"
 * ที่ธนาคารออกให้นิติบุคคล/ร้านค้า แทนเบอร์โทร/เลขนิติบุคคลส่วนตัว — สแกนจ่ายได้ทุกธนาคาร
 * (มาตรฐานเดียวกับที่เห็นบน QR "รับเงินได้จากทุกธนาคาร" ของ SCB/KBank ฯลฯ)
 *
 * Envelope (00/01/53/54/58/63) เหมือน Tag 29 ทุกประการ ต่างแค่เนื้อหาใน Tag 30
 * และ AID เป็น Bill Payment (A000000677010112) แทน PromptPay ส่วนบุคคล (...111)
 */
const crc = require('crc');

const AID_BILL_PAYMENT = 'A000000677010112';

function f(id, value) {
  if (!value) return '';
  const s = String(value);
  return `${id}${String(s.length).padStart(2, '0')}${s}`;
}

function generateBillPaymentPayload(billerId, options = {}) {
  const cleanBiller = String(billerId || '').replace(/\D/g, '');
  if (!cleanBiller) throw new Error('Missing Biller ID');

  const { amount, ref1 = '', ref2 = '' } = options;

  const merchantInfo = [
    f('00', AID_BILL_PAYMENT),
    f('01', cleanBiller),
    ref1 ? f('02', String(ref1).slice(0, 20)) : '',
    ref2 ? f('03', String(ref2).slice(0, 20)) : '',
  ].join('');

  const numAmount = parseFloat(amount) || 0;

  const parts = [
    f('00', '01'),                                            // Payload Format Indicator
    f('01', numAmount ? '12' : '11'),                          // Point of Initiation Method
    f('30', merchantInfo),                                     // Merchant Account Info — Bill Payment
    f('53', '764'),                                            // Transaction Currency (THB)
    numAmount ? f('54', numAmount.toFixed(2)) : '',            // Transaction Amount
    f('58', 'TH'),                                             // Country Code
  ].join('');

  // CRC-16/CCITT-FALSE (poly 0x1021, init 0xFFFF) — เดียวกับที่ promptpay-qr ใช้กับ Tag 29
  const dataToCrc = parts + '6304';
  const checksum = crc.crc16xmodem(dataToCrc, 0xffff).toString(16).toUpperCase().padStart(4, '0');
  return parts + '6304' + checksum;
}

module.exports = { generateBillPaymentPayload };
