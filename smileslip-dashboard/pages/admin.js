import React, { useState, useEffect } from 'react';
import Head from 'next/head';
import {
  Users, Trash2, PlusCircle, Search, ShieldCheck,
  LogOut, KeyRound, TrendingUp, CreditCard, RefreshCcw,
  ChevronDown, Eye, EyeOff, MinusCircle, Edit3, Check, X
} from 'lucide-react';

const TIERS = ['normal', 'pro', 'advance', 'super'];
const TIER_COLOR = {
  normal:  'bg-slate-700 text-slate-300',
  pro:     'bg-amber-900/60 text-amber-400',
  advance: 'bg-indigo-900/60 text-indigo-400',
  super:   'bg-emerald-900/60 text-emerald-400',
};

export default function AdminDashboard() {
  const [isAdmin, setIsAdmin] = useState(false);
  const [password, setPassword] = useState('');
  const [showPw, setShowPw] = useState(false);
  const [loginError, setLoginError] = useState('');
  const [loginLoading, setLoginLoading] = useState(false);

  const [shops, setShops] = useState([]);
  const [loading, setLoading] = useState(false);
  const [searchTerm, setSearchTerm] = useState('');
  const [filterTier, setFilterTier] = useState('all');
  const [expandedId, setExpandedId] = useState(null);

  // inline edit states
  const [editCredit, setEditCredit] = useState({});   // { shopId: value }
  const [editTier, setEditTier] = useState({});        // { shopId: tier }

  useEffect(() => {
    const token = sessionStorage.getItem('admin_token');
    if (token) { setIsAdmin(true); fetchData(); }
  }, []);

  const handleLogin = async (e) => {
    e.preventDefault();
    setLoginLoading(true);
    setLoginError('');
    try {
      const res = await fetch('/api/admin/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      sessionStorage.setItem('admin_token', data.token);
      setIsAdmin(true);
      fetchData();
    } catch (err) {
      setLoginError(err.message);
    }
    setLoginLoading(false);
  };

  const handleLogout = () => {
    sessionStorage.removeItem('admin_token');
    setIsAdmin(false);
    setShops([]);
  };

  const fetchData = async () => {
    setLoading(true);
    try {
      const { data, error } = await supabase
        .from('shop_profiles')
        .select(`*, shop_credits(balance_credits), shop_google_configs(google_email), shop_branches(id)`)
        .order('created_at', { ascending: false });
      if (error) throw error;
      setShops(data || []);
    } catch (err) {
      alert('โหลดข้อมูลไม่สำเร็จ: ' + err.message);
    }
    setLoading(false);
  };

  const callUpdate = async (action, shopId, value, currentCredits) => {
    const res = await fetch('/api/admin/update-shop', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action, shopId, value, currentCredits }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error);
    return data;
  };

  const handleTierChange = async (shopId, newTier) => {
    try {
      await callUpdate('update_tier', shopId, newTier);
      setShops(prev => prev.map(s => s.id === shopId ? { ...s, subscription_tier: newTier } : s));
      setEditTier(prev => { const n = { ...prev }; delete n[shopId]; return n; });
    } catch (err) { alert('แก้ไขไม่สำเร็จ: ' + err.message); }
  };

  const handleCreditAction = async (shopId, action, currentCredits) => {
    const val = editCredit[shopId];
    if (!val || isNaN(val)) return alert('กรอกจำนวนเครดิตให้ถูกต้อง');
    try {
      const result = await callUpdate(action, shopId, val, currentCredits);
      setShops(prev => prev.map(s => {
        if (s.id !== shopId) return s;
        const credits = Array.isArray(s.shop_credits) ? [{ balance_credits: result.newTotal }] : { balance_credits: result.newTotal };
        return { ...s, shop_credits: credits };
      }));
      setEditCredit(prev => { const n = { ...prev }; delete n[shopId]; return n; });
    } catch (err) { alert('แก้ไขไม่สำเร็จ: ' + err.message); }
  };

  const handleDelete = async (shopId, shopName) => {
    if (!confirm(`⚠️ ยืนยันลบร้าน "${shopName}"?\nข้อมูลทั้งหมดจะถูกลบและกู้คืนไม่ได้`)) return;
    try {
      await callUpdate('delete_shop', shopId);
      setShops(prev => prev.filter(s => s.id !== shopId));
    } catch (err) { alert('ลบไม่สำเร็จ: ' + err.message); }
  };

  const getCredit = (shop) => {
    const c = shop.shop_credits;
    if (Array.isArray(c)) return c[0]?.balance_credits ?? 0;
    return c?.balance_credits ?? 0;
  };

  const filteredShops = shops.filter(s => {
    const matchSearch = !searchTerm ||
      s.shop_name?.toLowerCase().includes(searchTerm.toLowerCase()) ||
      s.email?.toLowerCase().includes(searchTerm.toLowerCase()) ||
      s.phone?.includes(searchTerm) ||
      s.owner_line_id?.includes(searchTerm);
    const matchTier = filterTier === 'all' || s.subscription_tier === filterTier;
    return matchSearch && matchTier;
  });

  const stats = {
    total: shops.length,
    normal: shops.filter(s => (s.subscription_tier || 'normal') === 'normal').length,
    pro: shops.filter(s => s.subscription_tier === 'pro').length,
    advance: shops.filter(s => s.subscription_tier === 'advance').length,
    super: shops.filter(s => s.subscription_tier === 'super').length,
    totalCredits: shops.reduce((sum, s) => sum + getCredit(s), 0),
  };

  // ── LOGIN SCREEN ──
  if (!isAdmin) return (
    <div className="min-h-screen bg-slate-950 flex items-center justify-center p-6 font-sans">
      <Head><title>Admin | Smile Slip Pro</title></Head>
      <div className="max-w-sm w-full bg-slate-900 p-10 rounded-3xl shadow-2xl border border-slate-800">
        <div className="absolute top-0 left-0 w-full h-1 bg-gradient-to-r from-blue-600 to-indigo-600 rounded-t-3xl"/>
        <div className="flex justify-center mb-6">
          <div className="w-16 h-16 bg-slate-950 rounded-2xl flex items-center justify-center border border-slate-700">
            <KeyRound size={28} className="text-indigo-400"/>
          </div>
        </div>
        <h1 className="text-2xl font-black text-white text-center mb-1">SMILE SLIP <span className="text-indigo-400">ADMIN</span></h1>
        <p className="text-slate-500 text-center text-xs mb-8 uppercase tracking-widest">Authorized Personnel Only</p>

        {loginError && (
          <div className="bg-rose-500/10 border border-rose-500/30 text-rose-400 text-sm font-bold p-3 rounded-xl mb-5 text-center">
            {loginError}
          </div>
        )}

        <form onSubmit={handleLogin} className="space-y-4">
          <div>
            <label className="text-[10px] font-black text-slate-500 uppercase tracking-widest mb-2 block">Admin Password</label>
            <div className="relative">
              <input
                type={showPw ? 'text' : 'password'} required
                className="w-full bg-slate-950 border border-slate-700 rounded-xl py-3.5 px-5 text-white outline-none focus:border-indigo-500 transition-colors pr-12"
                placeholder="••••••••"
                value={password} onChange={e => setPassword(e.target.value)}
              />
              <button type="button" onClick={() => setShowPw(!showPw)}
                className="absolute right-4 top-3.5 text-slate-500 hover:text-white transition-colors">
                {showPw ? <EyeOff size={17}/> : <Eye size={17}/>}
              </button>
            </div>
          </div>
          <button type="submit" disabled={loginLoading}
            className="w-full bg-indigo-600 hover:bg-indigo-700 text-white font-black py-3.5 rounded-xl transition-colors disabled:opacity-50">
            {loginLoading ? 'กำลังตรวจสอบ...' : 'เข้าสู่ระบบ Admin'}
          </button>
        </form>
      </div>
    </div>
  );

  // ── ADMIN DASHBOARD ──
  return (
    <div className="min-h-screen bg-slate-950 text-white font-sans">
      <Head><title>Admin Panel | Smile Slip Pro</title></Head>

      {/* Navbar */}
      <nav className="bg-slate-900 border-b border-slate-800 px-8 h-14 flex items-center justify-between sticky top-0 z-50">
        <div className="flex items-center gap-3">
          <ShieldCheck size={20} className="text-indigo-400"/>
          <span className="font-black text-sm tracking-tight">SMILE SLIP <span className="text-indigo-400">ADMIN</span></span>
        </div>
        <div className="flex items-center gap-3">
          <button onClick={fetchData} className="p-2 text-slate-500 hover:text-white transition-colors" title="รีเฟรช">
            <RefreshCcw size={16}/>
          </button>
          <button onClick={handleLogout}
            className="flex items-center gap-1.5 px-3 py-2 text-rose-400 hover:bg-rose-500/10 rounded-xl text-xs font-bold transition-all">
            <LogOut size={14}/> ออกจากระบบ
          </button>
        </div>
      </nav>

      <div className="p-8 max-w-7xl mx-auto space-y-8">

        {/* Stats */}
        <div className="grid grid-cols-2 md:grid-cols-6 gap-4">
          {[
            { label: 'ร้านค้าทั้งหมด', value: stats.total, icon: <Users size={18}/>, color: 'text-white' },
            { label: 'Normal', value: stats.normal, icon: <CreditCard size={18}/>, color: 'text-slate-400' },
            { label: 'Pro', value: stats.pro, icon: <CreditCard size={18}/>, color: 'text-amber-400' },
            { label: 'Advance', value: stats.advance, icon: <CreditCard size={18}/>, color: 'text-indigo-400' },
            { label: 'Super', value: stats.super, icon: <CreditCard size={18}/>, color: 'text-emerald-400' },
            { label: 'เครดิตรวม', value: stats.totalCredits.toLocaleString(), icon: <TrendingUp size={18}/>, color: 'text-blue-400' },
          ].map((s, i) => (
            <div key={i} className="bg-slate-900 border border-slate-800 rounded-2xl p-4">
              <div className={`${s.color} mb-1`}>{s.icon}</div>
              <p className="text-2xl font-black text-white">{s.value}</p>
              <p className="text-[10px] text-slate-500 uppercase tracking-widest mt-0.5">{s.label}</p>
            </div>
          ))}
        </div>

        {/* Search + Filter */}
        <div className="flex flex-col sm:flex-row gap-3">
          <div className="relative flex-1">
            <Search className="absolute left-4 top-3 text-slate-500" size={17}/>
            <input
              placeholder="ค้นหา ชื่อร้าน, อีเมล, เบอร์, LINE ID..."
              className="w-full bg-slate-900 border border-slate-800 rounded-xl py-3 pl-11 pr-5 text-white outline-none focus:border-indigo-500 transition-colors text-sm"
              value={searchTerm} onChange={e => setSearchTerm(e.target.value)}
            />
          </div>
          <select
            className="bg-slate-900 border border-slate-800 rounded-xl px-4 py-3 text-sm text-white outline-none focus:border-indigo-500 transition-colors cursor-pointer"
            value={filterTier} onChange={e => setFilterTier(e.target.value)}>
            <option value="all">ทุก Tier</option>
            {TIERS.map(t => <option key={t} value={t}>{t.charAt(0).toUpperCase() + t.slice(1)}</option>)}
          </select>
        </div>

        {/* Table */}
        <div className="bg-slate-900 border border-slate-800 rounded-3xl overflow-hidden">
          <div className="px-6 py-4 border-b border-slate-800 flex items-center justify-between">
            <h2 className="font-black text-sm uppercase tracking-widest text-slate-400">
              ร้านค้าทั้งหมด ({filteredShops.length})
            </h2>
            {loading && <RefreshCcw size={14} className="text-slate-500 animate-spin"/>}
          </div>

          <div className="divide-y divide-slate-800/50">
            {filteredShops.length === 0 ? (
              <div className="py-20 text-center text-slate-600 font-bold">ไม่พบข้อมูล</div>
            ) : filteredShops.map((shop) => {
              const credit = getCredit(shop);
              const isExpanded = expandedId === shop.id;
              const tier = shop.subscription_tier || 'normal';
              const googleEmail = Array.isArray(shop.shop_google_configs)
                ? shop.shop_google_configs[0]?.google_email
                : shop.shop_google_configs?.google_email;
              const branchCount = Array.isArray(shop.shop_branches) ? shop.shop_branches.length : 0;

              return (
                <div key={shop.id}>
                  {/* Row */}
                  <div className="px-6 py-4 hover:bg-slate-800/30 transition-all">
                    <div className="flex items-center justify-between gap-4">
                      {/* Shop info */}
                      <div className="flex items-center gap-4 min-w-0">
                        <button onClick={() => setExpandedId(isExpanded ? null : shop.id)}
                          className="shrink-0 w-8 h-8 rounded-lg bg-slate-800 flex items-center justify-center text-slate-400 hover:text-white transition-all">
                          <ChevronDown size={14} className={`transition-transform ${isExpanded ? 'rotate-180' : ''}`}/>
                        </button>
                        <div className="min-w-0">
                          <p className="font-black text-white truncate">{shop.shop_name}</p>
                          <p className="text-[10px] text-slate-500 truncate">{shop.email} · {shop.phone}</p>
                        </div>
                      </div>

                      {/* Controls */}
                      <div className="flex items-center gap-3 shrink-0">
                        {/* Tier Selector */}
                        {editTier[shop.id] !== undefined ? (
                          <div className="flex items-center gap-1">
                            <select value={editTier[shop.id]}
                              onChange={e => setEditTier(prev => ({ ...prev, [shop.id]: e.target.value }))}
                              className="bg-slate-800 border border-slate-700 text-white text-xs rounded-lg px-2 py-1.5 outline-none">
                              {TIERS.map(t => <option key={t} value={t}>{t}</option>)}
                            </select>
                            <button onClick={() => handleTierChange(shop.id, editTier[shop.id])}
                              className="p-1.5 bg-emerald-500/20 text-emerald-400 hover:bg-emerald-500 hover:text-white rounded-lg transition-all">
                              <Check size={13}/>
                            </button>
                            <button onClick={() => setEditTier(prev => { const n={...prev}; delete n[shop.id]; return n; })}
                              className="p-1.5 bg-slate-700 text-slate-400 hover:bg-rose-500 hover:text-white rounded-lg transition-all">
                              <X size={13}/>
                            </button>
                          </div>
                        ) : (
                          <button onClick={() => setEditTier(prev => ({ ...prev, [shop.id]: tier }))}
                            className={`text-[10px] font-black px-3 py-1.5 rounded-lg uppercase tracking-wider ${TIER_COLOR[tier]} hover:opacity-80 transition-all flex items-center gap-1`}>
                            {tier} <Edit3 size={10}/>
                          </button>
                        )}

                        {/* Credit */}
                        <div className="flex items-center gap-1">
                          {editCredit[shop.id] !== undefined ? (
                            <>
                              <input type="number"
                                className="w-20 bg-slate-800 border border-slate-700 text-white text-xs rounded-lg px-2 py-1.5 outline-none text-center"
                                placeholder="จำนวน"
                                value={editCredit[shop.id]}
                                onChange={e => setEditCredit(prev => ({ ...prev, [shop.id]: e.target.value }))}/>
                              <button onClick={() => handleCreditAction(shop.id, 'add_credits', credit)}
                                className="p-1.5 bg-emerald-500/20 text-emerald-400 hover:bg-emerald-500 hover:text-white rounded-lg transition-all" title="เติม">
                                <PlusCircle size={13}/>
                              </button>
                              <button onClick={() => handleCreditAction(shop.id, 'set_credits', credit)}
                                className="p-1.5 bg-blue-500/20 text-blue-400 hover:bg-blue-500 hover:text-white rounded-lg transition-all" title="ตั้งค่า">
                                <Check size={13}/>
                              </button>
                              <button onClick={() => setEditCredit(prev => { const n={...prev}; delete n[shop.id]; return n; })}
                                className="p-1.5 bg-slate-700 text-slate-400 hover:bg-rose-500 hover:text-white rounded-lg transition-all">
                                <X size={13}/>
                              </button>
                            </>
                          ) : (
                            <button onClick={() => setEditCredit(prev => ({ ...prev, [shop.id]: '' }))}
                              className="flex items-center gap-1.5 bg-indigo-500/10 border border-indigo-500/20 text-indigo-400 hover:bg-indigo-500 hover:text-white px-3 py-1.5 rounded-lg text-xs font-black transition-all">
                              <CreditCard size={12}/> {credit.toLocaleString()}
                            </button>
                          )}
                        </div>

                        {/* Delete */}
                        <button onClick={() => handleDelete(shop.id, shop.shop_name)}
                          className="p-2 text-slate-600 hover:text-rose-400 hover:bg-rose-500/10 rounded-lg transition-all">
                          <Trash2 size={15}/>
                        </button>
                      </div>
                    </div>
                  </div>

                  {/* Expanded Detail */}
                  {isExpanded && (
                    <div className="px-16 pb-5 bg-slate-900/50 border-t border-slate-800/50">
                      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 pt-4 text-xs">
                        <div>
                          <p className="text-slate-500 uppercase tracking-widest text-[9px] mb-1">LINE ID</p>
                          <p className="text-white font-mono break-all">{shop.owner_line_id}</p>
                        </div>
                        <div>
                          <p className="text-slate-500 uppercase tracking-widest text-[9px] mb-1">Shop ID</p>
                          <p className="text-slate-400 font-mono break-all">{shop.id}</p>
                        </div>
                        <div>
                          <p className="text-slate-500 uppercase tracking-widest text-[9px] mb-1">Google Sync</p>
                          <p className={googleEmail ? 'text-emerald-400 font-bold' : 'text-slate-600'}>
                            {googleEmail || 'ยังไม่เชื่อมต่อ'}
                          </p>
                        </div>
                        <div>
                          <p className="text-slate-500 uppercase tracking-widest text-[9px] mb-1">ที่อยู่</p>
                          <p className="text-slate-400">{shop.address || '-'}</p>
                        </div>
                        <div>
                          <p className="text-slate-500 uppercase tracking-widest text-[9px] mb-1">สาขา</p>
                          <p className="text-white font-bold">{branchCount} สาขา</p>
                        </div>
                        <div>
                          <p className="text-slate-500 uppercase tracking-widest text-[9px] mb-1">เลขภาษี</p>
                          <p className="text-white font-mono">{shop.tax_id || '-'}</p>
                        </div>
                        <div>
                          <p className="text-slate-500 uppercase tracking-widest text-[9px] mb-1">ประเภท</p>
                          <p className="text-white">{shop.user_type || '-'}</p>
                        </div>
                        <div>
                          <p className="text-slate-500 uppercase tracking-widest text-[9px] mb-1">วันที่สมัคร</p>
                          <p className="text-slate-400">{shop.created_at ? new Date(shop.created_at).toLocaleDateString('th-TH') : '-'}</p>
                        </div>
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}
