export default function handler(req, res) {
  const { shopId } = req.query;
  const base = process.env.NEXT_PUBLIC_BASE_URL || process.env.FRONTEND_URL || '';
  const connectUrl = `${base}/api/auth/google/connect?shopId=${shopId}`;

  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.status(200).send(`<!DOCTYPE html>
<html lang="th">
<head>
<meta charset="utf-8"/>
<meta name="viewport" content="width=device-width, initial-scale=1"/>
<title>เปิดใน Chrome</title>
<style>
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body { background: #0f172a; color: #fff; font-family: -apple-system, sans-serif;
         min-height: 100vh; display: flex; align-items: center; justify-content: center; padding: 24px; }
  .card { background: #1e293b; border: 1px solid #334155; border-radius: 24px; padding: 32px 24px; max-width: 360px; width: 100%; text-align: center; }
  .icon { font-size: 48px; margin-bottom: 16px; }
  h1 { font-size: 20px; font-weight: 800; margin-bottom: 8px; }
  p { font-size: 14px; color: #94a3b8; line-height: 1.7; margin-bottom: 24px; }
  .steps { background: #0f172a; border-radius: 16px; padding: 16px; text-align: left; margin-bottom: 24px; }
  .step { display: flex; align-items: flex-start; gap: 10px; margin-bottom: 12px; font-size: 13px; color: #cbd5e1; }
  .step:last-child { margin-bottom: 0; }
  .num { background: #3b82f6; color: #fff; border-radius: 50%; width: 22px; height: 22px; flex-shrink: 0;
         display: flex; align-items: center; justify-content: center; font-size: 11px; font-weight: 800; margin-top: 1px; }
  .copy-btn { width: 100%; background: #3b82f6; color: #fff; border: none; border-radius: 14px;
              padding: 14px; font-size: 15px; font-weight: 800; cursor: pointer; transition: background 0.2s; }
  .copy-btn:active { background: #2563eb; }
  .copied { background: #16a34a !important; }
  .url-box { background: #0f172a; border: 1px solid #334155; border-radius: 10px; padding: 10px 12px;
             font-size: 11px; color: #64748b; word-break: break-all; margin-bottom: 16px; text-align: left; }
</style>
</head>
<body>
<div class="card">
  <div class="icon">🔒</div>
  <h1>ต้องเปิดใน Chrome หรือ Safari</h1>
  <p>Google ไม่อนุญาตให้ล็อกอินผ่านเบราว์เซอร์ภายใน LINE<br>กรุณาคัดลอกลิงก์แล้วเปิดใน Chrome หรือ Safari</p>

  <div class="steps">
    <div class="step"><span class="num">1</span><span>กดปุ่ม "คัดลอกลิงก์" ด้านล่าง</span></div>
    <div class="step"><span class="num">2</span><span>เปิดแอป <strong>Chrome</strong> หรือ <strong>Safari</strong> บนมือถือ</span></div>
    <div class="step"><span class="num">3</span><span>วางลิงก์ในแถบ URL แล้วกด Enter</span></div>
    <div class="step"><span class="num">4</span><span>เลือกบัญชี Google แล้วกด "อนุญาต"</span></div>
  </div>

  <div class="url-box" id="urlBox">${connectUrl}</div>

  <button class="copy-btn" id="copyBtn" onclick="copyLink()">📋 คัดลอกลิงก์</button>
</div>
<script>
function copyLink() {
  navigator.clipboard.writeText('${connectUrl}').then(function() {
    var btn = document.getElementById('copyBtn');
    btn.textContent = '✅ คัดลอกแล้ว!';
    btn.classList.add('copied');
    setTimeout(function() {
      btn.textContent = '📋 คัดลอกลิงก์';
      btn.classList.remove('copied');
    }, 2500);
  }).catch(function() {
    // fallback สำหรับ browser เก่า
    var el = document.createElement('textarea');
    el.value = '${connectUrl}';
    document.body.appendChild(el);
    el.select();
    document.execCommand('copy');
    document.body.removeChild(el);
    document.getElementById('copyBtn').textContent = '✅ คัดลอกแล้ว!';
  });
}
</script>
</body>
</html>`);
}
