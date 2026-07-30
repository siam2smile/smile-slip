const express = require('express');
const axios = require('axios');
const FormData = require('form-data');
const crypto = require('crypto');
const { createClient } = require('@supabase/supabase-js');

const app = express();

// Redis (Upstash) — Duplicate Guard ข้าม instance (optional, fallback to in-memory)
let redis = null;
try {
  if (process.env.UPSTASH_REDIS_REST_URL && process.env.UPSTASH_REDIS_REST_TOKEN) {
    const { Redis } = require('@upstash/redis');
    redis = new Redis({
      url: process.env.UPSTASH_REDIS_REST_URL,
      token: process.env.UPSTASH_REDIS_REST_TOKEN,
    });
    console.log('[BOOT] ✅ Upstash Redis connected — Duplicate Guard ข้าม instance');
  } else {
    console.log('[BOOT] ⚠️ UPSTASH_REDIS_REST_URL ไม่ได้ตั้งค่า — ใช้ in-memory cache (single instance)');
  }
} catch (e) {
  console.warn('[BOOT] Redis init failed:', e.message, '— ใช้ in-memory แทน');
}

// เก็บ rawBody ไว้สำหรับ verify LINE signature
app.use(express.json({
  verify: (req, res, buf) => { req.rawBody = buf; }
}));

// ==========================================
// 0. ERROR MONITORING — Google Cloud Error Reporting
// Cloud Run จะ pickup severity=ERROR จาก stderr อัตโนมัติ
// ไม่ต้องติดตั้ง package เพิ่ม
// ==========================================
function reportError(error, context = {}) {
  process.stderr.write(JSON.stringify({
    severity: 'ERROR',
    message: error.message || String(error),
    stack: error.stack || '',
    serviceContext: { service: 'smileslip-bot', version: process.env.K_REVISION || 'local' },
    ...context
  }) + '\n');
}

// ==========================================
// 1. SYSTEM CONFIGURATION & DATABASE
// ==========================================
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_KEY || process.env.SUPABASE_PUBLIC_KEY);

const LINE_HEADER = {
  headers: { Authorization: `Bearer ${process.env.LINE_CHANNEL_ACCESS_TOKEN}` }
};

// LINE Signature Verification — ป้องกันการปลอม webhook
function verifyLineSignature(rawBody, signature) {
  const secret = process.env.LINE_CHANNEL_SECRET;
  if (!secret) {
    console.warn('[SECURITY] ⚠️ LINE_CHANNEL_SECRET ไม่ได้ตั้งค่า — ข้ามการ verify');
    return true;
  }
  if (!signature) return false;
  const hash = crypto.createHmac('SHA256', secret).update(rawBody).digest('base64');
  return hash === signature;
}

// Duplicate event guard: กัน LINE retry ตัดเครดิตซ้ำ (TTL 5 นาที)
// Redis: SET NX EX — atomic check-and-set, ทำงานข้าม instance
const processedEvents = new Map(); // fallback in-memory
async function isDuplicateEvent(eventId) {
  if (redis) {
    try {
      const result = await redis.set(`evt:${eventId}`, '1', { ex: 300, nx: true });
      return result === null; // null = key มีอยู่แล้ว = duplicate
    } catch (e) {
      console.warn('[Redis] isDuplicateEvent error:', e.message, '— fallback in-memory');
    }
  }
  const now = Date.now();
  for (const [id, ts] of processedEvents) {
    if (now - ts > 5 * 60 * 1000) processedEvents.delete(id);
  }
  if (processedEvents.has(eventId)) return true;
  processedEvents.set(eventId, now);
  return false;
}

// Duplicate slip guard: กัน content สลิปซ้ำ (TTL 24 ชั่วโมง)
// Redis: SET NX EX — ทำงานข้าม instance และ restart
const imageHashCache = new Map(); // fallback in-memory
function getImageHash(buffer) {
  return crypto.createHash('md5').update(buffer).digest('hex');
}
async function isRecentDuplicateImage(hash, shopId) {
  if (redis) {
    try {
      const result = await redis.set(`img:${shopId}:${hash}`, '1', { ex: 86400, nx: true });
      return result === null; // null = key มีอยู่แล้ว = duplicate
    } catch (e) {
      console.warn('[Redis] isRecentDuplicateImage error:', e.message, '— fallback in-memory');
    }
  }
  const now = Date.now();
  const TTL = 24 * 60 * 60 * 1000;
  for (const [key, ts] of imageHashCache) {
    if (now - ts > TTL) imageHashCache.delete(key);
  }
  const cacheKey = `${shopId}:${hash}`;
  if (imageHashCache.has(cacheKey)) return true;
  imageHashCache.set(cacheKey, now);
  return false;
}

// Awaiting-receive-photo guard: ผู้ใช้พิมพ์ #รับสินค้า แล้วรอส่งรูปใบส่งของถัดไป (TTL 10 นาที)
// Redis: SET EX ธรรมดา (ไม่ใช่ NX เพราะต้อง "อ่านค่าคืน" ตอน consume ไม่ใช่แค่เช็คว่ามีอยู่หรือไม่)
// PEEK ไม่ลบ (2026-07-20 แก้บั๊ก): เดิม consume-once (อ่านแล้วลบทันที) ทำให้ส่งรูปเป็นอัลบั้มหลายใบ
// (LINE ส่งเป็นหลาย event แยกกัน) รูปที่ 2 เป็นต้นไปหลุดไปเข้า flow สแกนสลิปปกติ เพราะ state ถูกลบไปแล้ว
// ตั้งแต่รูปแรก — เปลี่ยนเป็นอ่านอย่างเดียว ปล่อยให้หมดอายุเองตาม TTL 10 นาที (Redis EX / in-memory ts check
// ด้านล่าง) แทน เพื่อให้ทุกรูปที่ส่งภายใน 10 นาทีถูกจับเข้าคิว "รอตรวจสอบ" ได้ครบ (ยังต้องผ่านแอดมินยืนยันอยู่ดี
// ก่อนตัดสต็อค/บันทึกจริง จึงไม่เสี่ยงข้อมูลผิดพลาดแม้จะจับรูปเกินจำเป็นในบางเคส)
const awaitingReceiveCache = new Map(); // fallback in-memory: userId -> { shopId, branchName, ts }
async function setAwaitingReceive(userId, shopId, branchName) {
  const value = JSON.stringify({ shopId, branchName: branchName || '' });
  if (redis) {
    try { await redis.set(`awaitrecv:${userId}`, value, { ex: 600 }); return; } catch (e) {
      console.warn('[Redis] setAwaitingReceive error:', e.message, '— fallback in-memory');
    }
  }
  awaitingReceiveCache.set(userId, { shopId, branchName: branchName || '', ts: Date.now() });
}
async function consumeAwaitingReceive(userId) {
  if (redis) {
    try {
      const raw = await redis.get(`awaitrecv:${userId}`);
      if (!raw) return null;
      return typeof raw === 'string' ? JSON.parse(raw) : raw; // upstash SDK บางเวอร์ชัน auto-parse ให้แล้ว
    } catch (e) {
      console.warn('[Redis] consumeAwaitingReceive error:', e.message, '— fallback in-memory');
    }
  }
  const now = Date.now();
  for (const [id, v] of awaitingReceiveCache) {
    if (now - v.ts > 10 * 60 * 1000) awaitingReceiveCache.delete(id);
  }
  const entry = awaitingReceiveCache.get(userId);
  if (!entry) return null;
  return { shopId: entry.shopId, branchName: entry.branchName };
}

// Awaiting-expense-photo guard: ผู้ใช้พิมพ์ #รายจ่าย แล้วรอส่งรูปบิล/สลิปค่าใช้จ่ายถัดไป (TTL 10 นาที)
// คนละ key/คนละ cache จาก awaitingReceive เจตนาแยกกันชัดเจน — กันสับสนว่ารูปถัดไปคือรับสินค้าหรือรายจ่าย
// PEEK ไม่ลบ เหตุผลเดียวกับ awaitingReceive ด้านบน (รองรับอัลบั้มหลายรูป)
const awaitingExpenseCache = new Map(); // fallback in-memory: userId -> { shopId, branchName, ts }
async function setAwaitingExpense(userId, shopId, branchName) {
  const value = JSON.stringify({ shopId, branchName: branchName || '' });
  if (redis) {
    try { await redis.set(`awaitexp:${userId}`, value, { ex: 600 }); return; } catch (e) {
      console.warn('[Redis] setAwaitingExpense error:', e.message, '— fallback in-memory');
    }
  }
  awaitingExpenseCache.set(userId, { shopId, branchName: branchName || '', ts: Date.now() });
}
async function consumeAwaitingExpense(userId) {
  if (redis) {
    try {
      const raw = await redis.get(`awaitexp:${userId}`);
      if (!raw) return null;
      return typeof raw === 'string' ? JSON.parse(raw) : raw;
    } catch (e) {
      console.warn('[Redis] consumeAwaitingExpense error:', e.message, '— fallback in-memory');
    }
  }
  const now = Date.now();
  for (const [id, v] of awaitingExpenseCache) {
    if (now - v.ts > 10 * 60 * 1000) awaitingExpenseCache.delete(id);
  }
  const entry = awaitingExpenseCache.get(userId);
  if (!entry) return null;
  return { shopId: entry.shopId, branchName: entry.branchName };
}

// ==========================================
// 2. HELPER FUNCTIONS
// ==========================================

// 2.0 ระบบ Tier — เช็คสิทธิ์แพ็กเกจ
const TIER_LEVEL = { normal: 0, pro: 1, advance: 2, business: 3, enterprise: 4, super: 4 };
const MAX_BRANCHES = { normal: 1, pro: 1, advance: 5, business: 10, enterprise: 20, super: 20 };
function getTier(shop) {
  return (shop.subscription_tier || 'normal').toLowerCase();
}
function hasFeature(shop, minTier) {
  return (TIER_LEVEL[getTier(shop)] || 0) >= (TIER_LEVEL[minTier] || 0);
}
// Enterprise (super) = ไม่ตัดเครดิต
function isUnlimited(shop) {
  const t = getTier(shop);
  return t === 'enterprise' || t === 'super';
}
// backward compat
function isSuper(shop) { return isUnlimited(shop); }

// ค้นหาร้านค้าจาก sourceId — รองรับทั้ง shop_profiles และ shop_branches
async function findShopBySource(sourceId) {
  // 1. ค้นหาจาก shop_profiles โดยตรง (กลุ่มหลัก หรือ DM เจ้าของ)
  const { data: shop } = await supabase
    .from('shop_profiles')
    .select('*')
    .or(`line_group_id.eq.${sourceId},owner_line_id.eq.${sourceId}`)
    .maybeSingle();
  if (shop) return { shop, branchName: shop.shop_name, branchId: null, isOwnerChat: !!shop.owner_line_id && shop.owner_line_id === sourceId };

  // 2. ค้นหาจาก shop_branches (สาขาต่างๆ)
  const { data: branch } = await supabase
    .from('shop_branches')
    .select('*, shop_profiles(*)')
    .eq('line_group_id', sourceId)
    .eq('is_active', true)
    .maybeSingle();
  if (branch?.shop_profiles) {
    return { shop: branch.shop_profiles, branchName: branch.branch_name, branchId: branch.id, isOwnerChat: false };
  }

  return null;
}

// ขอสิทธิ์ระดับสาขา (พนักงานส่ง / ผู้จัดการสาขา) ผ่านกลุ่ม LINE — มิเรอร์ #สมัครแอดมิน
// เดิมทุกประการ ต่างแค่ผูกกับ "สาขา" (branchId/branchName จาก findShopBySource) แทนร้าน
// ทั้งร้าน — เจ้าของ/แอดมินไปอนุมัติที่แดชบอร์ด (ตั้งค่า POS → คำขอสมัคร)
async function requestBranchRole(replyToken, shop, foundCmd, senderId, groupId, role, roleLabel) {
  if (!groupId) {
    await replyToLine(replyToken, [{ type: 'text', text: '⚠️ คำสั่งนี้ใช้ได้เฉพาะในกลุ่ม LINE ที่เชื่อมต่อกับร้าน/สาขาเท่านั้นค่ะ' }]);
    return;
  }

  let displayName = null;
  try {
    const profileRes = await axios.get(
      `https://api.line.me/v2/bot/group/${groupId}/member/${senderId}`,
      LINE_HEADER
    );
    displayName = profileRes.data.displayName || null;
  } catch (e) { /* ถ้า API ล้มเหลวก็บันทึกโดยไม่มีชื่อ */ }

  const { branchId, branchName } = foundCmd;

  try {
    // เช็คคำขอเดิมก่อน (สาขา+คน+role เดียวกัน) — ถ้าเคยขอไว้แล้ว (แม้เคยถูกปฏิเสธ) reset เป็น pending ใหม่แทนสร้างซ้ำ
    let existingQuery = supabase
      .from('branch_role_requests')
      .select('id')
      .eq('shop_id', shop.id)
      .eq('line_user_id', senderId)
      .eq('role', role);
    existingQuery = branchId ? existingQuery.eq('branch_id', branchId) : existingQuery.is('branch_id', null);
    const { data: existing } = await existingQuery.maybeSingle();

    if (existing) {
      await supabase.from('branch_role_requests')
        .update({ status: 'pending', display_name: displayName, approved_at: null })
        .eq('id', existing.id);
    } else {
      await supabase.from('branch_role_requests').insert({
        shop_id: shop.id,
        branch_id: branchId,
        branch_name: branchName,
        line_user_id: senderId,
        display_name: displayName,
        role,
        status: 'pending',
      });
    }

    await replyToLine(replyToken, [{
      type: 'text',
      text: `📋 ส่งคำขอเป็น${roleLabel}ของ "${branchName}" แล้วค่ะ\n\nรอเจ้าของร้าน/แอดมินอนุมัติในแดชบอร์ดนะคะ (ตั้งค่า POS → คำขอสมัคร) 😊\n\n⚠️ สำคัญมาก: ต้องกด "เพิ่มเพื่อน" บัญชีไลน์ Smile Slip ก่อนนะคะ ไม่งั้นระบบจะแจ้งเตือนงาน (เช่นงานส่งของ) หาไม่ได้เลย แม้จะอนุมัติแล้วก็ตาม\n👉 https://lin.ee/wdnoEN5`
    }]);

    if (shop.owner_line_id) {
      pushToOwner(shop.owner_line_id, [{
        type: 'text',
        text: `🔔 มีคำขอเป็น${roleLabel}ของ "${branchName}" ใหม่!\n👤 ${displayName || 'สมาชิกในกลุ่ม'}\n\nอนุมัติได้ที่ Dashboard → POS → ตั้งค่า → คำขอสมัครค่ะ`
      }]).catch(() => {});
    }
  } catch (err) {
    console.error(`[${role}] request error:`, err.message);
    await replyToLine(replyToken, [{ type: 'text', text: '❌ เกิดข้อผิดพลาด กรุณาลองใหม่ภายหลังค่ะ' }]);
  }
}

// Push แจ้งเตือนส่วนตัวเจ้าของ (Pro+)
async function pushToOwner(ownerLineId, messages) {
  try {
    await axios.post('https://api.line.me/v2/bot/message/push', { to: ownerLineId, messages }, LINE_HEADER);
    console.log(`[LOG] 📲 Push แจ้งเจ้าของสำเร็จ`);
  } catch (err) {
    console.error('[WARN] Push to owner failed:', err.response?.data?.message || err.message);
  }
}

// pushToChat — push ไปยัง group หรือ user โดยตรง (ไม่ใช้ replyToken ที่หมดอายุใน 30 วิ)
async function pushToChat(chatId, messages) {
  try {
    await axios.post('https://api.line.me/v2/bot/message/push', { to: chatId, messages }, LINE_HEADER);
    console.log(`[LOG] 📨 Push to chat สำเร็จ (${chatId})`);
  } catch (err) {
    const lineErr = err.response?.data;
    console.error('[ERROR] pushToChat failed:', JSON.stringify(lineErr || err.message), '| target:', chatId);
    throw err; // re-throw เพื่อให้ caller รู้ว่าล้มเหลว
  }
}

// replyOrPush — ลอง reply ก่อน (30 วิ window) ถ้าหมดอายุหรือล้มเหลวให้ push แทน
async function replyOrPush(replyToken, chatId, messages) {
  try {
    await replyToLine(replyToken, messages);
    console.log(`[LOG] ↩️ Reply สำเร็จ`);
  } catch (replyErr) {
    console.warn('[WARN] Reply token หมดอายุหรือใช้แล้ว — fallback push:', replyErr.response?.data?.message || replyErr.message);
    await pushToChat(chatId, messages);
  }
}

// 2.1 ปรับเวลาเป็นประเทศไทย (UTC+7) — ใช้ปี ค.ศ. (Gregorian) สำหรับชื่อโฟลเดอร์
const getThaiDateTime = () => {
  const bangkokTime = new Date(new Date().getTime() + (7 * 60 * 60 * 1000));
  const year = String(bangkokTime.getFullYear());
  const month = String(bangkokTime.getMonth() + 1).padStart(2, '0');
  const day = String(bangkokTime.getDate()).padStart(2, '0');
  return {
    date: bangkokTime.toLocaleDateString('th-TH'),
    time: bangkokTime.toLocaleTimeString('th-TH', { hour: '2-digit', minute: '2-digit', hour12: false }),
    raw: bangkokTime,
    year,
    month,
    isoDate: `${year}-${month}-${day}`,       // "2026-06-02" ใช้ filter Sheet
    monthFolderName: `${month}-${year}`,       // "06-2026"
  };
};

// 2.1b แปลงวันที่บนสลิป (DD/MM/YYYY หรือ DD/MM/YY) → { year, monthFolderName }
// ใช้สำหรับ Drive folder ให้ตรงกับวันที่จริงบนสลิป ไม่ใช่วันที่บันทึก
function parseSlipDateForFolder(slipDate) {
  const parts = (slipDate || '').split('/');
  if (parts.length !== 3) return null;
  let [, mm, yyyy] = parts.map(p => parseInt(p.trim(), 10));
  if (isNaN(mm) || isNaN(yyyy)) return null;
  if (yyyy > 2500) yyyy -= 543; // แปลง พ.ศ. → ค.ศ.
  if (yyyy < 100) yyyy += 2000;
  // กัน OCR อ่านปีผิด (เช่น เลขลายมือ 65/69 สลับกัน) — ถ้าห่างจากปีปัจจุบันเกินเกณฑ์ ให้ถือว่าอ่านผิดและใช้ปีปัจจุบันแทน
  const currentYear = new Date(new Date().getTime() + (7 * 60 * 60 * 1000)).getFullYear();
  if (yyyy < currentYear - 1 || yyyy > currentYear + 1) {
    console.warn(`[WARN] ⚠️ ปีที่อ่านได้จากสลิป (${yyyy}) ห่างจากปีปัจจุบัน (${currentYear}) มากเกินไป — likely OCR อ่านผิด ใช้ปีปัจจุบันแทน`);
    yyyy = currentYear;
  }
  const month = String(mm).padStart(2, '0');
  const year = String(yyyy);
  return { year, monthFolderName: `${month}-${year}` };
}

// 2.2 ดึง Google Access Token ด้วย Refresh Token
async function getAccessToken(refreshToken) {
  console.log(`[LOG] 🔑 กำลังขอ Google Access Token ใหม่...`);
  try {
    const res = await axios.post('https://oauth2.googleapis.com/token', {
      refresh_token: refreshToken,
      client_id: process.env.GOOGLE_CLIENT_ID,
      client_secret: process.env.GOOGLE_CLIENT_SECRET,
      grant_type: 'refresh_token',
    });
    console.log(`[LOG] ✅ ได้รับ Google Access Token สำเร็จ`);
    return res.data.access_token;
  } catch (error) {
    console.error("[ERROR] Google Token Error:", error.message);
    const err = new Error("ไม่สามารถเชื่อมต่อบัญชี Google ของร้านค้าได้");
    // invalid_grant = token หมดอายุหรือถูก revoke
    err.isTokenInvalid = error.response?.data?.error === 'invalid_grant';
    throw err;
  }
}

// 2.2b ดึงชื่อ LINE ของผู้ส่ง (รองรับทั้งกลุ่ม/ห้อง/แชทเดี่ยว) — ใช้บันทึกว่าใครเป็นคนส่ง/คีย์รายการ
// non-critical: ถ้า API ล้มเหลวก็คืน null ไม่บล็อก flow หลัก
async function getDisplayName(source) {
  try {
    if (source.type === 'group' && source.groupId && source.userId) {
      const res = await axios.get(`https://api.line.me/v2/bot/group/${source.groupId}/member/${source.userId}`, LINE_HEADER);
      return res.data.displayName || null;
    }
    if (source.type === 'room' && source.roomId && source.userId) {
      const res = await axios.get(`https://api.line.me/v2/bot/room/${source.roomId}/member/${source.userId}`, LINE_HEADER);
      return res.data.displayName || null;
    }
    if (source.userId) {
      const res = await axios.get(`https://api.line.me/v2/bot/profile/${source.userId}`, LINE_HEADER);
      return res.data.displayName || null;
    }
  } catch (e) { /* ข้ามถ้าดึงชื่อไม่ได้ */ }
  return null;
}

// 2.3 ดาวน์โหลดรูปสลิปจาก LINE Server
async function getLineImage(messageId) {
  console.log(`[LOG] 📥 กำลังดาวน์โหลดรูปภาพจาก LINE (ID: ${messageId})...`);
  const url = `https://api-data.line.me/v2/bot/message/${messageId}/content`;
  let lastErr;
  for (let i = 0; i < 3; i++) {
    try {
      const response = await axios.get(url, { ...LINE_HEADER, responseType: 'arraybuffer', timeout: 20000 });
      return Buffer.from(response.data);
    } catch (err) {
      lastErr = err;
      const isNetwork = err.code === 'ECONNRESET' || err.code === 'ECONNREFUSED' || err.message?.includes('socket') || err.message?.includes('TLS');
      if (isNetwork && i < 2) {
        console.log(`[LOG] ⚠️ LINE download ล้มเหลว (ครั้งที่ ${i + 1}) — retry ใน 2s...`);
        await new Promise(r => setTimeout(r, 2000));
        continue;
      }
      throw err;
    }
  }
  throw lastErr;
}

