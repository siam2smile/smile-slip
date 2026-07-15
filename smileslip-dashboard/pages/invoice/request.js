import React, { useState, useEffect } from 'react';
import { useRouter } from 'next/router';
import Head from 'next/head';
import { ArrowLeft, Printer, Building2, CheckCircle, Save } from 'lucide-react';

const SELLER = {
  name: 'บริษัท สยาม โกลบอล เน็ทเวิร์ค เอ็นเตอร์ไพรส์ จำกัด',
  branch: 'สำนักงานใหญ่',
  taxId: '0505565019236',
  address: '76 หมู่ 9 ต.หางดง อ.หางดง จ.เชียงใหม่ 50230',
  phone: '094-593-8254',
  sellerName: 'วิศรัต มะโนวรรณ',
  contactName: 'วลักษ์กมล',
  contactPhone: '081-993-7999',
  bank: 'ธนาคารกสิกรไทย',
  accountNo: '175-873-123-1',
  line: 'https://lin.ee/uYhct4L',
};

const PLANS = [
  { id: 'advance',    name: 'Advance',    monthlyPrice: 499,  yearlyPrice: 4990  },
  { id: 'business',  name: 'Business',   monthlyPrice: 999,  yearlyPrice: 9990  },
  { id: 'enterprise',name: 'Enterprise', monthlyPrice: 2990, yearlyPrice: 29900 },
];

function calcInvoice(price) {
  // price = ราคาแพ็กเกจก่อน VAT (ไม่รวม VAT)
  const base  = price;
  const vat   = Math.round((base * 0.07) * 100) / 100;
  const total = Math.round((base + vat) * 100) / 100;
  const wht   = Math.round((base * 0.03) * 100) / 100;
  return { base, vat, total, wht, net: Math.round((total - wht) * 100) / 100 };
}

