/**
 * POST /api/pos/collections
 * ส่งงานให้พนักงานไปเก็บเงินเชื่อค้างชำระ และ/หรือสินค้าหมุนเวียนที่ลูกค้ายืมค้างอยู่
 *
 * Body: {
 *   shopId, customer_id, customer_name, phone,
 *   task_type: 'เงินเชื่อ' | 'สินค้ายืม' | 'ทั้งคู่',
 *   debt_amount, items: [{sku,name,qty,unit}],   ← สินค้าที่ต้องเก็บคืน (สินค้าหมุนเวียน)
 *   staff_id, staff_name, staff_line_id, notes, created_by
 * }
 *
 * GET  /api/pos/collections?shopId                     → รายการงานทั้งหมด
 * GET  /api/pos/collections?shopId&collection_no=xxx    → ดึงงานเดียว
 * PATCH /api/pos/collections { shopId, collection_no,
 *   result: 'success' | 'failed',                        ← พนักงานตอบกลับ (Phase staff)
 *   collected_amount, collected_items, slip_url, confirmed_by, staff_note,
 *   cash_received, goods_received,                       ← แอดมิน/ผู้จัดการยืนยันรับเข้าร้านจริง (Phase admin)
 * } → อัปเดตสถานะ/ผลลัพธ์
 */
import { createClient } from '@supabase/supabase-js';
import {
  getAccessToken, readSheet, appendSheet, updateSheetRow, ensureTabExists,
  makeCollectionNo, rowToCollection, rowToContact, rowToProduct,
  COLLECTION_HEADERS, CONTACT_HEADERS,
} from '../../../lib/google-pos';

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_KEY
);

// บังคับให้ Google Sheets เก็บเป็นข้อความล้วน กันเบอร์โทรที่ขึ้นต้นด้วย 0 โดนตัด 0 ทิ้ง
function asText(v) {
  if (v === '' || v == null) return v;
  return `'${v}`;
}

async function getConfig(shopId) {
  const [{ data: pc }, { data: gc }] = await Promise.all([
    supabase.from('pos_configs').select('pos_sheet_id').eq('shop_id', shopId).single(),
    supabase.from('shop_google_configs').select('google_refresh_token').eq('shop_id', shopId).single(),
  ]);
  if (!pc?.pos_sheet_id) throw Object.assign(new Error('ยังไม่ได้ตั้งค่า POS'), { notSetup: true });
  if (!gc?.google_refresh_token) throw Object.assign(new Error('ยังไม่ได้เชื่อมต่อ Google'), { notConnected: true });
  return { sheetId: pc.pos_sheet_id, token: await getAccessToken(gc.google_refresh_token) };
}

// ── LINE Flex Message สำหรับพนักงานที่ถูกส่งไปเก็บเงิน/ของ ─────────────────────
function buildCollectionFlex(task, shopId) {
  const { collection_no, customer_name, phone, task_type, debt_amount, items, notes } = task;

  const bodyContents = [
    { type: 'text', text: `👤 ${customer_name}`, weight: 'bold', size: 'md' },
    phone ? { type: 'text', text: `📞 ${phone}`, size: 'sm', color: '#555555' } : null,
    { type: 'separator', margin: 'sm' },
  ];

  if (task_type !== 'สินค้ายืม' && debt_amount > 0) {
    bodyContents.push({
      type: 'box', layout: 'horizontal', margin: 'sm',
      contents: [
        { type: 'text', text: '💳 เงินเชื่อค้าง', flex: 3, size: 'sm', weight: 'bold' },
        { type: 'text', text: `฿${debt_amount.toLocaleString()}`, flex: 2, size: 'md', align: 'end', weight: 'bold', color: '#f97316' },
      ],
    });
  }

  if (task_type !== 'เงินเชื่อ' && Array.isArray(items) && items.length) {
    bodyContents.push({ type: 'text', text: '🔄 สินค้าที่ต้องเก็บคืน', size: 'sm', weight: 'bold', margin: 'sm', color: '#f97316' });
    items.forEach(item => {
      bodyContents.push({
        type: 'box', layout: 'horizontal',
        contents: [
          { type: 'text', text: item.name, flex: 3, size: 'sm', color: '#555555', wrap: true },
          { type: 'text', text: `×${item.qty}`, flex: 1, size: 'sm', align: 'end', color: '#888888' },
        ],
      });
    });
  }

  if (notes) bodyContents.push({ type: 'text', text: `📝 ${notes}`, size: 'sm', color: '#888888', wrap: true, margin: 'sm' });

  return {
    type: 'flex',
    altText: `🧾 งานเก็บเงิน/ของ ${collection_no} — ${customer_name}`,
    contents: {
      type: 'bubble',
      header: {
        type: 'box', layout: 'vertical', paddingAll: '16px', backgroundColor: '#ea580c',
        contents: [
          { type: 'text', text: '🧾 งานเก็บเงิน/ของคืน', weight: 'bold', size: 'xl', color: '#ffffff' },
          { type: 'text', text: collection_no, size: 'xs', color: '#fed7aa', margin: 'xs' },
        ],
      },
      body: { type: 'box', layout: 'vertical', spacing: 'sm', contents: bodyContents.filter(Boolean) },
      footer: {
        type: 'box', layout: 'vertical', spacing: 'sm',
        contents: [{
          type: 'button',
          action: {
            type: 'uri',
            label: '✅ เปิดหน้ายืนยันงาน',
            uri: `${process.env.FRONTEND_URL}/pos-staff?shopId=${shopId}&collection_no=${collection_no}`,
          },
          style: 'primary',
          color: '#ea580c',
          height: 'sm',
        }],
      },
    },
  };
}

