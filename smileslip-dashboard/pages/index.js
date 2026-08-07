import React, { useState, useEffect } from 'react';
import Head from 'next/head';
import Link from 'next/link';
import {
  CheckCircle2, ChevronRight, ArrowRight, Zap, Shield, BarChart3,
  Clock, ChevronDown, Database, Lock, TrendingUp, Target, Award,
  Activity, FileSpreadsheet, ShieldCheck, Users, Smartphone, Star,
  ShoppingCart, Truck, Wallet,
} from 'lucide-react';

export default function Home() {
  const [chatStep, setChatStep] = useState(0);
  const [headerScrolled, setHeaderScrolled] = useState(false);
  const [openFaq, setOpenFaq] = useState(null);
  const [promotion, setPromotion] = useState(null);
  const [realTestimonials, setRealTestimonials] = useState(null); // null = ยังโหลดไม่เสร็จ

  useEffect(() => {
    fetch('/api/promotion').then(r => r.json()).then(d => setPromotion(d.promotion || null)).catch(() => {});
    fetch('/api/testimonials').then(r => r.json()).then(d => setRealTestimonials(d.testimonials || [])).catch(() => setRealTestimonials([]));
  }, []);

  // LINE chat demo animation — วนซ้ำทุก 6 วินาที
  useEffect(() => {
    const DELAYS = [800, 1400, 1400, 1800, 2000];
    let timeout;
    const run = (step) => {
      setChatStep(step);
      if (step < DELAYS.length) {
        timeout = setTimeout(() => run(step + 1), DELAYS[step]);
      } else {
        timeout = setTimeout(() => run(0), 2500);
      }
    };
    timeout = setTimeout(() => run(1), 600);
    return () => clearTimeout(timeout);
  }, []);

  useEffect(() => {
    const fn = () => setHeaderScrolled(window.scrollY > 60);
    window.addEventListener('scroll', fn, { passive: true });
    return () => window.removeEventListener('scroll', fn);
  }, []);

  const fmtB = n => Number(n).toLocaleString('th-TH');

  const BENEFITS = [
    {
      icon: <Shield size={24}/>,
      color: 'blue',
      title: 'อุดรอยรั่ว สลิปปลอม สลิปซ้ำ',
      desc: 'ระบบ Duplicate Guard 3 ชั้นตรวจจับสลิปซ้ำ ยอดเงินไม่ตรง วันเวลาผิดปกติ — บอทแจ้งเตือนทันทีก่อนที่เงินจะหาย',
      items: ['ตรวจสลิปซ้ำ (image hash)', 'เช็คยอดเงินและเลขอ้างอิง', 'แจ้งเตือนเจ้าของร้านทันที'],
    },
    {
      icon: <FileSpreadsheet size={24}/>,
      color: 'green',
      title: 'บัญชี Real-time ไม่ต้องพิมพ์เอง',
      desc: 'ยอดเงิน ชื่อผู้โอน หมวดหมู่ค่าใช้จ่าย — วิ่งตรงเข้า Google Sheets ของร้านคุณเองทันทีทุกครั้งที่สแกนสลิป',
      items: ['อ่าน OCR ด้วย Gemini AI', 'จัดหมวดหมู่อัตโนมัติ (Business+)', 'แก้ไขได้ทีหลังจาก Dashboard'],
    },
    {
      icon: <Database size={24}/>,
      color: 'purple',
      title: 'คลังสลิปปลอดภัยแยกรายเดือน',
      desc: 'รูปสลิปทุกใบเก็บเข้า Google Drive ส่วนตัวของร้านคุณ แยกโฟลเดอร์ตามเดือน — ข้อมูลไม่ผ่านเซิร์ฟเวอร์กลาง PDPA 100%',
      items: ['Google Drive ของร้านคุณเอง', 'แยกโฟลเดอร์ปี/เดือน', 'Export Excel รายเดือนได้'],
    },
    {
      icon: <ShoppingCart size={24}/>,
      color: 'amber',
      title: 'POS ขายหน้าร้านครบวงจร ในแอปเดียว',
      desc: 'ไม่ต้องซื้อระบบ POS แยกอีกชุด — ขายหน้าร้าน จัดการสต็อก คิดภาษี VAT ออกใบกำกับภาษี และส่งพนักงานจัดส่งสินค้า ในระบบเดียวกับที่ตรวจสลิป',
      items: ['ขายได้หลายบิลพร้อมกัน + พิมพ์ใบเสร็จ', 'สต็อกสินค้าหมุนเวียน (ถัง/ขวด) อัตโนมัติ', 'แอปพนักงานส่งของ ไม่ต้องติดตั้งเพิ่ม'],
    },
  ];

  const colorMap = {
    blue:   { bg: 'bg-blue-50', border: 'border-blue-100', icon: 'bg-blue-100 text-blue-600', check: 'text-blue-500' },
    green:  { bg: 'bg-emerald-50', border: 'border-emerald-100', icon: 'bg-emerald-100 text-emerald-600', check: 'text-emerald-500' },
    purple: { bg: 'bg-violet-50', border: 'border-violet-100', icon: 'bg-violet-100 text-violet-600', check: 'text-violet-500' },
    amber:  { bg: 'bg-amber-50', border: 'border-amber-100', icon: 'bg-amber-100 text-amber-600', check: 'text-amber-500' },
  };

  const MORE_FEATURES = [
    { icon: <Activity size={20}/>, title: 'ใบสำคัญรับ/จ่าย อัตโนมัติ', desc: 'แตะปุ่มเดียวจากรายการในระบบ ออกใบสำคัญรับ/จ่ายเป็น PDF พร้อมเลขที่เอกสาร เก็บลง Google Drive ทันที ใช้หักภาษีเงินได้ได้จริง' },
    { icon: <FileSpreadsheet size={20}/>, title: 'ใบแจ้งหนี้ + ใบกำกับภาษีเต็มรูปแบบ', desc: 'ลูกค้านิติบุคคลขอใบแจ้งหนี้ผ่านระบบได้เอง ทีมงานออกใบกำกับภาษีพร้อมคำนวณ VAT และหัก ณ ที่จ่าย 3% ให้ครบ ส่งอีเมลอัตโนมัติ' },
    { icon: <Users size={20}/>, title: 'ชวนเพื่อนได้เครดิตฟรี', desc: 'ทุกร้านมีลิงก์แนะนำของตัวเอง ชวนร้านอื่นมาเชื่อม Google Drive สำเร็จ รับเครดิตฟรีทันทีทั้งสองฝ่าย ไม่มีจำกัดจำนวนครั้ง' },
    { icon: <BarChart3 size={20}/>, title: 'เทียบยอดหลายสาขาในที่เดียว', desc: 'เจ้าของแฟรนไชส์ดูยอดทุกสาขาพร้อมกันได้จาก Dashboard เดียว ไม่ต้องโทรถามแต่ละสาขาทุกวันอีกต่อไป' },
    { icon: <Users size={20}/>, title: 'สิทธิ์พนักงานละเอียด', desc: 'กำหนดได้เองว่าพนักงานคนไหนดูยอดขาย/กำไรขาดทุน/จัดการสต็อก/export VAT ได้บ้าง แยกสิทธิ์รายคนจากมือถือของพนักงานเอง' },
    { icon: <ShoppingCart size={20}/>, title: 'รับสินค้า/รายจ่ายผ่านรูปถ่ายใน LINE', desc: 'ถ่ายรูปใบส่งของ/บิลค่าใช้จ่ายส่งในกลุ่ม LINE เข้าคิวรอแอดมินตรวจสอบ+ยืนยัน ไม่ต้องพิมพ์เข้าระบบเอง' },
    { icon: <Award size={20}/>, title: 'White-Label (Enterprise)', desc: 'ลบชื่อ Smile Slip Pro ออกจากใบเสร็จ/ใบกำกับภาษี/รายงาน Excel ให้เหลือแต่แบรนด์ร้านคุณเอง' },
    { icon: <Target size={20}/>, title: 'Excel รายงานสำเร็จรูป', desc: 'ภ.พ.30, ยอดขายแยกสาขา, มูลค่าสต็อกสินค้าหมุนเวียน — ดาวน์โหลดพร้อมส่งนักบัญชีได้ทันที' },
  ];

  const ENTERPRISE_FEATURES = [
    { icon: '🔥', title: 'Peak Time Heatmap', desc: 'รู้ว่าลูกค้าโอนเงินวันไหน ชั่วโมงไหน — วางแผนโปรโมชั่นได้แม่นยำ ไม่ยิงโฆษณาตอนไม่มีคน' },
    { icon: '👥', title: 'RFM Customer Segments', desc: 'แยกลูกค้าเป็น Champions / At-Risk / Lost — รู้ว่าใครกำลังจะหาย เพื่อดึงกลับก่อนสายเกินไป' },
    { icon: '📈', title: 'Marketing ROI Calculator', desc: 'วัดผลโฆษณาได้จริง เทียบค่าโฆษณา vs รายรับรายวัน คำนวณ ROI อัตโนมัติ รู้ว่าลงทุน 1 ได้กลับกี่เท่า' },
    { icon: '🔮', title: 'Revenue Forecast (AI)', desc: 'AI พยากรณ์รายรับ 3 เดือนข้างหน้า จากข้อมูลประวัติจริง — วางแผนสต็อก จ้างพนักงาน ได้ล่วงหน้า' },
  ];

  const PAIN_POINTS = [
    { icon: '🕵️', text: 'สลิปปลอม/สลิปซ้ำที่ไม่มีใครจับได้ทัน' },
    { icon: '📦', text: 'สต็อกหายแต่หาสาเหตุไม่เจอ เพราะจดมือ' },
    { icon: '💵', text: 'ปิดร้านแล้วเงินในลิ้นชักไม่ตรงบัญชี ไม่รู้ใครทำหาย' },
  ];

  const POS_FEATURES = [
    { icon: <ShoppingCart size={22}/>, title: 'ขายหน้าร้านหลายบิลพร้อมกัน', desc: 'เปิดได้หลายบิลพร้อมกัน พิมพ์ใบเสร็จ/ใบกำกับภาษีเต็มรูปแบบทันที' },
    { icon: <Database size={22}/>, title: 'สต็อกสินค้าหมุนเวียน', desc: 'ถังแก๊ส/ขวดน้ำ แลกเปลี่ยน-ยืมคืนคำนวณให้อัตโนมัติ ไม่ต้องนับเอง' },
    { icon: <FileSpreadsheet size={22}/>, title: 'VAT ภ.พ.30 อัตโนมัติ', desc: 'คำนวณภาษีซื้อ-ขายทุกบิล ออกรายงานพร้อมยื่นสรรพากร แยกสาขาได้' },
    { icon: <Truck size={22}/>, title: 'แอปพนักงานส่งของ', desc: 'พนักงานยืนยันจัดส่ง รับเงิน รับของคืนผ่านมือถือ ไม่ต้องติดตั้งแอปเพิ่ม' },
    { icon: <Wallet size={22}/>, title: 'เปิด-ปิดกะเงินสด', desc: 'พนักงานเปิดกะด้วย PIN ตัวเอง ระบบกระทบยอดเงินสดให้อัตโนมัติ' },
    { icon: <Smartphone size={22}/>, title: 'เว็บสั่งซื้อสาธารณะ', desc: 'ลูกค้าสั่งซื้อ/สั่งจัดส่งเองผ่านลิงก์ ไม่ต้องโทรสั่ง แยกลิงก์ต่อสาขาได้' },
  ];

  const ROI_COMPARE = [
    { label: 'นักบัญชีรายเดือน', old: '฿8,000-15,000/เดือน', withUs: 'รวมในแพ็กเกจ Advance ฿499/เดือน' },
    { label: 'ระบบ POS แยก', old: '฿500-2,000/เดือน', withUs: 'ไม่มีค่าใช้จ่ายเพิ่ม — อยู่ในระบบเดียวกัน' },
    { label: 'เวลานั่งคัดสลิป/จดบัญชี', old: '2-3 ชม./วัน', withUs: '0 นาที — AI ทำให้อัตโนมัติ' },
  ];

  const COMPARISON_ROWS = [
    { label: 'ความเร็วตรวจสอบสลิป', old: 'นั่งเช็คเองทีละใบ', us: 'อัตโนมัติภายใน 2 วินาที' },
    { label: 'ระบบ POS + บัญชี', old: 'คนละระบบ ต้องกรอกซ้ำ', us: 'ระบบเดียว ข้อมูลเชื่อมกันหมด' },
    { label: 'ตรวจจับสลิปปลอม/ซ้ำ', old: 'ไม่มีทางรู้จนเงินหาย', us: 'แจ้งเตือนทันทีที่พบความผิดปกติ' },
    { label: 'ปิดกะ/กระทบยอดเงินสด', old: 'นับมือ เดาไม่ออกว่าใครทำเงินขาด', us: 'ระบบคำนวณให้ พร้อมแจ้งเจ้าของถ้ายอดไม่ตรง' },
    { label: 'ข้อมูลเป็นของใคร', old: 'ล็อกอยู่ในระบบผู้ให้บริการ', us: 'Google Drive/Sheets ของร้านเอง 100%' },
  ];

  const TIERS = [
    {
      name: 'Starter', price: 'ฟรี', period: '', color: 'slate',
      desc: 'ทดลองใช้ฟรีเต็มรูปแบบ 30 วัน ไม่ต้องผูกบัตร',
      features: ['สแกนสลิปอัตโนมัติ + POS เต็มรูปแบบ', 'สต็อกหมุนเวียน/แอปพนักงานส่ง/เงินเชื่อ', 'Google Drive + Sheets ของร้านเอง'],
      cta: 'เริ่มทดลองฟรี', popular: false,
    },
    {
      name: 'Shop Pro', price: '199', period: '/เดือน', color: 'blue',
      desc: 'สำหรับร้านค้าที่มีพนักงาน',
      features: ['200 เครดิต/เดือน', '#สรุปยอด/#กำไรขาดทุน', 'แจ้งเจ้าของทันทีเมื่อมีสลิปเข้า', '⚠️ ไม่รวม: สต็อกหมุนเวียน/แอปพนักงานส่ง/เงินเชื่อ'],
      cta: 'เลือกแพ็กเกจนี้', popular: true,
    },
    {
      name: 'Advance', price: '499', period: '/เดือน', color: 'indigo',
      desc: 'SME ที่มีนักบัญชี ต้องการ POS เต็มรูปแบบ',
      features: ['🔓 ปลดล็อกสต็อกหมุนเวียน/แอปพนักงานส่ง/เงินเชื่อ', '5 สาขา', 'Export Excel ส่งนักบัญชี', '#สรุปทุกสาขา'],
      cta: 'เลือกแพ็กเกจนี้', popular: false,
    },
    {
      name: 'Business', price: '999', period: '/เดือน', color: 'violet',
      desc: 'ร้านอาหาร/แฟรนไชส์เล็ก หลายสาขา',
      features: ['10 สาขา · 3 Admin', 'รายงานภาษี VAT (ภ.พ.30)', 'Top Sender Analysis', 'Dashboard Mobile-first'],
      cta: 'เลือกแพ็กเกจนี้', popular: false,
    },
    {
      name: 'Enterprise', price: '2,990', period: '/เดือน', color: 'amber',
      desc: 'แฟรนไชส์ใหญ่ ไม่จำกัดการสแกน',
      features: ['สแกน ∞ ไม่จำกัด', '20 สาขา', '🔥 Heatmap + RFM + ROI + Forecast', 'Priority Support + Onboarding'],
      cta: 'ติดต่อทีมงาน', popular: false,
    },
  ];

  const tierColor = {
    slate:  { badge: 'bg-slate-100 text-slate-600', btn: 'bg-slate-700 hover:bg-slate-600 text-white', border: 'border-slate-200' },
    blue:   { badge: 'bg-blue-600 text-white', btn: 'bg-blue-700 hover:bg-blue-600 text-white', border: 'border-blue-400 ring-2 ring-blue-300' },
    indigo: { badge: 'bg-indigo-100 text-indigo-700', btn: 'bg-indigo-600 hover:bg-indigo-700 text-white', border: 'border-indigo-200' },
    violet: { badge: 'bg-violet-100 text-violet-700', btn: 'bg-violet-700 hover:bg-violet-600 text-white', border: 'border-violet-200' },
    amber:  { badge: 'bg-amber-100 text-amber-700', btn: 'bg-gradient-to-r from-amber-500 to-orange-500 hover:from-amber-400 text-white', border: 'border-amber-200' },
  };

  const TESTIMONIALS = [
    { name: 'คุณนก', role: 'เจ้าของร้านอาหาร กรุงเทพ', text: 'ก่อนหน้านี้ต้องนั่งเช็คสลิปเองทุกคืน ตั้งแต่ดึง Smile Slip เข้ากลุ่ม LINE ไม่ต้องแตะอะไรเลย ข้อมูลลง Sheets เอง', stars: 5 },
    { name: 'คุณปอ', role: 'เจ้าของบาร์ เชียงใหม่', text: 'เจ้าของนอนหลับสบาย ไม่ต้องกลัวโดนสลิปปลอม บอทจะแจ้งทันทีถ้ายอดไม่ตรง ช่วยได้มากจริงๆ', stars: 5 },
    { name: 'คุณเอก', role: 'ร้านขายส่ง นนทบุรี', text: 'ใช้แพ็ก Business ดูยอดแต่ละสาขาได้ง่ายมาก ก่อนหน้านี้ต้องโทรถามทุกวัน ตอนนี้ดูใน Dashboard อย่างเดียวพอ', stars: 5 },
  ];

  const FAQS = [
    { q: 'ข้อมูลการเงินของร้านปลอดภัยไหม?', a: 'ปลอดภัย 100% ครับ ข้อมูลธุรกรรมทั้งหมด (ยอดเงิน, ชื่อผู้โอน, รูปสลิป) เก็บตรงใน Google Drive และ Google Sheets ของร้านคุณเอง — ไม่ผ่านเซิร์ฟเวอร์กลางของเรา เป็นไปตาม PDPA' },
    { q: 'ต้องจ่ายเงินทันทีไหม? ทดลองใช้ฟรีได้ไหม?', a: 'ไม่ต้องครับ แพ็กเกจ Starter ให้ทดลองใช้งานเต็มรูปแบบฟรี 30 วัน (รวมระบบ POS ขายหน้าร้านด้วย) ไม่ต้องใส่บัตรเครดิต ครบกำหนดแล้วค่อยเลือกแพ็กเกจที่เหมาะกับร้านต่อ ข้อมูลเดิมไม่หายแม้แต่บรรทัดเดียว' },
    { q: 'มีระบบ POS ขายหน้าร้านด้วยไหม?', a: 'มีครับ ระบบ POS เต็มรูปแบบ (ขายหน้าร้าน จัดการสต็อกสินค้ารวมถึงสินค้าหมุนเวียน คิด VAT พิมพ์ใบเสร็จ/ใบกำกับภาษี แอปพนักงานส่งของ เปิด-ปิดกะเงินสด) รวมอยู่ในระบบเดียวกัน ไม่ต้องซื้อระบบ POS แยกต่างหาก' },
    { q: 'ใช้กับ LINE กลุ่มที่มีอยู่แล้วได้ไหม?', a: 'ได้เลยครับ เพียงแค่เพิ่ม Smile Slip บอท (@574unjqj) เข้ากลุ่ม LINE ที่พนักงานใช้อยู่แล้ว ไม่ต้องเปลี่ยนแอปหรือสร้างกลุ่มใหม่' },
    { q: 'ถ้ายกเลิก ข้อมูลใน Google Sheets หายไปไหม?', a: 'ไม่หายครับ เพราะข้อมูลอยู่ใน Google Drive ของร้านคุณเองตลอด แม้ยกเลิกบริการก็ยังเข้าถึงข้อมูลได้ตามปกติ' },
  ];

  return (
    <>
      <Head>
        <title>Smile Slip Pro — AI ตรวจสลิป + ระบบ POS ขายหน้าร้านครบวงจร สำหรับร้านค้า SME ไทย</title>
        <meta name="description" content="เปลี่ยนกลุ่ม LINE ร้านค้าให้เป็นพนักงานบัญชีอัจฉริยะ ตรวจสลิปปลอม บันทึกบัญชีอัตโนมัติ พร้อมระบบ POS ขายหน้าร้าน สต็อกสินค้า VAT และแอปพนักงานส่งของ ครบในแอปเดียว"/>
        <meta name="keywords" content="ตรวจสลิป, LINE Bot, บัญชีร้านค้า, POS ขายหน้าร้าน, SME ไทย, Google Sheets, AI, สลิปปลอม, VAT"/>
        <meta property="og:title" content="Smile Slip Pro — AI ตรวจสลิป + POS ครบวงจร"/>
        <meta property="og:description" content="พนักงานส่งสลิปใน LINE บอทอ่าน OCR บันทึกบัญชีอัตโนมัติ ป้องกันสลิปปลอม พร้อมระบบ POS ขายหน้าร้านในแอปเดียว"/>
        <meta property="og:type" content="website"/>
        <meta name="viewport" content="width=device-width, initial-scale=1"/>
        <style>{`
          @keyframes fadeSlideUp {
            from { opacity: 0; transform: translateY(12px); }
            to   { opacity: 1; transform: translateY(0); }
          }
          @keyframes chatBubble {
            from { opacity: 0; transform: translateY(8px) scale(0.97); }
            to   { opacity: 1; transform: translateY(0) scale(1); }
          }
          @keyframes blink {
            0%, 100% { opacity: 0.3; } 50% { opacity: 1; }
          }
          @keyframes pulse-ring {
            0% { transform: scale(1); opacity: 0.5; }
            100% { transform: scale(1.6); opacity: 0; }
          }
          .fade-slide { animation: fadeSlideUp 0.5s ease both; }
          .chat-bubble { animation: chatBubble 0.4s cubic-bezier(0.34,1.56,0.64,1) both; }
          .blink-dot { animation: blink 1s ease infinite; }
          .blink-dot:nth-child(2) { animation-delay: 0.2s; }
          .blink-dot:nth-child(3) { animation-delay: 0.4s; }
          html { scroll-behavior: smooth; }
        `}</style>
      </Head>

      {/* ═══ STICKY HEADER ═══ */}
      <header className={`fixed top-0 left-0 right-0 z-50 transition-all duration-300 ${headerScrolled ? 'bg-white/95 backdrop-blur shadow-md border-b border-slate-100' : 'bg-transparent'}`}>
        <div className="max-w-6xl mx-auto px-5 h-16 flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <div className={`w-9 h-9 rounded-xl flex items-center justify-center text-lg font-black transition-colors ${headerScrolled ? 'bg-blue-800 text-white' : 'bg-white/20 text-white border border-white/30'}`}>😊</div>
            <span className={`font-black text-sm tracking-tight transition-colors ${headerScrolled ? 'text-slate-900' : 'text-white'}`}>
              Smile Slip <span className={headerScrolled ? 'text-blue-700' : 'text-blue-300'}>Pro</span>
            </span>
          </div>
          <div className="flex items-center gap-3">
            <Link href="/login" className={`hidden sm:block text-xs font-bold transition-colors ${headerScrolled ? 'text-slate-600 hover:text-slate-900' : 'text-white/80 hover:text-white'}`}>
              เข้าสู่ระบบ
            </Link>
            <Link href="/register"
              className="px-4 py-2 bg-blue-700 hover:bg-blue-600 text-white rounded-xl font-black text-xs shadow-lg hover:shadow-blue-500/30 transition-all flex items-center gap-1.5">
              สมัครฟรี <ChevronRight size={13}/>
            </Link>
          </div>
        </div>
      </header>

      <main className="font-sans antialiased bg-white">

        {/* ═══ HERO ═══ */}
        <section className="relative min-h-screen bg-gradient-to-br from-blue-950 via-blue-900 to-indigo-900 flex items-center overflow-hidden pt-16">
          {/* background blobs */}
          <div className="absolute top-0 right-0 w-[600px] h-[600px] bg-blue-600/10 rounded-full blur-3xl pointer-events-none"/>
          <div className="absolute bottom-0 left-0 w-[500px] h-[500px] bg-indigo-600/15 rounded-full blur-3xl pointer-events-none"/>
          <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_top_right,rgba(99,102,241,0.15),transparent_60%)] pointer-events-none"/>

          <div className="relative z-10 max-w-6xl mx-auto px-5 py-20 w-full">
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-12 items-center">

              {/* Left: Text */}
              <div className="fade-slide">
                <div className="inline-flex items-center gap-2 bg-white/10 border border-white/20 text-blue-200 text-xs font-bold px-4 py-1.5 rounded-full mb-6">
                  <span className="w-1.5 h-1.5 bg-emerald-400 rounded-full animate-pulse"/>
                  AI ทำงาน 24 ชั่วโมง · ไม่มีวันหยุด
                </div>

                <h1 className="text-4xl md:text-5xl font-black text-white leading-[1.15] mb-5">
                  เบื่อไหม? <br/>
                  <span className="text-blue-300">นั่งคัดสลิปจนตาแฉะ</span><br/>
                  <span className="text-slate-300 text-3xl md:text-4xl font-bold">ถึงตี 2 ทุกคืน</span>
                </h1>

                <p className="text-blue-200 text-base md:text-lg leading-relaxed mb-3">
                  เปลี่ยนกลุ่ม LINE ร้านค้าของคุณให้เป็น <strong className="text-white">พนักงานบัญชีอัจฉริยะ</strong> ตรวจสลิปปลอม บันทึกบัญชีอัตโนมัติ พร้อม <strong className="text-white">ระบบ POS ขายหน้าร้านครบวงจร</strong> ในแอปเดียว
                </p>
                <p className="text-blue-400 text-sm mb-8">— โดยไม่ต้องพิมพ์แม้แต่ตัวเดียว และไม่ต้องซื้อระบบ POS แยกอีกชุด</p>

                <div className="flex flex-col sm:flex-row gap-3 mb-8">
                  <Link href="/register"
                    className="flex items-center justify-center gap-2 px-8 py-4 bg-white text-blue-900 rounded-2xl font-black text-sm shadow-2xl hover:bg-blue-50 transition-all group">
                    เริ่มต้นใช้งานฟรี
                    <span className="bg-emerald-500 text-white text-[10px] font-black px-2 py-0.5 rounded-full">ทดลองฟรี 30 วัน</span>
                    <ChevronRight size={16} className="group-hover:translate-x-1 transition-transform"/>
                  </Link>
                  <a href="https://lin.ee/wdnoEN5" target="_blank" rel="noreferrer"
                    className="flex items-center justify-center gap-2 px-8 py-4 bg-[#06C755]/20 border border-[#06C755]/40 text-[#4ade80] rounded-2xl font-black text-sm hover:bg-[#06C755]/30 transition-all">
                    <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor"><path d="M19.365 9.863c.349 0 .63.285.63.631 0 .345-.281.63-.63.63H17.61v1.125h1.755c.349 0 .63.283.63.63 0 .344-.281.629-.63.629h-2.386c-.345 0-.627-.285-.627-.629V8.108c0-.345.282-.63.627-.63h2.386c.349 0 .63.285.63.63 0 .349-.281.63-.63.63H17.61v1.125h1.755zm-3.855 3.016c0 .27-.174.51-.432.596-.064.021-.133.031-.199.031-.211 0-.391-.09-.51-.25l-2.443-3.317v2.94c0 .344-.279.629-.631.629-.346 0-.626-.285-.626-.629V8.108c0-.27.173-.51.43-.595.06-.023.136-.033.194-.033.195 0 .375.104.495.254l2.462 3.33V8.108c0-.345.282-.63.63-.63.345 0 .63.285.63.63v4.771zm-5.741 0c0 .344-.282.629-.631.629-.345 0-.627-.285-.627-.629V8.108c0-.345.282-.63.627-.63.349 0 .631.285.631.63v4.771zm-2.466.629H4.917c-.345 0-.63-.285-.63-.629V8.108c0-.345.285-.63.63-.63.348 0 .63.285.63.63v4.141h1.756c.348 0 .629.283.629.63 0 .344-.281.629-.629.629M24 10.314C24 4.943 18.615.572 12 .572S0 4.943 0 10.314c0 4.811 4.27 8.842 10.035 9.608.391.082.923.258 1.058.59.12.301.079.766.038 1.08l-.164 1.02c-.045.301-.24 1.186 1.049.645 1.291-.539 6.916-4.078 9.436-6.975C23.176 14.393 24 12.458 24 10.314"/></svg>
                    เพิ่ม LINE บอท
                  </a>
                </div>

                <div className="flex items-center gap-4 text-xs text-blue-400">
                  <span className="flex items-center gap-1.5"><CheckCircle2 size={13} className="text-emerald-400"/> ไม่ต้องใส่บัตรเครดิต</span>
                  <span className="flex items-center gap-1.5"><CheckCircle2 size={13} className="text-emerald-400"/> PDPA Compliant</span>
                  <span className="flex items-center gap-1.5"><CheckCircle2 size={13} className="text-emerald-400"/> ตั้งค่าใน 5 นาที</span>
                </div>
              </div>

              {/* Right: LINE Chat Demo */}
              <div className="flex justify-center lg:justify-end">
                <div className="relative">
                  {/* Glow */}
                  <div className="absolute inset-0 bg-blue-500/20 blur-3xl rounded-3xl"/>
                  {/* Phone frame */}
                  <div className="relative w-72 bg-[#111B21] rounded-[2.5rem] border-4 border-slate-700 shadow-2xl overflow-hidden">
                    {/* Status bar */}
                    <div className="bg-[#1F2C33] px-5 pt-4 pb-2 flex items-center gap-3">
                      <div className="w-8 h-8 rounded-full bg-[#06C755] flex items-center justify-center text-white text-xs font-black shrink-0">S</div>
                      <div>
                        <p className="text-white text-xs font-bold">Smile Slip Pro</p>
                        <p className="text-[#8696A0] text-[10px]">บอทอัจฉริยะ · Online</p>
                      </div>
                    </div>

                    {/* Chat area */}
                    <div className="bg-[#0B141A] px-3 py-4 min-h-[380px] space-y-3 relative overflow-hidden">
                      {/* BG pattern */}
                      <div className="absolute inset-0 opacity-5" style={{backgroundImage:'radial-gradient(circle,#fff 1px,transparent 1px)',backgroundSize:'20px 20px'}}/>

                      {/* User sends slip */}
                      {chatStep >= 1 && (
                        <div className="chat-bubble flex justify-end">
                          <div className="max-w-[80%] bg-[#005C4B] rounded-2xl rounded-tr-sm px-3 py-2.5">
                            <div className="bg-[#004438] rounded-lg p-2 mb-1.5 flex items-center gap-2">
                              <div className="w-10 h-10 bg-slate-600 rounded-lg flex items-center justify-center text-lg">🧾</div>
                              <div>
                                <p className="text-white text-[10px] font-bold">สลิป_ค่าน้ำมัน.jpg</p>
                                <p className="text-emerald-400 text-[9px]">กำลังส่ง...</p>
                              </div>
                            </div>
                            <p className="text-[#8696A0] text-[9px] text-right">14:32 ✓✓</p>
                          </div>
                        </div>
                      )}

                      {/* Typing indicator */}
                      {chatStep === 2 && (
                        <div className="chat-bubble flex items-end gap-1.5">
                          <div className="w-6 h-6 rounded-full bg-[#06C755] flex items-center justify-center text-[10px] font-black text-white shrink-0">S</div>
                          <div className="bg-[#1F2C33] rounded-2xl rounded-bl-sm px-4 py-3 flex gap-1.5">
                            <div className="blink-dot w-1.5 h-1.5 bg-slate-400 rounded-full"/>
                            <div className="blink-dot w-1.5 h-1.5 bg-slate-400 rounded-full"/>
                            <div className="blink-dot w-1.5 h-1.5 bg-slate-400 rounded-full"/>
                          </div>
                        </div>
                      )}

                      {/* Bot Flex Message */}
                      {chatStep >= 3 && (
                        <div className="chat-bubble flex items-end gap-1.5">
                          <div className="w-6 h-6 rounded-full bg-[#06C755] flex items-center justify-center text-[10px] font-black text-white shrink-0">S</div>
                          <div className="bg-[#1F2C33] rounded-2xl rounded-bl-sm overflow-hidden max-w-[85%]">
                            <div className="bg-emerald-600 px-3 py-2">
                              <p className="text-white text-[10px] font-black">✅ บันทึกสลิปสำเร็จ</p>
                            </div>
                            <div className="px-3 py-2.5 space-y-1">
                              <div className="flex justify-between">
                                <span className="text-[#8696A0] text-[9px]">ประเภท</span>
                                <span className="text-red-400 text-[9px] font-bold">รายจ่าย</span>
                              </div>
                              <div className="flex justify-between">
                                <span className="text-[#8696A0] text-[9px]">จำนวน</span>
                                <span className="text-white text-[9px] font-black">฿ 500.00</span>
                              </div>
                              <div className="flex justify-between">
                                <span className="text-[#8696A0] text-[9px]">หมวดหมู่</span>
                                <span className="text-amber-400 text-[9px] font-bold">ค่าน้ำมัน</span>
                              </div>
                              <div className="flex justify-between">
                                <span className="text-[#8696A0] text-[9px]">บันทึกใน</span>
                                <span className="text-emerald-400 text-[9px]">Google Sheets ✓</span>
                              </div>
                            </div>
                          </div>
                        </div>
                      )}

                      {/* Google Sheets notification */}
                      {chatStep >= 4 && (
                        <div className="chat-bubble">
                          <div className="mx-auto bg-emerald-900/40 border border-emerald-700/50 rounded-xl px-3 py-2 flex items-center gap-2">
                            <FileSpreadsheet size={14} className="text-emerald-400 shrink-0"/>
                            <div>
                              <p className="text-emerald-300 text-[9px] font-bold">Google Sheets อัปเดตแล้ว</p>
                              <p className="text-emerald-500 text-[8px]">แถวใหม่เพิ่มใน Sheet มิ.ย. 2026</p>
                            </div>
                          </div>
                        </div>
                      )}
                    </div>
                  </div>

                  {/* Badge: ความเร็ว */}
                  <div className="absolute -top-3 -right-3 bg-white rounded-2xl shadow-xl px-3 py-2 flex items-center gap-2 border border-slate-100">
                    <Zap size={14} className="text-amber-500"/>
                    <div>
                      <p className="text-slate-900 text-[10px] font-black">ตรวจสอบใน</p>
                      <p className="text-amber-500 text-base font-black leading-none">2 วิ</p>
                    </div>
                  </div>
                  <div className="absolute -bottom-3 -left-3 bg-white rounded-2xl shadow-xl px-3 py-2 flex items-center gap-2 border border-slate-100">
                    <ShieldCheck size={14} className="text-emerald-500"/>
                    <div>
                      <p className="text-slate-900 text-[10px] font-black">PDPA Safe</p>
                      <p className="text-emerald-500 text-[9px]">ข้อมูลอยู่ใน Google</p>
                    </div>
                  </div>
                  <div className="absolute top-1/3 -right-4 bg-white rounded-2xl shadow-xl px-3 py-2 flex items-center gap-2 border border-slate-100">
                    <ShoppingCart size={14} className="text-blue-600"/>
                    <p className="text-slate-900 text-[10px] font-black">POS ในตัว</p>
                  </div>
                </div>
              </div>
            </div>

            {/* Stats row */}
            <div className="mt-16 grid grid-cols-3 gap-4 max-w-lg mx-auto lg:mx-0">
              {[
                { val: '2 วิ', label: 'ตรวจสอบสลิป' },
                { val: '24/7', label: 'ทำงานตลอด' },
                { val: '100%', label: 'ข้อมูลเป็นของคุณ' },
              ].map((s, i) => (
                <div key={i} className="text-center">
                  <p className="text-2xl font-black text-white">{s.val}</p>
                  <p className="text-blue-400 text-xs mt-0.5">{s.label}</p>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* ═══ TRUST BAR ═══ */}
        <section className="bg-white py-8 border-b border-slate-100">
          <div className="max-w-5xl mx-auto px-5 text-center">
            <p className="text-slate-400 text-xs font-bold uppercase tracking-widest mb-4">ร้านค้าที่ไว้ใจใช้งาน</p>
            <div className="flex flex-wrap items-center justify-center gap-x-8 gap-y-3 text-slate-500 text-sm font-bold">
              <span>🍜 ร้านอาหาร</span>
              <span>🏪 ร้านค้าปลีก</span>
              <span>🔥 ร้านแก๊ส/น้ำ</span>
              <span>📦 ร้านขายส่ง</span>
              <span>🏢 แฟรนไชส์หลายสาขา</span>
            </div>
          </div>
        </section>

        {/* ═══ PROBLEM AGITATION ═══ */}
        <section className="py-20 bg-gradient-to-b from-slate-900 to-slate-800">
          <div className="max-w-4xl mx-auto px-5 text-center">
            <p className="text-rose-400 font-bold text-sm uppercase tracking-wider mb-2">ก่อนจะสายเกินไป</p>
            <h2 className="text-3xl md:text-4xl font-black text-white mb-4">เงินร้านคุณรั่วไหลตรงไหนบ้าง<br/>โดยที่ไม่รู้ตัว?</h2>
            <p className="text-slate-400 mb-10 max-w-xl mx-auto">3 จุดที่ร้านค้าส่วนใหญ่เสียเงิน/เสียเวลาไปโดยไม่รู้ตัว — และเป็นจุดที่ระบบนี้แก้ให้ครบในที่เดียว</p>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-5">
              {PAIN_POINTS.map((p, i) => (
                <div key={i} className="bg-white/5 border border-rose-500/20 rounded-2xl p-6">
                  <div className="text-3xl mb-3">{p.icon}</div>
                  <p className="text-slate-200 text-sm leading-relaxed font-medium">{p.text}</p>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* ═══ 3 CORE BENEFITS ═══ */}
        <section className="py-20 bg-slate-50" id="benefits">
          <div className="max-w-6xl mx-auto px-5">
            <div className="text-center mb-12">
              <p className="text-blue-600 font-bold text-sm uppercase tracking-wider mb-2">ทำไมต้องใช้ Smile Slip Pro?</p>
              <h2 className="text-3xl md:text-4xl font-black text-slate-900">ปัญหาที่ระบบนี้แก้ได้ทันที</h2>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-6">
              {BENEFITS.map((b, i) => {
                const c = colorMap[b.color];
                return (
                  <div key={i} className={`rounded-2xl border p-6 ${c.bg} ${c.border}`}>
                    <div className={`w-12 h-12 rounded-2xl flex items-center justify-center mb-4 ${c.icon}`}>{b.icon}</div>
                    <h3 className="font-black text-slate-900 text-lg mb-2">{b.title}</h3>
                    <p className="text-slate-600 text-sm leading-relaxed mb-4">{b.desc}</p>
                    <ul className="space-y-1.5">
                      {b.items.map((it, j) => (
                        <li key={j} className="flex items-center gap-2 text-sm">
                          <CheckCircle2 size={14} className={c.check}/>
                          <span className="text-slate-700">{it}</span>
                        </li>
                      ))}
                    </ul>
                  </div>
                );
              })}
            </div>
          </div>
        </section>

        {/* ═══ HOW IT WORKS ═══ */}
        <section className="py-20 bg-white">
          <div className="max-w-4xl mx-auto px-5 text-center">
            <p className="text-blue-600 font-bold text-sm uppercase tracking-wider mb-2">วิธีการทำงาน</p>
            <h2 className="text-3xl font-black text-slate-900 mb-12">ง่ายใน 4 ขั้นตอน</h2>
            <div className="grid grid-cols-1 md:grid-cols-4 gap-8 relative">
              <div className="hidden md:block absolute top-10 left-[12.5%] right-[12.5%] h-px bg-gradient-to-r from-blue-200 via-blue-400 to-blue-200"/>
              {[
                { step:'01', icon:'📲', title:'เพิ่มบอทเข้ากลุ่ม LINE', desc:'เพิ่ม Smile Slip บอทเข้ากลุ่ม LINE ที่พนักงานใช้อยู่แล้ว ตั้งค่าเสร็จใน 5 นาที' },
                { step:'02', icon:'🧾', title:'พนักงานส่งรูปสลิป', desc:'พนักงานถ่ายรูปสลิปแล้วส่งในกลุ่มเหมือนเดิม บอทรับและตรวจสอบทันที' },
                { step:'03', icon:'📊', title:'บัญชีอัปเดตอัตโนมัติ', desc:'ข้อมูลวิ่งเข้า Google Sheets ของร้านทันที เจ้าของรับแจ้งเตือน ดู Dashboard ได้เลย' },
                { step:'04', icon:'🛒', title:'เปิด POS ขายหน้าร้านได้เลย', desc:'ใช้อุปกรณ์เดียวกันเปิดขายหน้าร้าน จัดสต็อก ออกใบเสร็จ — ไม่ต้องสมัครระบบอื่นเพิ่ม' },
              ].map((s, i) => (
                <div key={i} className="relative flex flex-col items-center">
                  <div className="w-20 h-20 bg-blue-50 border-2 border-blue-100 rounded-3xl flex items-center justify-center text-3xl mb-4 relative z-10 shadow-lg">
                    {s.icon}
                    <span className="absolute -top-2 -right-2 w-6 h-6 bg-blue-700 text-white text-[10px] font-black rounded-full flex items-center justify-center">{s.step}</span>
                  </div>
                  <h3 className="font-black text-slate-900 mb-2">{s.title}</h3>
                  <p className="text-slate-500 text-sm leading-relaxed">{s.desc}</p>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* ═══ MORE FEATURES ═══ */}
        <section className="py-20 bg-slate-50">
          <div className="max-w-6xl mx-auto px-5">
            <div className="text-center mb-12">
              <p className="text-blue-600 font-bold text-sm uppercase tracking-wider mb-2">ไม่ใช่แค่บันทึกบัญชี</p>
              <h2 className="text-3xl md:text-4xl font-black text-slate-900">ครบเครื่องทั้งบัญชีและ POS ร้านค้า</h2>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-5">
              {MORE_FEATURES.map((f, i) => (
                <div key={i} className="bg-white rounded-2xl border border-slate-200 p-6 flex gap-4 hover:shadow-lg transition-all">
                  <div className="w-11 h-11 rounded-xl bg-indigo-50 text-indigo-600 flex items-center justify-center shrink-0">
                    {f.icon}
                  </div>
                  <div>
                    <h3 className="font-black text-slate-900 text-base mb-1.5">{f.title}</h3>
                    <p className="text-slate-500 text-sm leading-relaxed">{f.desc}</p>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* ═══ POS SYSTEM SHOWCASE ═══ */}
        <section className="py-20 bg-gradient-to-br from-emerald-950 via-teal-950 to-emerald-950 overflow-hidden relative" id="pos">
          <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_center,rgba(16,185,129,0.15),transparent_70%)] pointer-events-none"/>
          <div className="max-w-6xl mx-auto px-5 relative z-10">
            <div className="text-center mb-12">
              <div className="inline-flex items-center gap-2 bg-emerald-500/20 border border-emerald-400/30 text-emerald-300 text-xs font-black px-4 py-1.5 rounded-full mb-4 uppercase tracking-wider">
                <ShoppingCart size={12}/> POS ระบบขายหน้าร้าน
              </div>
              <h2 className="text-3xl md:text-4xl font-black text-white mb-3 max-w-2xl mx-auto leading-snug">
                ทำไมต้องซื้อระบบ POS แยก ในเมื่อมันอยู่ในแอปเดียวกับที่ตรวจสลิปอยู่แล้ว?
              </h2>
              <p className="text-emerald-300 text-base max-w-xl mx-auto">ขาย จัดสต็อก คิด VAT ออกใบกำกับภาษี และส่งพนักงานจัดส่งสินค้า — ทำได้ทั้งหมดโดยไม่ต้องสมัครระบบเพิ่มอีกชุด</p>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 mb-8">
              {POS_FEATURES.map((f, i) => (
                <div key={i} className="bg-white/5 border border-white/10 rounded-2xl p-5 hover:bg-white/10 transition-all">
                  <div className="w-10 h-10 rounded-xl bg-emerald-500/20 text-emerald-300 flex items-center justify-center mb-3">{f.icon}</div>
                  <h3 className="font-black text-white text-sm mb-1.5">{f.title}</h3>
                  <p className="text-emerald-100/70 text-xs leading-relaxed">{f.desc}</p>
                </div>
              ))}
            </div>

            {/* Mock POS screen preview */}
            <div className="bg-white/5 border border-white/10 rounded-2xl p-5">
              <p className="text-white text-xs font-bold mb-3 flex items-center gap-2">🧾 ตัวอย่างใบเสร็จจากหน้าขาย POS จริง</p>
              <div className="bg-white rounded-xl p-4 max-w-xs mx-auto font-mono text-[11px] text-slate-700 shadow-xl">
                <p className="text-center font-black text-slate-900 mb-1">ร้านตัวอย่างของคุณ</p>
                <p className="text-center text-slate-400 text-[9px] mb-2">ใบเสร็จรับเงิน / ใบกำกับภาษี</p>
                <div className="border-t border-dashed border-slate-300 my-2"/>
                <div className="flex justify-between"><span>น้ำแก๊ส 15 กก. x1</span><span>480.00</span></div>
                <div className="flex justify-between text-slate-400"><span>↔️ แลกเปลี่ยนถังเก่า</span><span></span></div>
                <div className="border-t border-dashed border-slate-300 my-2"/>
                <div className="flex justify-between"><span>ก่อน VAT</span><span>448.60</span></div>
                <div className="flex justify-between"><span>VAT 7%</span><span>31.40</span></div>
                <div className="flex justify-between font-black text-slate-900 mt-1"><span>รวมสุทธิ</span><span>฿480.00</span></div>
              </div>
              <p className="text-emerald-100/50 text-[10px] mt-3 text-center">* ตัวอย่างข้อมูลสาธิต — พิมพ์จริงผ่านเครื่องพิมพ์ใบเสร็จหรือมือถือได้ทันที</p>
            </div>
          </div>
        </section>

        {/* ═══ ENTERPRISE MARKETING INTELLIGENCE ═══ */}
        <section className="py-20 bg-gradient-to-br from-slate-900 via-violet-950 to-slate-900 overflow-hidden relative" id="enterprise">
          <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_center,rgba(139,92,246,0.15),transparent_70%)] pointer-events-none"/>
          <div className="max-w-6xl mx-auto px-5 relative z-10">
            <div className="text-center mb-12">
              <div className="inline-flex items-center gap-2 bg-violet-500/20 border border-violet-400/30 text-violet-300 text-xs font-black px-4 py-1.5 rounded-full mb-4 uppercase tracking-wider">
                <Award size={12}/> Enterprise Exclusive
              </div>
              <h2 className="text-3xl md:text-4xl font-black text-white mb-3">Marketing Intelligence</h2>
              <p className="text-violet-300 text-base max-w-xl mx-auto">ไม่ใช่แค่บันทึกบัญชี — แต่วิเคราะห์ธุรกิจของคุณในระดับที่ระบบอื่นทำไม่ได้</p>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mb-8">
              {ENTERPRISE_FEATURES.map((f, i) => (
                <div key={i} className="bg-white/5 border border-white/10 rounded-2xl p-5 hover:bg-white/10 transition-all">
                  <div className="text-3xl mb-3">{f.icon}</div>
                  <div className="flex items-start justify-between gap-2 mb-2">
                    <h3 className="font-black text-white text-base">{f.title}</h3>
                    <span className="shrink-0 text-[9px] bg-violet-500/30 text-violet-300 px-2 py-0.5 rounded-full font-bold">Enterprise</span>
                  </div>
                  <p className="text-slate-400 text-sm leading-relaxed">{f.desc}</p>
                </div>
              ))}
            </div>

            {/* Heatmap preview mockup */}
            <div className="bg-white/5 border border-white/10 rounded-2xl p-5">
              <p className="text-white text-xs font-bold mb-3 flex items-center gap-2">🔥 ตัวอย่าง Peak Time Heatmap — ร้านค้าจริง</p>
              <div className="overflow-x-auto">
                <div className="min-w-max flex gap-px">
                  {['อา','จ','อ','พ','พฤ','ศ','ส'].map((d, di) => (
                    <div key={di} className="flex flex-col gap-px">
                      <div className="w-6 h-4 text-[8px] text-slate-500 flex items-center justify-center font-bold">{d}</div>
                      {Array.from({length:24},(_,h) => {
                        const demo = [[0,0,0,0,0,0,0,2,4,6,5,3,8,7,4,3,5,9,8,6,4,2,1,0],[0,0,0,0,0,0,0,1,3,5,7,8,9,7,5,4,6,8,7,5,3,1,0,0],[0,0,0,0,0,0,0,1,2,4,5,6,7,6,4,3,4,6,5,4,2,1,0,0],[0,0,0,0,0,0,0,2,4,6,8,9,8,7,5,4,6,9,8,7,4,2,1,0],[0,0,0,0,0,0,0,1,3,5,7,8,7,6,4,3,5,7,6,5,3,1,0,0],[0,0,0,0,0,0,0,3,5,8,9,8,7,6,5,4,7,9,9,8,6,3,1,0],[0,0,0,0,0,0,0,2,4,7,8,7,6,5,4,3,5,7,6,5,3,2,1,0]];
                        const v = demo[di]?.[h] || 0;
                        const bg = v===0?'bg-slate-800':v<=2?'bg-violet-900':v<=4?'bg-violet-700':v<=6?'bg-violet-500':v<=8?'bg-violet-400':'bg-violet-300';
                        return <div key={h} className={`w-6 h-3 rounded-sm ${bg}`}/>;
                      })}
                    </div>
                  ))}
                </div>
                <div className="flex items-center gap-1 mt-2 ml-6">
                  {['bg-slate-800','bg-violet-900','bg-violet-700','bg-violet-500','bg-violet-300'].map((c,i)=>(
                    <div key={i} className={`w-4 h-2.5 rounded-sm ${c}`}/>
                  ))}
                  <span className="text-[9px] text-slate-500 ml-1">น้อย → มาก</span>
                </div>
              </div>
              <p className="text-slate-500 text-[10px] mt-2">* ตัวอย่างข้อมูลสาธิต — ระบบจริงดึงจากข้อมูลสลิปร้านของคุณ</p>
            </div>
          </div>
        </section>

        {/* ═══ "แทนอะไรได้บ้าง" ROI FRAMING ═══ */}
        <section className="py-16 bg-white">
          <div className="max-w-4xl mx-auto px-5">
            <div className="text-center mb-10">
              <p className="text-blue-600 font-bold text-sm uppercase tracking-wider mb-2">คุ้มค่าแค่ไหน</p>
              <h2 className="text-3xl font-black text-slate-900">แทนอะไรได้บ้าง</h2>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
              {ROI_COMPARE.map((r, i) => (
                <div key={i} className="bg-slate-50 border border-slate-200 rounded-2xl p-5 text-center">
                  <p className="text-slate-400 text-xs font-bold mb-2">{r.label}</p>
                  <p className="text-rose-500 text-sm line-through mb-1">{r.old}</p>
                  <p className="text-emerald-600 font-black text-sm">{r.withUs}</p>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* ═══ PRICING ═══ */}
        <section className="py-20 bg-slate-50" id="pricing">
          <div className="max-w-6xl mx-auto px-5">
            <div className="text-center mb-12">
              {promotion && (
                <div className="inline-flex items-center gap-2 bg-amber-400 text-amber-950 text-sm font-black px-5 py-2.5 rounded-full mb-4 shadow-lg animate-pulse">
                  🎉 {promotion.title} — {promotion.badgeText}
                  {promotion.validUntil && <span className="font-normal">· หมดเขต {promotion.validUntil}</span>}
                </div>
              )}
              <p className="text-blue-600 font-bold text-sm uppercase tracking-wider mb-2">ราคา</p>
              <h2 className="text-3xl md:text-4xl font-black text-slate-900 mb-3">ทดลองฟรี 30 วัน ขยายตามธุรกิจ</h2>
              <p className="text-slate-500">ไม่มีค่าติดตั้ง · ยกเลิกได้ทุกเมื่อ · ข้อมูลยังอยู่กับคุณ</p>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-4">
              {TIERS.map((t, i) => {
                const c = tierColor[t.color];
                return (
                  <div key={i} className={`bg-white rounded-2xl border-2 p-5 relative flex flex-col ${c.border}`}>
                    {t.popular && (
                      <div className="absolute -top-3 left-1/2 -translate-x-1/2 bg-blue-700 text-white text-[10px] font-black px-4 py-1 rounded-full whitespace-nowrap">
                        ยอดนิยม
                      </div>
                    )}
                    <div className={`text-[10px] font-black px-2.5 py-1 rounded-full w-fit mb-3 ${c.badge}`}>{t.name}</div>
                    <div className="mb-1">
                      {t.price === 'ฟรี' ? (
                        <span className="text-3xl font-black text-slate-900">ฟรี</span>
                      ) : (() => {
                        const basePrice = parseInt(t.price.replace(/,/g, ''));
                        const finalPrice = promotion ? Math.round(basePrice * (1 - promotion.discountPercent / 100)) : basePrice;
                        return (
                          <>
                            {promotion && <div className="text-xs text-slate-400 line-through">฿{basePrice.toLocaleString()}</div>}
                            <span className="text-3xl font-black text-slate-900">฿{finalPrice.toLocaleString()}</span>
                            {t.period && <span className="text-slate-400 text-sm">{t.period}</span>}
                          </>
                        );
                      })()}
                    </div>
                    <p className="text-slate-500 text-xs mb-4 leading-relaxed">{t.desc}</p>
                    <ul className="space-y-2 mb-5 flex-1">
                      {t.features.map((f, j) => (
                        <li key={j} className="flex items-start gap-2 text-xs">
                          <CheckCircle2 size={13} className="text-emerald-500 mt-0.5 shrink-0"/>
                          <span className="text-slate-700">{f}</span>
                        </li>
                      ))}
                    </ul>
                    <Link href={t.name === 'Enterprise' ? 'https://lin.ee/wdnoEN5' : '/register'}
                      target={t.name === 'Enterprise' ? '_blank' : undefined}
                      className={`w-full py-2.5 rounded-xl font-black text-xs text-center transition-all ${c.btn}`}>
                      {t.cta}
                    </Link>
                  </div>
                );
              })}
            </div>
            <p className="text-center text-slate-400 text-xs mt-6">
              ต้องการข้อมูลเพิ่มเติม →{' '}
              <Link href="/pricing" className="text-blue-600 font-bold hover:underline">ดูตารางราคาเต็มรูปแบบ</Link>
            </p>
          </div>
        </section>

        {/* ═══ TESTIMONIALS ═══ */}
        <section className="py-20 bg-white">
          <div className="max-w-5xl mx-auto px-5">
            <div className="text-center mb-12">
              <p className="text-blue-600 font-bold text-sm uppercase tracking-wider mb-2">รีวิวจากผู้ใช้จริง</p>
              <h2 className="text-3xl font-black text-slate-900">ร้านค้าที่ใช้งานแล้วพูดว่าอะไร</h2>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-5">
              {(realTestimonials && realTestimonials.length > 0
                ? realTestimonials.map(t => ({ name: t.name, role: t.role, text: t.message, stars: t.stars }))
                : TESTIMONIALS
              ).map((t, i) => (
                <div key={i} className="bg-slate-50 rounded-2xl border border-slate-200 p-5">
                  <div className="flex gap-0.5 mb-3">
                    {Array.from({length:t.stars}).map((_,j)=>(
                      <Star key={j} size={14} className="text-amber-400 fill-amber-400"/>
                    ))}
                  </div>
                  <p className="text-slate-700 text-sm leading-relaxed mb-4 italic">"{t.text}"</p>
                  <div className="flex items-center gap-2.5">
                    <div className="w-8 h-8 bg-blue-100 rounded-full flex items-center justify-center text-blue-700 font-black text-xs">{t.name[0]}</div>
                    <div>
                      <p className="text-slate-900 text-xs font-bold">{t.name}</p>
                      <p className="text-slate-400 text-[10px]">{t.role}</p>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* ═══ COMPARISON TABLE ═══ */}
        <section className="py-20 bg-slate-50">
          <div className="max-w-4xl mx-auto px-5">
            <div className="text-center mb-10">
              <p className="text-blue-600 font-bold text-sm uppercase tracking-wider mb-2">เทียบให้เห็นชัดๆ</p>
              <h2 className="text-3xl font-black text-slate-900">Smile Slip Pro vs วิธีเดิม</h2>
            </div>
            <div className="bg-white rounded-3xl border border-slate-200 shadow-xl overflow-hidden">
              <div className="overflow-x-auto">
                <table className="w-full text-sm min-w-[560px]">
                  <thead>
                    <tr className="border-b border-slate-200 bg-slate-50">
                      <th className="text-left px-5 py-4 font-bold text-slate-700">หัวข้อ</th>
                      <th className="text-left px-4 py-4 font-bold text-slate-400">วิธีเดิม (จดมือ + POS แยก + นักบัญชี)</th>
                      <th className="text-left px-4 py-4 font-bold text-emerald-600">Smile Slip Pro</th>
                    </tr>
                  </thead>
                  <tbody>
                    {COMPARISON_ROWS.map((row, i) => (
                      <tr key={row.label} className={i % 2 === 0 ? 'bg-white' : 'bg-slate-50/50'}>
                        <td className="text-left px-5 py-3 text-slate-700 font-medium">{row.label}</td>
                        <td className="text-left px-4 py-3 text-slate-400">{row.old}</td>
                        <td className="text-left px-4 py-3 text-emerald-700 font-bold">{row.us}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        </section>

        {/* ═══ FAQ ═══ */}
        <section className="py-20 bg-slate-50">
          <div className="max-w-2xl mx-auto px-5">
            <div className="text-center mb-10">
              <p className="text-blue-600 font-bold text-sm uppercase tracking-wider mb-2">FAQ</p>
              <h2 className="text-3xl font-black text-slate-900">คำถามที่พบบ่อย</h2>
            </div>
            <div className="space-y-3">
              {FAQS.map((f, i) => (
                <div key={i} className="bg-white rounded-2xl border border-slate-200 overflow-hidden">
                  <button
                    onClick={() => setOpenFaq(openFaq === i ? null : i)}
                    className="w-full px-5 py-4 flex items-center justify-between text-left gap-4">
                    <span className="font-bold text-slate-900 text-sm">{f.q}</span>
                    <ChevronDown size={16} className={`text-slate-400 shrink-0 transition-transform ${openFaq===i?'rotate-180':''}`}/>
                  </button>
                  {openFaq === i && (
                    <div className="px-5 pb-4">
                      <p className="text-slate-600 text-sm leading-relaxed">{f.a}</p>
                    </div>
                  )}
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* ═══ FINAL CTA ═══ */}
        <section className="py-20 bg-gradient-to-br from-blue-900 to-indigo-900 relative overflow-hidden">
          <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_bottom,rgba(99,102,241,0.2),transparent_70%)] pointer-events-none"/>
          <div className="max-w-2xl mx-auto px-5 text-center relative z-10">
            <div className="text-5xl mb-5">😊</div>
            <h2 className="text-3xl md:text-4xl font-black text-white mb-3">พร้อมเปิดร้านแบบสบายใจกว่านี้ไหม?</h2>
            <p className="text-blue-300 mb-8">บัญชี + POS ขายหน้าร้าน ครบในระบบเดียว — ทดลองฟรี 30 วัน ไม่ต้องใส่บัตรเครดิต ตั้งค่าเสร็จใน 5 นาที</p>
            <div className="flex flex-col sm:flex-row gap-3 justify-center">
              <Link href="/register"
                className="flex items-center justify-center gap-2 px-10 py-4 bg-white text-blue-900 rounded-2xl font-black shadow-2xl hover:bg-blue-50 transition-all group">
                เริ่มต้นใช้งานฟรี
                <ArrowRight size={16} className="group-hover:translate-x-1 transition-transform"/>
              </Link>
              <a href="https://lin.ee/wdnoEN5" target="_blank" rel="noreferrer"
                className="flex items-center justify-center gap-2 px-8 py-4 border border-white/30 text-white rounded-2xl font-bold text-sm hover:bg-white/10 transition-all">
                ติดต่อทีมงาน LINE
              </a>
            </div>
            <p className="text-blue-400 text-xs mt-6">
              <Lock size={10} className="inline mr-1"/> ข้อมูลทั้งหมดปลอดภัย · PDPA Compliant · ยกเลิกได้ทุกเมื่อ
            </p>
          </div>
        </section>

        {/* ═══ FOOTER ═══ */}
        <footer className="bg-slate-900 py-10">
          <div className="max-w-6xl mx-auto px-5">
            <div className="flex flex-col md:flex-row items-center justify-between gap-4">
              <div className="flex items-center gap-2.5">
                <div className="w-8 h-8 bg-blue-800 rounded-xl flex items-center justify-center text-base">😊</div>
                <div>
                  <p className="text-white font-black text-sm">Smile Slip Pro</p>
                  <p className="text-slate-500 text-[10px]">บริษัท สยาม โกลบอล เน็ทเวิร์ค เอ็นเตอร์ไพรส์ จำกัด</p>
                </div>
              </div>
              <div className="flex gap-5 text-xs text-slate-400">
                <Link href="/pricing" className="hover:text-white transition-colors">ราคา</Link>
                <Link href="/terms" className="hover:text-white transition-colors">เงื่อนไขการใช้งาน</Link>
                <Link href="/privacy" className="hover:text-white transition-colors">นโยบายความเป็นส่วนตัว</Link>
                <Link href="/login" className="hover:text-white transition-colors">เข้าสู่ระบบ</Link>
              </div>
            </div>
            <div className="border-t border-slate-800 mt-6 pt-6 text-center text-slate-500 text-[11px]">
              © {new Date().getFullYear()} Smile Slip Pro · All rights reserved
            </div>
          </div>
        </footer>

      </main>
    </>
  );
}