// 2.4 สร้างโฟลเดอร์ Google Drive แบบแยกตาม เดือน/ปี
async function getOrCreateDriveFolder(accessToken, parentFolderId, folderName) {
  console.log(`[LOG] 📁 ค้นหา folder "${folderName}" ใน parent: ${parentFolderId}`);
  const query = `name='${folderName}' and '${parentFolderId}' in parents and mimeType='application/vnd.google-apps.folder' and trashed=false`;
  const searchUrl = `https://www.googleapis.com/drive/v3/files?q=${encodeURIComponent(query)}&fields=files(id,name)&supportsAllDrives=true&includeItemsFromAllDrives=true`;

  const searchRes = await axios.get(searchUrl, { headers: { Authorization: `Bearer ${accessToken}` } });
  const found = searchRes.data.files;

  if (found && found.length > 0) {
    console.log(`[LOG] ✅ พบ folder "${folderName}" เดิม (ID: ${found[0].id})`);
    return found[0].id;
  }

  console.log(`[LOG] ➕ ไม่พบ folder "${folderName}" — กำลังสร้างใหม่...`);
  const createRes = await axios.post('https://www.googleapis.com/drive/v3/files', {
    name: folderName,
    mimeType: 'application/vnd.google-apps.folder',
    parents: [parentFolderId]
  }, { headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' } });

  console.log(`[LOG] ✅ สร้าง folder "${folderName}" สำเร็จ (ID: ${createRes.data.id})`);
  return createRes.data.id;
}

// 2.4b ถ้า root folder/sheet ถูกลบไปแล้ว (404) → สร้างใหม่ให้ร้าน แล้วอัปเดต Supabase (self-healing)
async function recreateShopGoogleAssets(accessToken, shop) {
  console.log(`[LOG] 🛠️ [SelfHeal] root folder/sheet ของร้าน "${shop.shop_name}" ถูกลบไปแล้ว — กำลังสร้างใหม่...`);

  const folderRes = await axios.post('https://www.googleapis.com/drive/v3/files', {
    name: `SMILE SLIP - ${shop.shop_name}`,
    mimeType: 'application/vnd.google-apps.folder',
  }, { headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' } });
  const newFolderId = folderRes.data.id;

  const sheetRes = await axios.post('https://sheets.googleapis.com/v4/spreadsheets', {
    properties: { title: `SMILE SLIP - ${shop.shop_name}` },
  }, { headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' } });
  const newSheetId = sheetRes.data.spreadsheetId;

  // Sheets API สร้างไฟล์ที่ root Drive โดย default — ย้ายเข้า folder ใหม่
  await axios.patch(
    `https://www.googleapis.com/drive/v3/files/${newSheetId}?addParents=${newFolderId}&fields=id,parents`,
    {}, { headers: { Authorization: `Bearer ${accessToken}` } }
  );

  await supabase.from('shop_google_configs').update({
    google_folder_id: newFolderId, google_sheet_id: newSheetId, updated_at: new Date().toISOString(),
  }).eq('shop_id', shop.id);
  await supabase.from('shop_profiles').update({
    google_folder_id: newFolderId, google_sheet_id: newSheetId,
  }).eq('id', shop.id);

  console.log(`[LOG] ✅ [SelfHeal] สร้างใหม่สำเร็จ — folder:${newFolderId} sheet:${newSheetId}`);
  return { folderId: newFolderId, sheetId: newSheetId };
}

// 2.5 อัปโหลดรูปลง Google Drive
async function uploadToGoogleDrive(imageBuffer, accessToken, folderId, fileName) {
  console.log(`[LOG] ☁️ กำลังอัปโหลดรูปลง Google Drive...`);
  const form = new FormData();
  form.append('metadata', JSON.stringify({ name: fileName, parents: [folderId] }), { contentType: 'application/json' });
  form.append('file', imageBuffer, { filename: fileName, contentType: 'image/jpeg' });

  const res = await axios.post('https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart', form, {
    headers: { ...form.getHeaders(), Authorization: `Bearer ${accessToken}` }
  });

  console.log(`[LOG] ✅ อัปโหลดรูปสำเร็จ (Drive ID: ${res.data.id})`);
  return res.data.id;
}

// 2.6 สร้าง tab ปีใน Spreadsheet (ถ้ายังไม่มี) พร้อม header 11 คอลัมน์
// ถ้า sheet มีอยู่แล้วแต่ยังไม่มี column K → patch header อัตโนมัติ
async function getOrCreateYearSheet(accessToken, spreadsheetId, year) {
  const metaRes = await axios.get(
    `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}?fields=sheets.properties`,
    { headers: { Authorization: `Bearer ${accessToken}` } }
  );
  const exists = metaRes.data.sheets?.some(s => s.properties.title === year);
  if (exists) {
    // เช็ค header คอลัมน์ที่เพิ่มเข้ามาทีหลัง (sheet เก่าอาจไม่มี) แล้ว patch ให้ครบ
    const MISSING_HEADER_PATCHES = [
      ['K', 'เลขอ้างอิง/Hash'],
      ['P', 'หมวดหมู่'],
      ['Q', 'วิธีรับ-จ่าย (โอน/เงินสด)'],
      ['R', 'ผู้บันทึก'],
    ];
    for (const [col, headerText] of MISSING_HEADER_PATCHES) {
      try {
        const cellRes = await axios.get(
          `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}/values/${encodeURIComponent(year + '!' + col + '1')}`,
          { headers: { Authorization: `Bearer ${accessToken}` } }
        );
        const cellVal = cellRes.data.values?.[0]?.[0] || '';
        if (!cellVal) {
          console.log(`[LOG] 🔧 Patch column ${col} header บน sheet "${year}" (sheet เก่า)`);
          await axios.put(
            `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}/values/${encodeURIComponent(year + '!' + col + '1')}?valueInputOption=USER_ENTERED`,
            { values: [[headerText]] },
            { headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' } }
          );
        }
      } catch (e) { /* ข้ามถ้า patch ไม่ได้ */ }
    }
    console.log(`[LOG] ✅ Sheet tab "${year}" มีอยู่แล้ว`);
    return;
  }

  console.log(`[LOG] ➕ สร้าง Sheet tab "${year}" ใหม่...`);
  try {
    await axios.post(
      `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}:batchUpdate`,
      { requests: [{ addSheet: { properties: { title: year } } }] },
      { headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' } }
    );
  } catch (addErr) {
    // ถ้า tab ถูกสร้างไปแล้วโดย request อื่น (race condition) → ถือว่า OK
    const msg = addErr.response?.data?.error?.message || addErr.message || '';
    if (!msg.includes('already exists')) throw addErr;
    console.log(`[LOG] ℹ️ Sheet tab "${year}" ถูกสร้างโดย request อื่นไปแล้ว — ข้ามได้`);
  }
  await axios.put(
    `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}/values/${encodeURIComponent(year + '!A1:R1')}?valueInputOption=USER_ENTERED`,
    { values: [['วันที่สลิป','เวลา','ประเภท (รายรับ/รายจ่าย)','จำนวนเงิน (บาท)','ผู้โอน','ผู้รับ','หมายเหตุ','ลิงก์สลิป (Drive)','วันที่บันทึก (recorded_at)','ชื่อสาขา','เลขอ้างอิง/Hash','เลขภาษี','ชื่อผู้เสียภาษี','ยอดภาษี (บาท)','ที่อยู่ผู้เสียภาษี','หมวดหมู่','วิธีรับ-จ่าย (โอน/เงินสด)','ผู้บันทึก']] },
    { headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' } }
  );
  console.log(`[LOG] ✅ สร้าง Sheet tab "${year}" พร้อม header 16 คอลัมน์สำเร็จ`);
}

// ─── หมวดหมู่มาตรฐาน (สำหรับ Business+) ─────────────────────────────────────
const INCOME_CATEGORIES  = ['รายรับจากลูกค้า', 'เงินโอนรับ', 'รายรับอื่นๆ'];
const EXPENSE_CATEGORIES = [
  'ค่าน้ำมัน', 'ค่าแก๊ส/LPG', 'ค่าไฟฟ้า/น้ำประปา',
  'ค่าอาหาร/เครื่องดื่ม', 'ค่าวัสดุ/สินค้า', 'ค่าซ่อมบำรุง',
  'ค่าขนส่ง/พัสดุ', 'ค่าจ้างแรงงาน', 'ค่าเช่า',
  'ค่าการตลาด/โฆษณา', 'ค่าสาธารณูปโภค', 'อื่นๆ',
];

// 2.6b ตรวจจับหมวดหมู่ด้วย learned rules + Gemini text-mode (Business+ เท่านั้น)
async function detectCategory(slipData, shopId) {
  try {
    const isIncome = slipData.type === 'income';
    const cats     = isIncome ? INCOME_CATEGORIES : EXPENSE_CATEGORIES;

    // เช็ค learned rules ก่อน (เร็วกว่า + ตรงใจลูกค้า)
    if (shopId) {
      try {
        const { data: rules } = await supabase
          .from('shop_category_rules')
          .select('keyword, category')
          .eq('shop_id', shopId);
        if (rules && rules.length > 0) {
          const text = [slipData.sender, slipData.receiver, slipData.note].join(' ').toLowerCase();
          for (const rule of rules) {
            if (rule.keyword && text.includes(rule.keyword.toLowerCase())) {
              console.log(`[LOG] 🏷️ [Learned Rule] "${rule.keyword}" → "${rule.category}"`);
              return rule.category;
            }
          }
        }
      } catch (e) { /* ข้ามถ้า query ไม่ได้ */ }
    }

    const apiKey    = process.env.GEMINI_API_KEY;
    const model     = process.env.GEMINI_MODEL || 'gemini-3.5-flash';
    const url       = `https://generativelanguage.googleapis.com/v1/models/${model}:generateContent?key=${apiKey}`;
    const prompt    = `จากข้อมูลธุรกรรม:
ประเภท: ${isIncome ? 'รายรับ' : 'รายจ่าย'}
ผู้โอน: ${slipData.sender || '-'}
ผู้รับ: ${slipData.receiver || '-'}
หมายเหตุ: ${slipData.note || '-'}
จำนวนเงิน: ${slipData.amount} บาท

ตอบแค่ 1 คำ/วลี จากตัวเลือกนี้เท่านั้น:
${cats.join(' | ')}

ถ้าไม่แน่ใจให้ตอบ: ${isIncome ? 'รายรับอื่นๆ' : 'อื่นๆ'}`;

    // maxOutputTokens ต้องสูงพอสำหรับ "thinking token" ภายในของ gemini-3.5-flash (เผื่อ token
    // คิดก่อนตอบเสมอ แม้คำตอบจริงจะสั้นแค่คำเดียว — 32 เดิมน้อยเกินไป ทำให้ finishReason เป็น
    // MAX_TOKENS ตัดคำตอบก่อนจบ (พิสูจน์แล้วจริงตอนแก้บั๊กเดียวกันใน market-price.js)
    const res = await axios.post(url,
      { contents: [{ parts: [{ text: prompt }] }], generationConfig: { temperature: 0, maxOutputTokens: 1024 } },
      { headers: { 'Content-Type': 'application/json' }, timeout: 8000 }
    );
    // รวมทุก part เข้าด้วยกัน — Gemini บางครั้งแบ่งเอาต์พุตเป็นหลาย part ในคำตอบเดียว
    const parts = res.data?.candidates?.[0]?.content?.parts || [];
    const raw = parts.map(p => p.text || '').join('').trim();
    const matched = cats.find(c => raw.includes(c));
    const result  = matched || (isIncome ? 'รายรับอื่นๆ' : 'อื่นๆ');
    console.log(`[LOG] 🏷️ หมวดหมู่: "${result}" (raw: "${raw}", finishReason: "${res.data?.candidates?.[0]?.finishReason}")`);
    return result;
  } catch (e) {
    console.warn('[WARN] detectCategory ขัดข้อง (ข้าม):', e.message);
    return slipData.type === 'income' ? 'รายรับอื่นๆ' : 'อื่นๆ';
  }
}

// Tier D migration — แปลงวันที่-เวลาของสลิป/รายการ (สตริงไทย อาจเป็น พ.ศ., รูปแบบไม่แน่นอนเพราะ
// OCR อ่านมา) เป็น timestamp จริงสำหรับ ledger_transactions.transaction_at — เป็นแค่ฟิลด์รอง
// (secondary/best-effort, ยังไม่มีใครอ่านจากตารางนี้จริงจนกว่าจะทำ read-cutover) เลยไม่พยายาม parse
// ให้สมบูรณ์แบบ ผิดพลาดตรงไหน fallback เป็นเวลาปัจจุบันเสมอ ไม่ throw ออกไปกระทบการบันทึกจริง
function parseTransactionAt(dateStr, timeStr) {
  try {
    const parts = (dateStr || '').split('/');
    if (parts.length === 3) {
      let [d, m, y] = parts.map(p => parseInt(p.trim(), 10));
      if (y > 2500) y -= 543; // แปลง พ.ศ. → ค.ศ.
      if (y < 100) y += 2000;
      const currentYear = new Date(new Date().getTime() + (7 * 60 * 60 * 1000)).getFullYear();
      if (y < currentYear - 1 || y > currentYear + 1) y = currentYear; // OCR อ่านปีผิด — ใช้ปีปัจจุบันแทน
      const [hh, mm, ss] = (timeStr || '00:00:00').split(':').map(p => parseInt(p, 10) || 0);
      if (d && m && y) {
        const dt = new Date(Date.UTC(y, m - 1, d, (hh || 0) - 7, mm || 0, ss || 0)); // -7 ชม. แปลง Bangkok → UTC
        if (!isNaN(dt.getTime())) return dt.toISOString();
      }
    }
  } catch { /* ignore — fallback ด้านล่าง */ }
  return new Date().toISOString();
}

// 2.7 บันทึกข้อมูลลง Google Sheets (tab แยกตามปี)
// คอลัมน์: A=วันที่สลิป B=เวลา C=ประเภท D=ยอด E=ผู้โอน F=ผู้รับ G=หมายเหตุ H=ลิงก์รูป I=recorded_at J=สาขา K=เลขอ้างอิง/Hash L=เลขภาษี M=ชื่อผู้เสียภาษี N=ยอดภาษี O=ที่อยู่ผู้เสียภาษี P=หมวดหมู่ Q=วิธีรับ-จ่าย R=ผู้บันทึก
async function appendToGoogleSheet(accessToken, spreadsheetId, slipData, imageUrl, branchName = '-', sheetYear = null, fingerprint = '-', category = '-', method = '-', recorder = '-', shopId = null) {
  console.log(`[LOG] 📊 กำลังบันทึกข้อมูลลง Google Sheet${sheetYear ? ' tab ' + sheetYear : ''}...`);
  const range = sheetYear ? encodeURIComponent(sheetYear + '!A1') : 'A1';
  const url = `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}/values/${range}:append?valueInputOption=USER_ENTERED`;
  const { isoDate } = getThaiDateTime();
  const values = [[
    slipData.date, slipData.time,
    slipData.type === 'income' ? 'รายรับ' : 'รายจ่าย',
    slipData.amount, slipData.sender || '-',
    slipData.receiver || '-', slipData.note || '-',
    imageUrl || 'ไม่มีรูปภาพ',
    isoDate,
    branchName,
    fingerprint,                           // K — เลขอ้างอิงหรือ image hash
    slipData.tax_id       || '-',          // L — เลขภาษี
    slipData.taxpayer_name || '-',         // M — ชื่อผู้เสียภาษี
    slipData.tax_amount   || '-',          // N — ยอดภาษี
    slipData.tax_address  || '-',          // O — ที่อยู่ผู้เสียภาษี
    category,                              // P — หมวดหมู่
    method   || '-',                       // Q — วิธีรับ-จ่าย (โอน/เงินสด)
    recorder || '-',                        // R — ผู้บันทึก (ชื่อ LINE ของคนส่ง/คีย์)
  ]];
  await axios.post(url, { values }, { headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' } });
  console.log(`[LOG] ✅ บันทึกลง Google Sheet สำเร็จ (สาขา: ${branchName})`);

  // Tier D migration — เขียนคู่เข้า ledger_transactions (Supabase) แบบ fire-and-forget เสมอ
  // (Sheets ยังเป็น primary/บังคับสำเร็จเหมือนเดิมทุกประการ อันนี้แค่เก็บสำเนาไว้เผื่ออนาคต)
  if (shopId) {
    try {
      const isNoImage = !imageUrl || imageUrl === 'ไม่มีรูปภาพ' || imageUrl === 'ไม่มีรูปภาพ (คีย์เอง)';
      const { error: ledgerErr } = await supabase.from('ledger_transactions').insert({
        shop_id: shopId,
        type: slipData.type === 'income' ? 'income' : 'expense',
        amount: slipData.amount,
        category: category === '-' ? null : category,
        note: slipData.note || '-',
        slip_url: isNoImage ? null : imageUrl,
        slip_hash: fingerprint === '-' ? null : fingerprint,
        sender_name: slipData.sender || '-',
        receiver_name: slipData.receiver || '-',
        branch_name: branchName,
        tax_id: (slipData.tax_id && slipData.tax_id !== '-') ? slipData.tax_id : null,
        taxpayer_name: (slipData.taxpayer_name && slipData.taxpayer_name !== '-') ? slipData.taxpayer_name : null,
        tax_amount: (slipData.tax_amount && slipData.tax_amount !== '-') ? slipData.tax_amount : null,
        tax_address: (slipData.tax_address && slipData.tax_address !== '-') ? slipData.tax_address : null,
        payment_method: method === '-' ? null : method,
        recorder_name: recorder === '-' ? null : recorder,
        transaction_at: parseTransactionAt(slipData.date, slipData.time),
        raw_data: { source: 'bot-ledger', fingerprint },
      });
      if (ledgerErr) throw ledgerErr;
    } catch (e) {
      console.error('[LOG] ledger_transactions dual-write error (ข้าม):', e.message);
    }
  }
}

// 2.7b ตรวจสอบสลิปซ้ำใน Google Sheets column K (long-term, ข้ามการ restart)
async function checkDuplicateInSheets(accessToken, sheetId, fingerprint, year) {
  if (!fingerprint || fingerprint === '-') return false;
  try {
    const range = encodeURIComponent(`${year}!K:K`);
    const url = `https://sheets.googleapis.com/v4/spreadsheets/${sheetId}/values/${range}`;
    const res = await axios.get(url, { headers: { Authorization: `Bearer ${accessToken}` } });
    const values = (res.data.values || []).flat();
    return values.includes(fingerprint);
  } catch (e) {
    console.warn('[WARN] checkDuplicateInSheets ขัดข้อง (ข้าม):', e.message);
    return false; // ถ้าเช็กไม่ได้ให้ผ่านไปก่อน
  }
}

// Tier D read-cutover (2026-07-25) — แปลง "เที่ยงคืนตามเวลาไทย" ของวัน year-month-day ให้เป็น
// UTC ISO timestamp (Date.UTC จัดการ overflow ของ hour ติดลบ/เดือน-วันเกินขอบเขตให้อัตโนมัติ
// เช่น hour=-7 จะถอยไปวันก่อนหน้าให้เอง, month=13 จะเลื่อนไปปีถัดไปให้เอง) ใช้สร้างขอบเขตช่วงเวลา
// สำหรับ query ledger_transactions.created_at แทนการอ่าน Sheets เต็มช่วงแล้ว filter ใน JS แบบเดิม
function bangkokMidnightUTC(year, month, day) {
  return new Date(Date.UTC(year, month - 1, day, -7, 0, 0)).toISOString();
}

// 2.8 อ่านสรุปยอดจาก Supabase (ledger_transactions) ระหว่าง [startISO, endISO) กรองตามสาขาถ้าระบุ
// ใช้ created_at กรอง (เวลาที่บันทึกจริงในระบบ — เทียบเท่า "วันที่บันทึก (recorded_at)" คอลัมน์ I เดิม
// ของ Sheets เพราะบอทเขียนแบบ real-time เสมอไม่มี backdate ในฝั่งนี้)
// branchFilter = null → รวมทุกสาขา, string → เฉพาะสาขานั้น
async function readSheetSummary(shopId, startISO, endISO, branchFilter = null) {
  let query = supabase.from('ledger_transactions').select('type, amount')
    .eq('shop_id', shopId).gte('created_at', startISO).lt('created_at', endISO);
  if (branchFilter) query = query.eq('branch_name', branchFilter);
  const { data, error } = await query;
  if (error) throw error;

  let totalIncome = 0, totalExpense = 0, countIncome = 0, countExpense = 0;
  for (const row of (data || [])) {
    const amount = parseFloat(row.amount) || 0;
    if (row.type === 'income') { totalIncome += amount; countIncome++; }
    else if (row.type === 'expense') { totalExpense += amount; countExpense++; }
  }
  return { totalIncome, totalExpense, countIncome, countExpense, net: totalIncome - totalExpense };
}

// 2.9 สร้าง Flex Message สรุปยอด
function createSummaryFlexMessage(title, summary, period) {
  const fmt = (n) => `฿${n.toLocaleString('th-TH', { minimumFractionDigits: 2 })}`;
  const netColor = summary.net >= 0 ? '#10B981' : '#EF4444';
  const netText = summary.net >= 0 ? `+${fmt(summary.net)}` : fmt(summary.net);
  return {
    type: "flex",
    altText: `${title}: รายรับ ${fmt(summary.totalIncome)} | รายจ่าย ${fmt(summary.totalExpense)}`,
    contents: {
      type: "bubble", size: "kilo",
      header: {
        type: "box", layout: "vertical", backgroundColor: "#1e293b", paddingAll: "md",
        contents: [
          { type: "text", text: "📊 " + title, weight: "bold", color: "#ffffff", size: "sm" },
          { type: "text", text: period, color: "#94a3b8", size: "xs", margin: "xs" }
        ]
      },
      body: {
        type: "box", layout: "vertical", spacing: "md", paddingAll: "lg",
        contents: [
          {
            type: "box", layout: "horizontal", contents: [
              { type: "text", text: "💚 รายรับ", color: "#10B981", size: "sm", flex: 2, weight: "bold" },
              { type: "text", text: fmt(summary.totalIncome), color: "#10B981", size: "sm", align: "end", flex: 3, weight: "bold" }
            ]
          },
          { type: "text", text: `${summary.countIncome} รายการ`, color: "#94a3b8", size: "xs", align: "end" },
          {
            type: "box", layout: "horizontal", contents: [
              { type: "text", text: "🔴 รายจ่าย", color: "#EF4444", size: "sm", flex: 2, weight: "bold" },
              { type: "text", text: fmt(summary.totalExpense), color: "#EF4444", size: "sm", align: "end", flex: 3, weight: "bold" }
            ]
          },
          { type: "text", text: `${summary.countExpense} รายการ`, color: "#94a3b8", size: "xs", align: "end" },
          { type: "separator" },
          {
            type: "box", layout: "horizontal", contents: [
              { type: "text", text: "กำไร / ขาดทุน", color: "#1e293b", size: "md", flex: 2, weight: "bold" },
              { type: "text", text: netText, color: netColor, size: "md", align: "end", flex: 3, weight: "bold" }
            ]
          }
        ]
      }
    }
  };
}

// 2.8b อ่านสรุปยอดจาก Supabase (ledger_transactions) แล้วแตก per-branch breakdown — [startISO, endISO)
async function readAllBranchesSummary(shopId, startISO, endISO) {
  const { data, error } = await supabase.from('ledger_transactions').select('type, amount, branch_name')
    .eq('shop_id', shopId).gte('created_at', startISO).lt('created_at', endISO);
  if (error) throw error;

  const branchMap = {}; // { branchName: { totalIncome, totalExpense, countIn, countOut } }
  let grandIncome = 0, grandExpense = 0, grandCountIn = 0, grandCountOut = 0;

  for (const row of (data || [])) {
    const branch = (row.branch_name || 'สาขาหลัก').trim() || 'สาขาหลัก';
    const amount = parseFloat(row.amount) || 0;
    if (!branchMap[branch]) branchMap[branch] = { totalIncome: 0, totalExpense: 0, countIn: 0, countOut: 0 };
    if (row.type === 'income') { branchMap[branch].totalIncome += amount; branchMap[branch].countIn++; grandIncome += amount; grandCountIn++; }
    else if (row.type === 'expense') { branchMap[branch].totalExpense += amount; branchMap[branch].countOut++; grandExpense += amount; grandCountOut++; }
  }
  return { branches: branchMap, grand: { totalIncome: grandIncome, totalExpense: grandExpense, countIn: grandCountIn, countOut: grandCountOut } };
}

// 2.9b Flex Message แสดง per-branch breakdown
function createBranchBreakdownFlexMessage(title, data, period) {
  const fmt = (n) => `฿${n.toLocaleString('th-TH', { minimumFractionDigits: 2 })}`;
  const branchEntries = Object.entries(data.branches).sort((a, b) => b[1].totalIncome - a[1].totalIncome);

  const branchRows = branchEntries.flatMap(([name, d]) => [
    {
      type: 'box', layout: 'horizontal', contents: [
        { type: 'text', text: '🏢 ' + name, size: 'xs', flex: 4, color: '#334155', weight: 'bold', wrap: true },
        { type: 'text', text: fmt(d.totalIncome), size: 'xs', flex: 3, align: 'end', color: '#10B981', weight: 'bold' }
      ]
    },
    { type: 'text', text: `  จ่าย ${fmt(d.totalExpense)}  |  ${d.countIn + d.countOut} รายการ`, size: 'xxs', color: '#94a3b8', margin: 'xs' }
  ]);

  const net = data.grand.totalIncome - data.grand.totalExpense;
  const netColor = net >= 0 ? '#10B981' : '#EF4444';

  return {
    type: 'flex',
    altText: `${title}: รายรับรวม ${fmt(data.grand.totalIncome)} | ${branchEntries.length} สาขา`,
    contents: {
      type: 'bubble', size: 'kilo',
      header: {
        type: 'box', layout: 'vertical', backgroundColor: '#1e293b', paddingAll: 'md',
        contents: [
          { type: 'text', text: '🏢 ' + title, weight: 'bold', color: '#ffffff', size: 'sm' },
          { type: 'text', text: period + ' | ' + branchEntries.length + ' สาขา', color: '#94a3b8', size: 'xs', margin: 'xs' }
        ]
      },
      body: {
        type: 'box', layout: 'vertical', spacing: 'sm', paddingAll: 'lg',
        contents: [
          ...branchRows,
          { type: 'separator', margin: 'md' },
          {
            type: 'box', layout: 'horizontal', margin: 'md', contents: [
              { type: 'text', text: 'กำไร / ขาดทุน รวม', size: 'sm', flex: 3, color: '#1e293b', weight: 'bold' },
              { type: 'text', text: (net >= 0 ? '+' : '') + fmt(net), size: 'sm', flex: 3, align: 'end', color: netColor, weight: 'bold' }
            ]
          }
        ]
      }
    }
  };
}

// 2.10 Analytics — PDPA-safe (ห้ามเก็บชื่อจริง/ยอดจริง)
function getAmountBucket(amount) {
  const n = parseFloat(amount) || 0;
  if (n < 500)  return 'under_500';
  if (n < 2000) return '500_2000';
  if (n < 5000) return '2000_5000';
  return 'over_5000';
}

function getWeekOfYear(date) {
  const start = new Date(date.getFullYear(), 0, 1);
  return Math.ceil(((date - start) / 86400000 + start.getDay() + 1) / 7);
}

// resolve "brand_key" สำหรับ group ลูกค้าข้ามสาขา — สาขาที่ไม่ได้ตั้ง brand_name แยกไว้
// จะถือเป็นแบรนด์เดียวกับร้านหลักโดยอัตโนมัติ (default = shopId) ส่วนสาขาที่ตั้ง brand_name
// ไว้ต่างกัน (เช่น เปิดร้านคนละแบบใต้บริษัทเดียวกัน) จะถูกแยกกลุ่มลูกค้าออกจากกัน
async function resolveBrandKey(shopId, branchId) {
  if (!branchId) return shopId; // กลุ่มหลัก/เจ้าของ ใช้ default brand ของร้าน
  try {
    const { data: branch } = await supabase
      .from('shop_branches').select('brand_name').eq('id', branchId).maybeSingle();
    const brandName = branch?.brand_name?.trim();
    return brandName ? `${shopId}:${brandName.toLowerCase()}` : shopId;
  } catch (e) {
    return shopId; // query พลาด → fallback default brand ของร้าน
  }
}

async function recordAnalytics(shopId, branchId, slipData) {
  try {
    // ใช้เวลาไทย (UTC+7) เสมอ — เดิมใช้ new Date() ตรงๆ ซึ่งเป็นเวลา UTC ของเซิร์ฟเวอร์ Cloud Run
    // ทำให้ hour_of_day/day_of_week เพี้ยนไป 7 ชั่วโมงจากเวลาไทยจริงมาตลอด (Peak Time Heatmap ไม่ตรง)
    const { raw: now, isoDate: today } = getThaiDateTime();
    // sha256 ชื่อผู้โอน — ย้อนกลับไม่ได้, ไม่เก็บชื่อจริง
    const senderHash = slipData.sender
      ? crypto.createHash('sha256').update(String(slipData.sender)).digest('hex')
      : null;
    const brandKey = await resolveBrandKey(shopId, branchId);

    await supabase.from('slip_analytics').insert({
      shop_id:          shopId,
      branch_id:        branchId || null,
      slip_date:        today,
      hour_of_day:      now.getHours(),
      day_of_week:      now.getDay(),
      week_of_year:     getWeekOfYear(now),
      month:            now.getMonth() + 1,
      year:             now.getFullYear(),
      amount_bucket:    getAmountBucket(slipData.amount),
      transaction_type: slipData.type === 'income' ? 'income' : 'expense',
      sender_hash:      senderHash,
      sender_bank:      slipData.sender_bank || null,
      slip_type:        'bank_transfer',
    });

    if (senderHash) {
      const { data: existing } = await supabase
        .from('sender_profiles')
        .select('id, total_transactions, first_seen')
        .eq('shop_id', shopId)
        .eq('brand_key', brandKey)
        .eq('sender_hash', senderHash)
        .maybeSingle();

      if (existing) {
        const total = (existing.total_transactions || 0) + 1;
        // frequency_score 1-5 ตามจำนวนครั้ง
        const score = total >= 20 ? 5 : total >= 10 ? 4 : total >= 5 ? 3 : total >= 2 ? 2 : 1;
        await supabase.from('sender_profiles').update({
          last_seen: today, total_transactions: total,
          amount_bucket_mode: getAmountBucket(slipData.amount),
          frequency_score: score, updated_at: new Date().toISOString(),
        }).eq('id', existing.id);
      } else {
        await supabase.from('sender_profiles').insert({
          shop_id: shopId, brand_key: brandKey, sender_hash: senderHash,
          sender_bank: slipData.sender_bank || null,
          first_seen: today, last_seen: today,
          total_transactions: 1, amount_bucket_mode: getAmountBucket(slipData.amount),
          frequency_score: 1,
        });
      }
    }
  } catch (err) {
    // analytics ไม่ควรกระทบ main flow
    console.error('[Analytics] non-critical error:', err.message);
  }
}

// 2.7 สร้างการ์ด Flex Message (ละเอียด)
// fingerprint = ref_no หรือ image hash (column K) — ใช้สร้างลิงก์แก้ไขรายการ
// supplierName = ชื่อผู้จำหน่ายที่จับคู่ได้จาก POS contacts (optional)
function createBeautifulFlexMessage(slipData, fingerprint, shop, quoteToken, supplierName = null) {
  const { year: sheetYear } = getThaiDateTime();
  // ปุ่มแก้ไข — ลิงก์ตรงไปยังรายการนี้ (ระบุด้วย ref column K)
  const editUrl = fingerprint && fingerprint !== '-'
    ? `${process.env.FRONTEND_URL}/transaction/edit?userId=${shop.owner_line_id}&ref=${encodeURIComponent(fingerprint)}&year=${sheetYear}`
    : `${process.env.FRONTEND_URL}/dashboard?userId=${shop.owner_line_id}`;
  const isIncome = slipData.type === 'income';
  const amountText = `฿${parseFloat(slipData.amount).toLocaleString('th-TH', { minimumFractionDigits: 2 })}`;
  const txShortId = fingerprint && fingerprint !== '-' ? String(fingerprint).slice(0, 8).toUpperCase() : '-';
  const headerColor = isIncome ? '#10B981' : '#EF4444';
  const headerText = isIncome ? '💚 เงินเข้า — รายรับ' : '🔴 เงินออก — รายจ่าย';
  const amountColor = isIncome ? '#10B981' : '#EF4444';

  // แถวข้อมูล helper
  const row = (label, value, valueColor = '#1e293b') => ({
    type: "box", layout: "horizontal", contents: [
      { type: "text", text: label, color: "#94a3b8", size: "sm", flex: 2 },
      { type: "text", text: value || '-', color: valueColor, size: "sm", align: "end", flex: 3, wrap: true }
    ]
  });

  const bodyContents = [
    // ยอดเงิน (ใหญ่)
    {
      type: "box", layout: "horizontal", contents: [
        { type: "text", text: "ยอดเงิน", color: "#94a3b8", size: "sm", flex: 2 },
        { type: "text", text: amountText, weight: "bold", color: amountColor, size: "xl", align: "end", flex: 3 }
      ]
    },
    { type: "separator", margin: "sm" },
    row("ผู้โอน", slipData.sender),
    ...(supplierName ? [row("🏢 ผู้จำหน่าย", supplierName, "#3B82F6")] : []),
    row("ผู้รับ", slipData.receiver || shop.shop_name),
    row("บัญชีร้านค้า", shop.shop_name),
    row("วันที่", slipData.date),
    row("เวลา", slipData.time),
  ];

  if (slipData.note && slipData.note !== '-') {
    bodyContents.push(row("หมายเหตุ", slipData.note));
  }

  // ข้อมูลภาษี (เฉพาะ expense ที่มีข้อมูล)
  if (!isIncome && slipData.tax_id && slipData.tax_id !== '-') {
    bodyContents.push({ type: "separator", margin: "sm" });
    bodyContents.push({ type: "text", text: "ข้อมูลภาษี", color: "#94a3b8", size: "xs", margin: "sm" });
    bodyContents.push(row("เลขผู้เสียภาษี", slipData.tax_id));
    if (slipData.taxpayer_name && slipData.taxpayer_name !== '-') {
      bodyContents.push(row("ชื่อผู้เสียภาษี", slipData.taxpayer_name));
    }
    if (slipData.tax_amount && slipData.tax_amount > 0) {
      const taxAmt = parseFloat(slipData.tax_amount);
      const preVat = slipData.amount - taxAmt;
      if (preVat > 0) {
        bodyContents.push(row("ราคาก่อน VAT", `฿${preVat.toLocaleString('th-TH', { minimumFractionDigits: 2 })}`));
      }
      bodyContents.push(row("ภาษีมูลค่าเพิ่ม", `฿${taxAmt.toLocaleString('th-TH', { minimumFractionDigits: 2 })}`));
    }
  }

  bodyContents.push({ type: "separator", margin: "sm" });
  bodyContents.push(row("เลขที่รายการ", `#${txShortId}`, "#94a3b8"));

  const flexMsg = {
    type: "flex",
    altText: `${isIncome ? '💚 เงินเข้า' : '🔴 เงินออก'} ${amountText} | ${slipData.sender || ''} → ${slipData.receiver || shop.shop_name}`,
    contents: {
      type: "bubble",
      size: "kilo",
      header: {
        type: "box", layout: "vertical",
        backgroundColor: headerColor,
        paddingAll: "md",
        contents: [
          { type: "text", text: headerText, weight: "bold", color: "#ffffff", size: "sm" }
        ]
      },
      body: {
        type: "box", layout: "vertical", spacing: "sm",
        paddingAll: "lg",
        contents: bodyContents
      },
      footer: {
        type: "box", layout: "vertical", spacing: "sm", contents: [
          { type: "button", style: "primary", color: "#4F46E5", height: "sm",
            action: { type: "uri", label: "✏️ แก้ไขข้อมูล", uri: editUrl } }
        ]
      }
    }
  };

  // หมายเหตุ: LINE ไม่รองรับ quoteToken กับ message type 'flex' (รองรับแค่ text/sticker)
  // ห้ามใส่ quoteToken ที่นี่ — LINE จะ reject ทั้ง message

  return flexMsg;
}

async function replyToLine(replyToken, messages) {
  await axios.post('https://api.line.me/v2/bot/message/reply', { replyToken, messages }, LINE_HEADER);
}

// Retry wrapper สำหรับ Gemini — กัน 503 overload ด้วย exponential backoff + fallback model
async function withRetry(fn, fallbackFn = null, retries = 3, delayMs = 2000) {
  for (let i = 0; i < retries; i++) {
    try {
      return await fn();
    } catch (err) {
      const status = err.response?.status;
      if (status === 503) {
        if (i < retries - 1) {
          console.log(`[LOG] ⏳ Gemini 503 — รอ ${delayMs * (i + 1)}ms แล้ว retry ครั้งที่ ${i + 2}...`);
          await new Promise(r => setTimeout(r, delayMs * (i + 1)));
          continue;
        }
        // หมด retry แล้วยัง 503 — สลับ fallback model
        if (fallbackFn) {
          console.log(`[LOG] 🔄 Gemini หมด retry — สลับไปใช้ fallback model...`);
          return await fallbackFn();
        }
      }
      throw err;
    }
  }
}

// parse ข้อความคีย์รายการด้วยมือ เช่น "รับ 500 ค่าแก๊ส" หรือ "จ่ายสด 1200 ค่าไฟ"
// รองรับคำขึ้นต้นหลากหลาย: รับ/รับเงิน/รับเงินสด/รับสด/รับโอน/รับโอนเงิน, จ่าย/จ่ายเงิน/จ่ายเงินสด/จ่ายสด/จ่ายตังสด/จ่ายโอน/โอนจ่าย
const MANUAL_ENTRY_VERBS = [
  'โอนจ่าย', 'จ่ายโอน', 'จ่ายเงินสด', 'จ่ายตังสด', 'จ่ายสด', 'จ่ายเงิน', 'จ่าย',
  'รับโอนเงิน', 'รับโอน', 'รับเงินสด', 'รับสด', 'รับเงิน', 'รับ',
];
function parseManualEntry(text) {
  const re = new RegExp(`^(?:${MANUAL_ENTRY_VERBS.join('|')})\\s+([\\d,]+(?:\\.\\d{1,2})?)\\s*(.*)`, 'su');
  const verbMatch = text.match(new RegExp(`^(?:${MANUAL_ENTRY_VERBS.join('|')})`, 'u'));
  if (!verbMatch) return null;
  const m = text.match(re);
  if (!m) return null;
  const verb = verbMatch[0];
  const isIncome = verb.startsWith('รับ');
  const isTransfer = verb.includes('โอน');
  // ไม่ระบุวิธี (รับ/จ่าย เปล่าๆ) → ถือว่าเป็นเงินสด เพราะถ้าเป็นเงินโอนปกติลูกค้าจะส่งรูปสลิปแทนการคีย์เอง
  const method = isTransfer ? 'โอน' : 'เงินสด';
  return {
    type: isIncome ? 'income' : 'expense',
    amount: parseFloat(m[1].replace(/,/g, '')),
    note: m[2].trim() || '-',
    method,
  };
}

// ==========================================
// 2.8 ตรวจสอบประเภทสลิปจากชื่อบัญชีร้านค้า (กัน Gemini อ่าน perspective ผิด)
// หลักการ: ถ้า receiver ตรงชื่อบัญชีร้าน → รายรับ, ถ้า sender ตรงชื่อบัญชีร้าน → รายจ่าย
// รองรับ: คำนำหน้าชื่อ (นาย/นาง/MR.), ชื่อถูกปิดบังบางส่วน ("สมชาย ใ." / "สมชาย ใจ***")
// ==========================================

// ตัดคำนำหน้าชื่อ + นิติบุคคล ออกก่อนเทียบ
const NAME_PREFIXES = /^(นาย|นางสาว|นาง|น\.ส\.|ด\.ช\.|ด\.ญ\.|คุณ|mr\.?|mrs\.?|ms\.?|miss|บริษัท|บจก\.?|บมจ\.?|หจก\.?|ร้าน)\s*/i;

// แตกชื่อเป็น tokens (คงช่องว่างไว้ก่อน) + ลบตัวปิดบัง (* x . -)
function nameTokens(s) {
  const cleaned = (s || '')
    .toLowerCase()
    .replace(NAME_PREFIXES, '')
    .replace(/[*xX•·…]+/g, '')      // ตัวปิดบัง: สมชาย ใจ*** → สมชาย ใจ
    .replace(/[.\-_,()]/g, ' ')      // จุด/ขีด → ช่องว่าง: สมชาย ใ. → สมชาย ใ
    .trim();
  return cleaned.split(/\s+/).filter(t => t.length > 0);
}

// เทียบชื่อ 2 ฝั่งแบบ fuzzy — คืน true ถ้าน่าจะเป็นคนเดียวกัน
function namesLikelyMatch(slipName, accountName) {
  const a = nameTokens(slipName);
  const b = nameTokens(accountName);
  if (a.length === 0 || b.length === 0) return false;

  const flatA = a.join('');
  const flatB = b.join('');

  // 1) substring ทั้งก้อน (วิธีเดิม)
  if (flatA.length >= 3 && flatB.length >= 3 && (flatA.includes(flatB) || flatB.includes(flatA))) return true;

  // 2) token แรก (ชื่อจริง) ต้องตรงกันหรือฝั่งหนึ่งเป็น prefix ของอีกฝั่ง (กันชื่อถูกตัดท้าย)
  const firstMatch = a[0] === b[0] ||
    (a[0].length >= 3 && b[0].length >= 3 && (a[0].startsWith(b[0]) || b[0].startsWith(a[0])));
  if (!firstMatch) return false;

  // ชื่อจริงตรง + มีฝั่งเดียวที่มีนามสกุล → ยอมรับ (สลิปบางธนาคารแสดงแค่ชื่อ)
  if (a.length === 1 || b.length === 1) return a[0].length >= 3;

  // 3) นามสกุล: ตัวย่อ/ถูกปิดบัง — แค่ขึ้นต้นตรงกันก็พอ ("ใ" ≈ "ใจดี")
  const lastA = a[a.length - 1];
  const lastB = b[b.length - 1];
  return lastA.startsWith(lastB) || lastB.startsWith(lastA);
}

// ── จับคู่ชื่อผู้ส่ง/บริษัทบนสลิปกับผู้จำหน่ายใน POS contacts ──────────────
// คืน supplier name ถ้าตรง, null ถ้าไม่ตรงหรือไม่มี POS ─ suppress error ทุกกรณี
// Phase 3 Tier 1: อ่านจาก pos_contacts (Supabase) แทน Sheets "ผู้ติดต่อ" — pos_contacts
// เป็น source of truth เดียวของ dashboard มาตั้งแต่ Phase 2 Tier 138 แล้ว (ไม่ผ่าน Google เลย)
async function findMatchedSupplier(shopId, senderText) {
  if (!senderText || senderText === '-') return null;
  try {
    const { data: rows, error } = await supabase
      .from('pos_contacts')
      .select('name, aliases')
      .eq('shop_id', shopId)
      .eq('contact_type', 'ผู้จำหน่าย')
      .is('deleted_at', null);
    if (error) throw error;
    if (!rows || rows.length === 0) return null;

    const senderLower = senderText.toLowerCase().replace(/\s+/g, '');
    for (const row of rows) {
      const name    = row.name || '';
      const aliases = row.aliases || '';
      const terms = [name, ...aliases.split(',').map(s => s.trim())].filter(Boolean);
      for (const t of terms) {
        const tNorm = t.toLowerCase().replace(/\s+/g, '');
        if (!tNorm || tNorm.length < 2) continue;
        if (senderLower.includes(tNorm) || tNorm.includes(senderLower)) {
          return name;
        }
      }
    }
  } catch (e) {
    console.warn('[WARN] findMatchedSupplier:', e.message);
  }
  return null;
}

function detectTypeFromBankAccounts(slipData, bankAccounts, extraNames = []) {
  // รวมชื่อบัญชีธนาคาร + ชื่อร้านค้า + ชื่อสาขาทั้งหมด
  // (ครอบ QR bill payment ที่ receiver = ชื่อสาขา ไม่ใช่ชื่อบัญชีธนาคารหรือชื่อบริษัท)
  const accountNames = (bankAccounts || [])
    .map(a => a.account_name)
    .filter(n => n && n.trim().length >= 2);
  for (const n of extraNames) {
    if (n && n.trim().length >= 2) accountNames.push(n.trim());
  }

  if (accountNames.length === 0) return slipData.type;

  // receiver ตรงกับบัญชีร้าน → เงินเข้า (รายรับ) + แทนชื่อย่อจาก OCR ด้วยชื่อเต็มที่ลูกค้ากรอกไว้
  for (const name of accountNames) {
    if (namesLikelyMatch(slipData.receiver, name)) {
      console.log(`[LOG] ✅ [TypeCheck] receiver "${slipData.receiver}" ≈ บัญชีร้าน "${name}" → income${slipData.type !== 'income' ? ' (แก้จาก ' + slipData.type + ')' : ''}`);
      if (slipData.receiver !== name) {
        console.log(`[LOG] 📝 [NameFix] receiver "${slipData.receiver}" → ชื่อเต็ม "${name}"`);
        slipData.receiver = name;
      }
      return 'income';
    }
  }

  // sender ตรงกับบัญชีร้าน → เงินออก (รายจ่าย) + แทนชื่อย่อจาก OCR ด้วยชื่อเต็มที่ลูกค้ากรอกไว้
  for (const name of accountNames) {
    if (namesLikelyMatch(slipData.sender, name)) {
      console.log(`[LOG] ✅ [TypeCheck] sender "${slipData.sender}" ≈ บัญชีร้าน "${name}" → expense${slipData.type !== 'expense' ? ' (แก้จาก ' + slipData.type + ')' : ''}`);
      if (slipData.sender !== name) {
        console.log(`[LOG] 📝 [NameFix] sender "${slipData.sender}" → ชื่อเต็ม "${name}"`);
        slipData.sender = name;
      }
      return 'expense';
    }
  }

  // ไม่ match → เชื่อ Gemini ตามเดิม + log ไว้ debug ว่าเทียบอะไรไม่ติด
  console.log(`[LOG] ⚠️ [TypeCheck] ไม่ match บัญชีร้าน — sender:"${slipData.sender}" receiver:"${slipData.receiver}" vs [${accountNames.join(', ')}] → ใช้ค่า Gemini: ${slipData.type}`);
  return slipData.type;
}

// ==========================================
// 3. AI CORE ENGINE (HYBRID OCR: Cloud Vision + Gemini 3.5 Flash)
// ==========================================

// 3.1 ด่านหลัก: Gemini OCR image-mode (รองรับ model override สำหรับ fallback)
async function extractDataWithGemini(imageBuffer, modelOverride = null) {
  try {
    const apiKey = process.env.GEMINI_API_KEY;
    const modelVersion = modelOverride || process.env.GEMINI_MODEL || 'gemini-3.5-flash';
    console.log(`[LOG] 🧠 [Gemini image-mode] ใช้โมเดล: ${modelVersion}`);

    const url = `https://generativelanguage.googleapis.com/v1/models/${modelVersion}:generateContent?key=${apiKey}`;
    const { date: todayThaiDate, year: todayYear } = getThaiDateTime();
    const todayBuddhistYear = Number(todayYear) + 543;
    const prompt = `วันนี้คือ ${todayThaiDate} (พ.ศ. ${todayBuddhistYear} / ค.ศ. ${todayYear})
วิเคราะห์เอกสารการเงินนี้ (สลิปโอนเงิน / บิลลายมือ / ใบเสร็จพิมพ์ / ใบกำกับภาษี) แล้วตอบกลับเป็น JSON เท่านั้น ห้ามมีข้อความอื่น:
{"type":"income หรือ expense","amount":0.00,"date":"วว/ดด/ปปปป","time":"นน:นน","sender":"ชื่อผู้โอน/ผู้ซื้อ/ลูกค้า","receiver":"ชื่อร้านค้า/ผู้รับเงิน","note":"รายการหลัก/หมายเหตุ","ref_no":"เลขอ้างอิงธุรกรรม หรือ -","tax_id":"เลขผู้เสียภาษี หรือ -","taxpayer_name":"ชื่อผู้เสียภาษี หรือ -","tax_amount":0.00,"tax_address":"ที่อยู่ผู้เสียภาษี หรือ -"}
กฎ:
■ type: income=สลิปรับเงิน/ขายสินค้า, expense=บิลจ่ายเงิน/ซื้อของ/ค่าบริการ/ใบเสร็จ
■ amount (บิลลายมือหลายรายการ): ดูแถว "รวม"/"รวมทั้งสิ้น"/"จำนวนเงินรวมทั้งสิ้น" เท่านั้น ห้ามบวกรายการเอง ใช้ตัวเลขยอดสุดท้าย (รวมภาษีแล้ว ถ้ามี)
■ amount (ตาราง บาท|สต.): บวก ช่องบาท + ช่องสต./100 เช่น 141บาท -สต.=141.00, 131บาท 28สต.=131.28 ห้ามต่อเลขสองช่อง
■ note (บิลลายมือ): ใส่รายการแรก+จำนวน เช่น "แก๊สโซฮอล์ 95 3.67L" ถ้าหลายรายการเพิ่ม " และอื่นๆ"
■ sender/receiver (บิลซื้อของ): sender=ผู้ซื้อ (ส่วน "นาม/ชื่อลูกค้า"), receiver=ชื่อร้านในหัวบิล
■ ref_no: ใช้ "รหัสอ้างอิง"/"เลขที่อ้างอิง"/"รหัสธุรกรรม"/"Transaction ID" เฉพาะรายการนี้เท่านั้น ห้ามใช้ "รหัสร้านค้า"/"Merchant ID"/"Biller ID" (ซ้ำทุกรายการ) ถ้าไม่มีใส่ -
■ date: ปีเป็น พ.ศ. ถ้าปีไม่ชัดให้ยึดปีปัจจุบันข้างบน อย่าเดาปีที่ห่างจากปัจจุบันมาก`;

    const base64Image = imageBuffer.toString('base64');
    const requestBody = {
      contents: [{ parts: [{ text: prompt }, { inlineData: { mimeType: "image/jpeg", data: base64Image } }] }]
    };

    const response = await axios.post(url, requestBody, { headers: { 'Content-Type': 'application/json' } });

    if (response.data?.candidates?.[0]?.content?.parts?.[0]?.text) {
      const rawText = response.data.candidates[0].content.parts[0].text;
      // ดึง JSON ออกจาก text (กันกรณี Gemini แนบ markdown code block มาด้วย)
      const jsonMatch = rawText.match(/\{[\s\S]*\}/);
      if (!jsonMatch) throw new Error("Gemini ไม่ส่ง JSON กลับมา");
      try {
        const parsed = JSON.parse(jsonMatch[0]);
        // ตรวจ fields สำคัญต้องมี
        if (!parsed.type || parsed.amount === undefined) throw new Error("JSON ขาด fields หลัก (type/amount)");
        parsed.amount = parseFloat(parsed.amount) || 0;
        parsed.tax_amount = parseFloat(parsed.tax_amount) || 0;
        console.log(`[LOG] ✨ [Gemini AI] ประมวลผลสำเร็จ`);
        return parsed;
      } catch (parseErr) {
        throw new Error(`Gemini ส่ง JSON ผิดรูปแบบ: ${parseErr.message} | Raw: ${jsonMatch[0].slice(0, 200)}`);
      }
    } else {
      throw new Error("โครงสร้างการตอบกลับจาก Gemini API ไม่ถูกต้อง");
    }
  } catch (error) {
    const detail = error.response?.data ? JSON.stringify(error.response.data) : error.message;
    console.error("[ERROR] ❌ Gemini API Error:", error.message, "| Detail:", detail);
    throw error;
  }
}

// 3.2 ด่านหน้า: Hybrid Engine (Google Cloud Vision → Gemini text-mode → Gemini image fallback)
// ถ้า GOOGLE_VISION_API_KEY ไม่ได้ตั้งค่า → ใช้ Gemini โดยตรง (graceful degradation)
async function extractDataHybrid(imageBuffer) {
  const visionApiKey = process.env.GOOGLE_VISION_API_KEY;
  if (!visionApiKey) {
    console.log(`[LOG] ℹ️ GOOGLE_VISION_API_KEY ไม่ได้ตั้งค่า — ใช้ Gemini โดยตรง`);
    return await extractDataWithGemini(imageBuffer);
  }

  console.log(`[LOG] ⚡ [Hybrid OCR] เริ่มกระบวนการ (Cloud Vision DOCUMENT → Gemini text-mode)`);
  try {
    const base64Image = imageBuffer.toString('base64');
    const visionUrl = `https://vision.googleapis.com/v1/images:annotate?key=${visionApiKey}`;
    // DOCUMENT_TEXT_DETECTION: ดีกว่า TEXT_DETECTION สำหรับเอกสาร + ให้ confidence score ต่อ block
    const visionReq = {
      requests: [{ image: { content: base64Image }, features: [{ type: "DOCUMENT_TEXT_DETECTION" }] }]
    };

    const visionRes = await axios.post(visionUrl, visionReq, { timeout: 10000 });
    const rawText = visionRes.data.responses[0]?.textAnnotations?.[0]?.description
                 || visionRes.data.responses[0]?.fullTextAnnotation?.text || '';

    // คำนวณ confidence เฉลี่ยจาก block — ค่าต่ำ = น่าจะเป็นลายมือ
    const blocks = visionRes.data.responses[0]?.fullTextAnnotation?.pages?.[0]?.blocks || [];
    const avgConfidence = blocks.length > 0
      ? blocks.reduce((sum, b) => sum + (b.confidence || 0), 0) / blocks.length
      : 1.0;
    // ถ้า text ยาว (>100 ตัวอักษร) = digital slip / สลิปโอนเงิน / QR payment → ไม่ route image-mode แม้ confidence ต่ำ
    // (รูปถ่ายหน้าจอมือถืออาจมี confidence ต่ำเพราะแสงสะท้อน แต่ข้อความอ่านได้ครบ)
    const isHandwritten = avgConfidence < 0.75 && rawText.length < 100;

    if (rawText.length < 30 || isHandwritten) {
      const reason = rawText.length < 30 ? `text สั้น (${rawText.length} chars)` : `confidence ต่ำ (${avgConfidence.toFixed(2)}) + text สั้น → น่าจะเป็นลายมือ`;
      console.log(`[LOG] ⚠️ [Hybrid OCR] ${reason} → Gemini image-mode`);
      return await extractDataWithGemini(imageBuffer);
    }

    // Vision ได้ข้อความดีพอ → ส่งเป็น text ไปให้ Gemini วิเคราะห์
    // (text prompt เร็วกว่า image prompt 2-3x เพราะไม่ต้อง encode รูปภาพ)
    console.log(`[LOG] 🚀 [Hybrid OCR] Vision สแกนได้ ${rawText.length} ตัวอักษร → Gemini text-mode`);
    const apiKey = process.env.GEMINI_API_KEY;
    const modelVersion = process.env.GEMINI_MODEL || 'gemini-3.5-flash';
    const url = `https://generativelanguage.googleapis.com/v1/models/${modelVersion}:generateContent?key=${apiKey}`;
    const { date: todayThaiDateT, year: todayYearT } = getThaiDateTime();
    const todayBuddhistYearT = Number(todayYearT) + 543;
    const prompt = `วันนี้คือ ${todayThaiDateT} (พ.ศ. ${todayBuddhistYearT} / ค.ศ. ${todayYearT})
วิเคราะห์ข้อความต่อไปนี้ที่อ่านออกมาจากสลิปโอนเงินหรือบิลรายจ่าย แล้วตอบกลับเป็น JSON เท่านั้น ห้ามมีข้อความอื่น:

ข้อความจากสลิป:
${rawText}

JSON format:
{"type":"income หรือ expense","amount":0.00,"date":"วว/ดด/ปปปป","time":"นน:นน","sender":"ชื่อผู้โอน","receiver":"ชื่อผู้รับ","note":"หมายเหตุ","ref_no":"เลขอ้างอิงธุรกรรม หรือ -","tax_id":"-","taxpayer_name":"-","tax_amount":0.00,"tax_address":"-"}
กฎ: type=income ถ้าสลิปโอนเงิน, type=expense ถ้าบิล/ใบเสร็จ | ref_no: ใช้ "รหัสอ้างอิง" หรือ "เลขที่อ้างอิง" หรือ "รหัสธุรกรรม" หรือ "Transaction ID/Reference" เฉพาะรายการนี้เท่านั้น ห้ามใช้ "รหัสร้านค้า" / "Merchant ID" / "Biller ID" (ซ้ำทุกรายการ) ถ้าไม่มีใส่ - | date: ใส่ปีเป็น พ.ศ. ถ้าลายมือและปีไม่ชัดให้ยึดปีปัจจุบันข้างบน | amount สำหรับบิลลายมือที่มีช่องแยก บาท | สต.: ยอดคือ ช่องบาท + ช่องสต./100 เช่น 141 บาท - สต. = 141.00, 131 บาท 28 สต. = 131.28 ห้ามต่อตัวเลขสองช่อง ให้ใช้ยอดรวมสุดท้ายของบิล`;

    const requestBody = { contents: [{ parts: [{ text: prompt }] }] };
    const response = await axios.post(url, requestBody, { headers: { 'Content-Type': 'application/json' } });
    const responseText = response.data?.candidates?.[0]?.content?.parts?.[0]?.text || '';
    const jsonMatch = responseText.match(/\{[\s\S]*\}/);
    if (!jsonMatch) throw new Error('Gemini text-mode ไม่ส่ง JSON กลับมา');
    try {
      const parsed = JSON.parse(jsonMatch[0]);
      parsed.amount = parseFloat(parsed.amount) || 0;
      parsed.tax_amount = parseFloat(parsed.tax_amount) || 0;
      console.log(`[LOG] ✨ [Hybrid OCR] Gemini text-mode วิเคราะห์สำเร็จ`);
      return parsed;
    } catch (parseErr) {
      throw new Error(`Gemini text-mode JSON ผิดรูปแบบ: ${parseErr.message}`);
    }

  } catch (error) {
    console.error(`[ERROR] ❌ [Hybrid OCR] ขัดข้อง: ${error.message} → fallback Gemini image-mode`);
    return await extractDataWithGemini(imageBuffer);
  }
}

// ==========================================
// 3.3 รับสินค้าผ่านรูปถ่ายใน LINE (ใบส่งของ/ใบกำกับภาษีจากผู้จำหน่าย)
// คนละ schema กับสลิปโอนเงิน — อ่าน ผู้จำหน่าย/เลขที่เอกสาร/รายการสินค้า(ชื่อ,จำนวน,ราคาต่อหน่วย)
// ==========================================
async function extractReceiveDataWithGemini(imageBuffer, modelOverride = null) {
  const apiKey = process.env.GEMINI_API_KEY;
  const modelVersion = modelOverride || process.env.GEMINI_MODEL || 'gemini-3.5-flash';
  console.log(`[LOG] 🧠 [Gemini รับสินค้า] ใช้โมเดล: ${modelVersion}`);

  const url = `https://generativelanguage.googleapis.com/v1/models/${modelVersion}:generateContent?key=${apiKey}`;
  const { date: todayThaiDate, year: todayYear } = getThaiDateTime();
  const todayBuddhistYear = Number(todayYear) + 543;
  const prompt = `วันนี้คือ ${todayThaiDate} (พ.ศ. ${todayBuddhistYear} / ค.ศ. ${todayYear})
วิเคราะห์ใบส่งของ/ใบกำกับภาษีจากผู้จำหน่ายในรูปนี้ แล้วตอบกลับเป็น JSON เท่านั้น ห้ามมีข้อความอื่น:
{"supplier":"ชื่อผู้จำหน่าย/ร้านค้าที่ออกเอกสาร","invoice_no":"เลขที่เอกสาร หรือ -","invoice_date":"วว/ดด/ปปปป หรือ -","items":[{"name":"ชื่อสินค้า","qty":0,"unitPrice":0.00}]}
กฎ:
■ items: แยกทุกรายการสินค้าที่อยู่ในเอกสาร พร้อมจำนวนและราคาต่อหน่วย (ก่อน VAT ถ้าแยกได้ในเอกสาร ไม่งั้นใช้ราคาที่แสดง)
■ ถ้าเอกสารมีแต่ยอดรวมต่อบรรทัดไม่มีราคาต่อหน่วย ให้คำนวณ unitPrice = ยอดรวมบรรทัด/จำนวน
■ invoice_date: ปีเป็น พ.ศ. ถ้าปีไม่ชัดให้ยึดปีปัจจุบันข้างบน อย่าเดาปีที่ห่างจากปัจจุบันมาก`;

  const base64Image = imageBuffer.toString('base64');
  const requestBody = {
    contents: [{ parts: [{ text: prompt }, { inlineData: { mimeType: 'image/jpeg', data: base64Image } }] }]
  };

  const response = await axios.post(url, requestBody, { headers: { 'Content-Type': 'application/json' } });
  const rawText = response.data?.candidates?.[0]?.content?.parts?.[0]?.text;
  if (!rawText) throw new Error('โครงสร้างการตอบกลับจาก Gemini API ไม่ถูกต้อง');
  const jsonMatch = rawText.match(/\{[\s\S]*\}/);
  if (!jsonMatch) throw new Error('Gemini ไม่ส่ง JSON กลับมา');
  const parsed = JSON.parse(jsonMatch[0]);
  if (!Array.isArray(parsed.items)) parsed.items = [];
  parsed.items = parsed.items.map(i => ({
    name: i.name || '-',
    qty: parseFloat(i.qty) || 0,
    unitPrice: parseFloat(i.unitPrice) || 0,
  }));
  console.log(`[LOG] ✨ [Gemini รับสินค้า] ประมวลผลสำเร็จ — ${parsed.items.length} รายการ`);
  return parsed;
}

// tab "รับสินค้ารอยืนยัน" ใน POS Sheet ของร้าน (คนละ tab กับ "รับสินค้า" ที่ยืนยันแล้ว — รอแอดมินตรวจก่อนตัดสต็อคจริง)
const PENDING_RECEIVE_HEADERS = ['เลขที่รอยืนยัน', 'วันที่-เวลา', 'ผู้จำหน่าย (OCR)', 'เลขที่เอกสาร', 'วันที่ในเอกสาร', 'รายการสินค้า (JSON)', 'ลิงก์รูปภาพ', 'สาขา', 'สถานะ'];
async function ensurePendingReceiveSheet(accessToken, posSheetId) {
  const metaRes = await axios.get(
    `https://sheets.googleapis.com/v4/spreadsheets/${posSheetId}?fields=sheets.properties`,
    { headers: { Authorization: `Bearer ${accessToken}` } }
  );
  const exists = metaRes.data.sheets?.some(s => s.properties.title === 'รับสินค้ารอยืนยัน');
  if (exists) return;
  try {
    await axios.post(
      `https://sheets.googleapis.com/v4/spreadsheets/${posSheetId}:batchUpdate`,
      { requests: [{ addSheet: { properties: { title: 'รับสินค้ารอยืนยัน' } } }] },
      { headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' } }
    );
  } catch (addErr) {
    const msg = addErr.response?.data?.error?.message || addErr.message || '';
    if (!msg.includes('already exists')) throw addErr;
  }
  await axios.put(
    `https://sheets.googleapis.com/v4/spreadsheets/${posSheetId}/values/${encodeURIComponent('รับสินค้ารอยืนยัน!A1:I1')}?valueInputOption=USER_ENTERED`,
    { values: [PENDING_RECEIVE_HEADERS] },
    { headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' } }
  );
}
function makePendingReceiveNo() {
  return 'PR' + Date.now().toString(36).toUpperCase();
}
async function appendPendingReceive(accessToken, posSheetId, row) {
  await axios.post(
    `https://sheets.googleapis.com/v4/spreadsheets/${posSheetId}/values/${encodeURIComponent('รับสินค้ารอยืนยัน!A1')}:append?valueInputOption=USER_ENTERED`,
    { values: [row] },
    { headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' } }
  );
}

// ==========================================
// 3.4 รายจ่ายผ่านรูปถ่ายใน LINE (บิล/สลิปค่าใช้จ่ายที่ไม่เกี่ยวกับสต็อคสินค้า เช่น ค่าเช่า/ค่าน้ำไฟ)
// คนละ schema กับรับสินค้า — ไม่มีรายการสินค้าเป็นชิ้นๆ มีแค่ยอดรวมก้อนเดียว + ประเภท VAT
// ==========================================
async function extractExpenseDataWithGemini(imageBuffer, modelOverride = null) {
  const apiKey = process.env.GEMINI_API_KEY;
  const modelVersion = modelOverride || process.env.GEMINI_MODEL || 'gemini-3.5-flash';
  console.log(`[LOG] 🧠 [Gemini รายจ่าย] ใช้โมเดล: ${modelVersion}`);

  const url = `https://generativelanguage.googleapis.com/v1/models/${modelVersion}:generateContent?key=${apiKey}`;
  const { date: todayThaiDate, year: todayYear } = getThaiDateTime();
  const todayBuddhistYear = Number(todayYear) + 543;
  const prompt = `วันนี้คือ ${todayThaiDate} (พ.ศ. ${todayBuddhistYear} / ค.ศ. ${todayYear})
วิเคราะห์บิล/ใบเสร็จ/สลิปค่าใช้จ่ายของร้านในรูปนี้ (เช่น ค่าเช่า ค่าน้ำ-ไฟ ค่าแรง ค่าซ่อม ฯลฯ — ไม่ใช่รายการสินค้าซื้อเข้าสต็อค)
ตอบกลับเป็น JSON เท่านั้น ห้ามมีข้อความอื่น:
{"label":"รายการ/หมวดหมู่ค่าใช้จ่ายโดยสรุป","vendor":"ชื่อผู้รับเงิน/ร้านค้าที่ออกบิล หรือ -","amount":0.00,"vatType":"รวม VAT แล้ว หรือ ไม่รวม VAT หรือ ไม่มี VAT","invoice_no":"เลขที่เอกสาร หรือ -","invoice_date":"วว/ดด/ปปปป หรือ -"}
กฎ:
■ amount: ยอดรวมสุทธิที่ต้องจ่ายจริงตามเอกสาร
■ vatType: ถ้าเอกสารระบุ VAT/ภาษีมูลค่าเพิ่มแยกไว้ชัดเจนว่ารวมอยู่ในยอดแล้ว ให้ตอบ "รวม VAT แล้ว", ถ้าแยกยอดก่อน VAT กับ VAT ให้ต้องบวกเพิ่มเอง ให้ตอบ "ไม่รวม VAT", ถ้าไม่มี VAT ในเอกสารเลยให้ตอบ "ไม่มี VAT"
■ invoice_date: ปีเป็น พ.ศ. ถ้าปีไม่ชัดให้ยึดปีปัจจุบันข้างบน อย่าเดาปีที่ห่างจากปัจจุบันมาก`;

  const base64Image = imageBuffer.toString('base64');
  const requestBody = {
    contents: [{ parts: [{ text: prompt }, { inlineData: { mimeType: 'image/jpeg', data: base64Image } }] }]
  };

  const response = await axios.post(url, requestBody, { headers: { 'Content-Type': 'application/json' } });
  const rawText = response.data?.candidates?.[0]?.content?.parts?.[0]?.text;
  if (!rawText) throw new Error('โครงสร้างการตอบกลับจาก Gemini API ไม่ถูกต้อง');
  const jsonMatch = rawText.match(/\{[\s\S]*\}/);
  if (!jsonMatch) throw new Error('Gemini ไม่ส่ง JSON กลับมา');
  const parsed = JSON.parse(jsonMatch[0]);
  const validVatTypes = ['รวม VAT แล้ว', 'ไม่รวม VAT', 'ไม่มี VAT'];
  console.log(`[LOG] ✨ [Gemini รายจ่าย] ประมวลผลสำเร็จ — ฿${parsed.amount || 0}`);
  return {
    label: parsed.label || '-',
    vendor: parsed.vendor || '-',
    amount: parseFloat(parsed.amount) || 0,
    vatType: validVatTypes.includes(parsed.vatType) ? parsed.vatType : 'ไม่มี VAT',
    invoice_no: parsed.invoice_no || '-',
    invoice_date: parsed.invoice_date || '-',
  };
}

// tab "รายจ่ายรอยืนยัน" ใน POS Sheet ของร้าน — คนละ tab กับ "รายจ่าย" ที่ยืนยันแล้ว รอแอดมินตรวจก่อนบันทึกจริง
const PENDING_EXPENSE_HEADERS = ['เลขที่รอยืนยัน', 'วันที่-เวลา', 'รายการ/หมวดหมู่ (OCR)', 'ผู้รับเงิน (OCR)', 'จำนวนเงิน (OCR)', 'ประเภท VAT (OCR)', 'เลขที่เอกสาร', 'วันที่ในเอกสาร', 'ลิงก์รูปภาพ', 'สาขา', 'สถานะ'];
async function ensurePendingExpenseSheet(accessToken, posSheetId) {
  const metaRes = await axios.get(
    `https://sheets.googleapis.com/v4/spreadsheets/${posSheetId}?fields=sheets.properties`,
    { headers: { Authorization: `Bearer ${accessToken}` } }
  );
  const exists = metaRes.data.sheets?.some(s => s.properties.title === 'รายจ่ายรอยืนยัน');
  if (exists) return;
  try {
    await axios.post(
      `https://sheets.googleapis.com/v4/spreadsheets/${posSheetId}:batchUpdate`,
      { requests: [{ addSheet: { properties: { title: 'รายจ่ายรอยืนยัน' } } }] },
      { headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' } }
    );
  } catch (addErr) {
    const msg = addErr.response?.data?.error?.message || addErr.message || '';
    if (!msg.includes('already exists')) throw addErr;
  }
  await axios.put(
    `https://sheets.googleapis.com/v4/spreadsheets/${posSheetId}/values/${encodeURIComponent('รายจ่ายรอยืนยัน!A1:K1')}?valueInputOption=USER_ENTERED`,
    { values: [PENDING_EXPENSE_HEADERS] },
    { headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' } }
  );
}
function makePendingExpenseNo() {
  return 'PE' + Date.now().toString(36).toUpperCase();
}
async function appendPendingExpense(accessToken, posSheetId, row) {
  await axios.post(
    `https://sheets.googleapis.com/v4/spreadsheets/${posSheetId}/values/${encodeURIComponent('รายจ่ายรอยืนยัน!A1')}:append?valueInputOption=USER_ENTERED`,
    { values: [row] },
    { headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' } }
  );
}

// ==========================================
// 4. MAIN WEBHOOK ENDPOINT (LINE RECEIVER)
// ==========================================
app.post('/webhook', async (req, res) => {
  // LINE Signature Verification — reject request ที่ไม่ได้มาจาก LINE จริง
  const signature = req.headers['x-line-signature'];
  if (!verifyLineSignature(req.rawBody, signature)) {
    console.warn('[SECURITY] ❌ Invalid x-line-signature — request rejected');
    return res.status(401).send('Unauthorized');
  }

  // ตอบ LINE ทันทีก่อนประมวลผล กัน timeout → retry → ตัดเครดิตซ้ำ
  res.status(200).send('OK');

  const events = req.body.events;
  if (!events || events.length === 0) return;

  for (const event of events) {
    const replyToken = event.replyToken;

    // [FIX 2] Duplicate Guard: กัน LINE retry ยิง event เดิมซ้ำภายใน 5 นาที
    const eventId = event.webhookEventId;
    if (eventId && await isDuplicateEvent(eventId)) {
      console.log(`[LOG] ⏭️ ข้าม event ซ้ำ: ${eventId}`);
      continue;
    }

    // ==================== TEXT COMMAND HANDLER ====================
    if (event.type === 'message' && event.message.type === 'text') {
      const text = (event.message.text || '').trim();
      const sourceId = event.source.groupId || event.source.userId;

      // ดึงข้อมูลร้านก่อนทุก command (รองรับทั้งกลุ่มหลัก สาขา และ DM เจ้าของ)
      const foundCmd = await findShopBySource(sourceId);
      if (!foundCmd) { continue; }
      const { shop, branchName: cmdBranchName } = foundCmd;

      // ---- Manual Entry: รับ / จ่าย ----
      // ตรวจก่อน isSummaryCmd เพราะ "รับ/จ่าย" ไม่ใช่ # command
      const manualEntry = parseManualEntry(text);
      if (manualEntry) {
        // ทุกคนในกลุ่มคีย์ได้ — บันทึกชื่อผู้คีย์ไว้ใน column R เพื่อ audit
        const senderId = event.source.userId;
        try {
          // เช็คเครดิต (Super ข้าม)
          let manualCreditData = null;
          if (!isSuper(shop)) {
            const { data: mCred } = await supabase
              .from('shop_credits').select('balance_credits').eq('shop_id', shop.id).single();
            if (!mCred || mCred.balance_credits <= 0) {
              await replyToLine(replyToken, [{ type: 'text', text: `⚠️ เครดิตหมดแล้วค่ะ กรุณาเติมเครดิตที่:\n${process.env.FRONTEND_URL}/pricing?userId=${shop.owner_line_id}` }]);
              continue;
            }
            manualCreditData = mCred;
          }

          // สร้าง slipData จากข้อความ
          const thaiNow = getThaiDateTime();
          // fingerprint เฉพาะตัว — เดิมใช้คำว่า 'manual' ซ้ำทุกแถวทำให้แก้ไขรายการทีหลังไม่ได้
          const manualFingerprint = 'M' + Date.now().toString(36).toUpperCase();
          const manualSlipData = {
            type: manualEntry.type,
            amount: manualEntry.amount,
            date: thaiNow.date,
            time: thaiNow.time,
            sender: manualEntry.type === 'income' ? 'ลูกค้า (คีย์เอง)' : shop.shop_name,
            receiver: manualEntry.type === 'income' ? shop.shop_name : manualEntry.note,
            note: manualEntry.note,
            ref_no: manualFingerprint
          };

          // บันทึกลง Google Sheets
          const { data: gConfigM } = await supabase
            .from('shop_google_configs')
            .select('google_refresh_token, google_folder_id, google_sheet_id')
            .eq('shop_id', shop.id).maybeSingle();
          let mSheetId = gConfigM?.google_sheet_id || shop.google_sheet_id;

          if (gConfigM?.google_refresh_token && mSheetId) {
            const mAccessToken = await getAccessToken(gConfigM.google_refresh_token);
            const manualCategory = hasFeature(shop, 'business') ? await detectCategory(manualSlipData, shop.id) : '-';
            const manualRecorder = await getDisplayName(event.source);
            try {
              await getOrCreateYearSheet(mAccessToken, mSheetId, thaiNow.year);
              await appendToGoogleSheet(mAccessToken, mSheetId, manualSlipData, 'ไม่มีรูปภาพ (คีย์เอง)', cmdBranchName, thaiNow.year, manualFingerprint, manualCategory, manualEntry.method, manualRecorder || '-', shop.id);
            } catch (sheetErr) {
              if (sheetErr.response?.status === 404) {
                const healed = await recreateShopGoogleAssets(mAccessToken, shop);
                mSheetId = healed.sheetId;
                await getOrCreateYearSheet(mAccessToken, mSheetId, thaiNow.year);
                await appendToGoogleSheet(mAccessToken, mSheetId, manualSlipData, 'ไม่มีรูปภาพ (คีย์เอง)', cmdBranchName, thaiNow.year, manualFingerprint, manualCategory, manualEntry.method, manualRecorder || '-', shop.id);
              } else {
                throw sheetErr;
              }
            }
            console.log(`[LOG] ✍️ Manual entry บันทึกสำเร็จ: ${manualEntry.type} ฿${manualEntry.amount}`);
          } else {
            console.warn('[WARN] Manual entry: ยังไม่เชื่อมต่อ Google Sheets');
          }

          // ตัดเครดิต (atomic — กัน race condition ตอนส่งหลายรายการพร้อมกัน)
          if (!isSuper(shop) && manualCreditData) {
            const { data: deductResult } = await supabase.rpc('deduct_shop_credit', { p_shop_id: shop.id });
            const newBal = deductResult?.[0]?.new_balance ?? (manualCreditData.balance_credits - 1);
            if (newBal < 10 && shop.owner_line_id) {
              const topupUrl = `${process.env.FRONTEND_URL}/pricing?userId=${shop.owner_line_id}`;
              pushToOwner(shop.owner_line_id, [{ type: 'text', text: `⚠️ เครดิตเหลือ ${newBal} แผ่นค่ะ เติมได้ที่:\n${topupUrl}` }]).catch(() => {});
            }
          }

          // ตอบกลับ — Flex Message พร้อมปุ่มแก้ไขข้อมูล (เหมือนสลิปรูปภาพ)
          const savedToSheets = gConfigM?.google_refresh_token && mSheetId;
          if (savedToSheets) {
            await replyToLine(replyToken, [createBeautifulFlexMessage(manualSlipData, manualFingerprint, shop)]);
          } else {
            const fmt = (n) => `฿${parseFloat(n).toLocaleString('th-TH', { minimumFractionDigits: 2 })}`;
            const isInc = manualEntry.type === 'income';
            await replyToLine(replyToken, [{
              type: 'text',
              text: `${isInc ? '✅ บันทึกรายรับ' : '✅ บันทึกรายจ่าย'}\n` +
                `💰 ${fmt(manualEntry.amount)}\n` +
                `📝 ${manualEntry.note !== '-' ? manualEntry.note : 'ไม่มีหมายเหตุ'}\n` +
                `📅 ${thaiNow.date} ${thaiNow.time}\n\n` +
                '⚠️ ยังไม่ได้เชื่อมต่อ Google Sheets'
            }]);
          }

        } catch (manualErr) {
          console.error('[ERROR] Manual entry error:', manualErr.message);
          try { await replyToLine(replyToken, [{ type: 'text', text: `❌ บันทึกไม่สำเร็จ: ${manualErr.message}` }]); } catch(e) {}
        }
        continue;
      }
      // ---- End Manual Entry ----

      // ---- #รับสินค้า — พิมพ์คำสั่งนี้แล้วส่งรูปใบส่งของ/ใบกำกับภาษีถัดไป จะถูกอ่านเป็นรายการรับสินค้ารอยืนยัน (ไม่ใช่สลิปโอนเงิน) ----
      if (text === '#รับสินค้า' || text === '#รับของ') {
        const senderId = event.source.userId;
        try {
          const { data: posConfig } = await supabase
            .from('pos_configs').select('pos_sheet_id').eq('shop_id', shop.id).maybeSingle();
          if (!posConfig?.pos_sheet_id) {
            await replyToLine(replyToken, [{ type: 'text', text: '⚠️ ร้านนี้ยังไม่ได้เปิดใช้งานระบบ POS ค่ะ ตั้งค่าที่หน้า Dashboard → POS ก่อนนะคะ' }]);
            continue;
          }
          await setAwaitingReceive(senderId, shop.id, cmdBranchName);
          await replyToLine(replyToken, [{
            type: 'text',
            text: '📥 ส่งรูปใบส่งของ/ใบกำกับภาษีจากผู้จำหน่ายเข้ามาได้เลยค่ะ (ภายใน 10 นาที)\nระบบจะอ่านรายการสินค้าให้อัตโนมัติ แล้วรอแอดมินกดยืนยันในหน้า Dashboard → รับสินค้า อีกทีก่อนตัดเข้าสต็อคจริงค่ะ',
          }]);
        } catch (err) {
          console.error('[ERROR] #รับสินค้า error:', err.message);
          try { await replyToLine(replyToken, [{ type: 'text', text: `❌ เกิดข้อผิดพลาด: ${err.message}` }]); } catch(e) {}
        }
        continue;
      }
      // ---- End #รับสินค้า ----

      // ---- #รายจ่าย — พิมพ์คำสั่งนี้แล้วส่งรูปบิล/สลิปค่าใช้จ่ายถัดไป (ไม่เกี่ยวกับสต็อคสินค้า เช่น ค่าเช่า/ค่าน้ำไฟ) ----
      if (text === '#รายจ่าย' || text === '#ค่าใช้จ่าย') {
        const senderId = event.source.userId;
        try {
          const { data: posConfig } = await supabase
            .from('pos_configs').select('pos_sheet_id').eq('shop_id', shop.id).maybeSingle();
          if (!posConfig?.pos_sheet_id) {
            await replyToLine(replyToken, [{ type: 'text', text: '⚠️ ร้านนี้ยังไม่ได้เปิดใช้งานระบบ POS ค่ะ ตั้งค่าที่หน้า Dashboard → POS ก่อนนะคะ' }]);
            continue;
          }
          await setAwaitingExpense(senderId, shop.id, cmdBranchName);
          await replyToLine(replyToken, [{
            type: 'text',
            text: '🧾 ส่งรูปบิล/ใบเสร็จ/สลิปค่าใช้จ่ายเข้ามาได้เลยค่ะ (ภายใน 10 นาที) — สำหรับค่าใช้จ่ายที่ไม่เกี่ยวกับสต็อคสินค้า เช่น ค่าเช่า ค่าน้ำ-ไฟ ค่าแรง\nระบบจะอ่านยอด/VAT ให้อัตโนมัติ แล้วรอแอดมินกดยืนยันในหน้า Dashboard → รายจ่าย อีกทีก่อนบันทึกจริงค่ะ\n\n(ถ้าเป็นใบส่งของ/ใบกำกับภาษีที่ซื้อสินค้าเข้าสต็อค ให้ใช้ #รับสินค้า แทนนะคะ)',
          }]);
        } catch (err) {
          console.error('[ERROR] #รายจ่าย error:', err.message);
          try { await replyToLine(replyToken, [{ type: 'text', text: `❌ เกิดข้อผิดพลาด: ${err.message}` }]); } catch(e) {}
        }
        continue;
      }
      // ---- End #รายจ่าย ----

      // ---- #สมัครแอดมิน — ขอเป็นแอดมินร้านผ่านกลุ่ม LINE ----
      if (text === '#สมัครแอดมิน') {
        const senderId = event.source.userId;
        const groupId = event.source.groupId;
        // ต้องอยู่ในกลุ่ม LINE เท่านั้น (ไม่รับใน DM)
        if (!groupId) {
          await replyToLine(replyToken, [{ type: 'text', text: '⚠️ คำสั่งนี้ใช้ได้เฉพาะในกลุ่ม LINE ที่เชื่อมต่อกับร้านค้าเท่านั้นค่ะ' }]);
          continue;
        }
        // ห้ามเจ้าของสมัครตัวเอง
        if (senderId === shop.owner_line_id) {
          await replyToLine(replyToken, [{ type: 'text', text: '😊 คุณคือเจ้าของร้านอยู่แล้วค่ะ ไม่ต้องสมัครแอดมินนะคะ' }]);
          continue;
        }
        // ดึงชื่อ LINE จาก Group Member Profile (ไม่เปิดเผย User ID ให้ใคร)
        let displayName = null;
        try {
          const profileRes = await axios.get(
            `https://api.line.me/v2/bot/group/${groupId}/member/${senderId}`,
            LINE_HEADER
          );
          displayName = profileRes.data.displayName || null;
        } catch (e) { /* ถ้า API ล้มเหลวก็บันทึกโดยไม่มีชื่อ */ }

        // upsert — ถ้าส่งซ้ำก็ไม่เป็นไร
        const { error: adminErr } = await supabase.from('shop_admins').upsert({
          shop_id: shop.id,
          line_user_id: senderId,
          display_name: displayName,
          status: 'pending',
        }, { onConflict: 'shop_id,line_user_id' });

        if (adminErr) {
          console.error('[ADMIN] upsert error:', adminErr.message);
          await replyToLine(replyToken, [{ type: 'text', text: '❌ เกิดข้อผิดพลาด กรุณาลองใหม่ภายหลังค่ะ' }]);
        } else {
          console.log(`[ADMIN] คำขอแอดมินจาก ${displayName || senderId} ร้าน ${shop.id}`);
          await replyToLine(replyToken, [{
            type: 'text',
            text: `📋 ส่งคำขอเป็นแอดมินร้าน "${shop.shop_name}" แล้วค่ะ\n\n` +
              `รอเจ้าของร้านอนุมัติในแดชบอร์ด (ตั้งค่า → แอดมินร้าน) นะคะ 😊\n\n` +
              `⚠️ อย่าลืมกด "เพิ่มเพื่อน" บัญชีไลน์ Smile Slip ด้วยนะคะ ไม่งั้นระบบจะแจ้งเตือนหาไม่ได้ค่ะ\n👉 https://lin.ee/wdnoEN5`
          }]);
          // Push แจ้งเจ้าของ
          if (shop.owner_line_id) {
            pushToOwner(shop.owner_line_id, [{
              type: 'text',
              text: `🔔 มีคำขอเป็นแอดมินร้าน "${shop.shop_name}" ใหม่!\n` +
                `👤 ${displayName || 'สมาชิกในกลุ่ม'}\n\n` +
                `อนุมัติได้ที่ Dashboard → ตั้งค่า → แอดมินร้านค่ะ`
            }]).catch(() => {});
          }
        }
        continue;
      }
      // ---- End #สมัครแอดมิน ----

      // ---- #สมัครพนักงาน / #สมัครพนักงานขนส่ง / #สมัครผู้จัดการสาขา — ขอสิทธิ์ระดับสาขาผ่านกลุ่ม LINE ----
      // #สมัครพนักงาน คือชื่อคำสั่งหลัก (เข้าใจง่ายกว่า ไม่ผูกกับงานส่งของโดยเฉพาะ) — ใช้ role
      // 'delivery_staff' เดียวกันเป๊ะ (พนักงานทุกตำแหน่งใช้ PIN เดียวกันได้หมด เช่น เปิด-ปิดกะเงินสด
      // ไม่ได้จำกัดแค่งานส่งของ) เจ้าของร้านเปลี่ยนชื่อตำแหน่งได้ทีหลังจากหน้าแก้ไขพนักงานใน Dashboard
      // — คง #สมัครพนักงานขนส่ง ไว้ใช้ได้เหมือนเดิมด้วย กันคนที่คุ้นเคยคำสั่งเดิมอยู่แล้ว
      if (text === '#สมัครพนักงาน') {
        await requestBranchRole(replyToken, shop, foundCmd, event.source.userId, event.source.groupId, 'delivery_staff', 'พนักงาน');
        continue;
      }
      if (text === '#สมัครพนักงานขนส่ง') {
        await requestBranchRole(replyToken, shop, foundCmd, event.source.userId, event.source.groupId, 'delivery_staff', 'พนักงานส่ง');
        continue;
      }
      if (text === '#สมัครผู้จัดการสาขา') {
        await requestBranchRole(replyToken, shop, foundCmd, event.source.userId, event.source.groupId, 'branch_manager', 'ผู้จัดการสาขา');
        continue;
      }
      // ---- End #สมัครพนักงาน / #สมัครพนักงานขนส่ง / #สมัครผู้จัดการสาขา ----

      const isSummaryCmd =['#สรุปวันนี้','#สรุปวัน','#สรุปเดือนนี้','#สรุปเดือน','#กำไรขาดทุน','#กำไร','#สรุปทุกสาขา','#สรุปอาทิตย์นี้','#สรุปสัปดาห์','#สรุปปีนี้','#สรุปปี','#สรุปวันที่','#ดูวันที่','#รายงาน','#ช่วยเหลือ','#help','#วิธีใช้งาน'].some(k => text.startsWith(k));
      if (!isSummaryCmd) continue; // ไม่ใช่ command ของเรา ข้ามไป

      try {
        // คำสั่ง #ช่วยเหลือ — ทุกแผน
        if (text.startsWith('#ช่วยเหลือ') || text.startsWith('#help')) {
          const tier = getTier(shop);
          const helpText = `📋 คำสั่งที่ใช้ได้ (${tier.toUpperCase()})\n\n` +
            `📸 ส่งรูปสลิป → บันทึกอัตโนมัติ\n\n` +
            `📥 #รับสินค้า แล้วส่งรูปใบส่งของจากผู้จำหน่าย → อ่านรายการสินค้าอัตโนมัติ (ร้านที่เปิด POS เท่านั้น รอแอดมินยืนยันที่ Dashboard ก่อนตัดสต็อค)\n\n` +
            `🧾 #รายจ่าย แล้วส่งรูปบิล/ใบเสร็จค่าใช้จ่าย (ค่าเช่า/ค่าน้ำ-ไฟ ฯลฯ ไม่เกี่ยวกับสต็อค) → อ่านยอด/VAT อัตโนมัติ (ร้านที่เปิด POS เท่านั้น รอแอดมินยืนยันที่ Dashboard ก่อนบันทึกจริง)\n\n` +
            `✍️ คีย์รายการเอง:\n` +
            `  รับ [จำนวน] [หมายเหตุ] (เงินสด)\n` +
            `  รับโอน [จำนวน] [หมายเหตุ]\n` +
            `  จ่าย [จำนวน] [หมายเหตุ] (เงินสด)\n` +
            `  จ่ายโอน [จำนวน] [หมายเหตุ]\n` +
            `  เช่น: รับ 500 ค่าแก๊ส\n` +
            `  เช่น: จ่ายโอน 1200 ค่าไฟฟ้า\n` +
            `  ⚠️ รายการที่คีย์เองจะไม่มีรูปสลิปแนบ\n\n` +
            `👥 สมัครสิทธิ์ในกลุ่มนี้:\n` +
            `  #สมัครแอดมิน (คีย์รายการแทนเจ้าของทั้งร้าน)\n` +
            `  #สมัครพนักงาน (พนักงานของสาขานี้ ได้ PIN เข้าเว็บ POS)\n` +
            `  #สมัครผู้จัดการสาขา (ดูแลสาขานี้)\n` +
            `  ⚠️ ทุกคำขอต้องรอเจ้าของ/แอดมินอนุมัติที่ Dashboard ก่อน\n\n` +
            (hasFeature(shop, 'pro') ?
              `📊 #สรุปวันนี้\n📅 #สรุปเดือนนี้\n📆 #สรุปอาทิตย์นี้\n🗓 #สรุปปีนี้\n📌 #สรุปวันที่ 07/06\n💰 #กำไรขาดทุน\n📋 #รายงาน\n` +
              (hasFeature(shop, 'advance') ? `🏢 #สรุปทุกสาขา\n` : '') :
              `🔒 อัปเกรดเป็น Shop Pro เพื่อใช้คำสั่งสรุปยอด\n`) +
            `\n💡 พิมพ์ #วิธีใช้งาน เพื่อดูคำสอนแบบละเอียดทีละหัวข้อ`;
          await replyToLine(replyToken, [{ type: "text", text: helpText }]);
          continue;
        }

        // คำสั่ง #วิธีใช้งาน — เมนูสอนใช้งานแบบเลือกหัวข้อ (ละเอียด/คร่าวๆ)
        if (text.startsWith('#วิธีใช้งาน')) {
          const TOPICS = {
            'สลิป': {
              label: '📸 ส่งสลิป/บิล',
              brief: '📸 ส่งสลิป/บิล\n\nส่งรูปสลิปโอนเงินหรือบิลรายจ่ายเข้ากลุ่มนี้ได้เลย บอทจะอ่านและบันทึกอัตโนมัติ ไม่ต้องพิมพ์อะไรเพิ่ม',
              detail: '📸 ส่งสลิป/บิล (แบบละเอียด)\n\n1. ถ่ายรูปหรือแคปรูปสลิป/บิลให้เห็นชัด ไม่เบลอ\n2. ส่งรูปเข้ากลุ่ม LINE นี้ได้เลย ไม่ต้องพิมพ์ข้อความเพิ่ม\n3. บอทจะอ่านข้อมูล (วันที่ เวลา จำนวนเงิน ผู้โอน-ผู้รับ) อัตโนมัติด้วย AI\n4. ระบบเช็คชื่อบัญชีร้านอัตโนมัติว่าเป็นรายรับหรือรายจ่าย\n5. บันทึกเข้า Google Sheets + เก็บรูปไว้ใน Google Drive ให้ทันที\n6. ตอบกลับเป็นการ์ดสรุป พร้อมปุ่ม "✏️ แก้ไขข้อมูล" หากอ่านผิด\n⚠️ ต้องเชื่อมต่อ Google Drive ไว้ก่อน (ดูที่หน้าเว็บ → ตั้งค่า) ไม่งั้นจะไม่บันทึกลง Sheets ให้\n⚠️ ส่งรูปซ้ำจะถูกระบบกันซ้ำอัตโนมัติ ไม่ถูกหักเครดิตซ้ำ'
            },
            'รับสินค้า': {
              label: '📥 รับสินค้าจากรูป',
              brief: '📥 รับสินค้าจากรูป (ร้านที่เปิด POS)\n\nพิมพ์ #รับสินค้า แล้วส่งรูปใบส่งของ บอทจะอ่านรายการ/ราคาให้ แล้วเข้าคิวรอแอดมินตรวจสอบที่ Dashboard ก่อนตัดสต็อคจริง',
              detail: '📥 รับสินค้าจากรูป (แบบละเอียด — ร้านที่เปิด POS เท่านั้น)\n\n1. พิมพ์ #รับสินค้า (หรือ #รับของ) ในกลุ่มนี้ก่อน\n2. ภายใน 10 นาทีถัดไป ส่งรูปใบส่งของจากผู้จำหน่ายเข้ากลุ่มได้เลย (ส่งได้หลายรูป/อัลบั้มเดียวกันก็อ่านครบทุกใบ)\n3. บอทจะอ่านชื่อผู้จำหน่าย/เลขที่ใบส่งของ/รายการสินค้า/จำนวน/ราคาให้อัตโนมัติด้วย AI\n4. ข้อมูลจะเข้าคิว "รับสินค้ารอยืนยัน" ที่ Dashboard → POS → รับสินค้า ยังไม่ตัดสต็อคทันที\n5. แอดมินต้องกด "ตรวจสอบ/ยืนยัน" ที่หน้าเว็บก่อน ระบบจะจับคู่ชื่อสินค้าที่อ่านได้กับสินค้าจริงให้ แก้ไขได้ก่อนกดยืนยันจริง\n⚠️ ต้องเปิดใช้งาน POS ไว้ก่อน (Dashboard → เปิดระบบ POS) ไม่งั้นจะใช้คำสั่งนี้ไม่ได้\n⚠️ รูปที่จับคู่สินค้าไม่ได้ จะไม่ถูกใส่ในฟอร์มอัตโนมัติ ต้องไปเพิ่มสินค้าใหม่เองก่อน'
            },
            'รายจ่าย': {
              label: '🧾 บันทึกรายจ่ายจากรูป',
              brief: '🧾 บันทึกรายจ่ายจากรูป (ร้านที่เปิด POS)\n\nพิมพ์ #รายจ่าย แล้วส่งรูปบิล/ใบเสร็จค่าใช้จ่าย (ค่าเช่า/ค่าน้ำ-ไฟ ฯลฯ ไม่เกี่ยวกับสต็อคสินค้า) บอทอ่านยอด/VAT ให้ แล้วรอแอดมินยืนยัน',
              detail: '🧾 บันทึกรายจ่ายจากรูป (แบบละเอียด — ร้านที่เปิด POS เท่านั้น)\n\n1. พิมพ์ #รายจ่าย ในกลุ่มนี้ก่อน\n2. ภายใน 10 นาทีถัดไป ส่งรูปบิล/ใบเสร็จค่าใช้จ่ายที่ไม่เกี่ยวกับสต็อคสินค้า (เช่น ค่าเช่าร้าน ค่าน้ำ ค่าไฟ ค่าน้ำมัน) เข้ากลุ่มได้เลย\n3. บอทจะอ่านชื่อผู้รับเงิน/ยอดเงิน/วันที่/VAT ให้อัตโนมัติด้วย AI\n4. ข้อมูลจะเข้าคิว "รอยืนยันจาก LINE" ที่ Dashboard → POS → รายจ่าย ยังไม่บันทึกเข้าบัญชีจริงทันที\n5. แอดมินต้องกด "ตรวจสอบ/ยืนยัน" ที่หน้าเว็บก่อน แก้ไขได้ก่อนกดยืนยันจริง\n⚠️ ต้องเปิดใช้งาน POS ไว้ก่อน (Dashboard → เปิดระบบ POS) ไม่งั้นจะใช้คำสั่งนี้ไม่ได้\n⚠️ ถ้าเป็นค่าใช้จ่ายที่เกี่ยวกับซื้อสินค้าเข้าสต็อค ให้ใช้ #รับสินค้า แทน ไม่ใช่ #รายจ่าย'
            },
            'คีย์เอง': {
              label: '✍️ คีย์รายการเอง',
              brief: '✍️ คีย์รายการเอง\n\nพิมพ์ "รับ [จำนวน] [หมายเหตุ]" หรือ "จ่าย [จำนวน] [หมายเหตุ]" — ค่าเริ่มต้นคือเงินสด ถ้าเป็นเงินโอนให้พิมพ์ "รับโอน"/"จ่ายโอน" แทน ระบบจะบันทึกชื่อผู้คีย์ไว้อัตโนมัติ',
              detail: '✍️ คีย์รายการเอง (แบบละเอียด)\n\nใช้ตอนไม่มีสลิป เช่น ขายเงินสดหน้าร้าน หรือจ่ายค่าใช้จ่ายที่ไม่มีใบเสร็จ\n\n• รับ [จำนวน] [หมายเหตุ] → รายรับ เงินสด\n• รับโอน [จำนวน] [หมายเหตุ] → รายรับ เงินโอน\n• จ่าย [จำนวน] [หมายเหตุ] → รายจ่าย เงินสด\n• จ่ายโอน [จำนวน] [หมายเหตุ] → รายจ่าย เงินโอน\n\nตัวอย่าง:\n  รับ 500 ขายของหน้าร้าน\n  รับโอน 1500 ลูกค้าโอนจ่าย\n  จ่าย 300 ค่ากับข้าว\n  จ่ายโอน 1200 ค่าไฟฟ้า\n\n⚠️ ทุกคนในกลุ่มไลน์คีย์ได้ ไม่ใช่แค่เจ้าของร้าน (ระบบบันทึกชื่อผู้คีย์ไว้ตรวจสอบย้อนหลัง)\n⚠️ รายการที่คีย์เองจะไม่มีรูปสลิปแนบ และจะบันทึกชื่อผู้คีย์ไว้ในคอลัมน์ "ผู้บันทึก" ด้วย'
            },
            'สรุปยอด': {
              label: '📊 ดูสรุปยอด',
              brief: '📊 ดูสรุปยอด (Pro ขึ้นไป)\n\nพิมพ์ #สรุปวันนี้ #สรุปเดือนนี้ #สรุปอาทิตย์นี้ #สรุปปีนี้ #กำไรขาดทุน หรือ #สรุปวันที่ 07/06 เพื่อดูยอดย้อนหลัง',
              detail: '📊 ดูสรุปยอด (แบบละเอียด — Pro ขึ้นไป)\n\n• #สรุปวันนี้ — ยอดรับ-จ่ายของวันนี้\n• #สรุปเดือนนี้ — ยอดรวมเดือนนี้\n• #สรุปอาทิตย์นี้ — ยอดรวมจันทร์-อาทิตย์นี้\n• #สรุปปีนี้ — ยอดรวมทั้งปี\n• #สรุปวันที่ 07/06 — ยอดย้อนหลังวันที่ระบุ\n• #กำไรขาดทุน หรือ #รายงาน — สรุปกำไร-ขาดทุนเดือนนี้\n• #สรุปทุกสาขา — สรุปแยกรายสาขา (Advance ขึ้นไป)\n\nดูกราฟแนวโน้มแบบละเอียดกว่านี้ได้ที่หน้าเว็บ → กราฟวิเคราะห์ (เลือกดูรายสาขาหรือรวมทุกสาขาได้)'
            },
            'สาขา': {
              label: '🏢 จัดการหลายสาขา',
              brief: '🏢 หลายสาขา\n\nเพิ่มสาขาที่หน้าเว็บ → จัดการสาขา แล้วผูกกลุ่ม LINE ของสาขานั้น ข้อมูลทุกสาขาจะรวมอยู่ที่ Sheets เดียวกัน แยกดูได้ในเว็บ',
              detail: '🏢 จัดการหลายสาขา (แบบละเอียด)\n\n1. เข้าหน้าเว็บ → จัดการสาขา → เพิ่มชื่อสาขาใหม่\n2. เพิ่มบอทเข้ากลุ่ม LINE ของสาขานั้น แล้วผูกกลุ่มกับสาขาที่สร้างไว้\n3. พนักงานสาขานั้นส่งสลิปเข้ากลุ่มของสาขาตัวเอง บอทจะรู้เองว่าเป็นของสาขาไหน\n4. ข้อมูลทุกสาขาจะถูกบันทึกรวมใน Google Sheets ชุดเดียวกันของร้าน (แยกคอลัมน์ชื่อสาขา)\n5. ดูแยกรายสาขาได้ที่หน้าเว็บ → บัญชี (ตัวกรองสาขา) หรือ → กราฟวิเคราะห์ (Advance ขึ้นไปเปรียบเทียบสาขาได้)\n6. พิมพ์ #สรุปทุกสาขา ในกลุ่มไหนก็ได้เพื่อดูสรุปแยกทุกสาขา (Advance ขึ้นไป)'
            },
            'เครดิต': {
              label: '💳 เครดิต/แพ็กเกจ',
              brief: '💳 เครดิต/แพ็กเกจ\n\nสแกนสลิป 1 ครั้ง = 1 เครดิต คีย์เอง/ดูสรุปยอดไม่เสียเครดิต เครดิตหมดเติมได้ที่หน้าเว็บ → แพ็กเกจ/เครดิต',
              detail: '💳 เครดิต/แพ็กเกจ (แบบละเอียด)\n\n• สแกนสลิป (ส่งรูป) = หัก 1 เครดิตต่อรูป\n• คีย์รายการเอง (รับ/จ่าย) และคำสั่งสรุปยอด ไม่เสียเครดิต\n• แพ็กเกจ Enterprise/Super สแกนได้ไม่จำกัด ไม่หักเครดิต\n• เครดิตใกล้หมด (<10 แผ่น) บอทจะ Push แจ้งเจ้าของร้านอัตโนมัติ\n• เครดิตหมด → บอทหยุดรับสลิปชั่วคราว แต่ยังเข้าเว็บมาคีย์เองได้เสมอ\n• เติมเครดิต/อัปเกรดแพ็กเกจได้ที่หน้าเว็บ → แพ็กเกจ/เครดิต ชำระผ่าน Stripe ปลอดภัย\n• เครดิตรายเดือนของแพ็กเกจ Pro/Advance/Business จะเข้าอัตโนมัติทุกรอบบิล ไม่มีวันหมดอายุ'
            },
            'แก้ไข': {
              label: '✏️ แก้ไขรายการ',
              brief: '✏️ แก้ไขรายการ\n\nกดปุ่ม "✏️ แก้ไขข้อมูล" ใต้การ์ดที่บอทตอบ หรือกดปุ่มแก้ไขที่แถวรายการในหน้าเว็บ → บัญชี',
              detail: '✏️ แก้ไขรายการ (แบบละเอียด)\n\nวิธีที่ 1 — จาก LINE: กดปุ่ม "✏️ แก้ไขข้อมูล" ที่อยู่ใต้การ์ดสรุปที่บอทตอบกลับมาทันทีหลังส่งสลิป จะเด้งไปหน้าแก้ไขของรายการนั้นโดยตรง\n\nวิธีที่ 2 — จากหน้าเว็บ: เข้า → บัญชี หาแถวรายการที่ต้องการแก้ แล้วกดไอคอน ✏️ ที่ท้ายแถว\n\nแก้ไขได้: ประเภท (รับ/จ่าย) จำนวนเงิน ผู้โอน ผู้รับ หมายเหตุ\n⚠️ แก้ได้เฉพาะรายการที่มีเลขอ้างอิงในคอลัมน์ K เท่านั้น (รายการเก่ามากๆก่อนระบบมีเลขอ้างอิงจะแก้ผ่านระบบไม่ได้ ต้องแก้ตรงใน Google Sheets เอง)'
            },
            'กูเกิล': {
              label: '🔌 เชื่อมต่อ Google',
              brief: '🔌 เชื่อมต่อ Google Drive/Sheets\n\nไปที่หน้าเว็บ → ตั้งค่า → กดปุ่ม "เชื่อมต่อ Google" ล็อกอินด้วย Gmail ของร้าน ระบบจะสร้างโฟลเดอร์+ชีทให้อัตโนมัติ',
              detail: '🔌 เชื่อมต่อ Google Drive/Sheets (แบบละเอียด)\n\n1. เข้าหน้าเว็บ → ตั้งค่า\n2. กดปุ่ม "เชื่อมต่อ Google"\n3. ล็อกอินด้วยบัญชี Gmail ที่ต้องการใช้เก็บข้อมูลร้าน (แนะนำใช้ Gmail ของร้าน ไม่ใช่ส่วนตัว)\n4. ระบบจะสร้างโฟลเดอร์ Drive ชื่อ "SMILE SLIP - ชื่อร้าน" และ Google Sheet บัญชีให้อัตโนมัติ\n5. รูปสลิปทุกใบจะถูกเก็บใน Drive แยกตามปี/เดือน ส่วนข้อมูลตัวเลขจะอยู่ใน Sheets\n6. เชื่อมต่อสำเร็จครั้งแรกจะได้รับเครดิตโบนัสด้วย\n⚠️ ข้อมูลการเงินทั้งหมดเก็บใน Google ของร้านเอง ไม่ได้เก็บไว้ที่ฐานข้อมูลกลางของ Smile Slip Pro (เพื่อความเป็นส่วนตัวตาม PDPA)'
            },
            'แอดมิน': {
              label: '👥 แอดมินร้าน',
              brief: '👥 แอดมินร้าน\n\nพนักงานพิมพ์ #สมัครแอดมิน ในกลุ่ม เจ้าของไปอนุมัติที่หน้าเว็บ → ตั้งค่า → แอดมินร้าน',
              detail: '👥 แอดมินร้าน (แบบละเอียด)\n\nแอดมินร้าน คือพนักงานที่ได้รับสิทธิ์คีย์รายการเอง (รับ/จ่าย) แทนเจ้าของได้\n\n1. พนักงานพิมพ์ #สมัครแอดมิน ในกลุ่ม LINE ของร้าน/สาขา\n2. ระบบส่งคำขอไปแจ้งเจ้าของร้านทาง LINE ทันที\n3. เจ้าของเข้าหน้าเว็บ → ตั้งค่า → แอดมินร้าน → กดอนุมัติหรือปฏิเสธ\n4. หลังอนุมัติแล้ว พนักงานคนนั้นจะคีย์ "รับ/จ่าย" เองได้จากกลุ่มเดียวกัน\n⚠️ จำนวนแอดมินที่เพิ่มได้ขึ้นกับแพ็กเกจ (Business ขึ้นไปได้หลายคน)'
            },
            'พนักงาน': {
              label: '🛵 สมัครเป็นพนักงานสาขา',
              brief: '🛵 สมัครเป็นพนักงานสาขา\n\nพิมพ์ #สมัครพนักงาน (หรือ #สมัครผู้จัดการสาขา) ในกลุ่ม LINE ของสาขานั้น รอเจ้าของ/แอดมินอนุมัติที่ Dashboard → POS → ตั้งค่า → คำขอสมัคร',
              detail: '🛵 สมัครเป็นพนักงานสาขา (แบบละเอียด)\n\nต่างจาก "แอดมินร้าน" ตรงที่ผูกกับ "สาขา" ที่กลุ่ม LINE นั้นเชื่อมต่ออยู่ ใช้สำหรับพนักงานที่ต้องเข้าเว็บ POS ด้วย PIN ของตัวเอง (ขาย/รับสินค้า/เปิด-ปิดกะเงินสด/ยืนยันจัดส่ง)\n\n1. พิมพ์ #สมัครพนักงาน ในกลุ่ม LINE ของสาขานั้น (พนักงานทั่วไป/แคชเชียร์/พนักงานขาย ใช้คำสั่งนี้ได้หมด ไม่ได้จำกัดเฉพาะงานส่งของ) หรือ #สมัครผู้จัดการสาขา ถ้าเป็นผู้ดูแลสาขา\n2. ระบบส่งคำขอไปแจ้งเจ้าของร้านทาง LINE ทันที\n3. เจ้าของ/แอดมินเข้าหน้าเว็บ → POS → ตั้งค่า → คำขอสมัคร → กดอนุมัติ\n4. หลังอนุมัติ ระบบจะส่งลิงก์ตั้ง PIN 4 หลักให้ทาง LINE อัตโนมัติทันที ตั้งเสร็จแล้วใช้ PIN นั้นเข้าเว็บ POS/หน้าพนักงานได้เลย\n⚠️ ต้องกด "เพิ่มเพื่อน" บัญชีไลน์ Smile Slip ก่อน (https://lin.ee/wdnoEN5) ไม่งั้นจะไม่ได้รับลิงก์ตั้ง PIN/แจ้งเตือนงานเลย แม้อนุมัติแล้วก็ตาม\n⚠️ ใช้ได้เฉพาะกลุ่ม LINE ที่ผูกกับสาขาไว้แล้วเท่านั้น ถ้าพิมพ์ในกลุ่มร้านหลักที่ไม่ใช่สาขา จะไม่มีผล'
            },
          };

          const parts = text.replace('#วิธีใช้งาน', '').trim().split(/\s+/).filter(Boolean);
          const topicKey = parts[0];
          const wantDetail = parts.includes('ละเอียด');

          if (!topicKey || !TOPICS[topicKey]) {
            // แสดงเมนูเลือกหัวข้อ
            await replyToLine(replyToken, [{
              type: 'flex',
              altText: 'เลือกหัวข้อที่ต้องการเรียนรู้การใช้งาน',
              contents: {
                type: 'bubble', size: 'mega',
                header: {
                  type: 'box', layout: 'vertical', backgroundColor: '#1e3a8a', paddingAll: '16px',
                  contents: [
                    { type: 'text', text: '📚 วิธีใช้งาน Smile Slip Pro', color: '#ffffff', weight: 'bold', size: 'md', wrap: true }
                  ]
                },
                body: {
                  type: 'box', layout: 'vertical', spacing: 'sm', paddingAll: '12px',
                  contents: [
                    { type: 'text', text: 'เลือกหัวข้อที่อยากรู้ได้เลยค่ะ', size: 'xs', color: '#94a3b8', margin: 'sm' },
                    ...Object.entries(TOPICS).map(([key, t]) => ({
                      type: 'button', style: 'secondary', height: 'sm', color: '#eff6ff',
                      action: { type: 'message', label: t.label, text: `#วิธีใช้งาน ${key}` }
                    }))
                  ]
                }
              }
            }]);
            continue;
          }

          const topic = TOPICS[topicKey];
          const bodyText = wantDetail ? topic.detail : topic.brief;
          const toggleLabel = wantDetail ? '📖 ดูแบบคร่าวๆ' : '📖 ดูแบบละเอียด';
          const toggleText = wantDetail ? `#วิธีใช้งาน ${topicKey}` : `#วิธีใช้งาน ${topicKey} ละเอียด`;

          await replyToLine(replyToken, [{
            type: 'flex',
            altText: bodyText.split('\n')[0],
            contents: {
              type: 'bubble', size: 'mega',
              body: {
                type: 'box', layout: 'vertical', spacing: 'md', paddingAll: '16px',
                contents: [
                  { type: 'text', text: bodyText, wrap: true, size: 'sm', color: '#334155' }
                ]
              },
              footer: {
                type: 'box', layout: 'vertical', spacing: 'sm', paddingAll: '12px',
                contents: [
                  { type: 'button', style: 'secondary', height: 'sm', color: '#eff6ff',
                    action: { type: 'message', label: toggleLabel, text: toggleText } },
                  { type: 'button', style: 'link', height: 'sm',
                    action: { type: 'message', label: '⬅️ กลับไปเลือกหัวข้ออื่น', text: '#วิธีใช้งาน' } }
                ]
              }
            }
          }]);
          continue;
        }

        // คำสั่งสรุป — ต้องใช้ Pro ขึ้นไป
        if (!hasFeature(shop, 'pro')) {
          await replyToLine(replyToken, [{
            type: "text",
            text: `🔒 ฟีเจอร์นี้สำหรับแพ็กเกจ Shop Pro ขึ้นไปค่ะ\n\nอัปเกรดได้ที่:\n${process.env.FRONTEND_URL}/pricing?userId=${shop.owner_line_id}`
          }]);
          continue;
        }

        // ดึง Google config
        const { data: gConfig } = await supabase
          .from('shop_google_configs')
          .select('google_refresh_token, google_sheet_id')
          .eq('shop_id', shop.id)
          .maybeSingle();

        const cmdSheetId = gConfig?.google_sheet_id || shop.google_sheet_id;
        if (!gConfig?.google_refresh_token || !cmdSheetId) {
          await replyToLine(replyToken, [{ type: "text", text: "⚠️ ยังไม่ได้เชื่อมต่อ Google Sheets ค่ะ กรุณาตั้งค่าที่ Dashboard ก่อนนะคะ" }]);
          continue;
        }

        // Tier D read-cutover — อ่านสรุปยอดจาก Supabase (ledger_transactions) แทน Sheets แล้ว
        // ไม่ต้องขอ accessToken/getOrCreateYearSheet อีกต่อไปสำหรับคำสั่งสรุปกลุ่มนี้ (เช็ค
        // gConfig ด้านบนไว้เหมือนเดิมแค่เพื่อยืนยันว่าร้านเชื่อม Google แล้วจริง — ร้านที่ไม่เคย
        // เชื่อมจะไม่มีข้อมูลใน ledger_transactions เลยอยู่แล้วเพราะบอทเขียนคู่กับ Sheets เสมอ)
        const { isoDate, year, month } = getThaiDateTime();

        let summaryMsg;

        if (text.startsWith('#สรุปวันนี้') || text.startsWith('#สรุปวัน')) {
          const [y, m, d] = isoDate.split('-').map(Number);
          const summary = await readSheetSummary(shop.id, bangkokMidnightUTC(y, m, d), bangkokMidnightUTC(y, m, d + 1));
          summaryMsg = createSummaryFlexMessage('สรุปยอดวันนี้', summary, isoDate);

        } else if (text.startsWith('#สรุปเดือนนี้') || text.startsWith('#สรุปเดือน')) {
          const y = parseInt(year), m = parseInt(month);
          const summary = await readSheetSummary(shop.id, bangkokMidnightUTC(y, m, 1), bangkokMidnightUTC(y, m + 1, 1));
          summaryMsg = createSummaryFlexMessage('สรุปยอดเดือนนี้', summary, `${month}/${year}`);

        } else if (text.startsWith('#กำไรขาดทุน') || text.startsWith('#กำไร')) {
          const y = parseInt(year), m = parseInt(month);
          const summary = await readSheetSummary(shop.id, bangkokMidnightUTC(y, m, 1), bangkokMidnightUTC(y, m + 1, 1));
          summaryMsg = createSummaryFlexMessage('กำไร / ขาดทุน เดือนนี้', summary, `${month}/${year}`);

        } else if (text.startsWith('#สรุปอาทิตย์นี้') || text.startsWith('#สรุปสัปดาห์')) {
          const now = new Date(new Date().getTime() + 7 * 60 * 60 * 1000);
          const dow = now.getDay() === 0 ? 6 : now.getDay() - 1; // จันทร์=0
          const toISO = (d) => `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
          const weekStartDate = new Date(now.getTime() - dow * 86400000);
          const weekEndDate = new Date(now.getTime() + (6 - dow) * 86400000);
          const weekStart = toISO(weekStartDate);
          const weekEnd = toISO(weekEndDate);
          const startISO = bangkokMidnightUTC(weekStartDate.getFullYear(), weekStartDate.getMonth() + 1, weekStartDate.getDate());
          const endISO = bangkokMidnightUTC(weekEndDate.getFullYear(), weekEndDate.getMonth() + 1, weekEndDate.getDate() + 1); // +1 เพราะ weekEnd เดิม inclusive
          const summary = await readSheetSummary(shop.id, startISO, endISO);
          summaryMsg = createSummaryFlexMessage('สรุปยอดอาทิตย์นี้', summary, `${weekStart} ถึง ${weekEnd}`);

        } else if (text.startsWith('#สรุปปีนี้') || text.startsWith('#สรุปปี')) {
          const y = parseInt(year);
          const summary = await readSheetSummary(shop.id, bangkokMidnightUTC(y, 1, 1), bangkokMidnightUTC(y + 1, 1, 1));
          summaryMsg = createSummaryFlexMessage(`สรุปยอดปี ${year}`, summary, year);

        } else if (text.startsWith('#สรุปวันที่') || text.startsWith('#ดูวันที่')) {
          const dateArg = text.replace(/^#สรุปวันที่|^#ดูวันที่/, '').trim();
          const parts = dateArg.split('/');
          if (parts.length >= 2) {
            const dd = parseInt(parts[0].trim());
            const mm = parseInt(parts[1].trim());
            let yyyy = parts[2] ? parseInt(parts[2].trim()) : parseInt(year);
            if (yyyy > 2500) yyyy -= 543;
            const targetDate = `${yyyy}-${String(mm).padStart(2,'0')}-${String(dd).padStart(2,'0')}`;
            const summary = await readSheetSummary(shop.id, bangkokMidnightUTC(yyyy, mm, dd), bangkokMidnightUTC(yyyy, mm, dd + 1));
            summaryMsg = createSummaryFlexMessage(`สรุปยอด ${String(dd).padStart(2,'0')}/${String(mm).padStart(2,'0')}/${yyyy}`, summary, targetDate);
          } else {
            summaryMsg = { type: 'text', text: '⚠️ รูปแบบวันที่ไม่ถูกต้อง\nใช้: #สรุปวันที่ 07/06 หรือ 07/06/2026' };
          }

        } else if (text.startsWith('#รายงาน')) {
          const y = parseInt(year), m = parseInt(month);
          const summary = await readSheetSummary(shop.id, bangkokMidnightUTC(y, m, 1), bangkokMidnightUTC(y, m + 1, 1));
          summaryMsg = createSummaryFlexMessage(`รายงานผล ${month}/${year}`, summary, `${month}/${year}`);

        } else if (text.startsWith('#สรุปทุกสาขา')) {
          if (!hasFeature(shop, 'advance')) {
            await replyToLine(replyToken, [{ type: "text", text: `🔒 ฟีเจอร์นี้สำหรับแพ็กเกจ Advance ขึ้นไปค่ะ` }]);
            continue;
          }
          const y = parseInt(year), m = parseInt(month);
          const allBranchData = await readAllBranchesSummary(shop.id, bangkokMidnightUTC(y, m, 1), bangkokMidnightUTC(y, m + 1, 1));
          summaryMsg = createBranchBreakdownFlexMessage('สรุปทุกสาขา เดือนนี้', allBranchData, `${month}/${year}`);
        }

        if (summaryMsg) await replyToLine(replyToken, [summaryMsg]);

      } catch (err) {
        const detail = err.response?.data ? JSON.stringify(err.response.data) : null;
        console.error('[ERROR] Text command error:', err.message, detail ? '| Detail: ' + detail : '');
        try { await replyToLine(replyToken, [{ type: "text", text: `❌ เกิดข้อผิดพลาด: ${err.message}` }]); } catch(e) {}
      }
      continue;
    }
    // ===============================================================

    if (event.type === 'join') {
      const groupId = event.source.groupId;
      console.log(`[LOG] 🤖 บอทถูกเชิญเข้ากลุ่ม ID: ${groupId}`);
      const joinMsg = { type: "text", text: `สวัสดีค่ะ! ขอบคุณที่ดึง Smile Slip เข้ากลุ่มนะคะ\nโปรดคัดลอกรหัสกลุ่มนี้:\n${groupId}\n\nไปผูกในหน้า Dashboard ของร้านค้าเพื่อเริ่มใช้งานสแกนสลิปค่ะ 😊` };
      await replyToLine(replyToken, [joinMsg]);
      continue;
    }

    if (event.type === 'message' && event.message.type === 'image') {
      try {
        const sourceId = event.source.groupId || event.source.userId;
        console.log(`\n===================================================================`);
        console.log(`[LOG] 📥 ได้รับรูปภาพใหม่จากพิกัด ID: ${sourceId}`);

        // STEP 1: ค้นหาร้านค้า (รองรับทั้งกลุ่มหลักและสาขา)
        const found = await findShopBySource(sourceId);
        if (!found) {
          await replyToLine(replyToken, [{ type: "text", text: "⚠️ กลุ่มนี้ยังไม่ได้ลงทะเบียนผูกกับระบบ Smile Slip ค่ะ" }]);
          continue;
        }
        const { shop, branchName } = found;

        // STEP 1.5: ถ้าผู้ส่งเพิ่งพิมพ์ #รับสินค้า ไว้ → รูปนี้คือใบส่งของ ไม่ใช่สลิปโอนเงิน แยกไปคนละ flow เลย
        // (ไม่ตัดเครดิต เพราะเป็นฟีเจอร์ POS ไม่ใช่ระบบสแกนสลิปที่นับเครดิต)
        const awaitingReceive = event.source.userId ? await consumeAwaitingReceive(event.source.userId) : null;
        if (awaitingReceive && awaitingReceive.shopId === shop.id) {
          try {
            const receiveImageBuffer = await getLineImage(event.message.id);
            const receiveData = await withRetry(
              () => extractReceiveDataWithGemini(receiveImageBuffer),
              () => extractReceiveDataWithGemini(receiveImageBuffer, process.env.GEMINI_MODEL || 'gemini-3.5-flash')
            );

            const { data: gConfigR } = await supabase
              .from('shop_google_configs')
              .select('google_refresh_token, google_folder_id, google_sheet_id')
              .eq('shop_id', shop.id).maybeSingle();
            const { data: posConfigR } = await supabase
              .from('pos_configs').select('pos_sheet_id').eq('shop_id', shop.id).maybeSingle();

            let imageUrl = null;
            if (gConfigR?.google_refresh_token && gConfigR?.google_folder_id) {
              const accessTokenR = await getAccessToken(gConfigR.google_refresh_token);
              const thaiTimeR = getThaiDateTime();
              const yearFolderId = await getOrCreateDriveFolder(accessTokenR, gConfigR.google_folder_id, thaiTimeR.year);
              const monthFolderId = await getOrCreateDriveFolder(accessTokenR, yearFolderId, thaiTimeR.monthFolderName);
              const receiveFolderId = await getOrCreateDriveFolder(accessTokenR, monthFolderId, 'รับสินค้า');
              const fileName = `receive_${receiveData.supplier || 'unknown'}_${Date.now()}.jpg`;
              const driveFileId = await uploadToGoogleDrive(receiveImageBuffer, accessTokenR, receiveFolderId, fileName);
              imageUrl = `https://drive.google.com/open?id=${driveFileId}`;

              if (posConfigR?.pos_sheet_id) {
                await ensurePendingReceiveSheet(accessTokenR, posConfigR.pos_sheet_id);
                const nowR = new Date().toLocaleString('th-TH', { timeZone: 'Asia/Bangkok' });
                const pendingReceiveNo = makePendingReceiveNo();
                await appendPendingReceive(accessTokenR, posConfigR.pos_sheet_id, [
                  pendingReceiveNo, nowR, receiveData.supplier || '-', receiveData.invoice_no || '-',
                  receiveData.invoice_date || '-', JSON.stringify(receiveData.items), imageUrl || '',
                  awaitingReceive.branchName || branchName || '', 'รอตรวจสอบ',
                ]);
                // dual-write ระยะ migration ไป Supabase (ตาราง pos_pending_receives) — Sheets ยัง
                // เป็นตัวจริง ทำเป็น secondary แบบ fire-and-forget ไม่กระทบ flow หลักถ้า error —
                // .insert() คืน { error } แทนที่จะ throw ตอน DB error ต้องเช็คเองแล้ว throw เอง
                // ในนี้ถึงจะเข้า catch ได้จริง (ไม่งั้น error หลุดเงียบๆ ไม่ log อะไรเลย)
                try {
                  const { error: supaInsErr } = await supabase.from('pos_pending_receives').insert({
                    shop_id: shop.id, pending_no: pendingReceiveNo,
                    supplier: receiveData.supplier || '-', invoice_no: receiveData.invoice_no || '-',
                    invoice_date: receiveData.invoice_date || '-', items: receiveData.items,
                    image_url: imageUrl || '', branch_name: awaitingReceive.branchName || branchName || '',
                    status: 'รอตรวจสอบ',
                  });
                  if (supaInsErr) throw supaInsErr;
                } catch (supaErr) {
                  console.error('[pending-receive] Supabase dual-write error:', supaErr.message);
                }
              }
            }

            const itemsSummary = receiveData.items.slice(0, 10)
              .map(i => `• ${i.name} ×${i.qty} @฿${i.unitPrice}`).join('\n');
            const dashboardUrl = `${process.env.FRONTEND_URL}/pos?userId=${shop.owner_line_id}`;
            await replyToLine(replyToken, [{
              type: 'text',
              text: `📥 อ่านใบส่งของสำเร็จ!\n🏢 ผู้จำหน่าย: ${receiveData.supplier || '-'}\n📄 เลขที่: ${receiveData.invoice_no || '-'}\n\n${itemsSummary || 'ไม่พบรายการสินค้า'}\n\n⚠️ ยังไม่ตัดเข้าสต็อค — เข้าไปตรวจสอบ/ยืนยันที่ Dashboard → รับสินค้า → รอยืนยันจาก LINE\n${dashboardUrl}`,
            }]);
          } catch (recvErr) {
            console.error('[ERROR] รับสินค้าผ่าน LINE error:', recvErr.message);
            try { await replyToLine(replyToken, [{ type: 'text', text: `❌ อ่านใบส่งของไม่สำเร็จ: ${recvErr.message}` }]); } catch(e) {}
          }
          continue;
        }

        // STEP 1.6: ถ้าผู้ส่งเพิ่งพิมพ์ #รายจ่าย ไว้ → รูปนี้คือบิล/ใบเสร็จค่าใช้จ่าย ไม่ใช่สลิปโอนเงิน แยกไปคนละ flow
        // (ไม่ตัดเครดิต เหมือน #รับสินค้า เพราะเป็นฟีเจอร์ POS ไม่ใช่ระบบสแกนสลิปที่นับเครดิต)
        const awaitingExpense = event.source.userId ? await consumeAwaitingExpense(event.source.userId) : null;
        if (awaitingExpense && awaitingExpense.shopId === shop.id) {
          try {
            const expenseImageBuffer = await getLineImage(event.message.id);
            const expenseData = await withRetry(
              () => extractExpenseDataWithGemini(expenseImageBuffer),
              () => extractExpenseDataWithGemini(expenseImageBuffer, process.env.GEMINI_MODEL || 'gemini-3.5-flash')
            );

            const { data: gConfigE } = await supabase
              .from('shop_google_configs')
              .select('google_refresh_token, google_folder_id, google_sheet_id')
              .eq('shop_id', shop.id).maybeSingle();
            const { data: posConfigE } = await supabase
              .from('pos_configs').select('pos_sheet_id').eq('shop_id', shop.id).maybeSingle();

            let imageUrlE = null;
            if (gConfigE?.google_refresh_token && gConfigE?.google_folder_id) {
              const accessTokenE = await getAccessToken(gConfigE.google_refresh_token);
              const thaiTimeE = getThaiDateTime();
              const yearFolderIdE = await getOrCreateDriveFolder(accessTokenE, gConfigE.google_folder_id, thaiTimeE.year);
              const monthFolderIdE = await getOrCreateDriveFolder(accessTokenE, yearFolderIdE, thaiTimeE.monthFolderName);
              const expenseFolderId = await getOrCreateDriveFolder(accessTokenE, monthFolderIdE, 'รายจ่าย');
              const fileNameE = `expense_${expenseData.label || 'unknown'}_${Date.now()}.jpg`;
              const driveFileIdE = await uploadToGoogleDrive(expenseImageBuffer, accessTokenE, expenseFolderId, fileNameE);
              imageUrlE = `https://drive.google.com/open?id=${driveFileIdE}`;

              if (posConfigE?.pos_sheet_id) {
                await ensurePendingExpenseSheet(accessTokenE, posConfigE.pos_sheet_id);
                const nowE = new Date().toLocaleString('th-TH', { timeZone: 'Asia/Bangkok' });
                const pendingExpenseNo = makePendingExpenseNo();
                await appendPendingExpense(accessTokenE, posConfigE.pos_sheet_id, [
                  pendingExpenseNo, nowE, expenseData.label || '-', expenseData.vendor || '-',
                  expenseData.amount || 0, expenseData.vatType || 'ไม่มี VAT',
                  expenseData.invoice_no || '-', expenseData.invoice_date || '-', imageUrlE || '',
                  awaitingExpense.branchName || branchName || '', 'รอตรวจสอบ',
                ]);
                // dual-write ระยะ migration ไป Supabase (ตาราง pos_pending_expenses) — เหมือน
                // รับสินค้ารอยืนยัน: Sheets ยังเป็นตัวจริง, Supabase เป็น secondary fire-and-forget
                try {
                  const { error: supaInsErrE } = await supabase.from('pos_pending_expenses').insert({
                    shop_id: shop.id, pending_no: pendingExpenseNo,
                    label: expenseData.label || '-', vendor: expenseData.vendor || '-',
                    amount: expenseData.amount || 0, vat_type: expenseData.vatType || 'ไม่มี VAT',
                    invoice_no: expenseData.invoice_no || '-', invoice_date: expenseData.invoice_date || '-',
                    image_url: imageUrlE || '', branch_name: awaitingExpense.branchName || branchName || '',
                    status: 'รอตรวจสอบ',
                  });
                  if (supaInsErrE) throw supaInsErrE;
                } catch (supaErrE) {
                  console.error('[pending-expense] Supabase dual-write error:', supaErrE.message);
                }
              }
            }

            const dashboardUrlE = `${process.env.FRONTEND_URL}/pos?userId=${shop.owner_line_id}`;
            await replyToLine(replyToken, [{
              type: 'text',
              text: `🧾 อ่านบิลค่าใช้จ่ายสำเร็จ!\n📝 รายการ: ${expenseData.label || '-'}\n🏢 ผู้รับเงิน: ${expenseData.vendor || '-'}\n💰 ยอด: ฿${(expenseData.amount || 0).toLocaleString()}\n\n⚠️ ยังไม่บันทึกเป็นรายจ่ายจริง — เข้าไปตรวจสอบ/ยืนยันที่ Dashboard → รายจ่าย → รอยืนยันจาก LINE\n${dashboardUrlE}`,
            }]);
          } catch (expErr) {
            console.error('[ERROR] รายจ่ายผ่าน LINE error:', expErr.message);
            try { await replyToLine(replyToken, [{ type: 'text', text: `❌ อ่านบิลค่าใช้จ่ายไม่สำเร็จ: ${expErr.message}` }]); } catch(e) {}
          }
          continue;
        }

        // STEP 1.9: ล็อกการสแกนสลิปถ้าทดลองใช้ฟรี 30 วันหมดอายุแล้ว (30-Day Free Trial Lock Mechanism —
        // เพิ่ม 2026-07-20) — shop มาจาก findShopBySource() ที่ select('*') ไว้แล้ว จึงมี status ติดมา
        // เลยโดยไม่ต้อง query เพิ่ม ถ้าคอลัมน์ยังไม่ถูกสร้าง (รอรัน SQL) shop.status จะเป็น undefined
        // ซึ่งไม่ตรงกับ 'trial_expired' อยู่แล้ว จึงไม่ล็อกใครโดยไม่ตั้งใจ (fail-safe)
        if (shop.status === 'trial_expired') {
          await replyToLine(replyToken, [{
            type: 'text',
            text: `⚠️ ระยะเวลาทดลองใช้ฟรี 30 วันของร้าน ${shop.shop_name} หมดอายุแล้ว\nกรุณาอัปเกรดแพ็กเกจเพื่อสแกนสลิปต่อได้ที่ ${process.env.FRONTEND_URL || ''}/pricing\n(ข้อมูลเดิมของร้านยังอยู่ครบใน Google Sheets/Drive ไม่มีการสูญหาย)`,
          }]);
          continue;
        }

        // STEP 2: ตรวจสอบเครดิตคงเหลือ (Enterprise/Super ข้าม — ไม่ตัดเครดิต)
        let creditData = null;
        if (!isUnlimited(shop)) {
          const { data: cred } = await supabase
            .from('shop_credits')
            .select('balance_credits')
            .eq('shop_id', shop.id)
            .single();
          creditData = cred;
          if (!creditData || creditData.balance_credits <= 0) {
            await replyToLine(replyToken, [{ type: "text", text: `⚠️ เครดิตของร้าน ${shop.shop_name} หมดแล้ว กรุณาเติมเครดิตนะคะ` }]);
            continue;
          }
        }

        // STEP 3: ดาวน์โหลดรูปภาพ + ตรวจสอบสลิปซ้ำชั้น 1 (image hash, in-memory)
        const imageBuffer = await getLineImage(event.message.id);
        const quoteToken = event.message.quoteToken || null;
        const imageHash = getImageHash(imageBuffer);

        if (await isRecentDuplicateImage(imageHash, shop.id)) {
          console.log(`[LOG] ♻️ [Duplicate] พบสลิปซ้ำ (${redis ? 'Redis' : 'in-memory'}) shop: ${shop.shop_name}`);
          try {
            const dupMsg = { type: 'text', text: `⚠️ สลิปนี้เคยถูกส่งมาแล้วค่ะ ระบบไม่บันทึกซ้ำนะคะ 🙏` };
            if (quoteToken) dupMsg.quoteToken = quoteToken;
            await replyToLine(replyToken, [dupMsg]);
          } catch(e) {}
          continue;
        }

        // STEP 4: OCR — Hybrid (Cloud Vision → Gemini text-mode → Gemini image-mode)
        // retry อัตโนมัติสูงสุด 3 ครั้งเมื่อ 503, fallback ไป image-mode ด้วยโมเดลเดียวกัน
        // (ห้าม hardcode gemini-2.5-flash — deprecated ในโปรเจกต์นี้ ใช้ GEMINI_MODEL เสมอ)
        const slipData = await withRetry(
          () => extractDataHybrid(imageBuffer),
          () => extractDataWithGemini(imageBuffer, process.env.GEMINI_MODEL || 'gemini-3.5-flash')
        );

        // STEP 4.5: ตรวจสอบประเภทสลิปจากชื่อบัญชีธนาคาร + ชื่อร้าน + ชื่อสาขาทั้งหมด
        // (กัน Gemini อ่าน perspective ผิด เช่น QR bill payment ที่แสดง "ไปยัง: ชื่อสาขา")
        try {
          const [{ data: bankAccounts }, { data: branches }] = await Promise.all([
            supabase.from('shop_bank_accounts').select('account_name').eq('shop_id', shop.id),
            supabase.from('shop_branches').select('branch_name').eq('shop_id', shop.id).eq('is_active', true),
          ]);
          const branchNames = (branches || []).map(b => b.branch_name).filter(Boolean);
          const extraNames = [shop.shop_name, ...branchNames];
          slipData.type = detectTypeFromBankAccounts(slipData, bankAccounts || [], extraNames);
        } catch (e) {
          console.warn('[WARN] ไม่สามารถโหลด bank accounts/branches สำหรับตรวจ type:', e.message);
        }

        // สร้าง fingerprint สำหรับตรวจซ้ำชั้น 2 — ใช้เลขอ้างอิงถ้ามี, ไม่มีใช้ image hash
        const hasRefNo = slipData.ref_no && slipData.ref_no !== '-' && slipData.ref_no.trim() !== '';
        const fingerprint = hasRefNo ? slipData.ref_no.trim() : imageHash;

        // STEP 5: Google Drive/Sheets — แยก try-catch ออกต่างหาก
        // อ่าน refresh_token จาก shop_google_configs (ตารางที่มีอยู่จริง)
        let driveFileUrl = null;
        let isDuplicate = false;
        try {
          const { data: gConfig } = await supabase
            .from('shop_google_configs')
            .select('google_refresh_token, google_folder_id, google_sheet_id')
            .eq('shop_id', shop.id)
            .maybeSingle();

          let folderId = gConfig?.google_folder_id || shop.google_folder_id;
          let sheetId = gConfig?.google_sheet_id || shop.google_sheet_id;

          if (gConfig?.google_refresh_token && folderId && sheetId) {
            const accessToken = await getAccessToken(gConfig.google_refresh_token);
            const thaiTime = getThaiDateTime();

            // ใช้วันที่บนสลิปจริงเพื่อเลือก folder/sheet ที่ถูกต้อง
            const slipDateInfo = parseSlipDateForFolder(slipData.date);
            const folderYear = slipDateInfo?.year || thaiTime.year;
            const folderMonth = slipDateInfo?.monthFolderName || thaiTime.monthFolderName;

            // ตรวจสอบสลิปซ้ำชั้น 2: Google Sheets column K (persistent, ข้าม restart ได้)
            isDuplicate = await checkDuplicateInSheets(accessToken, sheetId, fingerprint, folderYear);
            if (isDuplicate) {
              console.log(`[LOG] ♻️ [Duplicate] พบสลิปซ้ำใน Sheets — fingerprint: ${fingerprint}`);
            } else {
              const recorderName = await getDisplayName(event.source);
              const saveOnce = async (fId, sId) => {
                // โครงสร้าง Drive: root → ปี ค.ศ. → เดือน-ปี → รายรับ|รายจ่าย
                const yearFolderId = await getOrCreateDriveFolder(accessToken, fId, folderYear);
                const monthFolderId = await getOrCreateDriveFolder(accessToken, yearFolderId, folderMonth);
                const typeFolder = slipData.type === 'income' ? 'รายรับ' : 'รายจ่าย';
                const typeFolderId = await getOrCreateDriveFolder(accessToken, monthFolderId, typeFolder);

                const fileName = `slip_${slipData.amount}THB_${folderMonth}_${Date.now()}.jpg`;
                const driveFileId = await uploadToGoogleDrive(imageBuffer, accessToken, typeFolderId, fileName);
                const fileUrl = `https://drive.google.com/open?id=${driveFileId}`;

                // Sheet tab แยกตามปีของสลิป
                await getOrCreateYearSheet(accessToken, sId, folderYear);
                // ตรวจจับหมวดหมู่ (Business+ เท่านั้น)
                const category = hasFeature(shop, 'business') ? await detectCategory(slipData, shop.id) : '-';
                // สลิปรูปภาพ = หลักฐานการโอนเงินเสมอ
                await appendToGoogleSheet(accessToken, sId, slipData, fileUrl, branchName, folderYear, fingerprint, category, 'โอน', recorderName || '-', shop.id);
                return fileUrl;
              };

              try {
                driveFileUrl = await saveOnce(folderId, sheetId);
              } catch (driveErr) {
                // root folder/sheet ถูกลบไปแล้ว → สร้างใหม่ แล้วลองอีกครั้ง
                if (driveErr.response?.status === 404) {
                  const healed = await recreateShopGoogleAssets(accessToken, shop);
                  folderId = healed.folderId; sheetId = healed.sheetId;
                  driveFileUrl = await saveOnce(folderId, sheetId);
                } else {
                  throw driveErr;
                }
              }
            }
          }
        } catch (googleErr) {
          const googleErrDetail = googleErr.response?.data?.error?.message || googleErr.response?.data || googleErr.message;
          console.error('[WARN] ⚠️ Google Drive/Sheets ขัดข้อง (ข้าม แต่บันทึก Supabase ต่อ):', googleErrDetail);
          // แจ้งเจ้าของร้านทาง LINE ถ้า token หมดอายุ
          if (googleErr.isTokenInvalid && shop.owner_line_id) {
            const reconnectUrl = `${process.env.FRONTEND_URL}/dashboard?userId=${shop.owner_line_id}&reconnectGoogle=true`;
            await pushToOwner(shop.owner_line_id, [{
              type: 'flex',
              altText: '⚠️ Google Drive ขาดการเชื่อมต่อ — กรุณาเชื่อมต่อใหม่',
              contents: {
                type: 'bubble',
                body: {
                  type: 'box', layout: 'vertical', spacing: 'md',
                  contents: [
                    { type: 'text', text: '⚠️ Google Drive ขาดการเชื่อมต่อ', weight: 'bold', color: '#e53e3e', size: 'md' },
                    { type: 'text', text: 'สลิปล่าสุดไม่ถูกบันทึกลง Google Sheets เนื่องจาก token หมดอายุ กรุณาเชื่อมต่อ Google ใหม่', wrap: true, color: '#555555', size: 'sm' }
                  ]
                },
                footer: {
                  type: 'box', layout: 'vertical',
                  contents: [{ type: 'button', style: 'primary', color: '#4285F4', action: { type: 'uri', label: '🔗 เชื่อมต่อ Google ใหม่', uri: reconnectUrl } }]
                }
              }
            }]);
          }
        }

        // หยุดทำงานถ้าพบสลิปซ้ำ (ไม่ตัดเครดิต, reply แจ้งซ้ำ)
        if (isDuplicate) {
          try {
            const dupMsg = {
              type: 'text',
              text: `⚠️ สลิปนี้เคยถูกส่งมาแล้วค่ะ ระบบไม่บันทึกซ้ำนะคะ 🙏` +
                (hasRefNo ? `\n(อ้างอิง: ${fingerprint})` : '')
            };
            if (quoteToken) dupMsg.quoteToken = quoteToken;
            await replyToLine(replyToken, [dupMsg]);
          } catch(e) {}
          console.log(`[LOG] ⏭️ ข้ามการตัดเครดิต — สลิปซ้ำ`);
          continue;
        }

        // STEP 6: ตัดยอดเครดิต (-1) — atomic กัน race condition ตอนส่งหลายรูปพร้อมกัน — Super plan ได้รับการยกเว้น
        if (isSuper(shop)) {
          console.log(`[LOG] 👑 Super Plan — ไม่ตัดเครดิต`);
        } else {
          const { data: deductResult } = await supabase.rpc('deduct_shop_credit', { p_shop_id: shop.id });
          const newBalance = deductResult?.[0]?.new_balance ?? (creditData.balance_credits - 1);
          console.log(`[LOG] 💳 ตัดเครดิตสำเร็จ ยอดคงเหลือ: ${newBalance}`);

          // แจ้งเตือนเครดิตใกล้หมด — Push LINE เมื่อ < 10 แผ่น
          if (newBalance < 10 && shop.owner_line_id) {
            const topupUrl = `${process.env.FRONTEND_URL}/pricing?userId=${shop.owner_line_id}`;
            const warnText = newBalance <= 0
              ? `🚨 เครดิตของร้าน "${shop.shop_name}" หมดแล้วค่ะ!\nสลิปที่ส่งเข้ามาจะไม่ถูกบันทึกจนกว่าจะเติมเครดิต\n\n💳 เติมเครดิตได้เลยที่:\n${topupUrl}`
              : `⚠️ เครดิตของร้าน "${shop.shop_name}" เหลือเพียง ${newBalance} แผ่นค่ะ\nกรุณาเติมเครดิตเพื่อใช้งานต่อเนื่อง\n\n💳 เติมเครดิตได้ที่:\n${topupUrl}`;
            pushToOwner(shop.owner_line_id, [{ type: 'text', text: warnText }])
              .catch(e => console.warn('[WARN] ส่งแจ้งเตือนเครดิตไม่สำเร็จ:', e.message));
            console.log(`[LOG] 🔔 แจ้งเตือนเครดิตใกล้หมด → เจ้าของร้าน (เหลือ ${newBalance} แผ่น)`);
          }
        }

        // STEP 6.5: บันทึก Analytics (PDPA-safe — ไม่เก็บชื่อจริง/ยอดจริง)
        recordAnalytics(shop.id, found.branchId || null, slipData);

        // STEP 7: Push แจ้งเจ้าของร้านส่วนตัว (Pro+ และเป็นสาขา ไม่ใช่กลุ่มหลัก)
        if (hasFeature(shop, 'pro') && !found.isOwnerChat && shop.owner_line_id) {
          const isIncome = slipData.type === 'income';
          const amountFmt = `฿${parseFloat(slipData.amount).toLocaleString('th-TH', { minimumFractionDigits: 2 })}`;
          const ownerNotify = {
            type: "text",
            text: `${isIncome ? '💚' : '🔴'} [${branchName}]\n${isIncome ? 'รายรับ' : 'รายจ่าย'} ${amountFmt}\nจาก: ${slipData.sender || 'ไม่ระบุ'}\n${slipData.date} ${slipData.time}`
          };
          await pushToOwner(shop.owner_line_id, [ownerNotify]);
        }

        // STEP 7.5: จับคู่ผู้จำหน่ายจาก POS contacts (expense เท่านั้น, suppress error)
        let supplierName = null;
        if (slipData.type === 'expense' && slipData.sender && slipData.sender !== '-') {
          supplierName = await findMatchedSupplier(shop.id, slipData.sender);
          if (supplierName) console.log(`[LOG] 🏢 จับคู่ผู้จำหน่าย: "${slipData.sender}" → "${supplierName}"`);
        }

        // STEP 8: ตอบกลับ Flex Message ในกลุ่ม/แชท
        // ลอง reply ก่อน (ถ้า OCR เสร็จใน 30 วิ) — fallback push ถ้าหมดอายุ
        await replyOrPush(replyToken, sourceId, [createBeautifulFlexMessage(slipData, fingerprint, shop, quoteToken, supplierName)]);

        console.log(`=================== 🎉 สิ้นสุดการประมวลผล ===================\n`);

      } catch (error) {
        reportError(error, { handler: 'webhook-image', sourceId: event.source?.groupId || event.source?.userId });
        try { await replyToLine(replyToken, [{ type: "text", text: `❌ ไม่สามารถตรวจสอบสลิปได้: ${error.message}` }]); } catch(e) {}
      }
    }
  }
});

// ─── Cron: สรุปยอดประจำวัน (เรียกโดย Cloud Scheduler 18:00 BKK = 11:00 UTC) ───
app.post('/cron/daily-summary', async (req, res) => {
  // ยืนยัน secret เพื่อกัน unauthorized call
  const secret = req.headers['x-cron-secret'] || req.query.secret;
  if (!process.env.CRON_SECRET || secret !== process.env.CRON_SECRET) {
    console.warn('[CRON] Unauthorized daily-summary call — secret ไม่ตรง');
    return res.status(401).json({ error: 'unauthorized' });
  }

  const today = getThaiDateTime();
  const isoToday = today.isoDate;        // "2026-06-12"
  const thaiDate = today.date;           // "12/6/2569"
  const year = today.year;               // "2026"

  console.log(`[CRON] 📅 เริ่มส่งสรุปยอดประจำวัน ${isoToday}`);

  // ดึงร้าน Pro+ ทั้งหมด
  const { data: shops, error: shopsErr } = await supabase
    .from('shop_profiles')
    .select('id, owner_line_id, shop_name, subscription_tier, google_sheet_id')
    .in('subscription_tier', ['pro', 'advance', 'business', 'enterprise', 'super']);

  if (shopsErr || !shops?.length) {
    console.log('[CRON] ไม่พบร้าน Pro+ หรือ error:', shopsErr?.message);
    return res.json({ sent: 0, skipped: 0, failed: 0 });
  }

  // ดึง google configs ทั้งหมดในครั้งเดียว
  const shopIds = shops.map(s => s.id);
  const { data: configs } = await supabase
    .from('shop_google_configs')
    .select('shop_id, google_refresh_token, google_sheet_id')
    .in('shop_id', shopIds);

  const configMap = {};
  for (const c of (configs || [])) configMap[c.shop_id] = c;

  let sent = 0, skipped = 0, failed = 0;

  for (const shop of shops) {
    const cfg = configMap[shop.id];
    if (!cfg?.google_refresh_token || !cfg?.google_sheet_id) { skipped++; continue; }
    if (!shop.owner_line_id) { skipped++; continue; }

    try {
      // อ่านสรุปเฉพาะวันนี้ (Tier D: อ่านจาก Supabase แทน Sheets แล้ว ไม่ต้องแลก access token อีก)
      const [cy, cm, cd] = isoToday.split('-').map(Number);
      const summary = await readSheetSummary(
        shop.id,
        bangkokMidnightUTC(cy, cm, cd),
        bangkokMidnightUTC(cy, cm, cd + 1)
      );

      // ส่งเฉพาะถ้ามีรายการ
      if (summary.countIncome === 0 && summary.countExpense === 0) { skipped++; continue; }

      const thaiMonths = ['ม.ค.','ก.พ.','มี.ค.','เม.ย.','พ.ค.','มิ.ย.','ก.ค.','ส.ค.','ก.ย.','ต.ค.','พ.ย.','ธ.ค.'];
      const [, m, d] = isoToday.split('-').map(Number);
      const periodLabel = `${d} ${thaiMonths[m - 1]} ${parseInt(year) + 543}`;

      await pushToOwner(shop.owner_line_id, [
        createSummaryFlexMessage(`สรุปยอดวันนี้ — ${shop.shop_name}`, summary, periodLabel)
      ]);
      sent++;
      console.log(`[CRON] ✅ ส่งสรุปให้ ${shop.shop_name} สำเร็จ`);
    } catch (err) {
      console.error(`[CRON] ❌ ส่งสรุปให้ ${shop.shop_name} ล้มเหลว:`, err.message);
      failed++;
    }
  }

  console.log(`[CRON] เสร็จสิ้น: ส่ง=${sent} ข้าม=${skipped} ล้มเหลว=${failed}`);
  return res.json({ sent, skipped, failed, date: isoToday });
});

// ════ WEEKLY SUMMARY CRON ════
// เรียกโดย Cloud Scheduler ทุกวันจันทร์ 18:00 กรุงเทพ (11:00 UTC)
app.post('/cron/weekly-summary', async (req, res) => {
  const secret = req.headers['x-cron-secret'] || req.query.secret;
  if (!process.env.CRON_SECRET || secret !== process.env.CRON_SECRET) {
    console.warn('[CRON-WEEKLY] Unauthorized — secret ไม่ตรง');
    return res.status(401).json({ error: 'unauthorized' });
  }

  const today = getThaiDateTime();
  const year = today.year;

  // คำนวณ range สัปดาห์นี้ (จันทร์-อาทิตย์) และสัปดาห์ที่แล้ว
  const now = new Date();
  const dayOfWeek = now.getDay(); // 0=อา, 1=จ
  const diffToMon = dayOfWeek === 0 ? 6 : dayOfWeek - 1;
  const thisMonday = new Date(now); thisMonday.setDate(now.getDate() - diffToMon); thisMonday.setHours(0,0,0,0);
  const lastMonday = new Date(thisMonday); lastMonday.setDate(thisMonday.getDate() - 7);
  const lastSunday = new Date(thisMonday); lastSunday.setDate(thisMonday.getDate() - 1);

  const toIso = (d) => d.toISOString().split('T')[0];
  const thisWeekDates = new Set();
  const lastWeekDates = new Set();
  for (let i = 0; i < 7; i++) {
    const d1 = new Date(thisMonday); d1.setDate(thisMonday.getDate() + i);
    thisWeekDates.add(toIso(d1));
    const d2 = new Date(lastMonday); d2.setDate(lastMonday.getDate() + i);
    lastWeekDates.add(toIso(d2));
  }

  const thaiMonths = ['ม.ค.','ก.พ.','มี.ค.','เม.ย.','พ.ค.','มิ.ย.','ก.ค.','ส.ค.','ก.ย.','ต.ค.','พ.ย.','ธ.ค.'];
  const fmtDate = (d) => `${d.getDate()} ${thaiMonths[d.getMonth()]}`;
  const periodLabel = `${fmtDate(thisMonday)} – ${fmtDate(lastSunday)} ${parseInt(year)+543}`;

  console.log(`[CRON-WEEKLY] 📅 เริ่มส่งสรุปประจำสัปดาห์: ${periodLabel}`);

  // ดึงร้าน Pro+ ทั้งหมด
  const { data: shops, error: shopsErr } = await supabase
    .from('shop_profiles')
    .select('id, owner_line_id, shop_name, subscription_tier, google_sheet_id')
    .in('subscription_tier', ['pro', 'advance', 'business', 'enterprise', 'super']);

  if (shopsErr || !shops?.length) {
    console.log('[CRON-WEEKLY] ไม่พบร้าน Pro+ หรือ error:', shopsErr?.message);
    return res.json({ sent: 0, skipped: 0, failed: 0 });
  }

  const shopIds = shops.map(s => s.id);
  const { data: configs } = await supabase
    .from('shop_google_configs')
    .select('shop_id, google_refresh_token, google_sheet_id')
    .in('shop_id', shopIds);

  const configMap = {};
  for (const c of (configs || [])) configMap[c.shop_id] = c;

  let sent = 0, skipped = 0, failed = 0;

  for (const shop of shops) {
    const cfg = configMap[shop.id];
    if (!cfg?.google_refresh_token || !cfg?.google_sheet_id) { skipped++; continue; }
    if (!shop.owner_line_id) { skipped++; continue; }

    try {
      // อ่านสรุปสัปดาห์นี้ และสัปดาห์ที่แล้ว (Tier D: อ่านจาก Supabase แทน Sheets แล้ว ไม่ต้องแลก
      // access token อีก — ใช้ thisMonday/lastMonday/lastSunday แบบ UTC ดิบตามของเดิมเป๊ะ ไม่ผ่าน
      // bangkokMidnightUTC() เพราะ Date object เหล่านี้ไม่ได้แทนวันปฏิทินกรุงเทพ)
      const [thisWeek, lastWeek] = await Promise.all([
        readSheetSummary(shop.id, thisMonday.toISOString(), new Date(thisMonday.getTime() + 7 * 86400000).toISOString()),
        readSheetSummary(shop.id, lastMonday.toISOString(), thisMonday.toISOString()),
      ]);

      if (thisWeek.countIncome === 0 && thisWeek.countExpense === 0) { skipped++; continue; }

      const fmt = (n) => `฿${n.toLocaleString('th-TH', { minimumFractionDigits: 0 })}`;
      const diffIncome = thisWeek.totalIncome - lastWeek.totalIncome;
      const diffPct = lastWeek.totalIncome > 0 ? Math.round((diffIncome / lastWeek.totalIncome) * 100) : null;
      const diffText = diffPct !== null
        ? (diffIncome >= 0 ? `▲ ${diffPct}% จากสัปดาห์ที่แล้ว` : `▼ ${Math.abs(diffPct)}% จากสัปดาห์ที่แล้ว`)
        : '';
      const netColor = thisWeek.net >= 0 ? '#10B981' : '#EF4444';
      const netText = thisWeek.net >= 0 ? `+${fmt(thisWeek.net)}` : fmt(thisWeek.net);

      const flexMsg = {
        type: 'flex',
        altText: `สรุปยอดสัปดาห์นี้ — ${shop.shop_name}: รายรับ ${fmt(thisWeek.totalIncome)}`,
        contents: {
          type: 'bubble', size: 'kilo',
          header: {
            type: 'box', layout: 'vertical', backgroundColor: '#312e81', paddingAll: 'md',
            contents: [
              { type: 'text', text: `📅 สรุปสัปดาห์ — ${shop.shop_name}`, weight: 'bold', color: '#ffffff', size: 'sm', wrap: true },
              { type: 'text', text: periodLabel, color: '#a5b4fc', size: 'xs', margin: 'xs' },
            ],
          },
          body: {
            type: 'box', layout: 'vertical', spacing: 'md', paddingAll: 'lg',
            contents: [
              { type: 'box', layout: 'horizontal', contents: [
                { type: 'text', text: '💚 รายรับ', size: 'sm', color: '#64748b', flex: 2 },
                { type: 'text', text: fmt(thisWeek.totalIncome), size: 'sm', weight: 'bold', color: '#10B981', align: 'end', flex: 3 },
              ]},
              ...(diffText ? [{ type: 'text', text: diffText, size: 'xxs', color: diffIncome >= 0 ? '#10B981' : '#EF4444', align: 'end', margin: 'none' }] : []),
              { type: 'separator', margin: 'sm' },
              { type: 'box', layout: 'horizontal', contents: [
                { type: 'text', text: '❤️ รายจ่าย', size: 'sm', color: '#64748b', flex: 2 },
                { type: 'text', text: fmt(thisWeek.totalExpense), size: 'sm', weight: 'bold', color: '#EF4444', align: 'end', flex: 3 },
              ]},
              { type: 'separator', margin: 'sm' },
              { type: 'box', layout: 'horizontal', contents: [
                { type: 'text', text: '📊 กำไร/ขาดทุน', size: 'sm', color: '#64748b', flex: 2 },
                { type: 'text', text: netText, size: 'sm', weight: 'bold', color: netColor, align: 'end', flex: 3 },
              ]},
              { type: 'separator', margin: 'sm' },
              { type: 'box', layout: 'horizontal', contents: [
                { type: 'text', text: '🧾 รายการทั้งหมด', size: 'xs', color: '#94a3b8', flex: 2 },
                { type: 'text', text: `${thisWeek.countIncome + thisWeek.countExpense} รายการ`, size: 'xs', color: '#94a3b8', align: 'end', flex: 3 },
              ]},
            ],
          },
          footer: {
            type: 'box', layout: 'vertical', paddingAll: 'md',
            contents: [{ type: 'button', action: { type: 'uri', label: 'ดูรายละเอียด Dashboard', uri: `${process.env.FRONTEND_URL}/dashboard?userId=${shop.owner_line_id}` }, style: 'primary', color: '#4F46E5', height: 'sm' }],
          },
        },
      };

      await pushToOwner(shop.owner_line_id, [flexMsg]);
      sent++;
      console.log(`[CRON-WEEKLY] ✅ ส่งสรุปให้ ${shop.shop_name}`);
    } catch (err) {
      console.error(`[CRON-WEEKLY] ❌ ${shop.shop_name}:`, err.message);
      failed++;
    }
  }

  console.log(`[CRON-WEEKLY] เสร็จสิ้น: ส่ง=${sent} ข้าม=${skipped} ล้มเหลว=${failed}`);
  return res.json({ sent, skipped, failed, period: periodLabel });
});

// ════ TRIAL DAY-25 NUDGE CRON (30-Day Free Trial Lock Mechanism — เพิ่ม 2026-07-20) ════
// เรียกโดย Cloud Scheduler ทุกวัน — เตือนร้านที่ทดลองใช้เหลือ ≤5 วันก่อนหมดอายุ (วันที่ 25/30)
// พร้อมสรุปการใช้งานช่วงทดลอง + ลิงก์อัปเกรด — ส่งครั้งเดียวต่อร้าน (กันด้วย trial_day25_notified)
app.post('/cron/trial-day25-nudge', async (req, res) => {
  const secret = req.headers['x-cron-secret'] || req.query.secret;
  if (!process.env.CRON_SECRET || secret !== process.env.CRON_SECRET) {
    console.warn('[CRON-TRIAL25] Unauthorized — secret ไม่ตรง');
    return res.status(401).json({ error: 'unauthorized' });
  }

  const today = getThaiDateTime();
  const year = today.year;
  const nowMs = Date.now();
  const fiveDaysMs = 5 * 24 * 60 * 60 * 1000;

  console.log(`[CRON-TRIAL25] 🔔 เริ่มตรวจร้านที่ทดลองใช้ใกล้หมดอายุ`);

  // ร้านที่ยังทดลองอยู่ (มี trial_ends_at ตั้งไว้ ยังไม่หมดอายุ ยังไม่เคยแจ้งเตือน)
  // ถ้าคอลัมน์ trial_ends_at/trial_day25_notified ยังไม่ถูกสร้าง (รอรัน SQL) query จะ error
  // → catch แล้วจบเงียบๆ ไม่ throw ออกไป (fail-safe เหมือน cron อื่นที่พึ่งพา schema ใหม่)
  let shops;
  try {
    const { data, error } = await supabase
      .from('shop_profiles')
      .select('id, owner_line_id, shop_name, subscription_tier, trial_started_at, trial_ends_at')
      .not('trial_ends_at', 'is', null)
      .is('stripe_subscription_id', null)
      .neq('status', 'trial_expired')
      .or('trial_day25_notified.is.null,trial_day25_notified.eq.false');
    if (error) throw error;
    shops = data;
  } catch (err) {
    console.warn('[CRON-TRIAL25] ข้าม — คอลัมน์ trial ยังไม่พร้อม (รอรัน SQL):', err.message);
    return res.json({ sent: 0, skipped: 0, failed: 0, note: 'trial columns not ready' });
  }

  if (!shops?.length) {
    console.log('[CRON-TRIAL25] ไม่พบร้านที่ทดลองใช้อยู่');
    return res.json({ sent: 0, skipped: 0, failed: 0 });
  }

  // เฉพาะร้านที่เหลือเวลา ≤5 วันก่อนหมดอายุ (และยังไม่หมดอายุไปแล้ว)
  const dueShops = shops.filter(s => {
    const endsMs = new Date(s.trial_ends_at).getTime();
    const remaining = endsMs - nowMs;
    return remaining > 0 && remaining <= fiveDaysMs;
  });

  if (!dueShops.length) {
    console.log('[CRON-TRIAL25] ยังไม่มีร้านที่ถึงรอบแจ้งเตือน (เหลือ >5 วัน)');
    return res.json({ sent: 0, skipped: 0, failed: 0 });
  }

  // Tier D: ไม่ต้อง query shop_google_configs อีกแล้ว (อ่านสรุปใช้งานจาก Supabase ตรงๆ ไม่ผ่าน Sheets)
  let sent = 0, skipped = 0, failed = 0;

  for (const shop of dueShops) {
    if (!shop.owner_line_id) { skipped++; continue; }
    const daysLeft = Math.max(0, Math.ceil((new Date(shop.trial_ends_at).getTime() - nowMs) / (24 * 60 * 60 * 1000)));

    try {
      // สรุปการใช้งานช่วงทดลอง (best-effort — Tier D: อ่านจาก Supabase แทน Sheets แล้ว ไม่ต้องเช็ค
      // Google connection/แลก access token อีก — ถ้าอ่านไม่ได้ ก็ยังส่งข้อความเตือนได้อยู่ตามปกติ)
      let usageText = null;
      if (shop.trial_started_at) {
        try {
          const startIso = new Date(shop.trial_started_at).toISOString();
          const summary = await readSheetSummary(shop.id, startIso, new Date().toISOString());
          const totalTx = summary.countIncome + summary.countExpense;
          if (totalTx > 0) {
            usageText = `\n\n📊 สรุปการใช้งานช่วงทดลอง:\n• บันทึกรายการแล้ว ${totalTx} รายการ\n• รายรับรวม ฿${summary.totalIncome.toLocaleString('th-TH')}\n• รายจ่ายรวม ฿${summary.totalExpense.toLocaleString('th-TH')}`;
          }
        } catch (sumErr) {
          console.warn(`[CRON-TRIAL25] อ่านสรุปการใช้งานของ ${shop.shop_name} ไม่ได้ (ไม่กระทบการแจ้งเตือน):`, sumErr.message);
        }
      }

      const pricingUrl = `${process.env.FRONTEND_URL || ''}/pricing?userId=${shop.owner_line_id}`;
      const flexMsg = {
        type: 'flex',
        altText: `⏳ ทดลองใช้ฟรีร้าน ${shop.shop_name} เหลืออีก ${daysLeft} วัน`,
        contents: {
          type: 'bubble', size: 'kilo',
          header: {
            type: 'box', layout: 'vertical', backgroundColor: '#7c2d12', paddingAll: 'md',
            contents: [
              { type: 'text', text: '⏳ ทดลองใช้ฟรีใกล้หมดอายุ', weight: 'bold', color: '#ffffff', size: 'sm', wrap: true },
              { type: 'text', text: shop.shop_name || '', color: '#fdba74', size: 'xs', margin: 'xs' },
            ],
          },
          body: {
            type: 'box', layout: 'vertical', spacing: 'md', paddingAll: 'lg',
            contents: [
              { type: 'text', text: `เหลืออีก ${daysLeft} วัน ระบบจะล็อกการสแกนสลิป/ใช้งาน POS ชั่วคราว`, size: 'sm', color: '#334155', wrap: true },
              { type: 'text', text: 'ข้อมูลเดิมทั้งหมดจะยังอยู่ครบใน Google Sheets/Drive ของร้านเสมอ ไม่มีการสูญหาย', size: 'xs', color: '#94a3b8', wrap: true, margin: 'md' },
              ...(usageText ? [{ type: 'text', text: usageText.trim(), size: 'xs', color: '#475569', wrap: true, margin: 'md' }] : []),
            ],
          },
          footer: {
            type: 'box', layout: 'vertical', paddingAll: 'md',
            contents: [{ type: 'button', action: { type: 'uri', label: 'อัปเกรดแพ็กเกจตอนนี้', uri: pricingUrl }, style: 'primary', color: '#EA580C', height: 'sm' }],
          },
        },
      };

      await pushToOwner(shop.owner_line_id, [flexMsg]);

      try {
        await supabase.from('shop_profiles').update({ trial_day25_notified: true }).eq('id', shop.id);
      } catch (flagErr) {
        console.warn(`[CRON-TRIAL25] ตั้งค่า trial_day25_notified ของ ${shop.shop_name} ไม่สำเร็จ (จะแจ้งเตือนซ้ำรอบถัดไป):`, flagErr.message);
      }

      sent++;
      console.log(`[CRON-TRIAL25] ✅ แจ้งเตือน ${shop.shop_name} สำเร็จ (เหลือ ${daysLeft} วัน)`);
    } catch (err) {
      console.error(`[CRON-TRIAL25] ❌ แจ้งเตือน ${shop.shop_name} ล้มเหลว:`, err.message);
      failed++;
    }
  }

  console.log(`[CRON-TRIAL25] เสร็จสิ้น: ส่ง=${sent} ข้าม=${skipped} ล้มเหลว=${failed}`);
  return res.json({ sent, skipped, failed });
});

const PORT = process.env.PORT || 8080;
app.listen(PORT, () => {
  console.log(`[SYSTEM] 🚀 Smile Slip Webhook Server รันอยู่ที่พอร์ต ${PORT}`);
});
