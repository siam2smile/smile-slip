/**
 * /transaction/edit?userId=LINE_ID&ref=FINGERPRINT&year=2026
 * หน้าแก้ไขธุรกรรม 1 รายการ — ลิงก์มาจากปุ่ม "แก้ไขข้อมูล" ใน LINE bot
 * หรือจากปุ่มแก้ไขในหน้า Ledger
 */
import React, { useState, useEffect, useRef } from 'react';
import { useRouter } from 'next/router';
import Head from 'next/head';
import { CheckCircle2, AlertTriangle, ArrowLeft, Receipt, Save, FileText, Download, Printer, X } from 'lucide-react';

export default function EditTransaction() {
  const router = useRouter();
  const { userId, ref, year } = router.query;

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [saved, setSaved] = useState(false);
  const [shopId, setShopId] = useState(null);
  const [txYear, setTxYear] = useState('');
  const [slipUrl, setSlipUrl] = useState('');
  const [branch, setBranch] = useState('');

  const [form, setForm] = useState({
    date: '', time: '', type: 'รายรับ', amount: '', sender: '', receiver: '', note: '', category: '',
    taxId: '', taxpayerName: '', taxAmount: '',
  });
  const [shopTier, setShopTier] = useState('normal');
  const [shopName, setShopName] = useState('');
  const [shopAddress, setShopAddress] = useState('');
  const [learnKeyword, setLearnKeyword] = useState('');

  // voucher state
  const [voucherStep, setVoucherStep] = useState(null); // null | 'preview' | 'saving' | 'saved'
  const [voucherResult, setVoucherResult] = useState(null); // { voucherNo, viewUrl, downloadUrl, fileName }
  const voucherPreviewUrl = useRef(null);

  useEffect(() => {
    if (!router.isReady) return;
    if (!userId || !ref) {
      setError('ลิงก์ไม่ถูกต้อง — ไม่พบรหัสรายการ');
      setLoading(false);
      return;
    }
    loadTransaction();
  }, [router.isReady, userId, ref]);

  const loadTransaction = async () => {
    try {
      // 1. หา shopId จาก LINE userId
      const shopRes = await fetch(`/api/shop/data?userId=${encodeURIComponent(userId)}`);
      const shopData = await shopRes.json();
      if (!shopData?.profile?.id) {
        setError('ไม่พบร้านค้า กรุณาเข้าสู่ระบบผ่าน LINE ก่อน');
        setLoading(false);
        return;
      }
      const sid = shopData.profile.id;
      setShopId(sid);
      setShopTier(shopData.profile.subscription_tier || 'normal');
      setShopName(shopData.profile.shop_name || '');
      setShopAddress(shopData.profile.address || '');

      // 2. ดึงธุรกรรมจาก Google Sheets ด้วย ref (column K)
      const targetYear = year || new Date().getFullYear().toString();
      const txRes = await fetch(
        `/api/sheets/update-transaction?shopId=${sid}&year=${targetYear}&ref=${encodeURIComponent(ref)}`
      );
      const txData = await txRes.json();
      if (txData.error) {
        setError(txData.error);
        setLoading(false);
        return;
      }

      const t = txData.transaction;
      setForm({
        date: t.date, time: t.time,
        type: t.type === 'รายจ่าย' ? 'รายจ่าย' : 'รายรับ',
        amount: String(t.amount).replace(/,/g, ''),
        sender: t.sender === '-' ? '' : t.sender,
        receiver: t.receiver === '-' ? '' : t.receiver,
        note: t.note === '-' ? '' : t.note,
        category: t.category === '-' ? '' : (t.category || ''),
        taxId: t.taxId === '-' ? '' : (t.taxId || ''),
        taxpayerName: t.taxpayerName === '-' ? '' : (t.taxpayerName || ''),
        taxAmount: t.taxAmount === '-' || t.taxAmount === '0' ? '' : (t.taxAmount || ''),
      });
      setTxYear(txData.year);
      setSlipUrl(t.slipUrl && !t.slipUrl.startsWith('ไม่มีรูปภาพ') ? t.slipUrl : '');
      setBranch(t.branch === '-' ? '' : t.branch);
      setLoading(false);
    } catch (e) {
      setError('โหลดข้อมูลไม่สำเร็จ กรุณาลองใหม่');
      setLoading(false);
    }
  };

  const handleSave = async (e) => {
    e.preventDefault();
    if (!form.amount || isNaN(parseFloat(form.amount))) return alert('กรุณากรอกจำนวนเงินให้ถูกต้องค่ะ');
    setSaving(true);
    try {
      const res = await fetch('/api/sheets/update-transaction', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ shopId, year: txYear, ref, ...form, learnKeyword }),
      });
      const data = await res.json();
      if (data.error) {
        alert('เกิดข้อผิดพลาด: ' + data.error);
      } else {
        setSaved(true);
      }
    } catch (e) {
      alert('บันทึกไม่สำเร็จ กรุณาลองใหม่ค่ะ');
    }
    setSaving(false);
  };

  const buildVoucherQuery = () => {
    const p = new URLSearchParams({
      type: form.type, amount: form.amount, date: form.date, time: form.time,
      sender: form.sender, receiver: form.receiver, note: form.note,
      category: form.category || '', shopName, shopAddress, branch: branch || '',
    });
    return p.toString();
  };

  const handleVoucherPreview = () => {
    voucherPreviewUrl.current = `/api/voucher/preview?${buildVoucherQuery()}`;
    setVoucherStep('preview');
    setVoucherResult(null);
  };

  const handleVoucherSave = async () => {
    setVoucherStep('saving');
    try {
      const res = await fetch('/api/voucher/save', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          shopId, type: form.type, amount: form.amount, date: form.date, time: form.time,
          sender: form.sender, receiver: form.receiver, note: form.note,
          category: form.category || '', branch: branch || '',
        }),
      });
      const data = await res.json();
      if (data.error) { alert('บันทึกไม่สำเร็จ: ' + data.error); setVoucherStep('preview'); return; }
      setVoucherResult(data);
      setVoucherStep('saved');
    } catch {
      alert('เกิดข้อผิดพลาด กรุณาลองใหม่');
      setVoucherStep('preview');
    }
  };

  // ดึง Google Drive file ID จากลิงก์ (รองรับ ?id=xxx และ /d/xxx/)
  const driveFileId = (() => {
    if (!slipUrl) return null;
    const m = slipUrl.match(/[?&]id=([^&]+)/) || slipUrl.match(/\/d\/([^/]+)/);
    return m ? m[1] : null;
  })();

  const TIER_LEVEL = { normal:0, pro:1, advance:2, business:3, enterprise:4, super:4 };
  const canCategory = (TIER_LEVEL[shopTier] || 0) >= 3;
  const INCOME_CATS  = ['รายรับจากลูกค้า', 'เงินโอนรับ', 'รายรับอื่นๆ'];
  const EXPENSE_CATS = ['ค่าน้ำมัน','ค่าแก๊ส/LPG','ค่าไฟฟ้า/น้ำประปา','ค่าอาหาร/เครื่องดื่ม','ค่าวัสดุ/สินค้า','ค่าซ่อมบำรุง','ค่าขนส่ง/พัสดุ','ค่าจ้างแรงงาน','ค่าเช่า','ค่าการตลาด/โฆษณา','ค่าสาธารณูปโภค','อื่นๆ'];
  const catOptions   = form.type === 'รายรับ' ? INCOME_CATS : EXPENSE_CATS;

  const field = (label, key, props = {}) => (
    <div>
      <label className="text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-1.5 block">{label}</label>
      <input value={form[key]} onChange={e => setForm({ ...form, [key]: e.target.value })}
        className="w-full border border-slate-200 rounded-xl px-4 py-2.5 text-sm font-medium outline-none focus:border-blue-400 transition-colors"
        {...props}/>
    </div>
  );

  return (
    <div className="min-h-screen bg-slate-50 font-sans antialiased">
      <Head>
        <title>แก้ไขรายการ | Smile Slip Pro</title>
        <meta name="viewport" content="width=device-width, initial-scale=1"/>
      </Head>

      <header className="bg-white border-b border-slate-200 sticky top-0 z-50">
        <div className="max-w-lg mx-auto px-5 h-14 flex items-center justify-between">
          <span className="text-lg font-bold tracking-tight text-blue-700">
            😊 Smile Slip <span className="text-slate-900 font-medium">Pro</span>
          </span>
          {userId && (
            <a href={`/dashboard?userId=${userId}&tab=accounts`} className="flex items-center gap-1 text-xs font-semibold text-blue-700 hover:text-blue-600">
              <ArrowLeft size={14}/> กลับหน้าบัญชี
            </a>
          )}
        </div>
      </header>

      <main className="max-w-lg mx-auto px-4 py-8">
        {loading ? (
          <div className="py-24 text-center text-slate-300 text-sm animate-pulse">กำลังโหลดข้อมูลรายการ...</div>

        ) : error ? (
          <div className="bg-white rounded-2xl border border-slate-200 p-8 text-center">
            <AlertTriangle size={36} className="text-amber-400 mx-auto mb-3"/>
            <p className="text-slate-600 text-sm font-medium mb-4">{error}</p>
            {userId && (
              <a href={`/dashboard?userId=${userId}&tab=accounts`} className="inline-block bg-blue-800 text-white px-5 py-2.5 rounded-xl text-sm font-bold hover:bg-blue-700 transition-all">
                กลับหน้าบัญชี
              </a>
            )}
          </div>

        ) : saved ? (
          <div className="bg-white rounded-2xl border border-slate-200 p-8 text-center">
            <CheckCircle2 size={42} className="text-green-500 mx-auto mb-3"/>
            <h2 className="text-lg font-black text-slate-900 mb-1">บันทึกการแก้ไขสำเร็จ</h2>
            <p className="text-slate-400 text-xs mb-5">ข้อมูลใน Google Sheets ถูกอัปเดตแล้ว</p>
            <div className="flex flex-col gap-2 items-center">
              <div className="flex gap-2 justify-center w-full">
                <button onClick={() => setSaved(false)}
                  className="flex-1 px-5 py-2.5 bg-slate-100 text-slate-600 rounded-xl text-sm font-bold hover:bg-slate-200 transition-all">
                  แก้ไขต่อ
                </button>
                <a href={`/dashboard?userId=${userId}&tab=accounts`}
                  className="flex-1 px-5 py-2.5 bg-blue-800 text-white rounded-xl text-sm font-bold hover:bg-blue-700 transition-all text-center">
                  กลับหน้าบัญชี
                </a>
              </div>
            </div>
          </div>

        ) : (
          <form onSubmit={handleSave} className="space-y-4">
            {/* รูปสลิปต้นฉบับ — ฝัง Drive preview (เจ้าของไฟล์ login Google อยู่จะเห็นรูปเลย) */}
            {driveFileId && (
              <div className="bg-white rounded-2xl border border-slate-200 overflow-hidden">
                <div className="px-4 py-2.5 border-b border-slate-100 flex items-center justify-between">
                  <span className="text-xs font-bold text-slate-500 flex items-center gap-1.5">
                    <Receipt size={12}/> รูปสลิปต้นฉบับ
                  </span>
                  <a href={slipUrl} target="_blank" rel="noreferrer"
                    className="text-[10px] text-blue-600 font-bold hover:underline">เปิดเต็มจอ ↗</a>
                </div>
                <iframe
                  src={`https://drive.google.com/file/d/${driveFileId}/preview`}
                  className="w-full border-0"
                  style={{ height: '420px' }}
                  allow="autoplay"
                  title="รูปสลิปต้นฉบับ"
                />
              </div>
            )}

            <div className="bg-white rounded-2xl border border-slate-200 p-5 space-y-4">
              <div className="flex items-center justify-between">
                <h1 className="text-base font-black text-slate-900">✏️ แก้ไขรายการ</h1>
                {branch && <span className="text-[10px] bg-slate-100 text-slate-500 px-2 py-1 rounded-lg font-medium">🏢 {branch}</span>}
              </div>

              {/* ประเภท */}
              <div>
                <label className="text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-1.5 block">ประเภทรายการ</label>
                <div className="grid grid-cols-2 gap-2">
                  <button type="button" onClick={() => setForm({ ...form, type: 'รายรับ' })}
                    className={`py-2.5 rounded-xl text-sm font-bold border-2 transition-all ${form.type === 'รายรับ' ? 'bg-green-50 border-green-500 text-green-600' : 'border-slate-200 text-slate-400 hover:border-slate-300'}`}>
                    💚 รายรับ (เงินเข้า)
                  </button>
                  <button type="button" onClick={() => setForm({ ...form, type: 'รายจ่าย' })}
                    className={`py-2.5 rounded-xl text-sm font-bold border-2 transition-all ${form.type === 'รายจ่าย' ? 'bg-red-50 border-red-500 text-red-500' : 'border-slate-200 text-slate-400 hover:border-slate-300'}`}>
                    🔴 รายจ่าย (เงินออก)
                  </button>
                </div>
              </div>

              {field('จำนวนเงิน (บาท)', 'amount', { type: 'number', step: '0.01', min: '0', required: true })}

              <div className="grid grid-cols-2 gap-3">
                {field('วันที่ (วว/ดด/ปปปป)', 'date', { placeholder: '11/06/2026' })}
                {field('เวลา', 'time', { placeholder: '14:30' })}
              </div>

              {field('ผู้โอน', 'sender', { placeholder: 'ชื่อผู้โอนเงิน' })}
              {field('ผู้รับ', 'receiver', { placeholder: 'ชื่อผู้รับเงิน' })}
              {field('หมายเหตุ', 'note', { placeholder: 'รายละเอียดเพิ่มเติม' })}

              {/* ข้อมูลภาษี (VAT) — แสดงเสมอ แก้ได้ถ้า OCR อ่านผิด */}
              <div className="border-t border-slate-100 pt-4 space-y-3">
                <p className="text-[10px] font-black text-slate-400 uppercase tracking-wider">ข้อมูลภาษี / VAT</p>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-1.5 block">ยอด VAT (บาท)</label>
                    <input value={form.taxAmount} onChange={e => setForm({ ...form, taxAmount: e.target.value })}
                      type="number" step="0.01" min="0" placeholder="เช่น 9.22"
                      className="w-full border border-slate-200 rounded-xl px-4 py-2.5 text-sm font-medium outline-none focus:border-blue-400 transition-colors"/>
                  </div>
                  <div>
                    <label className="text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-1.5 block">เลขภาษี</label>
                    <input value={form.taxId} onChange={e => setForm({ ...form, taxId: e.target.value })}
                      placeholder="0000000000000"
                      className="w-full border border-slate-200 rounded-xl px-4 py-2.5 text-sm font-medium outline-none focus:border-blue-400 transition-colors"/>
                  </div>
                </div>
                {field('ชื่อผู้เสียภาษี', 'taxpayerName', { placeholder: 'ชื่อบริษัท/ร้านค้า' })}
                {form.taxAmount && parseFloat(form.taxAmount) > 0 && parseFloat(form.amount) > 0 && (
                  <p className="text-[11px] text-slate-400">
                    ราคาก่อน VAT ≈ ฿{(parseFloat(form.amount) - parseFloat(form.taxAmount)).toLocaleString('th-TH', { minimumFractionDigits: 2 })}
                  </p>
                )}
              </div>

              {/* หมวดหมู่ — Business+ เท่านั้น */}
              {canCategory && (
                <div className="border-t border-slate-100 pt-4 space-y-3">
                  <div className="flex items-center gap-2">
                    <span className="text-[10px] font-black text-purple-600 uppercase tracking-wider">หมวดหมู่ (Business+)</span>
                    {form.category && <span className="text-[10px] bg-purple-50 text-purple-600 px-2 py-0.5 rounded-full font-bold">{form.category}</span>}
                  </div>
                  <div className="grid grid-cols-2 gap-1.5">
                    {catOptions.map(c => (
                      <button key={c} type="button"
                        onClick={() => setForm({ ...form, category: c })}
                        className={`py-2 px-3 rounded-xl text-xs font-semibold border transition-all text-left ${form.category === c ? 'bg-purple-600 border-purple-600 text-white' : 'border-slate-200 text-slate-500 hover:border-purple-300 hover:text-purple-600'}`}>
                        {c}
                      </button>
                    ))}
                  </div>
                  <div>
                    <label className="text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-1.5 block">
                      คำสำคัญให้บอทจำ (ไม่บังคับ)
                    </label>
                    <input value={learnKeyword} onChange={e => setLearnKeyword(e.target.value)}
                      placeholder="เช่น ปตท, ลินดา, ค่าเช่าร้าน"
                      className="w-full border border-slate-200 rounded-xl px-4 py-2.5 text-sm font-medium outline-none focus:border-purple-400 transition-colors"/>
                    <p className="text-[10px] text-slate-400 mt-1">บอทจะจำคำนี้ไว้ และจัดหมวดหมู่อัตโนมัติในครั้งถัดไป</p>
                  </div>
                </div>
              )}
            </div>

            <button type="submit" disabled={saving}
              className="w-full flex items-center justify-center gap-2 bg-blue-800 hover:bg-blue-700 text-white py-3.5 rounded-xl font-black text-sm transition-all shadow-lg disabled:opacity-50">
              <Save size={15}/>
              {saving ? 'กำลังบันทึก...' : 'บันทึกการแก้ไข'}
            </button>

            {/* ── ใบสำคัญรับ/จ่าย ── */}
            <div className="bg-white rounded-2xl border border-slate-200 overflow-hidden">
              <div className="px-5 py-3 flex items-center justify-between border-b border-slate-100">
                <span className="text-sm font-black text-slate-700 flex items-center gap-2">
                  <FileText size={15} className={form.type === 'รายจ่าย' ? 'text-red-500' : 'text-green-600'}/>
                  {form.type === 'รายจ่าย' ? 'ใบสำคัญจ่าย' : 'ใบสำคัญรับ'}
                </span>
                {voucherStep && voucherStep !== 'saving' && (
                  <button type="button" onClick={() => { setVoucherStep(null); setVoucherResult(null); }}
                    className="text-slate-400 hover:text-slate-600">
                    <X size={14}/>
                  </button>
                )}
              </div>

              <div className="px-5 py-4">
                {/* ยังไม่ได้กดดู preview */}
                {!voucherStep && (
                  <div className="text-center">
                    <p className="text-xs text-slate-400 mb-3">สร้างเอกสารสำหรับหักภาษีเงินได้และบันทึกบัญชี</p>
                    <button type="button" onClick={handleVoucherPreview}
                      className={`flex items-center gap-2 mx-auto px-5 py-2.5 rounded-xl text-sm font-bold transition-all text-white ${form.type === 'รายจ่าย' ? 'bg-red-600 hover:bg-red-700' : 'bg-emerald-600 hover:bg-emerald-700'}`}>
                      <FileText size={14}/>
                      ดูตัวอย่าง {form.type === 'รายจ่าย' ? 'ใบสำคัญจ่าย' : 'ใบสำคัญรับ'}
                    </button>
                  </div>
                )}

                {/* Preview iframe */}
                {(voucherStep === 'preview' || voucherStep === 'saving') && (
                  <div className="space-y-3">
                    <div className="rounded-xl overflow-hidden border border-slate-200 bg-slate-50">
                      <iframe
                        src={voucherPreviewUrl.current}
                        className="w-full border-0"
                        style={{ height: '420px' }}
                        title="ตัวอย่างใบสำคัญ"
                      />
                    </div>
                    <button type="button" onClick={handleVoucherSave} disabled={voucherStep === 'saving'}
                      className={`w-full flex items-center justify-center gap-2 py-2.5 rounded-xl text-sm font-black text-white transition-all disabled:opacity-50 ${form.type === 'รายจ่าย' ? 'bg-red-600 hover:bg-red-700' : 'bg-emerald-600 hover:bg-emerald-700'}`}>
                      <Save size={14}/>
                      {voucherStep === 'saving' ? 'กำลังบันทึกลง Google Drive...' : 'บันทึกลง Google Drive'}
                    </button>
                  </div>
                )}

                {/* บันทึกสำเร็จ */}
                {voucherStep === 'saved' && voucherResult && (
                  <div className="space-y-3">
                    <div className="flex items-center gap-2 text-emerald-700 bg-emerald-50 border border-emerald-200 rounded-xl px-4 py-2.5">
                      <CheckCircle2 size={16} className="shrink-0"/>
                      <div>
                        <p className="text-sm font-bold">บันทึกสำเร็จแล้ว</p>
                        <p className="text-xs text-emerald-600">{voucherResult.voucherNo} → Google Drive / {form.type === 'รายจ่าย' ? 'ใบสำคัญจ่าย' : 'ใบสำคัญรับ'}</p>
                      </div>
                    </div>
                    <div className="grid grid-cols-2 gap-2">
                      <a href={voucherResult.viewUrl} target="_blank" rel="noreferrer"
                        className="flex items-center justify-center gap-1.5 py-2.5 rounded-xl border-2 border-slate-300 text-slate-600 text-xs font-bold hover:bg-slate-50 transition-all">
                        <Printer size={13}/> ปริ้น
                      </a>
                      <a href={voucherResult.downloadUrl} target="_blank" rel="noreferrer"
                        className="flex items-center justify-center gap-1.5 py-2.5 rounded-xl bg-slate-700 text-white text-xs font-bold hover:bg-slate-600 transition-all">
                        <Download size={13}/> ดาวน์โหลด PDF
                      </a>
                    </div>
                  </div>
                )}
              </div>
            </div>

            <p className="text-center text-[10px] text-slate-400">
              การแก้ไขจะอัปเดตข้อมูลใน Google Sheets ของร้านคุณโดยตรง
            </p>
          </form>
        )}
      </main>
    </div>
  );
}
