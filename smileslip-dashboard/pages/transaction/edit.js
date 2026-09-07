/**
 * /transaction/edit?userId=LINE_ID&ref=FINGERPRINT&year=2026
 * หน้าแก้ไขธุรกรรม 1 รายการ — ลิงก์มาจากปุ่ม "แก้ไขข้อมูล" ใน LINE bot
 * หรือจากปุ่มแก้ไขในหน้า Ledger
 */
import React, { useState, useEffect, useRef } from 'react';
import { useRouter } from 'next/router';
import Head from 'next/head';
import { CheckCircle2, AlertTriangle, ArrowLeft, Receipt, Save, FileText, Download, Printer, X } from 'lucide-react';
import { getOwnerSessionToken, setOwnerSessionToken, findOwnerSessionTokenForOwnerId } from '../../lib/client-owner-session';

export default function EditTransaction() {
  const router = useRouter();
  const { userId, ref, year, ownerSession } = router.query;

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
    taxId: '', taxpayerName: '', taxAddress: '', taxAmount: '', whtAmount: '',
  });
  const [shopTier, setShopTier] = useState('normal');
  const [shopName, setShopName] = useState('');
  const [shopAddress, setShopAddress] = useState('');
  const [shopTaxId, setShopTaxId] = useState('');
  const [learnKeyword, setLearnKeyword] = useState('');

  // voucher state
  const [voucherStep, setVoucherStep] = useState(null); // null | 'preview' | 'saving' | 'saved'
  const [voucherResult, setVoucherResult] = useState(null); // { voucherNo, viewUrl, downloadUrl, fileName }
  const voucherPreviewUrl = useRef(null);

  // หนังสือรับรองหัก ณ ที่จ่าย (WHT certificate) state
  const [whtCertOpen, setWhtCertOpen] = useState(false);
  const [whtCertStep, setWhtCertStep] = useState('form'); // 'form' | 'preview' | 'saving' | 'saved'
  const [whtCert, setWhtCert] = useState(null);
  const [whtCertResult, setWhtCertResult] = useState(null);
  const whtCertPreviewUrl = useRef(null);

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
      // 1. หา shopId จาก LINE userId — token มาจาก (ก) ?ownerSession= ที่บอทเซ็นแนบมากับลิงก์
      // "แก้ไขข้อมูล" เสมอ (lib/owner-session-sign.js's ownerDeepLink ฝั่งบอท) หรือ (ข) localStorage
      // ถ้าเคย login ผ่าน /login บนเครื่องนี้มาก่อนแล้ว (เช่น กดลิงก์จากหน้า Ledger ในเว็บเอง)
      const initialToken = ownerSession || findOwnerSessionTokenForOwnerId(userId);
      const shopRes = await fetch(`/api/shop/data?userId=${encodeURIComponent(userId)}`,
        initialToken ? { headers: { 'x-owner-session': initialToken } } : undefined);
      if (shopRes.status === 401) {
        setError('ลิงก์หมดอายุหรือไม่ถูกต้อง — กรุณากดปุ่ม "แก้ไขข้อมูล" ใหม่จากข้อความล่าสุดใน LINE');
        setLoading(false);
        return;
      }
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
      setShopTaxId(shopData.profile.tax_id || '');

      // เก็บ token ไว้ผูกกับ shopId จริงตัวแรกที่รู้ (localStorage key ผูกกับ shopId ไม่ใช่ userId)
      // กันต้องพึ่ง query string ทุกครั้งที่เปิดหน้านี้ใหม่บนเครื่องเดียวกัน
      if (ownerSession) setOwnerSessionToken(sid, ownerSession);
      const sessionToken = initialToken || getOwnerSessionToken(sid);

      // 2. ดึงธุรกรรมจาก ledger_transactions ด้วย ref (slip_hash)
      const targetYear = year || new Date().getFullYear().toString();
      const txRes = await fetch(
        `/api/sheets/update-transaction?shopId=${sid}&year=${targetYear}&ref=${encodeURIComponent(ref)}`,
        sessionToken ? { headers: { 'x-owner-session': sessionToken } } : undefined
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
        taxAddress: t.taxAddress === '-' ? '' : (t.taxAddress || ''),
        taxAmount: t.taxAmount === '-' || t.taxAmount === '0' ? '' : (t.taxAmount || ''),
        whtAmount: t.whtAmount === '-' || t.whtAmount === '0' ? '' : (t.whtAmount || ''),
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
      const sessionToken = getOwnerSessionToken(shopId);
      const res = await fetch('/api/sheets/update-transaction', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', ...(sessionToken ? { 'x-owner-session': sessionToken } : {}) },
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
      const sessionToken = getOwnerSessionToken(shopId);
      const res = await fetch('/api/voucher/save', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...(sessionToken ? { 'x-owner-session': sessionToken } : {}) },
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

  // ── หนังสือรับรองหัก ณ ที่จ่าย (WHT certificate) ──────────────────────────────
  // ทิศทาง: type='รายจ่าย' = เราจ่าย+หักภาษีคู่ค้า (เอกสารทางการที่เราต้องออก), type='รายรับ' =
  // คู่ค้าหักภาษีจากเรา (เราแค่ช่วยเตรียมร่างให้คู่ค้าตรวจสอบ+ออกในนามของเขาเอง — ไม่ใช่ฉบับทางการ)
  const openWhtCert = () => {
    const isWeWithhold = form.type === 'รายจ่าย';
    const baseAmount = Math.max(0,
      (parseFloat(form.amount) || 0) + (parseFloat(form.whtAmount) || 0) - (parseFloat(form.taxAmount) || 0)
    ).toFixed(2);
    const counterparty = {
      name: form.taxpayerName || (isWeWithhold ? form.receiver : form.sender) || '',
      address: form.taxAddress || '',
      taxId: form.taxId || '',
    };
    const shopParty = { name: shopName, address: shopAddress, taxId: shopTaxId };
    setWhtCert({
      direction: isWeWithhold ? 'we_withhold' : 'they_withhold',
      docDate: form.date || '',
      baseAmount,
      whtAmount: form.whtAmount || '',
      incomeTypeCode: '5',
      incomeTypeOther: '',
      payer: isWeWithhold ? shopParty : counterparty,
      payee: isWeWithhold ? counterparty : shopParty,
      certNo: null,
    });
    setWhtCertStep('form');
    setWhtCertOpen(true);
    setWhtCertResult(null);
  };

  // นิยาม TIER_LEVEL ซ้ำเฉพาะที่นี่ (ไม่พึ่งค่าที่ประกาศไว้ทีหลังในไฟล์เดียวกัน — const ใน JS ไม่ hoist
  // ให้เรียกใช้ก่อนบรรทัดประกาศได้ ถ้าอ้างอิงตัวแปรร่วมกันข้ามจุดจะเจอ ReferenceError จาก temporal
  // dead zone) ค่าตรงกับ lib/tier-features.js's white_label threshold (Enterprise ขึ้นไป)
  const isEnterprise = (({ normal: 0, pro: 1, advance: 2, business: 3, enterprise: 4, super: 4 }[shopTier] || 0) >= 4);

  const buildWhtCertQuery = (extra = {}) => {
    const c = { ...whtCert, ...extra };
    return new URLSearchParams({
      direction: c.direction, docDate: c.docDate,
      baseAmount: c.baseAmount, whtAmount: c.whtAmount,
      incomeTypeCode: c.incomeTypeCode, incomeTypeOther: c.incomeTypeOther || '',
      payerName: c.payer.name || '', payerAddress: c.payer.address || '', payerTaxId: c.payer.taxId || '',
      payeeName: c.payee.name || '', payeeAddress: c.payee.address || '', payeeTaxId: c.payee.taxId || '',
      isWhiteLabel: isEnterprise ? '1' : '0',
      certNo: c.certNo || '',
    }).toString();
  };

  const handleWhtCertPreview = () => {
    whtCertPreviewUrl.current = `/api/wht-certificate/preview?${buildWhtCertQuery()}`;
    setWhtCertStep('preview');
  };

  const handleWhtCertSave = async () => {
    setWhtCertStep('saving');
    try {
      const sessionToken = getOwnerSessionToken(shopId);
      const res = await fetch('/api/wht-certificate/save', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...(sessionToken ? { 'x-owner-session': sessionToken } : {}) },
        body: JSON.stringify({
          shopId, ref,
          direction: whtCert.direction,
          incomeTypeCode: whtCert.incomeTypeCode, incomeTypeOther: whtCert.incomeTypeOther,
          baseAmount: whtCert.baseAmount, whtAmount: whtCert.whtAmount, docDate: whtCert.docDate,
          payer: whtCert.payer, payee: whtCert.payee,
        }),
      });
      const data = await res.json();
      if (data.error) { alert('บันทึกไม่สำเร็จ: ' + data.error); setWhtCertStep('preview'); return; }
      setWhtCert(prev => ({ ...prev, certNo: data.certNo }));
      whtCertPreviewUrl.current = `/api/wht-certificate/preview?${buildWhtCertQuery({ certNo: data.certNo })}`;
      setWhtCertResult(data);
      setWhtCertStep('saved');
    } catch {
      alert('เกิดข้อผิดพลาด กรุณาลองใหม่');
      setWhtCertStep('preview');
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
            <p className="text-slate-400 text-xs mb-5">ข้อมูลรายการนี้ถูกอัปเดตแล้ว</p>
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
                {field('ที่อยู่ผู้เสียภาษี', 'taxAddress', { placeholder: 'ที่อยู่ตามหนังสือรับรอง/ใบกำกับภาษี' })}
                {form.taxAmount && parseFloat(form.taxAmount) > 0 && parseFloat(form.amount) > 0 && (
                  <p className="text-[11px] text-slate-400">
                    ราคาก่อน VAT ≈ ฿{(parseFloat(form.amount) - parseFloat(form.taxAmount)).toLocaleString('th-TH', { minimumFractionDigits: 2 })}
                  </p>
                )}
              </div>

              {/* ภาษีหัก ณ ที่จ่าย (WHT) — คนละก้อนจาก VAT ข้างบนเจตนา ห้ามปนกัน (คนละอัตรา/
                  ความหมายกันโดยสิ้นเชิง) แสดงได้ทั้งรายรับ/รายจ่าย ต่างจาก VAT ที่ผูกกับราคาสินค้า
                  โดยตรง — ทิศทางความหมายเปลี่ยนตาม form.type: รายรับ = คู่ค้าหักเรา (เรามีเครดิต
                  ภาษีไว้ใช้ตอนยื่น), รายจ่าย = เราหักคู่ค้า (เราติดหนี้สรรพากร ต้องนำส่ง+ออกหนังสือ
                  รับรองให้คู่ค้า) — ปกติบอทจะอ่านค่านี้ให้อัตโนมัติจากเอกสารที่ระบุ "หัก ณ ที่จ่าย"
                  ชัดเจน แต่เผื่อ OCR พลาด/เอกสารไม่ชัด แก้ไข-เติมเองตรงนี้ได้เสมอ */}
              <div className="border-t border-slate-100 pt-4 space-y-3">
                <p className="text-[10px] font-black text-amber-600 uppercase tracking-wider">ภาษีหัก ณ ที่จ่าย (WHT)</p>
                <div>
                  <label className="text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-1.5 block">
                    ยอดถูกหัก/ที่หัก ณ ที่จ่าย (บาท)
                  </label>
                  <input value={form.whtAmount} onChange={e => setForm({ ...form, whtAmount: e.target.value })}
                    type="number" step="0.01" min="0" placeholder="เช่น 15.00 (เว้นว่าง = ไม่มี)"
                    className="w-full border border-slate-200 rounded-xl px-4 py-2.5 text-sm font-medium outline-none focus:border-amber-400 transition-colors"/>
                </div>
                {form.whtAmount && parseFloat(form.whtAmount) > 0 && (
                  <p className="text-[11px] text-slate-400">
                    {form.type === 'รายจ่าย'
                      ? '💡 หมายถึง "เรา" เป็นคนหักภาษี ณ ที่จ่ายจากคู่ค้ารายนี้ — ต้องนำส่งสรรพากร + ออกหนังสือรับรองการหักภาษีให้คู่ค้า'
                      : '💡 หมายถึงคู่ค้ารายนี้หักภาษี ณ ที่จ่ายจากเรา — เก็บไว้เป็นเครดิตภาษีตอนยื่นแบบ (ควรมีหนังสือรับรองการหักภาษี ณ ที่จ่ายจากคู่ค้าด้วย)'}
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

            {/* ── หนังสือรับรองหัก ณ ที่จ่าย — โผล่เฉพาะรายการที่มี WHT เท่านั้น ── */}
            {form.whtAmount && parseFloat(form.whtAmount) > 0 && whtCert === null && !whtCertOpen && (
              <div className="bg-white rounded-2xl border border-slate-200 overflow-hidden">
                <div className="px-5 py-3 border-b border-slate-100">
                  <span className="text-sm font-black text-slate-700 flex items-center gap-2">
                    <FileText size={15} className="text-amber-500"/>
                    หนังสือรับรองหัก ณ ที่จ่าย
                  </span>
                </div>
                <div className="px-5 py-4 text-center">
                  <p className="text-xs text-slate-400 mb-3">
                    {form.type === 'รายจ่าย'
                      ? 'ออกหนังสือรับรองการหักภาษี ณ ที่จ่ายให้คู่ค้ารายนี้ (เอกสารทางการที่กฎหมายบังคับให้เราต้องออก)'
                      : 'เตรียมร่างหนังสือรับรองฯ ให้คู่ค้ารายนี้ตรวจสอบและออกในนามของเขาเอง'}
                  </p>
                  <button type="button" onClick={openWhtCert}
                    className="flex items-center gap-2 mx-auto px-5 py-2.5 rounded-xl text-sm font-bold text-white bg-amber-600 hover:bg-amber-700 transition-all">
                    <FileText size={14}/> กรอกข้อมูล/ดูตัวอย่าง
                  </button>
                </div>
              </div>
            )}

            {whtCertOpen && whtCert && (
              <div className="bg-white rounded-2xl border border-slate-200 overflow-hidden">
                <div className="px-5 py-3 flex items-center justify-between border-b border-slate-100">
                  <span className="text-sm font-black text-slate-700 flex items-center gap-2">
                    <FileText size={15} className="text-amber-500"/>
                    หนังสือรับรองหัก ณ ที่จ่าย
                  </span>
                  {whtCertStep !== 'saving' && (
                    <button type="button" onClick={() => { setWhtCertOpen(false); setWhtCert(null); setWhtCertResult(null); setWhtCertStep('form'); }}
                      className="text-slate-400 hover:text-slate-600">
                      <X size={14}/>
                    </button>
                  )}
                </div>

                <div className="px-5 py-4">
                  {whtCertStep === 'form' && (
                    <div className="space-y-3">
                      <div className={`text-[11px] font-semibold rounded-xl px-3 py-2 ${whtCert.direction === 'we_withhold' ? 'bg-blue-50 text-blue-700' : 'bg-amber-50 text-amber-700'}`}>
                        {whtCert.direction === 'we_withhold'
                          ? '🟢 เราเป็นผู้จ่ายเงินและหักภาษีไว้ — เอกสารทางการที่เราต้องออกให้คู่ค้า'
                          : '🟡 คู่ค้ารายนี้หักภาษีจากเรา — เอกสารนี้เป็นแค่ร่างให้คู่ค้าตรวจสอบและออกเอง'}
                      </div>

                      <div className="grid grid-cols-2 gap-3">
                        <div>
                          <label className="text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-1.5 block">เงินได้ที่จ่าย (ก่อนหัก)</label>
                          <input type="number" step="0.01" min="0" value={whtCert.baseAmount}
                            onChange={e => setWhtCert({ ...whtCert, baseAmount: e.target.value })}
                            className="w-full border border-slate-200 rounded-xl px-3 py-2 text-sm font-medium outline-none focus:border-amber-400 transition-colors"/>
                        </div>
                        <div>
                          <label className="text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-1.5 block">ภาษีที่หักไว้</label>
                          <input type="number" step="0.01" min="0" value={whtCert.whtAmount}
                            onChange={e => setWhtCert({ ...whtCert, whtAmount: e.target.value })}
                            className="w-full border border-slate-200 rounded-xl px-3 py-2 text-sm font-medium outline-none focus:border-amber-400 transition-colors"/>
                        </div>
                      </div>
                      {parseFloat(whtCert.baseAmount) > 0 && (
                        <p className="text-[10px] text-slate-400">
                          อัตราภาษีที่หัก ≈ {((parseFloat(whtCert.whtAmount || 0) / parseFloat(whtCert.baseAmount)) * 100).toFixed(2)}%
                        </p>
                      )}

                      <div>
                        <label className="text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-1.5 block">ประเภทเงินได้ (ตามมาตรา 40)</label>
                        <select value={whtCert.incomeTypeCode} onChange={e => setWhtCert({ ...whtCert, incomeTypeCode: e.target.value })}
                          className="w-full border border-slate-200 rounded-xl px-3 py-2 text-xs font-medium outline-none focus:border-amber-400 transition-colors">
                          <option value="1">1. เงินเดือน ค่าจ้าง เบี้ยเลี้ยง โบนัส ฯลฯ</option>
                          <option value="2">2. ค่าธรรมเนียม ค่านายหน้า ฯลฯ</option>
                          <option value="3">3. ค่าแห่งลิขสิทธิ์ ฯลฯ</option>
                          <option value="4a">4(ก). ดอกเบี้ย ฯลฯ</option>
                          <option value="4b">4(ข). เงินปันผล เงินส่วนแบ่งกำไร ฯลฯ</option>
                          <option value="5">5. อื่นๆ (ค่าจ้างทำของ/ค่าบริการ/ค่าขนส่ง ฯลฯ)</option>
                        </select>
                      </div>
                      {whtCert.incomeTypeCode === '5' && (
                        <input value={whtCert.incomeTypeOther} onChange={e => setWhtCert({ ...whtCert, incomeTypeOther: e.target.value })}
                          placeholder="ระบุ เช่น ค่าบริการ, ค่าเช่า, ค่าขนส่ง"
                          className="w-full border border-slate-200 rounded-xl px-3 py-2 text-xs font-medium outline-none focus:border-amber-400 transition-colors"/>
                      )}

                      <div>
                        <label className="text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-1.5 block">วันที่จ่ายเงิน</label>
                        <input value={whtCert.docDate} onChange={e => setWhtCert({ ...whtCert, docDate: e.target.value })}
                          placeholder="วว/ดด/ปปปป"
                          className="w-full border border-slate-200 rounded-xl px-3 py-2 text-sm font-medium outline-none focus:border-amber-400 transition-colors"/>
                      </div>

                      {['payer', 'payee'].map(role => (
                        <div key={role} className="border-t border-slate-100 pt-3 space-y-2">
                          <p className="text-[10px] font-black text-slate-400 uppercase tracking-wider">
                            {role === 'payer' ? 'ผู้จ่ายเงิน (ผู้มีหน้าที่หักภาษี)' : 'ผู้ถูกหักภาษี (ผู้รับเงิน)'}
                          </p>
                          <input value={whtCert[role].name} onChange={e => setWhtCert({ ...whtCert, [role]: { ...whtCert[role], name: e.target.value } })}
                            placeholder="ชื่อ" className="w-full border border-slate-200 rounded-xl px-3 py-2 text-sm font-medium outline-none focus:border-amber-400 transition-colors"/>
                          <input value={whtCert[role].address} onChange={e => setWhtCert({ ...whtCert, [role]: { ...whtCert[role], address: e.target.value } })}
                            placeholder="ที่อยู่" className="w-full border border-slate-200 rounded-xl px-3 py-2 text-xs font-medium outline-none focus:border-amber-400 transition-colors"/>
                          <input value={whtCert[role].taxId} onChange={e => setWhtCert({ ...whtCert, [role]: { ...whtCert[role], taxId: e.target.value } })}
                            placeholder="เลขประจำตัวผู้เสียภาษี/บัตรประชาชน" className="w-full border border-slate-200 rounded-xl px-3 py-2 text-xs font-medium outline-none focus:border-amber-400 transition-colors"/>
                        </div>
                      ))}

                      <button type="button" onClick={handleWhtCertPreview}
                        disabled={!(parseFloat(whtCert.whtAmount) > 0)}
                        className="w-full flex items-center justify-center gap-2 py-2.5 rounded-xl text-sm font-black text-white bg-amber-600 hover:bg-amber-700 transition-all disabled:opacity-50">
                        <FileText size={14}/> ดูตัวอย่าง
                      </button>
                    </div>
                  )}

                  {(whtCertStep === 'preview' || whtCertStep === 'saving') && (
                    <div className="space-y-3">
                      <div className="rounded-xl overflow-hidden border border-slate-200 bg-slate-50">
                        <iframe
                          src={whtCertPreviewUrl.current}
                          className="w-full border-0"
                          style={{ height: '480px' }}
                          title="ตัวอย่างหนังสือรับรองหัก ณ ที่จ่าย"
                        />
                      </div>
                      <div className="flex gap-2">
                        <button type="button" onClick={() => setWhtCertStep('form')} disabled={whtCertStep === 'saving'}
                          className="flex-1 py-2.5 rounded-xl text-sm font-bold text-slate-500 border border-slate-200 hover:bg-slate-50 transition-all disabled:opacity-50">
                          ← แก้ไข
                        </button>
                        <button type="button" onClick={handleWhtCertSave} disabled={whtCertStep === 'saving'}
                          className="flex-1 flex items-center justify-center gap-2 py-2.5 rounded-xl text-sm font-black text-white bg-amber-600 hover:bg-amber-700 transition-all disabled:opacity-50">
                          <Save size={14}/>
                          {whtCertStep === 'saving' ? 'กำลังบันทึก...' : 'บันทึกเลขที่ + สำเนา'}
                        </button>
                      </div>
                    </div>
                  )}

                  {whtCertStep === 'saved' && whtCertResult && (
                    <div className="space-y-3">
                      <div className="flex items-center gap-2 text-amber-700 bg-amber-50 border border-amber-200 rounded-xl px-4 py-2.5">
                        <CheckCircle2 size={16} className="shrink-0"/>
                        <div>
                          <p className="text-sm font-bold">บันทึกสำเร็จแล้ว</p>
                          <p className="text-xs text-amber-600">{whtCertResult.certNo}</p>
                        </div>
                      </div>
                      <div className="grid grid-cols-2 gap-2">
                        <a href={whtCertPreviewUrl.current} target="_blank" rel="noreferrer"
                          className="flex items-center justify-center gap-1.5 py-2.5 rounded-xl border-2 border-slate-300 text-slate-600 text-xs font-bold hover:bg-slate-50 transition-all">
                          <Printer size={13}/> ปริ้น
                        </a>
                        <a href={`${whtCertPreviewUrl.current}&download=1`} target="_blank" rel="noreferrer"
                          className="flex items-center justify-center gap-1.5 py-2.5 rounded-xl bg-slate-700 text-white text-xs font-bold hover:bg-slate-600 transition-all">
                          <Download size={13}/> ดาวน์โหลด PDF
                        </a>
                      </div>
                      {whtCertResult.driveViewUrl && (
                        <a href={whtCertResult.driveViewUrl} target="_blank" rel="noreferrer"
                          className="block text-center text-[11px] text-blue-600 font-bold hover:underline">
                          📁 เปิดสำเนาใน Google Drive
                        </a>
                      )}
                    </div>
                  )}
                </div>
              </div>
            )}

            <p className="text-center text-[10px] text-slate-400">
              การแก้ไขจะอัปเดตข้อมูลรายการนี้ในระบบทันที
            </p>
          </form>
        )}
      </main>
    </div>
  );
}
