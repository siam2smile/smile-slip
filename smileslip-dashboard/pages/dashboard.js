import React, { useState, useEffect } from 'react';
import { useRouter } from 'next/router';
import Head from 'next/head';
import {
  LayoutDashboard, Receipt, Wallet, LogOut,
  Settings, Landmark, FileSpreadsheet, FolderOpen,
  RefreshCcw, CheckCircle2, Circle,
  ChevronDown, TrendingUp, ExternalLink, Edit3, CreditCard,
  GitBranch, PlusCircle, Trash2, Clock
} from 'lucide-react';
import Link from 'next/link';

export default function Dashboard() {
  const router = useRouter();
  const [activeTab, setActiveTab] = useState('home');
  const [shopInfo, setShopInfo] = useState(null);
  const [credits, setCredits] = useState(0);
  const [bankAccounts, setBankAccounts] = useState([]);
  const [googleConfig, setGoogleConfig] = useState(null);
  const [isLoaded, setIsLoaded] = useState(false);
  const [transactions, setTransactions] = useState([]);
  const [loadingTransactions, setLoadingTransactions] = useState(false);
  const [reconnectGoogle, setReconnectGoogle] = useState(false);
  const [branches, setBranches] = useState([]);
  const [newBranchName, setNewBranchName] = useState('');
  const [newBranchGroupId, setNewBranchGroupId] = useState('');
  const [branchLoading, setBranchLoading] = useState(false);
  const [currentTime, setCurrentTime] = useState(new Date());
  const [isEditingProfile, setIsEditingProfile] = useState(false);
  const [editForm, setEditForm] = useState({ shopName: '', email: '', phone: '' });
  const [savingProfile, setSavingProfile] = useState(false);

  useEffect(() => {
    const timer = setInterval(() => setCurrentTime(new Date()), 1000);
    return () => clearInterval(timer);
  }, []);

  useEffect(() => {
    if (router.isReady) {
      const { userId, reconnectGoogle: rg } = router.query;
      if (!userId) { router.push('/login'); return; }
      if (rg === 'true') setReconnectGoogle(true);
      fetchData(userId);
    }
  }, [router.isReady, router.query]);

  useEffect(() => {
    if (activeTab === 'ledger' && shopInfo?.id) fetchTransactions(shopInfo.id);
    if (activeTab === 'branches' && shopInfo?.id) fetchBranches(shopInfo.id);
  }, [activeTab, shopInfo]);

  const fetchBranches = async (shopId) => {
    const res = await fetch(`/api/shop/branches?shopId=${shopId}`);
    const data = await res.json();
    setBranches(data.branches || []);
  };

  const MAX_BRANCHES = { normal: 1, pro: 1, advance: 5, super: 20 };
  const branchLimit = MAX_BRANCHES[(shopInfo?.subscription_tier || 'normal').toLowerCase()] || 1;

  const handleAddBranch = async () => {
    if (!newBranchName.trim() || !newBranchGroupId.trim()) return alert('กรุณากรอกชื่อสาขาและ Group ID ให้ครบค่ะ');
    if (branches.length >= branchLimit) return alert(`แพ็กเกจของคุณรองรับสูงสุด ${branchLimit} สาขาค่ะ`);
    setBranchLoading(true);
    const res = await fetch(`/api/shop/branches?shopId=${shopInfo.id}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ branchName: newBranchName, lineGroupId: newBranchGroupId }),
    });
    const data = await res.json();
    if (data.error) alert('เกิดข้อผิดพลาด: ' + data.error);
    else { setNewBranchName(''); setNewBranchGroupId(''); await fetchBranches(shopInfo.id); }
    setBranchLoading(false);
  };

  const handleDeleteBranch = async (branchId) => {
    if (!confirm('ยืนยันลบสาขานี้?')) return;
    await fetch(`/api/shop/branches?shopId=${shopInfo.id}`, {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ branchId }),
    });
    await fetchBranches(shopInfo.id);
  };

  const fetchData = async (userId) => {
    setIsLoaded(false);
    try {
      const res = await fetch(`/api/shop/data?userId=${encodeURIComponent(userId)}`);
      const data = await res.json();
      if (data.profile) {
        setShopInfo(data.profile);
        setEditForm({ shopName: data.profile.shop_name || '', email: data.profile.email || '', phone: data.profile.phone || '' });
        setCredits(data.credits ?? 0);
        setGoogleConfig(data.googleConfig);
        setBankAccounts(data.bankAccounts || []);
      }
      setIsLoaded(true);
    } catch (error) {
      console.error("Error fetching data:", error);
      setIsLoaded(true);
    }
  };

  const handleSaveProfile = async () => {
    setSavingProfile(true);
    try {
      const res = await fetch('/api/shop/update-profile', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ shopId: shopInfo.id, ...editForm }),
      });
      const data = await res.json();
      if (data.error) { alert('เกิดข้อผิดพลาด: ' + data.error); return; }
      setShopInfo(prev => ({ ...prev, shop_name: editForm.shopName, email: editForm.email, phone: editForm.phone }));
      setIsEditingProfile(false);
    } catch (e) {
      alert('เกิดข้อผิดพลาด กรุณาลองใหม่อีกครั้ง');
    } finally {
      setSavingProfile(false);
    }
  };

  const fetchTransactions = async (shopId) => {
    setLoadingTransactions(true);
    try {
      const res = await fetch(`/api/sheets/transactions?shopId=${shopId}`);
      const data = await res.json();
      if (data.rows) setTransactions(data.rows);
    } catch (err) {
      console.error("Ledger Error:", err);
    }
    setLoadingTransactions(false);
  };

  const navItems = [
    { id: 'home',     label: 'หน้าหลัก',       icon: <LayoutDashboard size={15}/> },
    { id: 'ledger',   label: 'รายรับ-รายจ่าย',  icon: <TrendingUp size={15}/> },
    { id: 'branches', label: 'จัดการสาขา',      icon: <GitBranch size={15}/> },
    { id: 'settings', label: 'ตั้งค่า',          icon: <Settings size={15}/> },
  ];

  const tierColor = {
    normal:  'bg-slate-100 text-slate-600',
    pro:     'bg-amber-100 text-amber-700',
    advance: 'bg-indigo-100 text-indigo-700',
    super:   'bg-emerald-100 text-emerald-700',
  };

  if (!isLoaded) return (
    <div className="min-h-screen flex flex-col items-center justify-center bg-blue-950 text-white font-sans">
      <div className="text-5xl animate-bounce mb-4">😊</div>
      <p className="animate-pulse font-bold tracking-widest text-blue-300 text-sm uppercase">กำลังโหลด Smile Slip Pro...</p>
    </div>
  );

  return (
    <div className="min-h-screen bg-blue-50 font-sans flex flex-col">
      <Head>
        <title>{shopInfo?.shop_name || 'Smile Slip Pro'} — Dashboard</title>
      </Head>

      {/* ══════════════════ TOP NAVBAR ══════════════════ */}
      <nav className="bg-blue-900 text-white h-14 flex items-center justify-between px-6 sticky top-0 z-50 shadow-xl shadow-blue-900/30">

        {/* Logo */}
        <div className="flex items-center gap-2.5 shrink-0">
          <div className="w-8 h-8 bg-blue-500 rounded-xl flex items-center justify-center text-base font-black shadow-lg">😊</div>
          <span className="font-black text-sm tracking-tight hidden sm:block">
            Smile Slip <span className="text-blue-300 font-medium">Pro</span>
          </span>
        </div>

        {/* Tab Navigation */}
        <div className="flex items-center gap-1">
          {navItems.map(item => (
            <button key={item.id} onClick={() => setActiveTab(item.id)}
              className={`flex items-center gap-1.5 px-3.5 py-2 rounded-xl text-xs font-bold transition-all ${
                activeTab === item.id
                  ? 'bg-blue-600 text-white shadow-lg shadow-blue-600/30'
                  : 'text-blue-300 hover:bg-blue-800 hover:text-white'
              }`}>
              {item.icon}
              <span className="hidden md:inline">{item.label}</span>
            </button>
          ))}
          <Link href={`/pricing?userId=${shopInfo?.owner_line_id}`}
            className="flex items-center gap-1.5 px-3.5 py-2 rounded-xl text-xs font-bold text-blue-300 hover:bg-blue-800 hover:text-white transition-all ml-1 border border-blue-700">
            <CreditCard size={15}/>
            <span className="hidden md:inline">แพ็กเกจ</span>
          </Link>
        </div>

        {/* Right: Date/Time + Logout */}
        <div className="flex items-center gap-3 shrink-0">
          <div className="text-right hidden lg:block">
            <p className="text-[10px] text-blue-400 leading-tight">
              {currentTime.toLocaleDateString('th-TH', { weekday: 'short', year: 'numeric', month: 'short', day: 'numeric' })}
            </p>
            <p className="text-sm font-mono font-black text-white leading-tight">
              {currentTime.toLocaleTimeString('th-TH')}
            </p>
          </div>
          <div className="w-px h-8 bg-blue-700 hidden lg:block"/>
          <button onClick={() => router.push('/login')}
            className="flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-bold text-blue-300 hover:bg-rose-600 hover:text-white transition-all">
            <LogOut size={15}/> <span className="hidden sm:inline">ออกจากระบบ</span>
          </button>
        </div>
      </nav>

      {/* ══════════════════ CONTENT AREA ══════════════════ */}
      <div className="flex flex-1 overflow-hidden">

        {/* ── Sidebar ── */}
        <aside className="w-56 bg-white border-r border-blue-100 flex flex-col sticky top-14 h-[calc(100vh-3.5rem)] overflow-y-auto shrink-0">

          {/* Shop Card */}
          <div className="p-4 border-b border-blue-50">
            <div className="flex items-center gap-3 mb-3">
              <div className="w-9 h-9 bg-blue-600 rounded-xl flex items-center justify-center text-base text-white font-black shadow-md shadow-blue-200">😊</div>
              <div className="overflow-hidden">
                <p className="text-xs font-black text-slate-800 truncate leading-tight">{shopInfo?.shop_name || 'Smile Slip'}</p>
                <span className={`text-[9px] px-1.5 py-0.5 rounded font-black uppercase tracking-wide ${tierColor[(shopInfo?.subscription_tier || 'normal').toLowerCase()] || tierColor.normal}`}>
                  {shopInfo?.subscription_tier || 'Normal'}
                </span>
              </div>
            </div>
            {/* Credit mini display */}
            <div className="bg-blue-50 border border-blue-100 rounded-xl p-3 flex items-center justify-between">
              <span className="text-[10px] text-blue-500 font-bold">เครดิต</span>
              <span className="text-lg font-black text-blue-800">{(credits || 0).toLocaleString()}</span>
            </div>
          </div>

          {/* Onboarding Checklist */}
          <div className="p-4 flex-1">
            <div className="flex items-center justify-between mb-3">
              <p className="text-[9px] font-black text-slate-400 uppercase tracking-widest">Onboarding</p>
              <ChevronDown size={12} className="text-slate-300"/>
            </div>
            <div className="space-y-2.5 text-xs font-bold">
              <div className="flex items-center gap-2 text-emerald-600">
                <CheckCircle2 size={14} className="shrink-0"/> เชื่อมต่อ LINE
              </div>
              <div className="flex items-center gap-2 text-emerald-600">
                <CheckCircle2 size={14} className="shrink-0"/> สร้างธุรกิจ
              </div>
              <div className={`flex items-center gap-2 ${googleConfig ? 'text-emerald-600' : 'text-slate-400'}`}>
                {googleConfig ? <CheckCircle2 size={14} className="shrink-0"/> : <Circle size={14} className="shrink-0"/>}
                เชื่อมต่อ Google
              </div>
              <div className="flex items-center gap-2 text-slate-400">
                <Circle size={14} className="shrink-0"/> ใส่ลายเซ็นรับรอง
              </div>
            </div>

            {/* Date/time (mobile fallback) */}
            <div className="mt-6 pt-4 border-t border-blue-50 lg:hidden">
              <div className="flex items-center gap-2 text-slate-400">
                <Clock size={12}/>
                <p className="text-[10px] font-mono font-bold">{currentTime.toLocaleTimeString('th-TH')}</p>
              </div>
              <p className="text-[9px] text-slate-300 mt-0.5">
                {currentTime.toLocaleDateString('th-TH', { year: 'numeric', month: 'short', day: 'numeric' })}
              </p>
            </div>
          </div>

          {/* Footer */}
          <div className="p-4 border-t border-blue-50">
            <div className="flex justify-center gap-3">
              <Link href="/terms" className="text-[9px] text-slate-400 hover:text-blue-600 underline transition-colors">เงื่อนไข</Link>
              <span className="text-slate-200 text-[9px]">|</span>
              <Link href="/privacy" className="text-[9px] text-slate-400 hover:text-blue-600 underline transition-colors">ความเป็นส่วนตัว</Link>
            </div>
            <p className="text-center text-[8px] text-slate-300 mt-1">© 2569 Smile Slip Pro</p>
          </div>
        </aside>

        {/* ══════════════════ MAIN CONTENT ══════════════════ */}
        <main className="flex-1 overflow-y-auto p-8 bg-blue-50">

          {/* ─── HOME TAB ─── */}
          {activeTab === 'home' && (
            <div className="max-w-5xl space-y-8 animate-in fade-in duration-300">

              {/* Google reconnect warning */}
              {reconnectGoogle && (
                <div className="bg-red-50 border border-red-200 rounded-2xl p-4 flex items-center justify-between gap-4">
                  <div className="flex items-center gap-3">
                    <span className="text-xl">⚠️</span>
                    <div>
                      <p className="font-black text-red-700 text-sm">Google Drive ขาดการเชื่อมต่อ</p>
                      <p className="text-red-400 text-xs mt-0.5">สลิปล่าสุดไม่ถูกบันทึกลง Google Sheets</p>
                    </div>
                  </div>
                  <a href={`/api/auth/google/connect?shopId=${shopInfo?.id}`}
                    className="shrink-0 bg-red-600 hover:bg-red-700 text-white font-black text-xs px-4 py-2 rounded-xl transition-all">
                    เชื่อมต่อใหม่
                  </a>
                </div>
              )}

              {/* Hero Header */}
              <div className="bg-gradient-to-br from-blue-900 via-blue-800 to-blue-600 rounded-3xl p-8 text-white relative overflow-hidden shadow-2xl shadow-blue-900/30">
                {/* Decorative circles */}
                <div className="absolute -top-12 -right-12 w-48 h-48 bg-blue-500/20 rounded-full"/>
                <div className="absolute -bottom-8 -left-8 w-32 h-32 bg-blue-400/10 rounded-full"/>
                {/* วางรูป hero ได้ที่นี่ — ใส่ไฟล์รูปใน public/ แล้วใช้ <img src="/hero.png" .../> */}
                <div className="relative z-10 flex flex-col md:flex-row items-start md:items-center justify-between gap-4">
                  <div>
                    <p className="text-blue-300 text-xs font-bold uppercase tracking-widest mb-1">ยินดีต้อนรับ</p>
                    <h2 className="text-3xl font-black tracking-tight mb-1">สวัสดี, {shopInfo?.shop_name} 😊</h2>
                    <p className="text-blue-200 text-sm">Financial Trust Layer พร้อมใช้งานแล้ว</p>
                  </div>
                  <div className="text-right shrink-0">
                    <p className="text-[10px] text-blue-400 uppercase tracking-widest">Shop ID</p>
                    <p className="font-mono text-xs text-blue-300">{shopInfo?.id?.split('-')[0]?.toUpperCase()}</p>
                  </div>
                </div>
              </div>

              {/* Credit Banner */}
              <div className="bg-gradient-to-r from-blue-600 to-cyan-500 rounded-2xl p-5 text-white shadow-lg flex flex-col sm:flex-row items-center justify-between gap-4">
                <div>
                  <h3 className="text-lg font-black mb-0.5">เครดิตคงเหลือ {(credits || 0).toLocaleString()} แผ่น</h3>
                  <p className="text-blue-100 text-xs">เติมเครดิตหรืออัปเกรดแพ็กเกจเพื่อปลดล็อกฟีเจอร์ AI เพิ่มเติม</p>
                </div>
                <button onClick={() => router.push(`/pricing?userId=${shopInfo?.owner_line_id}`)}
                  className="shrink-0 bg-white text-blue-700 px-5 py-2.5 rounded-xl font-black text-sm hover:scale-105 transition-transform shadow-md">
                  ดูแพ็กเกจ & เติมเครดิต
                </button>
              </div>

              {/* Stats Cards */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">

                {/* Credit Card */}
                <div className="bg-blue-900 p-8 rounded-3xl shadow-2xl text-white relative overflow-hidden group">
                  <Wallet className="absolute -right-4 -bottom-4 w-32 h-32 opacity-10 group-hover:scale-110 transition-transform duration-700"/>
                  <p className="text-blue-400 font-black uppercase tracking-widest text-[10px] mb-3">เครดิตคงเหลือ</p>
                  <h3 className="text-6xl font-black tracking-tighter">{(credits || 0).toLocaleString()}</h3>
                  <p className="text-blue-400 text-xs mt-1">แผ่น</p>
                  <div className="mt-6 flex gap-2 relative z-10">
                    <button onClick={() => router.push(`/pricing?userId=${shopInfo?.owner_line_id}`)}
                      className="bg-blue-600 hover:bg-blue-500 px-5 py-2 rounded-xl text-xs font-bold transition-all">
                      เติมเครดิต
                    </button>
                    <button className="bg-blue-800 hover:bg-blue-700 px-5 py-2 rounded-xl text-xs font-bold transition-all">
                      ประวัติการใช้
                    </button>
                  </div>
                </div>

                {/* Google Sync Card */}
                <div className="bg-white p-8 rounded-3xl shadow-xl border border-blue-100 flex flex-col justify-between">
                  <div className="flex justify-between items-start">
                    <div className={`p-3 rounded-2xl ${googleConfig ? 'bg-emerald-50 text-emerald-600' : 'bg-amber-50 text-amber-500'}`}>
                      <FileSpreadsheet size={28}/>
                    </div>
                    <span className={`px-3 py-1 rounded-full text-[10px] font-black uppercase tracking-widest ${googleConfig ? 'bg-emerald-50 text-emerald-600' : 'bg-amber-50 text-amber-600'}`}>
                      {googleConfig ? 'Active Sync' : 'ยังไม่เชื่อมต่อ'}
                    </span>
                  </div>
                  <div className="mt-6">
                    <h4 className="text-lg font-black text-slate-800 mb-3">Google Ecosystem</h4>
                    {googleConfig ? (
                      <div className="space-y-2">
                        <a href={`https://docs.google.com/spreadsheets/d/${googleConfig.google_sheet_id}`} target="_blank" rel="noreferrer"
                          className="flex items-center gap-2 text-blue-600 font-bold hover:bg-blue-50 p-2.5 rounded-xl transition-all text-sm">
                          <ExternalLink size={14}/> เปิด Google Sheet รายงาน
                        </a>
                        <a href={`https://drive.google.com/drive/folders/${googleConfig.google_folder_id}`} target="_blank" rel="noreferrer"
                          className="flex items-center gap-2 text-amber-600 font-bold hover:bg-amber-50 p-2.5 rounded-xl transition-all text-sm">
                          <FolderOpen size={14}/> โฟลเดอร์รูปสลิป
                        </a>
                        <a href={`/api/auth/google/connect?shopId=${shopInfo?.id}`}
                          className="flex items-center gap-2 text-slate-500 font-bold hover:bg-slate-50 p-2.5 rounded-xl transition-all text-sm">
                          <RefreshCcw size={14}/> เชื่อมต่อใหม่
                        </a>
                      </div>
                    ) : (
                      <a href={`/api/auth/google/connect?shopId=${shopInfo?.id}`}
                        className="w-full flex items-center justify-center gap-2 bg-blue-900 text-white p-3.5 rounded-2xl font-black text-sm hover:bg-blue-700 transition-all shadow-lg">
                        <RefreshCcw size={16}/> เชื่อมต่อ Google Drive
                      </a>
                    )}
                  </div>
                </div>
              </div>

              {/* Coming Soon */}
              <div className="bg-white border border-blue-100 rounded-3xl p-8 text-center shadow-sm">
                <p className="text-slate-400 font-medium italic text-sm">เตรียมพบกับระบบรายงานบัญชี AI และ Dashboard สรุปยอดขายเร็วๆ นี้</p>
              </div>
            </div>
          )}

          {/* ─── LEDGER TAB ─── */}
          {activeTab === 'ledger' && (
            <div className="max-w-6xl animate-in fade-in duration-300">
              <header className="mb-8">
                <h2 className="text-2xl font-black text-blue-900 uppercase tracking-tight">Transaction Ledger</h2>
                <p className="text-slate-500 text-sm mt-1">รายการเดินบัญชีที่ผ่านการตรวจสอบสลิปแล้ว</p>
              </header>

              <div className="bg-white rounded-3xl shadow-xl border border-blue-100 overflow-hidden">
                <table className="w-full text-left">
                  <thead>
                    <tr className="bg-blue-50 border-b border-blue-100 text-blue-400 text-[10px] font-black uppercase tracking-widest">
                      <th className="px-6 py-4">วันที่ / เวลา</th>
                      <th className="px-6 py-4">ผู้โอน / รายการ</th>
                      <th className="px-6 py-4 text-right">ยอดเงิน</th>
                      <th className="px-6 py-4 text-center">สลิป</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-50">
                    {loadingTransactions ? (
                      <tr><td colSpan="4" className="py-24 text-center font-bold text-slate-300 animate-pulse text-sm">กำลังดึงข้อมูลจาก Google Sheets...</td></tr>
                    ) : transactions.length === 0 ? (
                      <tr><td colSpan="4" className="py-24 text-center font-bold text-slate-300 italic text-sm">ไม่พบประวัติธุรกรรม (ตรวจสอบการเชื่อมต่อ Google)</td></tr>
                    ) : transactions.map((tx, idx) => (
                      <tr key={idx} className="hover:bg-blue-50/50 transition-colors">
                        <td className="px-6 py-4">
                          <p className="font-black text-slate-700 text-sm">{tx.date}</p>
                          <p className="text-[10px] text-slate-400 font-bold">{tx.time}</p>
                        </td>
                        <td className="px-6 py-4">
                          <div className="flex items-center gap-3">
                            <div className="w-8 h-8 bg-blue-100 rounded-full flex items-center justify-center text-blue-600 font-black text-xs">
                              {tx.sender?.charAt(0)?.toUpperCase() || 'U'}
                            </div>
                            <div>
                              <p className="font-bold text-slate-800 text-sm">{tx.sender || 'ไม่ระบุชื่อ'}</p>
                              <p className="text-[10px] text-slate-400">{tx.type}</p>
                            </div>
                          </div>
                        </td>
                        <td className="px-6 py-4 text-right">
                          <span className={`font-black text-xl tracking-tighter ${tx.type === 'รายรับ' ? 'text-emerald-600' : 'text-rose-500'}`}>
                            ฿{Number(tx.amount || 0).toLocaleString()}
                          </span>
                        </td>
                        <td className="px-6 py-4 text-center">
                          {tx.slipUrl ? (
                            <a href={tx.slipUrl} target="_blank" rel="noreferrer"
                              className="inline-flex items-center gap-1.5 bg-white border border-slate-200 text-slate-600 px-4 py-2 rounded-xl font-bold hover:bg-blue-900 hover:text-white hover:border-blue-900 transition-all text-xs">
                              <Receipt size={12}/> ดูสลิป
                            </a>
                          ) : <span className="text-slate-300 text-xs">—</span>}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* ─── BRANCHES TAB ─── */}
          {activeTab === 'branches' && (
            <div className="max-w-4xl space-y-6 animate-in fade-in duration-300">
              <header>
                <h2 className="text-2xl font-black text-blue-900 tracking-tight">จัดการสาขา</h2>
                <p className="text-slate-500 text-sm mt-1">
                  แพ็กเกจของคุณรองรับสูงสุด <span className="font-black text-blue-600">{branchLimit} สาขา</span> (เพิ่มแล้ว {branches.length} สาขา)
                </p>
              </header>

              {branches.length < branchLimit ? (
                <div className="bg-white p-7 rounded-3xl shadow-xl border border-blue-100">
                  <h3 className="text-base font-black text-slate-800 mb-5 flex items-center gap-2">
                    <PlusCircle size={18} className="text-blue-600"/> เพิ่มสาขาใหม่
                  </h3>
                  <div className="space-y-4">
                    <div>
                      <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-2 block">ชื่อสาขา</label>
                      <input value={newBranchName} onChange={e => setNewBranchName(e.target.value)}
                        placeholder="เช่น สาขาสีลม, สาขาอโศก"
                        className="w-full border border-slate-200 rounded-xl px-4 py-3 text-sm font-bold outline-none focus:border-blue-400 transition-colors"/>
                    </div>
                    <div>
                      <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-2 block">LINE Group ID</label>
                      <input value={newBranchGroupId} onChange={e => setNewBranchGroupId(e.target.value)}
                        placeholder="C1234567890abcdef..."
                        className="w-full border border-slate-200 rounded-xl px-4 py-3 text-sm font-mono outline-none focus:border-blue-400 transition-colors"/>
                      <p className="text-xs text-slate-400 mt-2">💡 เพิ่มบอทเข้ากลุ่ม LINE สาขา — บอทจะส่ง Group ID มาอัตโนมัติ</p>
                    </div>
                    <button onClick={handleAddBranch} disabled={branchLoading}
                      className="w-full bg-blue-600 hover:bg-blue-700 text-white py-3 rounded-xl font-black text-sm transition-colors disabled:opacity-50">
                      {branchLoading ? 'กำลังเพิ่ม...' : '+ เพิ่มสาขา'}
                    </button>
                  </div>
                </div>
              ) : (
                <div className="bg-amber-50 border border-amber-200 p-6 rounded-2xl text-center">
                  <p className="font-black text-amber-700 text-sm">ถึงขีดจำกัดสาขาของแพ็กเกจแล้ว</p>
                  <Link href={`/pricing?userId=${shopInfo?.owner_line_id}`}
                    className="inline-block mt-3 bg-amber-500 hover:bg-amber-600 text-white px-6 py-2 rounded-xl text-sm font-black transition-colors">
                    อัปเกรดเพื่อเพิ่มสาขา
                  </Link>
                </div>
              )}

              <div className="bg-white rounded-3xl shadow-xl border border-blue-100 overflow-hidden">
                <div className="px-6 py-4 border-b border-slate-100">
                  <h3 className="font-black text-slate-800 text-sm">สาขาที่ลงทะเบียนแล้ว</h3>
                </div>
                {branches.length === 0 ? (
                  <div className="py-16 text-center text-slate-400 font-bold italic text-sm">ยังไม่มีสาขา — เพิ่มสาขาแรกได้เลย</div>
                ) : (
                  <div className="divide-y divide-slate-50">
                    {branches.map(b => (
                      <div key={b.id} className="flex items-center justify-between px-6 py-4 hover:bg-blue-50/50 transition-colors">
                        <div>
                          <p className="font-black text-slate-800 text-sm">{b.branch_name}</p>
                          <p className="text-xs font-mono text-slate-400 mt-0.5">{b.line_group_id}</p>
                        </div>
                        <div className="flex items-center gap-2">
                          <span className={`text-[10px] px-3 py-1 rounded-full font-bold ${b.is_active ? 'bg-emerald-50 text-emerald-600' : 'bg-slate-100 text-slate-400'}`}>
                            {b.is_active ? 'ใช้งาน' : 'ปิด'}
                          </span>
                          <button onClick={() => handleDeleteBranch(b.id)}
                            className="p-2 text-rose-400 hover:bg-rose-50 rounded-xl transition-colors">
                            <Trash2 size={15}/>
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {(shopInfo?.subscription_tier || 'normal').toLowerCase() !== 'normal' && (
                <div className="bg-blue-900 p-7 rounded-3xl text-white">
                  <h3 className="font-black mb-4 text-sm flex items-center gap-2">📲 คำสั่ง LINE สำหรับเจ้าของ</h3>
                  <div className="space-y-2 text-sm font-mono">
                    {['#สรุปวันนี้','#สรุปเดือนนี้','#กำไรขาดทุน',
                      ...(['advance','super'].includes((shopInfo?.subscription_tier||'').toLowerCase()) ? ['#สรุปทุกสาขา'] : []),
                      '#ช่วยเหลือ'
                    ].map(cmd => (
                      <div key={cmd} className="flex items-center gap-3 bg-blue-800 px-4 py-2.5 rounded-xl">
                        <span className="text-cyan-400">{cmd}</span>
                      </div>
                    ))}
                  </div>
                  <p className="text-blue-400 text-xs mt-4">พิมพ์คำสั่งในแชท LINE กับบอทได้เลยค่ะ</p>
                </div>
              )}
            </div>
          )}

          {/* ─── SETTINGS TAB ─── */}
          {activeTab === 'settings' && (
            <div className="max-w-4xl space-y-6 animate-in fade-in duration-300">
              <header>
                <h2 className="text-2xl font-black text-blue-900 tracking-tight">ตั้งค่าร้านค้า</h2>
                <p className="text-slate-500 text-sm mt-1">ข้อมูลร้านค้า, Google Drive และบัญชีธนาคาร</p>
              </header>

              {/* ── ข้อมูลร้านค้า ── */}
              <div className="bg-white p-8 rounded-3xl shadow-xl border border-blue-100">
                <div className="flex items-center justify-between mb-6">
                  <h3 className="text-lg font-black text-slate-800 flex items-center gap-2">
                    <Settings className="text-blue-600" size={20}/> ข้อมูลร้านค้า
                  </h3>
                  {!isEditingProfile ? (
                    <button onClick={() => setIsEditingProfile(true)}
                      className="flex items-center gap-1.5 px-4 py-2 text-xs font-black text-blue-600 bg-blue-50 hover:bg-blue-100 rounded-xl transition-all">
                      <Edit3 size={14}/> แก้ไข
                    </button>
                  ) : (
                    <div className="flex gap-2">
                      <button onClick={() => setIsEditingProfile(false)}
                        className="px-4 py-2 text-xs font-black text-slate-500 bg-slate-100 hover:bg-slate-200 rounded-xl transition-all">
                        ยกเลิก
                      </button>
                      <button onClick={handleSaveProfile} disabled={savingProfile}
                        className="px-4 py-2 text-xs font-black text-white bg-blue-600 hover:bg-blue-700 rounded-xl transition-all disabled:opacity-50">
                        {savingProfile ? 'กำลังบันทึก...' : 'บันทึก'}
                      </button>
                    </div>
                  )}
                </div>

                {isEditingProfile ? (
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div>
                      <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-2 block">ชื่อร้าน / ธุรกิจ</label>
                      <input value={editForm.shopName} onChange={e => setEditForm(f => ({...f, shopName: e.target.value}))}
                        className="w-full border border-slate-200 rounded-xl px-4 py-3 text-sm font-bold outline-none focus:border-blue-400 transition-colors"/>
                    </div>
                    <div>
                      <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-2 block">อีเมล</label>
                      <input value={editForm.email} onChange={e => setEditForm(f => ({...f, email: e.target.value}))}
                        className="w-full border border-slate-200 rounded-xl px-4 py-3 text-sm font-bold outline-none focus:border-blue-400 transition-colors"/>
                    </div>
                    <div>
                      <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-2 block">เบอร์โทรศัพท์</label>
                      <input value={editForm.phone} onChange={e => setEditForm(f => ({...f, phone: e.target.value}))}
                        className="w-full border border-slate-200 rounded-xl px-4 py-3 text-sm font-bold outline-none focus:border-blue-400 transition-colors"/>
                    </div>
                  </div>
                ) : (
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    {[
                      { label: 'ชื่อร้าน / ธุรกิจ', value: shopInfo?.shop_name },
                      { label: 'ประเภทผู้ใช้', value: shopInfo?.user_type },
                      { label: 'เลขประจำตัวผู้เสียภาษี', value: shopInfo?.tax_id || '—' },
                      { label: 'สาขา', value: shopInfo?.branch_name },
                      { label: 'อีเมล', value: shopInfo?.email },
                      { label: 'เบอร์โทรศัพท์', value: shopInfo?.phone },
                      { label: 'แพ็กเกจ', value: shopInfo?.subscription_tier?.toUpperCase() },
                    ].map(item => (
                      <div key={item.label} className="bg-blue-50 rounded-2xl p-4">
                        <p className="text-[10px] font-black text-blue-400 uppercase tracking-widest mb-1">{item.label}</p>
                        <p className="font-black text-slate-800 text-sm">{item.value || '—'}</p>
                      </div>
                    ))}
                    <div className="md:col-span-2 bg-blue-50 rounded-2xl p-4">
                      <p className="text-[10px] font-black text-blue-400 uppercase tracking-widest mb-1">ที่อยู่</p>
                      <p className="font-bold text-slate-700 text-sm">{shopInfo?.address || '—'}</p>
                    </div>
                  </div>
                )}
              </div>

              {/* ── Google Drive & Sheets ── */}
              <div className="bg-white p-8 rounded-3xl shadow-xl border border-blue-100">
                <h3 className="text-lg font-black text-slate-800 flex items-center gap-2 mb-6">
                  <FileSpreadsheet className="text-emerald-600" size={20}/> Google Drive & Sheets
                </h3>
                {googleConfig ? (
                  <div className="space-y-3">
                    <div className="flex items-center gap-3 p-4 bg-emerald-50 rounded-2xl border border-emerald-100">
                      <CheckCircle2 size={20} className="text-emerald-600 shrink-0"/>
                      <div className="flex-1">
                        <p className="font-black text-emerald-700 text-sm">เชื่อมต่อแล้ว</p>
                        <p className="text-emerald-500 text-xs">{googleConfig.google_email || 'Google Account'}</p>
                      </div>
                    </div>
                    <div className="flex flex-col sm:flex-row gap-3">
                      <a href={`https://docs.google.com/spreadsheets/d/${googleConfig.google_sheet_id}`} target="_blank" rel="noreferrer"
                        className="flex-1 flex items-center justify-center gap-2 bg-blue-50 text-blue-700 p-3 rounded-xl font-black text-sm hover:bg-blue-100 transition-all">
                        <ExternalLink size={15}/> เปิด Google Sheet
                      </a>
                      <a href={`https://drive.google.com/drive/folders/${googleConfig.google_folder_id}`} target="_blank" rel="noreferrer"
                        className="flex-1 flex items-center justify-center gap-2 bg-amber-50 text-amber-700 p-3 rounded-xl font-black text-sm hover:bg-amber-100 transition-all">
                        <FolderOpen size={15}/> โฟลเดอร์สลิป
                      </a>
                      <a href={`/api/auth/google/connect?shopId=${shopInfo?.id}`}
                        className="flex items-center justify-center gap-2 bg-slate-100 text-slate-600 p-3 rounded-xl font-black text-sm hover:bg-slate-200 transition-all">
                        <RefreshCcw size={15}/> เชื่อมต่อใหม่
                      </a>
                    </div>
                  </div>
                ) : (
                  <div className="text-center py-4">
                    <p className="text-slate-500 text-sm font-bold mb-5">เชื่อมต่อ Google เพื่อให้บอทบันทึกสลิปลง Drive และ Sheets ของคุณอัตโนมัติ</p>
                    <a href={`/api/auth/google/connect?shopId=${shopInfo?.id}`}
                      className="inline-flex items-center gap-2 bg-blue-900 text-white px-8 py-4 rounded-2xl font-black text-sm hover:bg-blue-700 transition-all shadow-lg">
                      <RefreshCcw size={18}/> เชื่อมต่อ Google Drive & Sheets
                    </a>
                    <p className="text-xs text-slate-400 mt-3">รับเครดิตโบนัส 30 แผ่น เมื่อเชื่อมต่อสำเร็จ</p>
                  </div>
                )}
              </div>

              {/* ── บัญชีธนาคาร ── */}
              <div className="bg-white p-8 rounded-3xl shadow-xl border border-blue-100">
                <h3 className="text-lg font-black text-slate-800 flex items-center gap-2 mb-6">
                  <Landmark className="text-blue-600" size={20}/> บัญชีธนาคารรับเงิน
                </h3>
                <div className="grid grid-cols-1 gap-4">
                  {bankAccounts.map(bank => (
                    <div key={bank.id} className="p-6 bg-blue-50 rounded-2xl border border-blue-100 flex justify-between items-center">
                      <div>
                        <p className="text-[10px] font-black text-blue-400 uppercase tracking-widest">{bank.bank_name}</p>
                        <h4 className="text-xl font-black text-slate-800 mt-1 tracking-tight">{bank.account_number}</h4>
                        <p className="text-slate-500 font-bold text-sm mt-1">{bank.account_name}</p>
                        <p className="text-slate-400 text-xs mt-0.5">{bank.account_type}</p>
                      </div>
                    </div>
                  ))}
                  {bankAccounts.length === 0 && (
                    <div className="py-16 border-2 border-dashed border-blue-100 rounded-2xl text-center text-slate-400 font-bold italic text-sm">
                      ยังไม่มีข้อมูลบัญชีธนาคาร
                    </div>
                  )}
                </div>
              </div>
            </div>
          )}

        </main>
      </div>
    </div>
  );
}
