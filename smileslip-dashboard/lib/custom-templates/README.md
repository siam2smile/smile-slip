# รายงาน Excel กำหนดเองเฉพาะร้าน (Isolated Custom Templates)

โฟลเดอร์นี้เตรียมไว้สำหรับร้านค้ารายพิเศษ (Business/Enterprise) ที่ต้องการรูปแบบรายงาน Excel
ที่ไม่ตรงกับ 3 แม่แบบสำเร็จรูป (`vat30`/`sales_by_branch`/`cyclical_inventory`) ใน `api/pos/export.js`
— ณ วันที่เขียน (2026-07-21) ยังไม่มีร้านไหนต้องใช้จริง เตรียมโครงสร้างไว้รอเท่านั้น

## วิธีสร้างรายงานกำหนดเองให้ร้านหนึ่งๆ

สร้างไฟล์ `{shop_id}.js` ในโฟลเดอร์นี้ (shop_id คือ UUID จาก `shop_profiles.id`) แล้ว export
ฟังก์ชัน `buildCustomReport` ดังนี้:

```js
// lib/custom-templates/f8009a36-9331-40c8-9664-ab255ebbd35c.js
exports.buildCustomReport = async function ({ shopId, shopName, branchName, from, to, XLSX }) {
  // from/to เป็น Date object หรือ null (ผู้ใช้ไม่ได้กรองช่วงวันที่)
  // ดึงข้อมูลเพิ่มเติมเองได้ตามต้องการ (import readSheet/getAccessToken จาก '../google-pos' ได้ตรงๆ)
  return [
    {
      name: 'ชื่อ Sheet (ไม่เกิน 31 ตัวอักษร)',
      data: [
        ['หัวข้อรายงาน'],
        ['คอลัมน์ 1', 'คอลัมน์ 2'],
        ['แถวข้อมูล 1', 123],
      ],
    },
  ];
};
```

`api/pos/export.js` จะโหลดไฟล์นี้อัตโนมัติเมื่อเรียก `GET /api/pos/export?...&types=custom&shopId={shop_id}`
(ต้องเป็นแพ็กเกจ Business ขึ้นไป) แล้วนำ sheet ที่คืนมาต่อท้ายไฟล์ Excel ให้เอง — ถ้าไม่มีไฟล์สำหรับ
shopId นั้น ระบบจะขึ้น sheet แจ้งว่า "ร้านนี้ยังไม่มีรายงานกำหนดเองที่ตั้งค่าไว้" แทน ไม่ error