async function pushLineMessage(lineId, message) {
  const token = process.env.LINE_CHANNEL_ACCESS_TOKEN;
  if (!token || !lineId) return;
  const res = await fetch('https://api.line.me/v2/bot/message/push', {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ to: lineId, messages: [message] }),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    console.error('[collections] LINE push error:', err);
  }
}

export default async function handler(req, res) {
  const shopId = req.query.shopId || req.body?.shopId;
  if (!shopId) return res.status(400).json({ error: 'Missing shopId' });

  try {
    const { sheetId, token } = await getConfig(shopId);
    await ensureTabExists(token, sheetId, 'งานเก็บเงิน', COLLECTION_HEADERS);

    // ── GET — รายการงาน ────────────────────────────────────────────────────
    if (req.method === 'GET') {
      const rows = await readSheet(token, sheetId, 'งานเก็บเงิน!A:U');
      const tasks = rows.slice(1)
        .map((r, i) => ({ ...rowToCollection(r), _row: i + 2 }))
        .filter(t => t.collection_no)
        .reverse();

      if (req.query.collection_no) {
        const task = tasks.find(t => t.collection_no === req.query.collection_no);
        return res.json({ task: task || null });
      }

      return res.json({ tasks });
    }

    // ── POST — สร้างงานใหม่ ─────────────────────────────────────────────────
    if (req.method === 'POST') {
      const {
        customer_id = '', customer_name, phone = '',
        task_type = 'เงินเชื่อ', debt_amount = 0, items = [],
        staff_id = '', staff_name = '', staff_line_id = '', notes = '', created_by = '',
      } = req.body;

      if (!customer_name) return res.status(400).json({ error: 'ต้องระบุลูกค้า' });
      if (!staff_id) return res.status(400).json({ error: 'ต้องเลือกพนักงาน' });

      const collection_no = makeCollectionNo();
      const now = new Date().toLocaleString('th-TH', { timeZone: 'Asia/Bangkok' });

      await appendSheet(token, sheetId, 'งานเก็บเงิน', [
        collection_no, asText(now), customer_id, customer_name, asText(phone),
        task_type, debt_amount, JSON.stringify(items),
        staff_id, staff_name, 'รอดำเนินการ', notes,
        '', '', '', '', '', '', '', '', created_by,
      ]);

      if (staff_line_id) {
        const flexMsg = buildCollectionFlex({ collection_no, customer_name, phone, task_type, debt_amount, items, notes }, shopId);
        await pushLineMessage(staff_line_id, flexMsg);
      }

      return res.json({ ok: true, collection_no });
    }

    // ── PATCH — พนักงานตอบกลับ / แอดมินยืนยันรับเข้าร้าน ───────────────────────
    if (req.method === 'PATCH') {
      const {
        collection_no, result, collected_amount, collected_items, slip_url,
        confirmed_by, staff_note, cash_received, goods_received,
      } = req.body;
      if (!collection_no) return res.status(400).json({ error: 'Missing collection_no' });

      const rows = await readSheet(token, sheetId, 'งานเก็บเงิน!A:U');
      const dataRows = rows.slice(1);
      const idx = dataRows.findIndex(r => r[0] === collection_no);
      if (idx === -1) return res.status(404).json({ error: 'ไม่พบงาน' });

      const existing = [...dataRows[idx]];
      while (existing.length < 21) existing.push('');

      // ── พนักงานตอบกลับผลการเก็บ (ครั้งเดียว) ────────────────────────────────
      if (result !== undefined && existing[10] === 'รอดำเนินการ') {
        existing[10] = result === 'success' ? 'เก็บสำเร็จ' : 'เก็บไม่ได้';
        existing[12] = collected_amount || 0;
        existing[13] = JSON.stringify(collected_items || []);
        existing[14] = slip_url || '';
        existing[15] = asText(new Date().toLocaleString('th-TH', { timeZone: 'Asia/Bangkok' }));
        if (confirmed_by !== undefined) existing[16] = confirmed_by;
        existing[17] = staff_note || '';

        if (result === 'success') {
          const custId = existing[2];
          const amountCollected = parseFloat(collected_amount) || 0;
          const itemsCollected = Array.isArray(collected_items) ? collected_items : [];
          const totalItemsQty = itemsCollected.reduce((s, i) => s + (parseInt(i.qty) || 0), 0);

          if (custId && (amountCollected > 0 || totalItemsQty > 0)) {
            try {
              await ensureTabExists(token, sheetId, 'ผู้ติดต่อ', CONTACT_HEADERS);
              const custRows = await readSheet(token, sheetId, 'ผู้ติดต่อ!A:W');
              const custDataRows = custRows.slice(1);
              const custIdx = custDataRows.findIndex(r => r[0] === custId);
              if (custIdx !== -1) {
                const custRow = rowToContact(custDataRows[custIdx]);
                const custExisting = [...custDataRows[custIdx]];
                while (custExisting.length < 23) custExisting.push('');
                if (amountCollected > 0) custExisting[13] = Math.max(0, (custRow.debt || 0) - amountCollected);
                if (totalItemsQty > 0) custExisting[14] = Math.max(0, (custRow.cylinders || 0) - totalItemsQty);
                custExisting[19] = asText(new Date().toLocaleString('th-TH', { timeZone: 'Asia/Bangkok' }));
                await updateSheetRow(token, sheetId, 'ผู้ติดต่อ', custIdx + 2, custExisting);
              }
            } catch (custErr) {
              console.error('[collections] update customer debt/cylinders error:', custErr.message);
            }
          }

          // สินค้าหมุนเวียนที่เก็บคืนมา → เพิ่ม "เปล่ารอรีฟิล" ของสินค้านั้น
          if (itemsCollected.length) {
            try {
              const prodRows = await readSheet(token, sheetId, 'สินค้า!A:R');
              const prodDataRows = prodRows.slice(1);
              for (const item of itemsCollected) {
                const qty = parseInt(item.qty) || 0;
                if (qty <= 0 || !item.sku) continue;
                const pIdx = prodDataRows.findIndex(r => r[0] === item.sku);
                if (pIdx === -1) continue;
                const prod = rowToProduct(prodDataRows[pIdx]);
                if (prod.type !== 'หมุนเวียน') continue;
                const prodExisting = [...prodDataRows[pIdx]];
                while (prodExisting.length < 18) prodExisting.push('');
                prodExisting[12] = (prod.empty_waiting || 0) + qty;
                prodExisting[9] = asText(new Date().toLocaleString('th-TH', { timeZone: 'Asia/Bangkok' }));
                await updateSheetRow(token, sheetId, 'สินค้า', pIdx + 2, prodExisting);
                prodDataRows[pIdx] = prodExisting;
              }
            } catch (prodErr) {
              console.error('[collections] update product empty_waiting error:', prodErr.message);
            }
          }
        }
      }

      // ── แอดมิน/ผู้จัดการยืนยันรับเข้าร้านจริง (สองชั้นกันเงิน/ของหาย) ────────────
      if (cash_received !== undefined) existing[18] = cash_received ? 'TRUE' : 'FALSE';
      if (goods_received !== undefined) existing[19] = goods_received ? 'TRUE' : 'FALSE';

      await updateSheetRow(token, sheetId, 'งานเก็บเงิน', idx + 2, existing);
      return res.json({ ok: true, collection_no });
    }

    // ── DELETE — ยกเลิกงาน ──────────────────────────────────────────────────
    if (req.method === 'DELETE') {
      const { collection_no } = req.body;
      if (!collection_no) return res.status(400).json({ error: 'Missing collection_no' });

      const rows = await readSheet(token, sheetId, 'งานเก็บเงิน!A:U');
      const idx = rows.slice(1).findIndex(r => r[0] === collection_no);
      if (idx === -1) return res.status(404).json({ error: 'ไม่พบงาน' });

      await updateSheetRow(token, sheetId, 'งานเก็บเงิน', idx + 2, new Array(21).fill(''));
      return res.json({ ok: true });
    }

    return res.status(405).json({ error: 'Method not allowed' });

  } catch (err) {
    console.error('[pos/collections]', err.message);
    if (err.notSetup) return res.status(400).json({ error: err.message, notSetup: true });
    if (err.notConnected) return res.status(400).json({ error: err.message, notConnected: true });
    return res.status(500).json({ error: err.message });
  }
}