function fmt(n) {
  return Number(n).toLocaleString('th-TH', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function genInvoiceNo() {
  const d = new Date();
  const ymd = `${d.getFullYear()}${String(d.getMonth()+1).padStart(2,'0')}${String(d.getDate()).padStart(2,'0')}`;
  return `INV${ymd}${String(Math.floor(Math.random()*9000)+1000)}`;
}

function fmtDate(d) {
  return `${String(d.getDate()).padStart(2,'0')}/${String(d.getMonth()+1).padStart(2,'0')}/${d.getFullYear()}`;
}

function thaiAmountText(amount) {
  const D = ['','หนึ่ง','สอง','สาม','สี่','ห้า','หก','เจ็ด','แปด','เก้า'];
  const P = ['','สิบ','ร้อย','พัน','หมื่น','แสน'];
  function cvt(n) {
    if (!n) return '';
    if (n >= 1000000) return cvt(Math.floor(n/1000000))+'ล้าน'+cvt(n%1000000);
    const s = String(n), len = s.length;
    let r = '';
    for (let i=0;i<len;i++){
      const d=parseInt(s[i]), pl=len-1-i;
      if(!d) continue;
      let dt = D[d];
      if(pl===1&&d===2) dt='ยี่';
      if(pl===1&&d===1) dt='';
      if(pl===0&&d===1&&len>1) dt='เอ็ด';
      r += dt+P[pl];
    }
    return r;
  }
  const rounded = Math.round(amount*100)/100;
  const baht = Math.floor(rounded);
  const satang = Math.round((rounded-baht)*100);
  let t = baht>0 ? cvt(baht)+'บาท' : '';
  t += satang>0 ? cvt(satang)+'สตางค์' : 'ถ้วน';
  return t;
}

function LogoSVG() {
  return (
    <img src="/Logo-smile-slip.jpg" alt="Smile Slip"
      style={{ width:'48px', height:'48px', objectFit:'contain' }}
      onError={e=>{ e.target.style.display='none'; }}/>
  );
}

export default function InvoiceRequest() {
  const router = useRouter();
  const { plan: qPlan, yearly: qYearly, userId } = router.query;

  const [planId,   setPlanId]   = useState('advance');
  const [isYearly, setIsYearly] = useState(false);
  const [invNo]                 = useState(genInvoiceNo);
  const [invDate]               = useState(() => fmtDate(new Date()));
  const [saving,   setSaving]   = useState(false);
  const [saved,    setSaved]    = useState(false);

  const [buyer, setBuyer] = useState({ name:'', taxId:'', branch:'', address:'', contactName:'', phone:'', email:'' });

  useEffect(() => {
    if (qPlan) setPlanId(qPlan);
    if (qYearly==='true') setIsYearly(true);
  }, [qPlan, qYearly]);

  const plan   = PLANS.find(p=>p.id===planId)||PLANS[0];
  const price  = isYearly ? plan.yearlyPrice : plan.monthlyPrice;
  const calc   = calcInvoice(price);
  const period = isYearly ? 'รายปี (12 เดือน)' : 'รายเดือน (1 เดือน)';
  const unit   = isYearly ? 'ปี' : 'เดือน';

  const handlePrint = () => {
    if (!buyer.name||!buyer.taxId||!buyer.address) {
      alert('กรุณากรอก ชื่อบริษัท, เลขประจำตัวผู้เสียภาษี และที่อยู่ก่อนพิมพ์');
      return;
    }
    window.print();
  };

  const handleSave = async () => {
    if (!buyer.name||!buyer.taxId||!buyer.address) {
      alert('กรุณากรอกข้อมูลให้ครบก่อนบันทึก');
      return;
    }
    setSaving(true);
    try {
      const res = await fetch('/api/invoice/save', {
        method:'POST', headers:{'Content-Type':'application/json'},
        body: JSON.stringify({
          shopId: router.query.shopId||null,
          planId:plan.id, isYearly,
          basePrice:calc.base, vatAmount:calc.vat, totalPrice:calc.total, whtAmount:calc.wht, netAmount:calc.net,
          invoiceNo:invNo,
          buyerName:buyer.name, buyerTaxId:buyer.taxId, buyerBranch:buyer.branch,
          buyerAddress:buyer.address, buyerEmail:buyer.email, buyerPhone:buyer.phone,
          buyerContact:buyer.contactName,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      setSaved(true);
    } catch(err){ alert('บันทึกไม่สำเร็จ: '+err.message); }
    setSaving(false);
  };

  const allFilled = buyer.name && buyer.taxId && buyer.address;

  return (
    <>
      <Head>
        <title>ขอใบแจ้งหนี้ — Smile Slip Pro</title>
        <style>{`
          @media print {
            @page { size: A4 portrait; margin: 12mm; }
            #screen-ui { display: none !important; }
            #invoice-print-root { display: block !important; }
          }
          #invoice-print-root { display: none; }
        `}</style>
      </Head>

      {/* ── Screen UI ── */}
      <div id="screen-ui" className="min-h-screen bg-slate-50 font-sans">
        <div className="bg-white border-b border-slate-200 px-6 py-4">
          <div className="max-w-6xl mx-auto flex items-center gap-3">
            <button onClick={()=>router.push(`/pricing?userId=${userId}`)}
              className="flex items-center gap-1.5 text-slate-500 hover:text-slate-800 text-sm">
              <ArrowLeft size={16}/> กลับ
            </button>
            <span className="text-slate-300">|</span>
            <span className="font-black text-slate-800 text-sm">ขอใบแจ้งหนี้ / Quotation Request</span>
          </div>
        </div>

        <div className="max-w-6xl mx-auto px-4 py-8 grid grid-cols-1 lg:grid-cols-2 gap-8">

          {/* ── Form ── */}
          <div className="space-y-6">
            <div className="bg-white rounded-3xl border border-slate-200 p-6 shadow-sm">
              <h2 className="font-black text-slate-800 mb-4 flex items-center gap-2">
                <Building2 size={18} className="text-indigo-500"/> เลือกแพ็กเกจ
              </h2>
              <div className="grid grid-cols-3 gap-2 mb-4">
                {PLANS.map(p=>(
                  <button key={p.id} onClick={()=>setPlanId(p.id)}
                    className={`py-2.5 rounded-xl text-sm font-bold border-2 transition-all ${planId===p.id?'bg-indigo-600 text-white border-indigo-600':'bg-white text-slate-600 border-slate-200 hover:border-indigo-300'}`}>
                    {p.name}
                  </button>
                ))}
              </div>
              <div className="flex items-center gap-3">
                <button onClick={()=>setIsYearly(false)}
                  className={`flex-1 py-2 rounded-xl text-sm font-bold border-2 transition-all ${!isYearly?'bg-slate-800 text-white border-slate-800':'bg-white text-slate-500 border-slate-200'}`}>
                  รายเดือน ฿{plan.monthlyPrice.toLocaleString()}
                </button>
                <button onClick={()=>setIsYearly(true)}
                  className={`flex-1 py-2 rounded-xl text-sm font-bold border-2 transition-all ${isYearly?'bg-slate-800 text-white border-slate-800':'bg-white text-slate-500 border-slate-200'}`}>
                  รายปี ฿{plan.yearlyPrice.toLocaleString()} <span className="text-emerald-400 text-[10px]">-2เดือน</span>
                </button>
              </div>
            </div>

            <div className="bg-white rounded-3xl border border-slate-200 p-6 shadow-sm">
              <h2 className="font-black text-slate-800 mb-4">ข้อมูลบริษัทของท่าน (ผู้ซื้อ)</h2>
              <div className="space-y-3">
                {[
                  {key:'name',        label:'ชื่อบริษัท / ห้างหุ้นส่วน *',          placeholder:'บริษัท ตัวอย่าง จำกัด'},
                  {key:'taxId',       label:'เลขประจำตัวผู้เสียภาษี (13 หลัก) *',   placeholder:'0000000000000'},
                  {key:'branch',      label:'สาขา (ถ้ามี)',                           placeholder:'สำนักงานใหญ่ / สาขา 0001'},
                  {key:'address',     label:'ที่อยู่สำหรับออกเอกสาร *',              placeholder:'123 ถ.ตัวอย่าง ต. อ. จ. รหัสไปรษณีย์'},
                  {key:'contactName', label:'ชื่อผู้ติดต่อ',                          placeholder:'ชื่อ-นามสกุล ผู้ประสานงาน'},
                  {key:'phone',       label:'เบอร์โทรศัพท์ผู้ติดต่อ',                placeholder:'0x-xxxx-xxxx'},
                  {key:'email',       label:'อีเมลสำหรับรับเอกสาร',                   placeholder:'accounting@company.com'},
                ].map(f=>(
                  <div key={f.key}>
                    <label className="text-xs font-bold text-slate-500 block mb-1">{f.label}</label>
                    {f.key==='address'?(
                      <textarea rows={2} placeholder={f.placeholder}
                        className="w-full border border-slate-200 rounded-xl px-3 py-2 text-sm outline-none focus:border-indigo-400 resize-none"
                        value={buyer[f.key]} onChange={e=>setBuyer(p=>({...p,[f.key]:e.target.value}))}/>
                    ):(
                      <input type="text" placeholder={f.placeholder}
                        className="w-full border border-slate-200 rounded-xl px-3 py-2 text-sm outline-none focus:border-indigo-400"
                        value={buyer[f.key]} onChange={e=>setBuyer(p=>({...p,[f.key]:e.target.value}))}/>
                    )}
                  </div>
                ))}
              </div>
            </div>

            <div className="space-y-3">
              <div className="grid grid-cols-2 gap-2">
                <button onClick={handlePrint} disabled={!allFilled}
                  className="flex items-center justify-center gap-2 bg-indigo-600 hover:bg-indigo-700 disabled:opacity-40 text-white font-black py-3.5 rounded-2xl text-sm">
                  <Printer size={16}/> พิมพ์ PDF
                </button>
                <button onClick={handleSave} disabled={!allFilled||saving||saved}
                  className={`flex items-center justify-center gap-2 font-black py-3.5 rounded-2xl text-sm border-2 ${saved?'bg-emerald-50 border-emerald-400 text-emerald-600':'bg-white border-slate-300 hover:border-indigo-400 text-slate-600 disabled:opacity-40'}`}>
                  <Save size={16}/>{saved?'✓ ส่งคำขอแล้ว':saving?'กำลังส่ง...':'ส่งคำขอ'}
                </button>
              </div>
              {saved&&(
                <div className="bg-emerald-50 border border-emerald-200 rounded-2xl px-4 py-3 text-xs text-emerald-700 flex items-center gap-2">
                  <CheckCircle size={14}/>ส่งคำขอแล้ว — ทีมงานจะออก <strong>ใบกำกับภาษีเต็มรูปแบบ</strong> และส่งทางอีเมลหลังได้รับชำระเงิน
                </div>
              )}
              <div className="bg-amber-50 border border-amber-200 rounded-2xl p-4 text-xs text-amber-700 space-y-1">
                <p className="font-bold">หลังได้ใบแจ้งหนี้แล้ว:</p>
                <p>1. โอนเงิน <strong>ยอดสุทธิหลังหัก WHT 3% = ฿{fmt(calc.net)}</strong> มาที่บัญชี KBank 175-873-123-1</p>
                <p>2. ส่ง สลิปโอนเงิน + หนังสือรับรองหัก ณ ที่จ่าย ผ่าน LINE</p>
                <p>3. ทีมงานจะเปิดสิทธิ์ภายใน 1 วันทำการ</p>
              </div>
              <a href={SELLER.line} target="_blank" rel="noreferrer"
                className="w-full flex items-center justify-center gap-2 bg-[#06C755] hover:bg-[#05a848] text-white font-black py-3.5 rounded-2xl text-sm">
                <svg width="18" height="18" viewBox="0 0 48 48" fill="currentColor"><path d="M24 4C12.95 4 4 11.86 4 21.5c0 5.5 2.93 10.4 7.52 13.6L9.5 44l9.3-4.64C20.5 39.78 22.22 40 24 40c11.05 0 20-7.86 20-17.5S35.05 4 24 4z"/></svg>
                ส่งเอกสารผ่าน LINE Smile Slip
              </a>
            </div>
          </div>

          {/* ── Screen Preview ── */}
          <div>
            <div className="bg-white rounded-3xl border-2 border-indigo-100 shadow-lg overflow-hidden">
              <div className="bg-slate-700 px-6 py-3 flex items-center justify-between">
                <p className="text-white text-xs font-bold uppercase tracking-widest">ใบแจ้งหนี้ (Quotation)</p>
                <span className="text-[10px] bg-amber-400 text-amber-900 font-bold px-2 py-0.5 rounded-full">รอการอนุมัติ</span>
              </div>
              <div className="overflow-auto p-2" style={{maxHeight:'700px'}}>
                <div style={{transform:'scale(0.72)', transformOrigin:'top left', width:'138.9%'}}>
                  <InvoiceDoc invNo={invNo} invDate={invDate} buyer={buyer} plan={plan} isYearly={isYearly} calc={calc} period={period} unit={unit}/>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* ── Print Root (hidden on screen, only shown in print) ── */}
      <div id="invoice-print-root">
        <InvoiceDoc invNo={invNo} invDate={invDate} buyer={buyer} plan={plan} isYearly={isYearly} calc={calc} period={period} unit={unit}/>
      </div>
    </>
  );
}

function InvoiceDoc({ invNo, invDate, buyer, plan, isYearly, calc, period, unit }) {
  const amountWords = thaiAmountText(calc.total);
  const s = { fontFamily:"'Sarabun','Noto Sans Thai',sans-serif", color:'#1e293b', backgroundColor:'white', padding:'20px', fontSize:'10.5pt', lineHeight:'1.5' };

  return (
    <div style={s}>

      {/* ══ HEADER ══ */}
      <div style={{display:'flex', justifyContent:'space-between', alignItems:'flex-start', marginBottom:'12px'}}>

        {/* Left: Company */}
        <div style={{width:'54%'}}>
          <div style={{display:'flex', alignItems:'center', gap:'10px', marginBottom:'8px'}}>
            <LogoSVG/>
            <div>
              <div style={{fontSize:'8.5pt', color:'#64748b', fontWeight:'600'}}>Siam Global Network Enterprise Co., Ltd.</div>
              <div style={{fontSize:'7pt', color:'#94a3b8'}}>smile slip pro · AI OCR · LINE Bot</div>
            </div>
          </div>
          <div style={{fontSize:'9.5pt', fontWeight:'700', lineHeight:'1.7'}}>
            {SELLER.name} ({SELLER.branch})<br/>
            {SELLER.address}<br/>
            เลขประจำตัวผู้เสียภาษี {SELLER.taxId}<br/>
            โทร. {SELLER.phone}
          </div>
        </div>

        {/* Right: Title + Doc info */}
        <div style={{width:'44%'}}>
          <div style={{textAlign:'right', marginBottom:'6px'}}>
            <div style={{fontSize:'18pt', fontWeight:'900', color:'#64748b', lineHeight:'1.2'}}>ใบแจ้งหนี้</div>
            <div style={{fontSize:'8pt', color:'#ef4444', fontWeight:'600'}}>เอกสารนี้ไม่ใช่ใบกำกับภาษี</div>
            <div style={{fontSize:'7.5pt', color:'#94a3b8'}}>ใบกำกับภาษีจะออกให้หลังได้รับชำระเงิน</div>
          </div>
          <table style={{width:'100%', borderCollapse:'collapse', border:'1px solid #cbd5e1', fontSize:'9pt'}}>
            <tbody>
              {[
                ['เลขที่',    invNo],
                ['วันที่',    invDate],
                ...(buyer.contactName ? [['ผู้ติดต่อ', buyer.contactName]] : []),
                ...(buyer.phone       ? [['เบอร์โทร',  buyer.phone]]       : []),
              ].map(([l,v])=>(
                <tr key={l}>
                  <td style={{padding:'3px 8px', fontWeight:'600', color:'#64748b', borderBottom:'1px solid #e2e8f0', whiteSpace:'nowrap', width:'35%'}}>{l}</td>
                  <td style={{padding:'3px 8px', borderBottom:'1px solid #e2e8f0', borderLeft:'1px solid #e2e8f0'}}>{v}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Blue divider */}
      <div style={{borderTop:'2.5px solid #1e40af', marginBottom:'10px'}}/>

      {/* ══ CUSTOMER ══ */}
      <div style={{marginBottom:'12px', padding:'8px 10px', border:'1px solid #e2e8f0', borderRadius:'4px'}}>
        <div style={{fontSize:'8.5pt', fontWeight:'700', color:'#1e40af', marginBottom:'3px'}}>ลูกค้า</div>
        <div style={{fontWeight:'700', fontSize:'10pt'}}>
          {buyer.name||'.................................'}{buyer.branch?` (${buyer.branch})`:''}
        </div>
        <div style={{fontSize:'9pt', color:'#475569', lineHeight:'1.6'}}>
          {buyer.address||'.................................'}<br/>
          เลขประจำตัวผู้เสียภาษี {buyer.taxId||'0000000000000'}
          {buyer.phone&&<><br/>โทร. {buyer.phone}</>}
          {buyer.email&&<><br/>Email: {buyer.email}</>}
        </div>
      </div>

      {/* ══ ITEMS TABLE ══ */}
      <table style={{width:'100%', borderCollapse:'collapse', border:'1px solid #cbd5e1', fontSize:'9pt', marginBottom:'0'}}>
        <thead>
          <tr style={{backgroundColor:'#1e293b', color:'white'}}>
            <th style={{padding:'6px 8px', textAlign:'center', width:'5%', borderRight:'1px solid #374151'}}>#</th>
            <th style={{padding:'6px 8px', textAlign:'left',   width:'43%', borderRight:'1px solid #374151'}}>รายละเอียด</th>
            <th style={{padding:'6px 8px', textAlign:'center', width:'8%',  borderRight:'1px solid #374151'}}>จำนวน</th>
            <th style={{padding:'6px 8px', textAlign:'center', width:'8%',  borderRight:'1px solid #374151'}}>หน่วย</th>
            <th style={{padding:'6px 8px', textAlign:'right',  width:'14%', borderRight:'1px solid #374151'}}>ราคาต่อหน่วย</th>
            <th style={{padding:'6px 8px', textAlign:'center', width:'8%',  borderRight:'1px solid #374151'}}>ส่วนลด</th>
            <th style={{padding:'6px 8px', textAlign:'right',  width:'14%'}}>มูลค่า</th>
          </tr>
        </thead>
        <tbody>
          <tr style={{borderBottom:'1px solid #e2e8f0'}}>
            <td style={{padding:'10px 8px', textAlign:'center', borderRight:'1px solid #e2e8f0'}}>1</td>
            <td style={{padding:'10px 8px', borderRight:'1px solid #e2e8f0'}}>
              <div style={{fontWeight:'700'}}>Smile Slip Pro — {plan.name}</div>
              <div style={{fontSize:'8pt', color:'#64748b'}}>บริการซอฟต์แวร์จัดการสลิปโอนเงิน AI ({period})</div>
            </td>
            <td style={{padding:'10px 8px', textAlign:'center', borderRight:'1px solid #e2e8f0'}}>1</td>
            <td style={{padding:'10px 8px', textAlign:'center', borderRight:'1px solid #e2e8f0'}}>{unit}</td>
            <td style={{padding:'10px 8px', textAlign:'right',  borderRight:'1px solid #e2e8f0', fontFamily:'monospace'}}>{fmt(calc.total)}</td>
            <td style={{padding:'10px 8px', textAlign:'center', borderRight:'1px solid #e2e8f0'}}>0.0 %</td>
            <td style={{padding:'10px 8px', textAlign:'right',  fontFamily:'monospace', fontWeight:'700'}}>{fmt(calc.total)}</td>
          </tr>
          {/* Spacer rows */}
          <tr style={{borderBottom:'1px solid #e2e8f0'}}><td colSpan={7} style={{padding:'6px'}}></td></tr>
          <tr style={{borderBottom:'1px solid #e2e8f0'}}><td colSpan={7} style={{padding:'6px'}}></td></tr>
        </tbody>
      </table>

      {/* ══ AMOUNT WORDS + TOTALS ══ */}
      <div style={{display:'flex', justifyContent:'space-between', alignItems:'stretch', border:'1px solid #cbd5e1', borderTop:'none', marginBottom:'10px'}}>
        {/* Amount in words */}
        <div style={{width:'52%', padding:'10px 12px', display:'flex', alignItems:'center', borderRight:'1px solid #cbd5e1', fontSize:'9.5pt'}}>
          ({amountWords})
        </div>
        {/* Totals */}
        <div style={{width:'48%', fontSize:'9pt'}}>
          {[
            {label:'รวมเป็นเงิน',                  value:fmt(calc.total)+' บาท'},
            {label:'ภาษีมูลค่าเพิ่ม 7%',           value:fmt(calc.vat)+' บาท'},
            {label:'ราคาไม่รวมภาษีมูลค่าเพิ่ม',    value:fmt(calc.base)+' บาท'},
          ].map((r,i)=>(
            <div key={i} style={{display:'flex', justifyContent:'space-between', padding:'4px 10px', borderBottom:'1px solid #e2e8f0'}}>
              <span>{r.label}</span>
              <span style={{fontFamily:'monospace'}}>{r.value}</span>
            </div>
          ))}
          <div style={{display:'flex', justifyContent:'space-between', padding:'6px 10px', backgroundColor:'#eff6ff', fontWeight:'700', fontSize:'10pt', borderTop:'2px solid #1e40af'}}>
            <span>จำนวนเงินรวมทั้งสิ้น</span>
            <span style={{fontFamily:'monospace', color:'#1e40af'}}>{fmt(calc.total)} บาท</span>
          </div>
        </div>
      </div>

      {/* ══ PAYMENT METHOD ══ */}
      <div style={{fontSize:'8.5pt', marginBottom:'6px', lineHeight:'2'}}>
        <span>การชำระเงินจะสมบูรณ์เมื่อบริษัทได้รับเงินเรียบร้อยแล้ว</span>
        {'  '}
        {['เงินสด','เช็ค','โอนเงิน','บัตรเครดิต'].map(m=>(
          <span key={m} style={{marginLeft:'12px'}}>
            <span style={{border:'1px solid #94a3b8', padding:'0 6px', marginRight:'3px'}}>□</span>{m}
          </span>
        ))}
      </div>
      <div style={{fontSize:'8.5pt', borderBottom:'1px solid #cbd5e1', paddingBottom:'4px', marginBottom:'12px'}}>
        ธนาคาร _________________________ เลขที่ _________________________ วันที่ _________________________ จำนวนเงิน _________________________
      </div>

      {/* ══ SIGNATURE AREA ══ */}
      <div style={{display:'flex', justifyContent:'space-between', fontSize:'8.5pt', marginTop:'8px'}}>

        {/* Left: Buyer */}
        <div style={{width:'30%', textAlign:'center'}}>
          <div style={{marginBottom:'4px', fontWeight:'600'}}>ในนาม {buyer.name||'.....................................'}</div>
          <div style={{height:'52px'}}></div>
          <div style={{borderTop:'1px dotted #94a3b8', paddingTop:'4px', marginTop:'4px'}}>ผู้จ่ายเงิน</div>
          <div style={{marginTop:'4px', color:'#64748b'}}>วันที่ ____/____/________</div>
        </div>

        {/* Center: pending note */}
        <div style={{width:'34%', display:'flex', flexDirection:'column', alignItems:'center', justifyContent:'center', gap:'6px'}}>
          <div style={{border:'2px dashed #fbbf24', borderRadius:'8px', padding:'10px 12px', textAlign:'center', color:'#92400e', fontSize:'8pt', lineHeight:'1.6'}}>
            <div style={{fontWeight:'800', fontSize:'9pt', marginBottom:'2px'}}>⏳ รอการอนุมัติ</div>
            ตราประทับและลายเซ็น<br/>จะอยู่ในใบกำกับภาษีเต็มรูปแบบ
          </div>
        </div>

        {/* Right: Seller (no signature on quotation) */}
        <div style={{width:'30%', textAlign:'center'}}>
          <div style={{marginBottom:'4px', fontWeight:'600', fontSize:'7.5pt'}}>ในนาม {SELLER.name}</div>
          <div style={{height:'52px', display:'flex', alignItems:'center', justifyContent:'center'}}>
            <div style={{color:'#94a3b8', fontSize:'8pt', fontStyle:'italic'}}>— รอออกใบกำกับภาษี —</div>
          </div>
          <div style={{fontSize:'8pt', color:'#475569', marginBottom:'2px'}}>{invDate}</div>
          <div style={{borderTop:'1px dotted #94a3b8', paddingTop:'4px'}}>ผู้ออกเอกสาร</div>
        </div>
      </div>

      {/* WHT note */}
      <div style={{marginTop:'14px', padding:'6px 10px', backgroundColor:'#fefce8', border:'1px solid #fde047', borderRadius:'4px', fontSize:'8pt', color:'#713f12'}}>
        * กรณีหักภาษี ณ ที่จ่าย 3%: ยอดสุทธิที่โอน <strong>฿{fmt(calc.net)}</strong> บาท — กรุณาส่งหนังสือรับรองหัก ณ ที่จ่าย มาที่ LINE: lin.ee/uYhct4L
      </div>
    </div>
  );
}
