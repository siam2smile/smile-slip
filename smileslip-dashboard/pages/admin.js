import React, { useState, useEffect, useRef } from 'react';
import Head from 'next/head';
import {
  Users, Trash2, Search, ShieldCheck, LogOut, KeyRound,
  TrendingUp, CreditCard, RefreshCcw, ChevronDown, Eye, EyeOff,
  Edit3, Check, X, PlusCircle, Shield, UserX, UserPlus, Zap,
  Building2, Phone, Mail, MapPin, Calendar, Copy, CheckCircle2,
  FileText, Printer, Send, Settings, Link, ExternalLink
} from 'lucide-react';

const TIERS = ['normal', 'pro', 'advance', 'business', 'enterprise'];
const TIERS_WITH_LEGACY = [...TIERS, 'super']; // สำหรับ display เท่านั้น
const TIER_COLOR = {
  normal:     'bg-slate-700 text-slate-300',
  pro:        'bg-amber-900/60 text-amber-400',
  advance:    'bg-indigo-900/60 text-indigo-400',
  business:   'bg-emerald-900/60 text-emerald-400',
  enterprise: 'bg-violet-900/60 text-violet-400',
  super:      'bg-violet-900/60 text-violet-300',
};
const TIER_CREDITS = { normal: 0, pro: 200, advance: 500, business: 1000, enterprise: 0, super: 0 };

export default function AdminDashboard() {
  const [isAdmin, setIsAdmin] = useState(false);
  const [loginEmail, setLoginEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPw, setShowPw] = useState(false);
  const [loginError, setLoginError] = useState('');
  const [loginLoading, setLoginLoading] = useState(false);
  const tokenRef = useRef('');

  // ── Multi-admin identity (2026-07-20) ──
  const [currentAdmin, setCurrentAdmin] = useState(null); // { id, email, display_name, role } — null ถ้าเข้าด้วยรหัสฉุกเฉิน
  const [isLegacyAdmin, setIsLegacyAdmin] = useState(false);
  const [needsBootstrap, setNeedsBootstrap] = useState(false);
  const [bootstrapForm, setBootstrapForm] = useState({ email: '', password: '', display_name: '' });
  const [bootstrapSaving, setBootstrapSaving] = useState(false);
  const [bootstrapError, setBootstrapError] = useState('');
  const [companyAdmins, setCompanyAdmins] = useState([]);
  const [companyAdminsLoading, setCompanyAdminsLoading] = useState(false);
  const [showAddCompanyAdmin, setShowAddCompanyAdmin] = useState(false);
  const [newCompanyAdminForm, setNewCompanyAdminForm] = useState({ email: '', password: '', display_name: '', role: 'staff' });
  const [newCompanyAdminSaving, setNewCompanyAdminSaving] = useState(false);
  const [myPasswordForm, setMyPasswordForm] = useState({ current_password: '', new_password: '' });
  const [myPasswordSaving, setMyPasswordSaving] = useState(false);

  const [shops, setShops] = useState([]);
  const [loading, setLoading] = useState(false);
  const [searchTerm, setSearchTerm] = useState('');
  const [filterTier, setFilterTier] = useState('all');
  const [expandedId, setExpandedId] = useState(null);
  const [activeTab, setActiveTab] = useState('shops');

  // invoice
  const [invoices, setInvoices] = useState([]);
  const [invoiceFilter, setInvoiceFilter] = useState('pending');
  const [issuingId, setIssuingId] = useState(null);
  const [printInvoice, setPrintInvoice] = useState(null);

  // admin google settings
  const [adminGoogleEmail, setAdminGoogleEmail] = useState(null);
  const [adminSheetId, setAdminSheetId] = useState(null);
  const [loadingSettings, setLoadingSettings] = useState(false);

  // promotion
  const [promotion, setPromotion] = useState(null);
  const [promoForm, setPromoForm] = useState({ title: '', badgeText: '', discountPercent: '', validUntil: '' });
  const [savingPromo, setSavingPromo] = useState(false);

  // testimonials
  const [testimonials, setTestimonials] = useState([]);

  // inline edit
  const [editCredit, setEditCredit] = useState({});
  const [editTier, setEditTier] = useState({});
  const [editExpiry, setEditExpiry] = useState({}); // { [shopId]: 'YYYY-MM-DD' }
  const [addAdminForm, setAddAdminForm] = useState({});
  const [editProfile, setEditProfile] = useState({}); // { [shopId]: { shopName, email, phone, taxId, address, userType } }
  const [copiedId, setCopiedId] = useState(null);
  const [deliveryStats, setDeliveryStats] = useState({ total: 0, pending: 0, assigned: 0, delivered: 0, paid: 0, today: 0 });

  useEffect(() => {
    const token = sessionStorage.getItem('admin_token');
    if (token) {
      tokenRef.current = token; setIsAdmin(true);
      let identity = {};
      try { identity = JSON.parse(sessionStorage.getItem('admin_identity') || '{}'); } catch {}
      setCurrentAdmin(identity.admin || null);
      setIsLegacyAdmin(!!identity.legacy);
      fetchData(token); fetchInvoices(token); fetchAdminSettings(token); fetchPromotion(token); fetchTestimonials(token); fetchDeliveryStats(token);
      if (identity.admin?.role === 'owner') fetchCompanyAdmins(token);
    }

    // ตรวจสอบ query param หลัง Google OAuth callback
    const params = new URLSearchParams(window.location.search);
    if (params.get('google') === 'connected') {
      const cleanUrl = window.location.pathname + (params.get('tab') ? `?tab=${params.get('tab')}` : '');
      window.history.replaceState({}, '', cleanUrl);
      if (params.get('tab') === 'settings') setActiveTab('settings');
    }
    if (params.get('error')) {
      alert('Google Connect ล้มเหลว: ' + params.get('error'));
      window.history.replaceState({}, '', window.location.pathname);
    }
  }, []);

  const adminHeader = () => ({ 'Content-Type': 'application/json', 'x-admin-token': tokenRef.current });

  // ── Delivery Stats ──
  const fetchDeliveryStats = async (token) => {
    try {
      const res = await fetch('/api/admin/delivery-stats', { headers: { 'x-admin-token': token || tokenRef.current } });
      if (res.ok) { const d = await res.json(); setDeliveryStats(d.stats || {}); }
    } catch {}
  };

  // ── Admin Settings (Google) ──
  const fetchAdminSettings = async (token) => {
    setLoadingSettings(true);
    try {
      const res = await fetch('/api/admin/settings', { headers: { 'x-admin-token': token || tokenRef.current } });
      if (res.ok) {
        const data = await res.json();
        setAdminGoogleEmail(data.google_email || null);
        setAdminSheetId(data.invoice_sheet_id || null);
      }
    } catch {}
    setLoadingSettings(false);
  };

  // ── Promotion ──
  const fetchPromotion = async (token) => {
    try {
      const res = await fetch('/api/admin/promotion', { headers: { 'x-admin-token': token || tokenRef.current } });
      if (res.ok) {
        const data = await res.json();
        setPromotion(data.promotion?.enabled ? data.promotion : null);
        if (data.promotion?.enabled) {
          setPromoForm({
            title: data.promotion.title || '', badgeText: data.promotion.badgeText || '',
            discountPercent: data.promotion.discountPercent || '', validUntil: data.promotion.validUntil || '',
          });
        }
      }
    } catch {}
  };

  const handleSavePromotion = async () => {
    if (!promoForm.title || !promoForm.discountPercent) return alert('กรอกชื่อโปรและ % ส่วนลดก่อนครับ');
    setSavingPromo(true);
    try {
      const res = await fetch('/api/admin/promotion', {
        method: 'POST', headers: adminHeader(),
        body: JSON.stringify({ enabled: true, ...promoForm }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      setPromotion(data.promotion);
      alert('✅ เปิดโปรโมชั่นแล้ว แสดงในหน้าเว็บทันที');
    } catch (err) { alert('ไม่สำเร็จ: ' + err.message); }
    setSavingPromo(false);
  };

  const handleDisablePromotion = async () => {
    if (!confirm('ปิดโปรโมชั่นนี้?')) return;
    setSavingPromo(true);
    try {
      const res = await fetch('/api/admin/promotion', {
        method: 'POST', headers: adminHeader(),
        body: JSON.stringify({ enabled: false }),
      });
      if (res.ok) { setPromotion(null); }
    } catch {}
    setSavingPromo(false);
  };

  // ── Testimonials ──
  const fetchTestimonials = async (token) => {
    try {
      const res = await fetch('/api/admin/testimonials', { headers: { 'x-admin-token': token || tokenRef.current } });
      if (res.ok) { const data = await res.json(); setTestimonials(data.testimonials || []); }
    } catch {}
  };

  const handleToggleTestimonial = async (id, hidden) => {
    const res = await fetch('/api/admin/testimonials', {
      method: 'PATCH', headers: adminHeader(),
      body: JSON.stringify({ id, hidden }),
    });
    if (res.ok) await fetchTestimonials();
  };

  // ── Invoices ──
  const fetchInvoices = async (token) => {
    const res = await fetch(`/api/admin/invoices?status=all`, { headers: { 'x-admin-token': token || tokenRef.current } });
    const data = await res.json();
    if (res.ok) setInvoices(data.invoices || []);
  };

  const handleIssue = async (inv) => {
    if (!confirm(`ออกใบกำกับภาษีให้ "${inv.buyer_name}"?\nเลขจะถูกกำหนดอัตโนมัติ`)) return;
    setIssuingId(inv.id);
    try {
      const res = await fetch('/api/admin/invoices', {
        method: 'PATCH', headers: adminHeader(),
        body: JSON.stringify({ id: inv.id, action: 'issue' }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      await fetchInvoices();
      alert(`✅ ออกใบกำกับภาษีแล้ว เลขที่: ${data.taxInvoiceNo}`);
    } catch (err) { alert('ไม่สำเร็จ: ' + err.message); }
    setIssuingId(null);
  };

  const handleInvoiceStatus = async (id, action) => {
    const res = await fetch('/api/admin/invoices', {
      method: 'PATCH', headers: adminHeader(),
      body: JSON.stringify({ id, action }),
    });
    if (res.ok) await fetchInvoices();
  };

  const fmt = (n) => Number(n).toLocaleString('th-TH', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

  // ── Login ──
  const handleLogin = async (e) => {
    e.preventDefault();
    setLoginLoading(true); setLoginError('');
    try {
      const res = await fetch('/api/admin/login', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: loginEmail.trim() || undefined, password }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      sessionStorage.setItem('admin_token', data.token);
      sessionStorage.setItem('admin_identity', JSON.stringify({ admin: data.admin || null, legacy: !!data.legacy }));
      tokenRef.current = data.token;
      setIsAdmin(true);
      setCurrentAdmin(data.admin || null);
      setIsLegacyAdmin(!!data.legacy);
      setNeedsBootstrap(!!data.needsBootstrap);
      fetchData(data.token);
      fetchInvoices(data.token);
      fetchAdminSettings(data.token);
      fetchPromotion(data.token);
      fetchTestimonials(data.token);
      if (data.admin?.role === 'owner') fetchCompanyAdmins(data.token);
    } catch (err) { setLoginError(err.message); }
    setLoginLoading(false);
  };

  const handleLogout = () => {
    sessionStorage.removeItem('admin_token');
    sessionStorage.removeItem('admin_identity');
    tokenRef.current = '';
    setIsAdmin(false); setShops([]);
    setCurrentAdmin(null); setIsLegacyAdmin(false); setNeedsBootstrap(false); setCompanyAdmins([]);
  };

  // ── Multi-admin management (2026-07-20) ──
  const fetchCompanyAdmins = async (token) => {
    setCompanyAdminsLoading(true);
    try {
      const res = await fetch('/api/admin/admins', { headers: { 'x-admin-token': token || tokenRef.current } });
      const d = await res.json();
      if (res.ok) setCompanyAdmins(d.admins || []);
    } catch {}
    setCompanyAdminsLoading(false);
  };

  const handleBootstrap = async (e) => {
    e.preventDefault();
    setBootstrapSaving(true); setBootstrapError('');
    try {
      const res = await fetch('/api/admin/admins', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...bootstrapForm, bootstrapPassword: password }),
      });
      const d = await res.json();
      if (!res.ok) throw new Error(d.error);
      alert('ตั้งบัญชีเจ้าของระบบสำเร็จแล้ว! กรุณาเข้าสู่ระบบใหม่ด้วยอีเมล/รหัสผ่านที่เพิ่งตั้งไว้');
      handleLogout();
    } catch (err) { setBootstrapError(err.message); }
    setBootstrapSaving(false);
  };

  const handleAddCompanyAdmin = async (e) => {
    e.preventDefault();
    setNewCompanyAdminSaving(true);
    try {
      const res = await fetch('/api/admin/admins', { method: 'POST', headers: adminHeader(), body: JSON.stringify(newCompanyAdminForm) });
      const d = await res.json();
      if (!res.ok) throw new Error(d.error);
      setShowAddCompanyAdmin(false);
      setNewCompanyAdminForm({ email: '', password: '', display_name: '', role: 'staff' });
      fetchCompanyAdmins();
    } catch (err) { alert(err.message); }
    setNewCompanyAdminSaving(false);
  };

  const updateCompanyAdmin = async (id, patch) => {
    try {
      const res = await fetch('/api/admin/admins', { method: 'PATCH', headers: adminHeader(), body: JSON.stringify({ id, ...patch }) });
      const d = await res.json();
      if (!res.ok) throw new Error(d.error);
      fetchCompanyAdmins();
      return true;
    } catch (err) { alert(err.message); return false; }
  };

  const handleChangeMyPassword = async (e) => {
    e.preventDefault();
    if (!currentAdmin) return;
    setMyPasswordSaving(true);
    try {
      const ok = await updateCompanyAdmin(currentAdmin.id, myPasswordForm);
      if (ok) { alert('เปลี่ยนรหัสผ่านสำเร็จ'); setMyPasswordForm({ current_password: '', new_password: '' }); }
    } finally { setMyPasswordSaving(false); }
  };

  // ── Fetch data ──
  const fetchData = async (token) => {
    setLoading(true);
    try {
      const res = await fetch('/api/admin/shops', {
        headers: { 'x-admin-token': token || tokenRef.current }
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'โหลดไม่สำเร็จ');
      setShops(data.shops || []);
    } catch (err) { alert('โหลดข้อมูลไม่สำเร็จ: ' + err.message); }
    setLoading(false);
  };

  // ── Helpers ──
  const callUpdate = async (body) => {
    const res = await fetch('/api/admin/update-shop', {
      method: 'POST', headers: adminHeader(), body: JSON.stringify(body),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error);
    return data;
  };

  const getCredit = (shop) => {
    const c = shop.shop_credits;
    if (Array.isArray(c)) return c[0]?.balance_credits ?? 0;
    return c?.balance_credits ?? 0;
  };

  const patchShop = (shopId, updates) =>
    setShops(prev => prev.map(s => s.id === shopId ? { ...s, ...updates } : s));

  const copyToClipboard = (text, id) => {
    navigator.clipboard.writeText(text).then(() => {
      setCopiedId(id); setTimeout(() => setCopiedId(null), 1500);
    });
  };

  // ── Tier ──
  const handleTierChange = async (shopId, newTier) => {
    const expiresAtRaw = editExpiry[shopId];
    const expiresAt = expiresAtRaw ? new Date(expiresAtRaw + 'T23:59:59').toISOString() : null;
    try {
      await callUpdate({ action: 'update_tier', shopId, value: newTier, expiresAt });
      patchShop(shopId, { subscription_tier: newTier, subscription_expires_at: expiresAt });
      setEditTier(p => { const n = { ...p }; delete n[shopId]; return n; });
      setEditExpiry(p => { const n = { ...p }; delete n[shopId]; return n; });
    } catch (err) { alert('แก้ไขไม่สำเร็จ: ' + err.message); }
  };

  const handleManualAssign = async (shopId, newTier, currentCredits) => {
    const expiresAtRaw = editExpiry[shopId];
    const expiresAt = expiresAtRaw ? new Date(expiresAtRaw + 'T23:59:59').toISOString() : null;
    const expiryNote = expiresAt ? `\nวันหมดอายุ: ${new Date(expiresAt).toLocaleDateString('th-TH')}` : '\n⚠️ ไม่ได้ตั้งวันหมดอายุ — แพ็กเกจนี้จะไม่หมดอายุอัตโนมัติ';
    if (!confirm(`ยืนยันกำหนด "${newTier}" พร้อมเติมเครดิต ${TIER_CREDITS[newTier] || 0} ใบให้ร้านนี้?\n(สำหรับลูกค้าที่จ่ายผ่านบัญชีบริษัท)${expiryNote}`)) return;
    try {
      const result = await callUpdate({ action: 'manual_assign_tier', shopId, value: newTier, currentCredits, expiresAt });
      patchShop(shopId, {
        subscription_tier: newTier,
        subscription_expires_at: expiresAt,
        shop_credits: [{ balance_credits: result.newTotal ?? currentCredits }]
      });
      setEditTier(p => { const n = { ...p }; delete n[shopId]; return n; });
      setEditExpiry(p => { const n = { ...p }; delete n[shopId]; return n; });
      alert(`✅ กำหนด ${newTier} สำเร็จ${result.creditsAdded > 0 ? ` เติม +${result.creditsAdded} เครดิต` : ''}`);
    } catch (err) { alert('ไม่สำเร็จ: ' + err.message); }
  };

  // ── Edit Profile ──
  const openEditProfile = (shop) => {
    setEditProfile(p => ({ ...p, [shop.id]: {
      shopName: shop.shop_name || '',
      email:    shop.email || '',
      phone:    shop.phone || '',
      taxId:    shop.tax_id || '',
      address:  shop.address || '',
      userType: shop.user_type || 'individual',
    }}));
  };

  const handleProfileSave = async (shopId) => {
    const form = editProfile[shopId];
    if (!form) return;
    try {
      await callUpdate({ action: 'update_profile', shopId, ...form });
      patchShop(shopId, {
        shop_name: form.shopName, email: form.email, phone: form.phone,
        tax_id: form.taxId, address: form.address, user_type: form.userType,
      });
      setEditProfile(p => { const n = { ...p }; delete n[shopId]; return n; });
    } catch (err) { alert('บันทึกไม่สำเร็จ: ' + err.message); }
  };

  // ── Credits ──
  const handleCreditAction = async (shopId, action, currentCredits) => {
    const val = editCredit[shopId];
    if (!val || isNaN(val)) return alert('กรอกจำนวนให้ถูกต้อง');
    try {
      const result = await callUpdate({ action, shopId, value: val, currentCredits });
      patchShop(shopId, { shop_credits: [{ balance_credits: result.newTotal }] });
      setEditCredit(p => { const n = { ...p }; delete n[shopId]; return n; });
    } catch (err) { alert('ไม่สำเร็จ: ' + err.message); }
  };

  // ── Shop Admin ──
  const handleAddShopAdmin = async (shopId) => {
    const form = addAdminForm[shopId] || {};
    if (!form.lineUserId?.trim()) return alert('กรอก LINE User ID');
    try {
      await callUpdate({ action: 'add_shop_admin', shopId, lineUserId: form.lineUserId.trim(), displayName: form.displayName || '' });
      await fetchData();
      setAddAdminForm(p => { const n = { ...p }; delete n[shopId]; return n; });
    } catch (err) { alert('ไม่สำเร็จ: ' + err.message); }
  };

  const handleRemoveShopAdmin = async (shopId, adminRowId, name) => {
    if (!confirm(`ลบแอดมิน "${name}"?`)) return;
    try {
      await callUpdate({ action: 'remove_shop_admin', shopId, adminRowId });
      setShops(prev => prev.map(s => s.id === shopId
        ? { ...s, shop_admins: (s.shop_admins || []).filter(a => a.id !== adminRowId) }
        : s
      ));
    } catch (err) { alert('ไม่สำเร็จ: ' + err.message); }
  };

  // ── Delete ──
  const handleDelete = async (shopId, shopName) => {
    if (!confirm(`⚠️ ลบร้าน "${shopName}" ?\nข้อมูลทั้งหมดจะถูกลบถาวร`)) return;
    try {
      await callUpdate({ action: 'delete_shop', shopId });
      setShops(prev => prev.filter(s => s.id !== shopId));
    } catch (err) { alert('ลบไม่สำเร็จ: ' + err.message); }
  };

  // ── Filter / Stats ──
  const filteredShops = shops.filter(s => {
    const q = searchTerm.toLowerCase();
    const match = !q || s.shop_name?.toLowerCase().includes(q) ||
      s.email?.toLowerCase().includes(q) || s.phone?.includes(q) ||
      s.owner_line_id?.includes(q);
    const tier = filterTier === 'all' || s.subscription_tier === filterTier;
    return match && tier;
  });

  const stats = {
    total: shops.length,
    normal:     shops.filter(s => !s.subscription_tier || s.subscription_tier === 'normal').length,
    pro:        shops.filter(s => s.subscription_tier === 'pro').length,
    advance:    shops.filter(s => s.subscription_tier === 'advance').length,
    business:   shops.filter(s => s.subscription_tier === 'business').length,
    enterprise: shops.filter(s => ['enterprise','super'].includes(s.subscription_tier)).length,
    totalCredits: shops.reduce((sum, s) => sum + getCredit(s), 0),
  };

  // ════ LOGIN ════
  if (!isAdmin) return (
    <div className="min-h-screen bg-slate-950 flex items-center justify-center p-6 font-sans">
      <Head><title>Admin | Smile Slip Pro</title></Head>
      <div className="max-w-sm w-full bg-slate-900 p-10 rounded-3xl shadow-2xl border border-slate-800 relative">
        <div className="absolute top-0 left-0 right-0 h-1 bg-gradient-to-r from-blue-600 to-indigo-600 rounded-t-3xl"/>
        <div className="flex justify-center mb-6">
          <div className="w-16 h-16 bg-slate-950 rounded-2xl flex items-center justify-center border border-slate-700">
            <KeyRound size={28} className="text-indigo-400"/>
          </div>
        </div>
        <h1 className="text-2xl font-black text-white text-center mb-1">SMILE SLIP <span className="text-indigo-400">ADMIN</span></h1>
        <p className="text-slate-500 text-center text-xs mb-8 uppercase tracking-widest">Authorized Personnel Only</p>
        {loginError && <div className="bg-rose-500/10 border border-rose-500/30 text-rose-400 text-sm font-bold p-3 rounded-xl mb-5 text-center">{loginError}</div>}
        <form onSubmit={handleLogin} className="space-y-4">
          <input type="email" placeholder="อีเมลแอดมิน (เว้นว่างถ้าใช้รหัสฉุกเฉิน)"
            className="w-full bg-slate-950 border border-slate-700 rounded-xl py-3.5 px-5 text-white outline-none focus:border-indigo-500 transition-colors"
            value={loginEmail} onChange={e => setLoginEmail(e.target.value)}/>
          <div className="relative">
            <input type={showPw ? 'text' : 'password'} required placeholder="รหัสผ่าน"
              className="w-full bg-slate-950 border border-slate-700 rounded-xl py-3.5 px-5 text-white outline-none focus:border-indigo-500 transition-colors pr-12"
              value={password} onChange={e => setPassword(e.target.value)}/>
            <button type="button" onClick={() => setShowPw(!showPw)}
              className="absolute right-4 top-3.5 text-slate-500 hover:text-white transition-colors">
              {showPw ? <EyeOff size={17}/> : <Eye size={17}/>}
            </button>
          </div>
          <button type="submit" disabled={loginLoading}
            className="w-full bg-indigo-600 hover:bg-indigo-700 text-white font-black py-3.5 rounded-xl transition-colors disabled:opacity-50">
            {loginLoading ? 'กำลังตรวจสอบ...' : 'เข้าสู่ระบบ'}
          </button>
          <p className="text-slate-600 text-[11px] text-center">เว้นช่องอีเมลว่างไว้ = เข้าด้วยรหัสผ่านฉุกเฉินของทั้งบริษัท</p>
        </form>
      </div>
    </div>
  );

  // ════ BOOTSTRAP: ตั้งบัญชีเจ้าของระบบคนแรก (เข้าด้วยรหัสฉุกเฉินแต่ยังไม่มีบัญชีแอดมินส่วนตัวเลย) ════
  if (needsBootstrap) return (
    <div className="min-h-screen bg-slate-950 flex items-center justify-center p-6 font-sans">
      <Head><title>ตั้งค่าบัญชีแอดมินคนแรก | Smile Slip Pro</title></Head>
      <div className="max-w-sm w-full bg-slate-900 p-10 rounded-3xl shadow-2xl border border-slate-800 relative">
        <div className="absolute top-0 left-0 right-0 h-1 bg-gradient-to-r from-emerald-600 to-teal-600 rounded-t-3xl"/>
        <div className="flex justify-center mb-6">
          <div className="w-16 h-16 bg-slate-950 rounded-2xl flex items-center justify-center border border-slate-700">
            <ShieldCheck size={28} className="text-emerald-400"/>
          </div>
        </div>
        <h1 className="text-xl font-black text-white text-center mb-1">ตั้งบัญชีเจ้าของระบบคนแรก</h1>
        <p className="text-slate-500 text-center text-xs mb-6">ยังไม่มีบัญชีแอดมินส่วนตัวในระบบ — ตั้งอีเมล/รหัสผ่านของคุณเองแทนการใช้รหัสฉุกเฉินร่วมกันทั้งบริษัท</p>
        {bootstrapError && <div className="bg-rose-500/10 border border-rose-500/30 text-rose-400 text-sm font-bold p-3 rounded-xl mb-5 text-center">{bootstrapError}</div>}
        <form onSubmit={handleBootstrap} className="space-y-3">
          <input type="text" placeholder="ชื่อที่แสดง (เช่น ชื่อเจ้าของร้าน)" required
            className="w-full bg-slate-950 border border-slate-700 rounded-xl py-3 px-4 text-white text-sm outline-none focus:border-emerald-500"
            value={bootstrapForm.display_name} onChange={e => setBootstrapForm(f => ({ ...f, display_name: e.target.value }))}/>
          <input type="email" placeholder="อีเมล" required
            className="w-full bg-slate-950 border border-slate-700 rounded-xl py-3 px-4 text-white text-sm outline-none focus:border-emerald-500"
            value={bootstrapForm.email} onChange={e => setBootstrapForm(f => ({ ...f, email: e.target.value }))}/>
          <input type="password" placeholder="ตั้งรหัสผ่าน (อย่างน้อย 8 ตัวอักษร)" required minLength={8}
            className="w-full bg-slate-950 border border-slate-700 rounded-xl py-3 px-4 text-white text-sm outline-none focus:border-emerald-500"
            value={bootstrapForm.password} onChange={e => setBootstrapForm(f => ({ ...f, password: e.target.value }))}/>
          <button type="submit" disabled={bootstrapSaving}
            className="w-full bg-emerald-600 hover:bg-emerald-700 text-white font-black py-3.5 rounded-xl transition-colors disabled:opacity-50">
            {bootstrapSaving ? 'กำลังบันทึก...' : 'ตั้งบัญชีเจ้าของระบบ'}
          </button>
          <button type="button" onClick={() => setNeedsBootstrap(false)}
            className="w-full text-slate-500 hover:text-slate-300 text-xs py-2 transition-colors">
            ข้ามไปก่อน (ใช้รหัสฉุกเฉินต่อ)
          </button>
        </form>
      </div>
    </div>
  );

  // ════ DASHBOARD ════
  return (
    <div className="min-h-screen bg-slate-950 text-white font-sans">
      <Head><title>Admin Panel | Smile Slip Pro</title></Head>

      {/* Navbar */}
      <nav className="bg-slate-900 border-b border-slate-800 px-6 h-14 flex items-center justify-between sticky top-0 z-50">
        <div className="flex items-center gap-3">
          <ShieldCheck size={20} className="text-indigo-400"/>
          <span className="font-black text-sm tracking-tight">SMILE SLIP <span className="text-indigo-400">ADMIN</span></span>
          {currentAdmin ? (
            <span className="text-[10px] text-slate-500 hidden md:flex items-center gap-1.5">
              {currentAdmin.display_name || currentAdmin.email}
              <span className={`px-1.5 py-0.5 rounded text-[9px] font-bold ${currentAdmin.role === 'owner' ? 'bg-indigo-900/60 text-indigo-300' : 'bg-slate-800 text-slate-400'}`}>
                {currentAdmin.role === 'owner' ? 'เจ้าของระบบ' : 'แอดมิน'}
              </span>
            </span>
          ) : (
            <span className="text-[10px] text-amber-500/80 hidden md:block">⚠️ เข้าด้วยรหัสฉุกเฉิน (ไม่มีตัวตน)</span>
          )}
        </div>
        <div className="flex items-center gap-2">
          <button onClick={() => { fetchData(); fetchInvoices(); }} className="p-2 text-slate-500 hover:text-white transition-colors rounded-lg hover:bg-slate-800" title="รีเฟรช">
            <RefreshCcw size={15} className={loading ? 'animate-spin' : ''}/>
          </button>
          <button onClick={handleLogout}
            className="flex items-center gap-1.5 px-3 py-2 text-rose-400 hover:bg-rose-500/10 rounded-xl text-xs font-bold transition-all">
            <LogOut size={13}/> ออก
          </button>
        </div>
      </nav>

      <div className="p-4 md:p-8 max-w-7xl mx-auto space-y-6">

        {/* Tabs */}
        <div className="flex gap-2">
          {[
            { id: 'shops',    label: 'ร้านค้า', icon: <Users size={14}/> },
            { id: 'invoices', label: `ใบแจ้งหนี้ / ภาษี${invoices.filter(i=>i.status==='pending').length > 0 ? ` (${invoices.filter(i=>i.status==='pending').length})` : ''}`, icon: <FileText size={14}/> },
            { id: 'settings', label: 'ตั้งค่า', icon: <Settings size={14}/> },
            ...(currentAdmin ? [{ id: 'admins', label: 'แอดมิน', icon: <Shield size={14}/> }] : []),
          ].map(t => (
            <button key={t.id} onClick={() => setActiveTab(t.id)}
              className={`flex items-center gap-1.5 px-4 py-2 rounded-xl text-xs font-black transition-all ${activeTab === t.id ? 'bg-indigo-600 text-white' : 'bg-slate-900 text-slate-400 hover:text-white border border-slate-800'}`}>
              {t.icon} {t.label}
            </button>
          ))}
        </div>

        {/* Stats */}
        <div className="grid grid-cols-4 md:grid-cols-7 gap-3">
          {[
            { label: 'ทั้งหมด',   value: stats.total,      color: 'text-white' },
            { label: 'Normal',    value: stats.normal,     color: 'text-slate-400' },
            { label: 'Pro',       value: stats.pro,        color: 'text-amber-400' },
            { label: 'Advance',   value: stats.advance,    color: 'text-indigo-400' },
            { label: 'Business',  value: stats.business,   color: 'text-emerald-400' },
            { label: 'Enterprise',value: stats.enterprise, color: 'text-violet-400' },
            { label: 'เครดิตรวม', value: stats.totalCredits.toLocaleString(), color: 'text-blue-400' },
          ].map((s, i) => (
            <div key={i} className="bg-slate-900 border border-slate-800 rounded-2xl p-3 text-center">
              <p className={`text-xl font-black ${s.color}`}>{s.value}</p>
              <p className="text-[9px] text-slate-600 uppercase tracking-widest mt-0.5">{s.label}</p>
            </div>
          ))}
        </div>

        {/* Delivery Stats */}
        <div className="bg-slate-900 border border-blue-900/40 rounded-2xl p-4">
          <div className="flex items-center gap-2 mb-3">
            <span className="text-base">🚚</span>
            <p className="text-xs font-black text-blue-400 uppercase tracking-widest">Delivery — ร้านที่เปิดใช้</p>
            <span className="ml-auto text-[10px] text-slate-600">เพิ่มวันนี้ {deliveryStats.today || 0} ร้าน</span>
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
            {[
              { label: 'ร้านที่เปิด Delivery', value: deliveryStats.total ?? 0, color: 'text-blue-400' },
              { label: 'เปิดใช้แล้ว',          value: deliveryStats.active ?? 0, color: 'text-green-400' },
              { label: 'เพิ่มวันนี้',           value: deliveryStats.today ?? 0, color: 'text-white' },
            ].map((s, i) => (
              <div key={i} className="bg-slate-800 rounded-xl p-2 text-center">
                <p className={`text-lg font-black ${s.color}`}>{s.value}</p>
                <p className="text-[9px] text-slate-600 uppercase tracking-widest mt-0.5">{s.label}</p>
              </div>
            ))}
          </div>
          <p className="text-[10px] text-slate-600 mt-2">ออเดอร์อยู่ใน Google Sheets ของแต่ละร้าน (PDPA)</p>
        </div>

        {/* ════ INVOICE TAB ════ */}
        {activeTab === 'invoices' && (
          <InvoiceTab invoices={invoices} invoiceFilter={invoiceFilter} setInvoiceFilter={setInvoiceFilter}
            handleIssue={handleIssue} handleInvoiceStatus={handleInvoiceStatus}
            issuingId={issuingId} fmt={fmt} adminToken={tokenRef.current}
            onRefresh={() => fetchInvoices(tokenRef.current)}/>
        )}

        {/* ════ SETTINGS TAB ════ */}
        {activeTab === 'settings' && (
          <div className="space-y-6 max-w-xl">
            {/* Google Drive / Sheets */}
            <div className="bg-slate-900 border border-slate-800 rounded-2xl p-6">
              <h3 className="text-sm font-black text-white mb-1 flex items-center gap-2">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" className="text-blue-400"><path d="M6.19 2h11.62L23 10.77l-5.29 9.15A2 2 0 0115.97 21H8.03a2 2 0 01-1.74-1.08L1 10.77 6.19 2z" opacity=".3"/><path d="M1 10.77h22M6.19 2l5.52 9.55M17.81 2l-5.52 9.55m5.52 9.15L12 11.55M6.19 21.08L12 11.55"/></svg>
                Google Drive & Sheets (บริษัท)
              </h3>
              <p className="text-xs text-slate-500 mb-4">เชื่อมต่อ Google Account ของบริษัท เพื่อบันทึกใบกำกับภาษีที่ออกแล้วลง Google Sheets อัตโนมัติ</p>

              {loadingSettings ? (
                <p className="text-xs text-slate-500">กำลังโหลด...</p>
              ) : adminGoogleEmail ? (
                <div className="space-y-3">
                  <div className="flex items-center gap-2 bg-emerald-500/10 border border-emerald-500/20 rounded-xl px-4 py-3">
                    <CheckCircle2 size={14} className="text-emerald-400 shrink-0"/>
                    <div className="min-w-0">
                      <p className="text-xs font-bold text-emerald-400">เชื่อมต่อแล้ว</p>
                      <p className="text-[11px] text-slate-400 truncate">{adminGoogleEmail}</p>
                    </div>
                  </div>
                  {adminSheetId && (
                    <a href={`https://docs.google.com/spreadsheets/d/${adminSheetId}`} target="_blank" rel="noreferrer"
                      className="flex items-center gap-2 text-xs text-indigo-400 hover:text-indigo-300 transition-colors">
                      <ExternalLink size={12}/> เปิด Invoice Register Sheet
                    </a>
                  )}
                  <button onClick={() => window.location.href = '/api/admin/google/connect'}
                    className="text-xs text-slate-500 hover:text-white transition-colors">
                    เชื่อมต่อบัญชีอื่น / รีเฟรช Token
                  </button>
                </div>
              ) : (
                <div className="space-y-3">
                  <div className="flex items-center gap-2 bg-slate-800 border border-slate-700 rounded-xl px-4 py-3">
                    <div className="w-2 h-2 rounded-full bg-slate-600 shrink-0"/>
                    <p className="text-xs text-slate-400">ยังไม่ได้เชื่อมต่อ</p>
                  </div>
                  <button onClick={() => window.location.href = '/api/admin/google/connect'}
                    className="w-full flex items-center justify-center gap-2 bg-white text-slate-900 font-bold text-sm py-3 rounded-xl hover:bg-slate-100 transition-colors">
                    <svg width="16" height="16" viewBox="0 0 24 24"><path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" fill="#4285F4"/><path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853"/><path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l3.66-2.84z" fill="#FBBC05"/><path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335"/></svg>
                    เชื่อมต่อ Google Account
                  </button>
                  <p className="text-[10px] text-slate-600 text-center">ต้องเพิ่ม redirect URI นี้ใน Google Cloud Console ก่อน:<br/>
                    <span className="font-mono text-slate-500 text-[9px] break-all">{typeof window !== 'undefined' ? window.location.origin : ''}/api/admin/google/callback</span>
                  </p>
                </div>
              )}
            </div>

            {/* Promotion */}
            <div className="bg-slate-900 border border-slate-800 rounded-2xl p-6">
              <h3 className="text-sm font-black text-white mb-1 flex items-center gap-2">
                🎉 โปรโมชั่น
              </h3>
              <p className="text-xs text-slate-500 mb-4">เปิดโปรแล้วจะแสดงในหน้า pricing/index ทันที และลูกค้าจะได้ส่วนลดจริงตอน checkout</p>

              {promotion ? (
                <div className="space-y-3">
                  <div className="flex items-center gap-2 bg-emerald-500/10 border border-emerald-500/20 rounded-xl px-4 py-3">
                    <CheckCircle2 size={14} className="text-emerald-400 shrink-0"/>
                    <div className="min-w-0">
                      <p className="text-xs font-bold text-emerald-400">{promotion.title} — ลด {promotion.discountPercent}%</p>
                      <p className="text-[11px] text-slate-400">{promotion.validUntil ? `หมดเขต ${promotion.validUntil}` : 'ไม่มีกำหนดหมดเขต'}</p>
                    </div>
                  </div>
                  <button onClick={handleDisablePromotion} disabled={savingPromo}
                    className="text-xs text-red-400 hover:text-red-300 transition-colors disabled:opacity-50">
                    ปิดโปรโมชั่นนี้
                  </button>
                </div>
              ) : (
                <div className="space-y-3">
                  <input placeholder="ชื่อโปร เช่น 🎉 โปรปีใหม่ 2569"
                    className="w-full bg-slate-800 border border-slate-700 rounded-xl px-4 py-2.5 text-sm text-white outline-none focus:border-indigo-500"
                    value={promoForm.title} onChange={e => setPromoForm({ ...promoForm, title: e.target.value })}/>
                  <div className="grid grid-cols-2 gap-3">
                    <input type="number" min="1" max="90" placeholder="% ส่วนลด เช่น 20"
                      className="bg-slate-800 border border-slate-700 rounded-xl px-4 py-2.5 text-sm text-white outline-none focus:border-indigo-500"
                      value={promoForm.discountPercent} onChange={e => setPromoForm({ ...promoForm, discountPercent: e.target.value })}/>
                    <input placeholder="badge เช่น ลด 20%"
                      className="bg-slate-800 border border-slate-700 rounded-xl px-4 py-2.5 text-sm text-white outline-none focus:border-indigo-500"
                      value={promoForm.badgeText} onChange={e => setPromoForm({ ...promoForm, badgeText: e.target.value })}/>
                  </div>
                  <div>
                    <label className="text-[10px] text-slate-500 mb-1 block">วันหมดเขต (ไม่บังคับ — เว้นว่าง = ไม่หมดเขต)</label>
                    <input type="date"
                      className="w-full bg-slate-800 border border-slate-700 rounded-xl px-4 py-2.5 text-sm text-white outline-none focus:border-indigo-500"
                      value={promoForm.validUntil} onChange={e => setPromoForm({ ...promoForm, validUntil: e.target.value })}/>
                  </div>
                  <button onClick={handleSavePromotion} disabled={savingPromo}
                    className="w-full bg-indigo-600 hover:bg-indigo-500 text-white font-bold text-sm py-3 rounded-xl transition-colors disabled:opacity-50">
                    {savingPromo ? 'กำลังเปิด...' : 'เปิดโปรโมชั่นนี้'}
                  </button>
                </div>
              )}
            </div>

            {/* Testimonials */}
            <div className="bg-slate-900 border border-slate-800 rounded-2xl p-6">
              <h3 className="text-sm font-black text-white mb-1 flex items-center gap-2">
                ⭐ รีวิวจากลูกค้า ({testimonials.length})
              </h3>
              <p className="text-xs text-slate-500 mb-4">รีวิวที่ลูกค้ากรอกเองในแดชบอร์ด แสดงในหน้าแรกอัตโนมัติ — กดซ่อนได้ถ้าไม่เหมาะสม</p>
              {testimonials.length === 0 ? (
                <p className="text-xs text-slate-600">ยังไม่มีรีวิว</p>
              ) : (
                <div className="space-y-3 max-h-96 overflow-y-auto">
                  {testimonials.map(t => (
                    <div key={t.id} className={`rounded-xl p-4 border ${t.is_hidden ? 'bg-slate-800/50 border-slate-700 opacity-50' : 'bg-slate-800 border-slate-700'}`}>
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <p className="text-xs font-bold text-white">{t.name} <span className="text-amber-400">{'★'.repeat(t.stars)}</span></p>
                          <p className="text-[10px] text-slate-500 mb-1.5">{t.role}</p>
                          <p className="text-xs text-slate-300 leading-relaxed">{t.message}</p>
                        </div>
                        <button onClick={() => handleToggleTestimonial(t.id, !t.is_hidden)}
                          className={`shrink-0 text-[10px] font-bold px-3 py-1.5 rounded-lg transition-colors ${t.is_hidden ? 'bg-emerald-500/20 text-emerald-400 hover:bg-emerald-500/30' : 'bg-red-500/20 text-red-400 hover:bg-red-500/30'}`}>
                          {t.is_hidden ? 'แสดงอีกครั้ง' : 'ซ่อน'}
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Email Settings */}
            <div className="bg-slate-900 border border-slate-800 rounded-2xl p-6">
              <h3 className="text-sm font-black text-white mb-1 flex items-center gap-2">
                <Mail size={14} className="text-indigo-400"/> การส่งอีเมล
              </h3>
              <p className="text-xs text-slate-500 mb-3">ระบบจะส่งอีเมลใบกำกับภาษีอัตโนมัติเมื่อกด "ออกใบกำกับภาษี"</p>
              <div className="bg-slate-800 rounded-xl p-4 text-xs space-y-1.5 font-mono">
                <p className="text-slate-400">EMAIL_USER=<span className="text-amber-400">{process.env.NEXT_PUBLIC_EMAIL_CONFIGURED === 'true' ? '✅ ตั้งค่าแล้ว' : '❌ ยังไม่ได้ตั้งค่า'}</span></p>
                <p className="text-[10px] text-slate-600">ตั้งค่าใน .env: EMAIL_USER, EMAIL_PASS (Gmail App Password)</p>
              </div>
            </div>
          </div>
        )}

        {/* ════ ADMINS TAB (multi-admin, 2026-07-20) ════ */}
        {activeTab === 'admins' && currentAdmin && (
          <div className="space-y-6 max-w-xl">
            <div className="bg-slate-900 border border-slate-800 rounded-2xl p-6">
              <h3 className="text-sm font-black text-white mb-1 flex items-center gap-2">
                <KeyRound size={14} className="text-indigo-400"/> เปลี่ยนรหัสผ่านของฉัน
              </h3>
              <p className="text-xs text-slate-500 mb-4">{currentAdmin.email}</p>
              <form onSubmit={handleChangeMyPassword} className="space-y-3">
                <input type="password" required placeholder="รหัสผ่านปัจจุบัน"
                  className="w-full bg-slate-950 border border-slate-700 rounded-xl py-2.5 px-4 text-white text-sm outline-none focus:border-indigo-500"
                  value={myPasswordForm.current_password} onChange={e => setMyPasswordForm(f => ({ ...f, current_password: e.target.value }))}/>
                <input type="password" required minLength={8} placeholder="รหัสผ่านใหม่ (อย่างน้อย 8 ตัวอักษร)"
                  className="w-full bg-slate-950 border border-slate-700 rounded-xl py-2.5 px-4 text-white text-sm outline-none focus:border-indigo-500"
                  value={myPasswordForm.new_password} onChange={e => setMyPasswordForm(f => ({ ...f, new_password: e.target.value }))}/>
                <button type="submit" disabled={myPasswordSaving}
                  className="bg-indigo-600 hover:bg-indigo-700 text-white font-bold text-xs px-5 py-2.5 rounded-xl transition-all disabled:opacity-50">
                  {myPasswordSaving ? 'กำลังบันทึก...' : 'เปลี่ยนรหัสผ่าน'}
                </button>
              </form>
            </div>

            {currentAdmin.role === 'owner' && (
              <div className="bg-slate-900 border border-slate-800 rounded-2xl p-6">
                <div className="flex items-center justify-between mb-4">
                  <h3 className="text-sm font-black text-white flex items-center gap-2">
                    <Shield size={14} className="text-indigo-400"/> จัดการแอดมิน ({companyAdmins.length})
                  </h3>
                  <button onClick={() => setShowAddCompanyAdmin(v => !v)}
                    className="flex items-center gap-1.5 bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-bold px-3 py-1.5 rounded-xl transition-all">
                    <UserPlus size={13}/> เพิ่มแอดมิน
                  </button>
                </div>

                {showAddCompanyAdmin && (
                  <form onSubmit={handleAddCompanyAdmin} className="bg-slate-800 rounded-xl p-4 space-y-2.5 mb-4">
                    <input type="text" required placeholder="ชื่อที่แสดง"
                      className="w-full bg-slate-950 border border-slate-700 rounded-lg py-2 px-3 text-white text-sm outline-none focus:border-indigo-500"
                      value={newCompanyAdminForm.display_name} onChange={e => setNewCompanyAdminForm(f => ({ ...f, display_name: e.target.value }))}/>
                    <input type="email" required placeholder="อีเมล"
                      className="w-full bg-slate-950 border border-slate-700 rounded-lg py-2 px-3 text-white text-sm outline-none focus:border-indigo-500"
                      value={newCompanyAdminForm.email} onChange={e => setNewCompanyAdminForm(f => ({ ...f, email: e.target.value }))}/>
                    <input type="password" required minLength={8} placeholder="รหัสผ่าน (อย่างน้อย 8 ตัวอักษร)"
                      className="w-full bg-slate-950 border border-slate-700 rounded-lg py-2 px-3 text-white text-sm outline-none focus:border-indigo-500"
                      value={newCompanyAdminForm.password} onChange={e => setNewCompanyAdminForm(f => ({ ...f, password: e.target.value }))}/>
                    <div className="flex gap-2">
                      {['staff', 'owner'].map(r => (
                        <button key={r} type="button" onClick={() => setNewCompanyAdminForm(f => ({ ...f, role: r }))}
                          className={`flex-1 py-2 rounded-lg text-xs font-bold transition-colors ${newCompanyAdminForm.role === r ? 'bg-indigo-600 text-white' : 'bg-slate-950 text-slate-400 border border-slate-700'}`}>
                          {r === 'owner' ? 'เจ้าของระบบ' : 'แอดมิน'}
                        </button>
                      ))}
                    </div>
                    <button type="submit" disabled={newCompanyAdminSaving}
                      className="w-full bg-emerald-600 hover:bg-emerald-700 text-white font-bold text-xs py-2.5 rounded-lg transition-all disabled:opacity-50">
                      {newCompanyAdminSaving ? 'กำลังบันทึก...' : 'สร้างบัญชี'}
                    </button>
                  </form>
                )}

                {companyAdminsLoading ? (
                  <div className="text-center text-slate-600 text-xs py-6">กำลังโหลด...</div>
                ) : companyAdmins.length === 0 ? (
                  <div className="text-center text-slate-600 text-xs py-6">ยังไม่มีแอดมินในระบบ</div>
                ) : (
                  <div className="space-y-2">
                    {companyAdmins.map(a => (
                      <div key={a.id} className="bg-slate-800 rounded-xl p-3 flex items-center justify-between gap-3">
                        <div className="min-w-0">
                          <div className="text-white text-sm font-bold truncate flex items-center gap-1.5">
                            {a.display_name || a.email}
                            {a.id === currentAdmin.id && <span className="text-[9px] text-slate-500">(ฉัน)</span>}
                          </div>
                          <div className="text-slate-500 text-[11px] truncate">{a.email}</div>
                          <div className="text-slate-600 text-[10px]">{a.last_login_at ? `เข้าใช้ล่าสุด ${new Date(a.last_login_at).toLocaleString('th-TH')}` : 'ยังไม่เคย login'}</div>
                        </div>
                        <div className="flex items-center gap-1.5 shrink-0">
                          <span className={`px-2 py-1 rounded text-[10px] font-bold ${a.role === 'owner' ? 'bg-indigo-900/60 text-indigo-300' : 'bg-slate-700 text-slate-300'}`}>
                            {a.role === 'owner' ? 'เจ้าของระบบ' : 'แอดมิน'}
                          </span>
                          <button onClick={() => updateCompanyAdmin(a.id, { role: a.role === 'owner' ? 'staff' : 'owner' })}
                            title="สลับสิทธิ์" className="text-[10px] px-2 py-1 bg-slate-700 hover:bg-slate-600 text-slate-300 rounded-lg transition-colors">
                            สลับสิทธิ์
                          </button>
                          {a.id !== currentAdmin.id && (
                            <button onClick={() => updateCompanyAdmin(a.id, { status: a.status === 'active' ? 'disabled' : 'active' })}
                              className={`text-[10px] px-2 py-1 rounded-lg transition-colors ${a.status === 'active' ? 'bg-rose-500/10 text-rose-400 hover:bg-rose-500 hover:text-white' : 'bg-emerald-500/10 text-emerald-400 hover:bg-emerald-500 hover:text-white'}`}>
                              {a.status === 'active' ? 'ระงับ' : 'เปิดใช้งาน'}
                            </button>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>
        )}

        {activeTab === 'shops' && <>
        {/* Search */}
        <div className="flex gap-3">
          <div className="relative flex-1">
            <Search className="absolute left-4 top-3 text-slate-500" size={16}/>
            <input placeholder="ค้นหา ชื่อร้าน, อีเมล, เบอร์, LINE ID..."
              className="w-full bg-slate-900 border border-slate-800 rounded-xl py-3 pl-11 pr-4 text-white outline-none focus:border-indigo-500 text-sm transition-colors"
              value={searchTerm} onChange={e => setSearchTerm(e.target.value)}/>
          </div>
          <select className="bg-slate-900 border border-slate-800 rounded-xl px-4 py-3 text-sm text-white outline-none cursor-pointer"
            value={filterTier} onChange={e => setFilterTier(e.target.value)}>
            <option value="all">ทุก Tier</option>
            {TIERS.map(t => <option key={t} value={t}>{t}</option>)}
          </select>
        </div>

        {/* Shop list */}
        <div className="bg-slate-900 border border-slate-800 rounded-3xl overflow-hidden">
          <div className="px-6 py-4 border-b border-slate-800 flex items-center justify-between">
            <h2 className="font-black text-xs uppercase tracking-widest text-slate-400">ร้านค้าทั้งหมด ({filteredShops.length})</h2>
          </div>

          <div className="divide-y divide-slate-800/50">
            {filteredShops.length === 0 ? (
              <div className="py-16 text-center text-slate-600 font-bold">ไม่พบข้อมูล</div>
            ) : filteredShops.map((shop) => {
              const credit = getCredit(shop);
              const isExpanded = expandedId === shop.id;
              const tier = shop.subscription_tier || 'normal';
              const googleEmail = Array.isArray(shop.shop_google_configs)
                ? shop.shop_google_configs[0]?.google_email : shop.shop_google_configs?.google_email;
              const branches = Array.isArray(shop.shop_branches) ? shop.shop_branches : [];
              const admins = Array.isArray(shop.shop_admins) ? shop.shop_admins : [];
              const approvedAdmins = admins.filter(a => a.status === 'approved');
              const pendingAdmins = admins.filter(a => a.status === 'pending');
              const adminFormData = addAdminForm[shop.id] || {};

              return (
                <div key={shop.id}>
                  {/* Row */}
                  <div className="px-4 md:px-6 py-4 hover:bg-slate-800/20 transition-all">
                    <div className="flex items-center justify-between gap-3 flex-wrap">
                      {/* Shop info */}
                      <div className="flex items-center gap-3 min-w-0 flex-1">
                        <button onClick={() => setExpandedId(isExpanded ? null : shop.id)}
                          className="shrink-0 w-8 h-8 rounded-lg bg-slate-800 flex items-center justify-center text-slate-400 hover:text-white transition-all">
                          <ChevronDown size={14} className={`transition-transform ${isExpanded ? 'rotate-180' : ''}`}/>
                        </button>
                        <div className="min-w-0">
                          <p className="font-black text-white text-sm truncate">{shop.shop_name}</p>
                          <p className="text-[10px] text-slate-500 truncate">{shop.email} · {shop.phone}</p>
                        </div>
                        {pendingAdmins.length > 0 && (
                          <span className="text-[9px] bg-orange-500/20 text-orange-400 px-2 py-0.5 rounded-full font-bold shrink-0">
                            {pendingAdmins.length} pending
                          </span>
                        )}
                      </div>

                      {/* Controls */}
                      <div className="flex items-center gap-2 shrink-0 flex-wrap">

                        {/* Tier selector */}
                        {editTier[shop.id] !== undefined ? (
                          <div className="flex items-center gap-1">
                            <select value={editTier[shop.id]}
                              onChange={e => setEditTier(p => ({ ...p, [shop.id]: e.target.value }))}
                              className="bg-slate-800 border border-slate-700 text-white text-xs rounded-lg px-2 py-1.5 outline-none">
                              {TIERS.map(t => <option key={t} value={t}>{t}</option>)}
                            </select>
                            <input type="date" title="วันหมดอายุแพ็กเกจ (เว้นว่าง = ไม่หมดอายุ)"
                              value={editExpiry[shop.id] ?? (shop.subscription_expires_at ? shop.subscription_expires_at.slice(0,10) : '')}
                              onChange={e => setEditExpiry(p => ({ ...p, [shop.id]: e.target.value }))}
                              className="bg-slate-800 border border-slate-700 text-white text-xs rounded-lg px-2 py-1.5 outline-none"/>
                            {/* ปุ่มกำหนดปกติ */}
                            <button onClick={() => handleTierChange(shop.id, editTier[shop.id])}
                              title="เปลี่ยน tier + วันหมดอายุ"
                              className="p-1.5 bg-slate-700 text-slate-300 hover:bg-emerald-500 hover:text-white rounded-lg transition-all">
                              <Check size={13}/>
                            </button>
                            {/* ปุ่ม Manual Payment + เติมเครดิต */}
                            <button onClick={() => handleManualAssign(shop.id, editTier[shop.id], credit)}
                              title="โอนจ่ายผ่านบัญชีบริษัท — เปลี่ยน tier + เติมเครดิตตาม plan + วันหมดอายุ"
                              className="p-1.5 bg-indigo-900 text-indigo-300 hover:bg-indigo-600 hover:text-white rounded-lg transition-all flex items-center gap-0.5">
                              <Zap size={12}/><CreditCard size={11}/>
                            </button>
                            <button onClick={() => { setEditTier(p => { const n={...p}; delete n[shop.id]; return n; }); setEditExpiry(p => { const n={...p}; delete n[shop.id]; return n; }); }}
                              className="p-1.5 bg-slate-700 text-slate-400 hover:bg-rose-500 hover:text-white rounded-lg transition-all">
                              <X size={13}/>
                            </button>
                          </div>
                        ) : (
                          <div className="flex flex-col items-start gap-0.5">
                            <button onClick={() => setEditTier(p => ({ ...p, [shop.id]: tier }))}
                              className={`text-[10px] font-black px-3 py-1.5 rounded-lg uppercase tracking-wider ${TIER_COLOR[tier]} hover:opacity-80 transition-all flex items-center gap-1`}>
                              {tier} <Edit3 size={10}/>
                            </button>
                            {shop.subscription_expires_at && (() => {
                              const expDate = new Date(shop.subscription_expires_at);
                              const daysLeft = Math.ceil((expDate - new Date()) / 86400000);
                              const expired = daysLeft < 0;
                              return (
                                <span className={`text-[9px] font-bold px-1.5 ${expired ? 'text-rose-400' : daysLeft <= 7 ? 'text-amber-400' : 'text-slate-500'}`}>
                                  {expired ? '⚠️ หมดอายุแล้ว' : `⏳ หมดอายุ ${expDate.toLocaleDateString('th-TH')} (${daysLeft} วัน)`}
                                </span>
                              );
                            })()}
                            {shop.stripe_subscription_id && shop.stripe_billed_tier && shop.stripe_billed_tier !== tier && (
                              <span className="text-[9px] font-bold px-1.5 text-orange-400" title={`Stripe เก็บเงินจริงที่แพ็กเกจ ${shop.stripe_billed_tier} แต่ tier ปัจจุบันคือ ${tier}`}>
                                ⚠️ ไม่ตรงกับ Stripe (จ่ายจริง: {shop.stripe_billed_tier})
                              </span>
                            )}
                          </div>
                        )}

                        {/* Credits */}
                        <div className="flex items-center gap-1">
                          {editCredit[shop.id] !== undefined ? (
                            <>
                              <input type="number" placeholder="จำนวน"
                                className="w-20 bg-slate-800 border border-slate-700 text-white text-xs rounded-lg px-2 py-1.5 outline-none text-center"
                                value={editCredit[shop.id]}
                                onChange={e => setEditCredit(p => ({ ...p, [shop.id]: e.target.value }))}/>
                              <button onClick={() => handleCreditAction(shop.id, 'add_credits', credit)}
                                title="เติม +" className="p-1.5 bg-emerald-500/20 text-emerald-400 hover:bg-emerald-500 hover:text-white rounded-lg transition-all">
                                <PlusCircle size={13}/>
                              </button>
                              <button onClick={() => handleCreditAction(shop.id, 'set_credits', credit)}
                                title="ตั้งค่า =" className="p-1.5 bg-blue-500/20 text-blue-400 hover:bg-blue-500 hover:text-white rounded-lg transition-all">
                                <Check size={13}/>
                              </button>
                              <button onClick={() => setEditCredit(p => { const n={...p}; delete n[shop.id]; return n; })}
                                className="p-1.5 bg-slate-700 text-slate-400 hover:bg-rose-500 hover:text-white rounded-lg transition-all">
                                <X size={13}/>
                              </button>
                            </>
                          ) : (
                            <button onClick={() => setEditCredit(p => ({ ...p, [shop.id]: '' }))}
                              className="flex items-center gap-1.5 bg-indigo-500/10 border border-indigo-500/20 text-indigo-400 hover:bg-indigo-500 hover:text-white px-3 py-1.5 rounded-lg text-xs font-black transition-all">
                              <CreditCard size={12}/> {credit.toLocaleString()}
                            </button>
                          )}
                        </div>

                        {/* Delete */}
                        <button onClick={() => handleDelete(shop.id, shop.shop_name)}
                          className="p-2 text-slate-700 hover:text-rose-400 hover:bg-rose-500/10 rounded-lg transition-all">
                          <Trash2 size={15}/>
                        </button>
                      </div>
                    </div>
                  </div>

                  {/* Expanded Detail */}
                  {isExpanded && (
                    <div className="bg-slate-950/60 border-t border-slate-800/50">
                      <div className="px-6 md:px-16 py-5 space-y-5">

                        {/* Info Grid + Edit Profile */}
                        {editProfile[shop.id] ? (
                          /* ── Edit Mode ── */
                          <div className="bg-slate-900 border border-indigo-500/30 rounded-2xl p-4 space-y-3">
                            <div className="flex items-center justify-between mb-1">
                              <p className="text-[10px] font-black text-indigo-400 uppercase tracking-widest">แก้ไขข้อมูลร้านค้า</p>
                              <button onClick={() => setEditProfile(p => { const n={...p}; delete n[shop.id]; return n; })}
                                className="text-slate-500 hover:text-white"><X size={14}/></button>
                            </div>
                            <div className="grid grid-cols-2 gap-3 text-xs">
                              {[
                                { key:'shopName', label:'ชื่อร้านค้า', span:2 },
                                { key:'email',    label:'อีเมล' },
                                { key:'phone',    label:'เบอร์โทร' },
                                { key:'taxId',    label:'เลขประจำตัวผู้เสียภาษี' },
                              ].map(f => (
                                <div key={f.key} className={f.span===2 ? 'col-span-2' : ''}>
                                  <label className="block text-[9px] text-slate-500 uppercase tracking-widest mb-1">{f.label}</label>
                                  <input value={editProfile[shop.id][f.key] || ''}
                                    onChange={e => setEditProfile(p => ({ ...p, [shop.id]: { ...p[shop.id], [f.key]: e.target.value } }))}
                                    className="w-full bg-slate-800 border border-slate-700 text-white text-xs rounded-xl px-3 py-2 outline-none focus:border-indigo-500"/>
                                </div>
                              ))}
                              <div>
                                <label className="block text-[9px] text-slate-500 uppercase tracking-widest mb-1">ประเภท</label>
                                <select value={editProfile[shop.id].userType || 'individual'}
                                  onChange={e => setEditProfile(p => ({ ...p, [shop.id]: { ...p[shop.id], userType: e.target.value } }))}
                                  className="w-full bg-slate-800 border border-slate-700 text-white text-xs rounded-xl px-3 py-2 outline-none focus:border-indigo-500">
                                  <option value="individual">บุคคลธรรมดา</option>
                                  <option value="juristic">นิติบุคคล</option>
                                </select>
                              </div>
                              <div className="col-span-2">
                                <label className="block text-[9px] text-slate-500 uppercase tracking-widest mb-1">ที่อยู่</label>
                                <textarea rows={2} value={editProfile[shop.id].address || ''}
                                  onChange={e => setEditProfile(p => ({ ...p, [shop.id]: { ...p[shop.id], address: e.target.value } }))}
                                  className="w-full bg-slate-800 border border-slate-700 text-white text-xs rounded-xl px-3 py-2 outline-none focus:border-indigo-500 resize-none"/>
                              </div>
                            </div>
                            <div className="flex gap-2 pt-1">
                              <button onClick={() => handleProfileSave(shop.id)}
                                className="flex items-center gap-1.5 px-4 py-2 bg-indigo-600 hover:bg-indigo-700 text-white rounded-xl text-xs font-black transition-all">
                                <Check size={13}/> บันทึก
                              </button>
                              <button onClick={() => setEditProfile(p => { const n={...p}; delete n[shop.id]; return n; })}
                                className="px-4 py-2 bg-slate-800 text-slate-400 hover:text-white rounded-xl text-xs font-bold transition-all">
                                ยกเลิก
                              </button>
                            </div>
                          </div>
                        ) : (
                          /* ── View Mode ── */
                          <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-xs">
                            {[
                              { icon: <Shield size={11}/>, label: 'LINE ID (เจ้าของ)', value: shop.owner_line_id, copy: true, copyId: `line-${shop.id}` },
                              { icon: <Building2 size={11}/>, label: 'Shop ID', value: shop.id, copy: true, copyId: `shop-${shop.id}` },
                              { icon: <Mail size={11}/>, label: 'Google Sync', value: googleEmail || 'ยังไม่เชื่อมต่อ', color: googleEmail ? 'text-emerald-400' : 'text-slate-600' },
                              { icon: <MapPin size={11}/>, label: 'ที่อยู่', value: shop.address || '-' },
                              { icon: <Building2 size={11}/>, label: 'สาขา', value: `${branches.length} สาขา` },
                              { icon: <CreditCard size={11}/>, label: 'เลขภาษี', value: shop.tax_id || '-' },
                              { icon: <Phone size={11}/>, label: 'ประเภท', value: shop.user_type || '-' },
                              { icon: <Calendar size={11}/>, label: 'สมัครเมื่อ', value: shop.created_at ? new Date(shop.created_at).toLocaleDateString('th-TH') : '-' },
                            ].map((item, i) => (
                              <div key={i} className="bg-slate-900 rounded-xl p-3 border border-slate-800">
                                <div className="flex items-center gap-1 text-slate-500 mb-1">{item.icon}<p className="uppercase tracking-widest text-[9px]">{item.label}</p></div>
                                <div className="flex items-center gap-1.5">
                                  <p className={`font-mono text-[11px] break-all ${item.color || 'text-slate-300'}`}>{item.value}</p>
                                  {item.copy && item.value && (
                                    <button onClick={() => copyToClipboard(item.value, item.copyId)}
                                      className="shrink-0 text-slate-600 hover:text-white transition-colors">
                                      {copiedId === item.copyId ? <CheckCircle2 size={11} className="text-emerald-400"/> : <Copy size={11}/>}
                                    </button>
                                  )}
                                </div>
                              </div>
                            ))}
                            <div className="col-span-2 md:col-span-4 flex justify-end">
                              <button onClick={() => openEditProfile(shop)}
                                className="flex items-center gap-1.5 text-[10px] px-3 py-1.5 bg-indigo-500/10 border border-indigo-500/20 text-indigo-400 hover:bg-indigo-600 hover:text-white rounded-lg transition-all font-bold">
                                <Edit3 size={11}/> แก้ไขข้อมูลร้านค้า
                              </button>
                            </div>
                          </div>
                        )}

                        {/* Branches */}
                        {branches.length > 0 && (
                          <div>
                            <p className="text-[9px] font-black text-slate-500 uppercase tracking-widest mb-2">สาขา ({branches.length})</p>
                            <div className="flex flex-wrap gap-2">
                              {branches.map(b => (
                                <span key={b.id} className="text-xs bg-slate-800 text-slate-300 px-3 py-1 rounded-lg font-mono">
                                  {b.branch_name}
                                </span>
                              ))}
                            </div>
                          </div>
                        )}

                        {/* ── Admin Management ── */}
                        <div>
                          <p className="text-[9px] font-black text-slate-500 uppercase tracking-widest mb-3 flex items-center gap-1.5">
                            <Shield size={11}/> Shop Admins
                            {pendingAdmins.length > 0 && (
                              <span className="bg-orange-500/30 text-orange-400 px-2 py-0.5 rounded-full text-[9px]">
                                {pendingAdmins.length} pending
                              </span>
                            )}
                          </p>

                          {/* Pending admins */}
                          {pendingAdmins.length > 0 && (
                            <div className="mb-3 space-y-1.5">
                              {pendingAdmins.map(a => (
                                <div key={a.id} className="flex items-center justify-between bg-orange-500/10 border border-orange-500/20 rounded-xl px-3 py-2">
                                  <div>
                                    <p className="text-xs font-bold text-orange-300">{a.display_name || 'LINE Member'}</p>
                                    <p className="text-[9px] text-orange-500">รอเจ้าของอนุมัติ</p>
                                  </div>
                                  <div className="flex gap-1.5">
                                    <button onClick={async () => {
                                      const r = await fetch('/api/shop/admins', {
                                        method: 'PATCH',
                                        headers: { 'Content-Type': 'application/json', 'x-admin-token': tokenRef.current },
                                        body: JSON.stringify({ shopId: shop.id, adminId: a.id, action: 'approve' }),
                                      });
                                      if (r.ok) await fetchData();
                                      else { const d = await r.json(); alert('ไม่สำเร็จ: ' + d.error); }
                                    }} className="px-2 py-1 bg-emerald-500/20 text-emerald-400 hover:bg-emerald-500 hover:text-white rounded-lg text-[10px] font-bold transition-all">
                                      อนุมัติ
                                    </button>
                                    <button onClick={async () => {
                                      const res2 = await fetch('/api/shop/admins', {
                                        method: 'PATCH', headers: adminHeader(),
                                        body: JSON.stringify({ shopId: shop.id, adminId: a.id, action: 'reject' }),
                                      });
                                      if (res2.ok) await fetchData();
                                    }} className="px-2 py-1 bg-slate-700 text-slate-400 hover:bg-rose-500 hover:text-white rounded-lg text-[10px] font-bold transition-all">
                                      ปฏิเสธ
                                    </button>
                                  </div>
                                </div>
                              ))}
                            </div>
                          )}

                          {/* Approved admins */}
                          {approvedAdmins.length > 0 && (
                            <div className="mb-3 flex flex-wrap gap-2">
                              {approvedAdmins.map(a => (
                                <div key={a.id} className="flex items-center gap-2 bg-slate-800 border border-slate-700 rounded-xl px-3 py-2">
                                  <Shield size={11} className="text-blue-400 shrink-0"/>
                                  <span className="text-xs text-slate-300 font-bold">{a.display_name || 'แอดมิน'}</span>
                                  <button onClick={() => handleRemoveShopAdmin(shop.id, a.id, a.display_name || 'แอดมิน')}
                                    className="text-slate-600 hover:text-rose-400 transition-colors">
                                    <UserX size={12}/>
                                  </button>
                                </div>
                              ))}
                            </div>
                          )}

                          {/* Add admin form */}
                          <div className="flex gap-2">
                            <div className="flex-1 relative">
                              <input placeholder="LINE User ID (Uxxxxxxx...)"
                                value={adminFormData.lineUserId || ''}
                                onChange={e => setAddAdminForm(p => ({ ...p, [shop.id]: { ...adminFormData, lineUserId: e.target.value } }))}
                                className="w-full bg-slate-800 border border-slate-700 text-white text-xs rounded-xl px-3 py-2 outline-none focus:border-indigo-500 font-mono"/>
                            </div>
                            <input placeholder="ชื่อ (optional)"
                              value={adminFormData.displayName || ''}
                              onChange={e => setAddAdminForm(p => ({ ...p, [shop.id]: { ...adminFormData, displayName: e.target.value } }))}
                              className="w-28 bg-slate-800 border border-slate-700 text-white text-xs rounded-xl px-3 py-2 outline-none focus:border-indigo-500"/>
                            <button onClick={() => handleAddShopAdmin(shop.id)}
                              className="flex items-center gap-1 px-3 py-2 bg-indigo-600 hover:bg-indigo-700 text-white rounded-xl text-xs font-bold transition-all">
                              <UserPlus size={13}/> เพิ่ม
                            </button>
                          </div>
                          <div className="text-[9px] text-slate-600 mt-1.5 space-y-0.5">
                            <p>Admin ที่เพิ่มจากที่นี่จะถูก approve ทันที ไม่ต้องรอเจ้าของร้าน</p>
                            <p className="text-slate-700">💡 ไม่รู้ LINE ID? ใช้ LINE ID เจ้าของ (คัดลอกจาก "LINE ID (เจ้าของ)" ด้านบน) หรือให้ลูกค้า forward ข้อความใน LINE แล้ว bot จะแสดง user ID</p>
                          </div>
                        </div>

                        {/* Quick Actions */}
                        <div className="flex flex-wrap gap-2 pt-1 border-t border-slate-800/50">
                          <span className="text-[9px] text-slate-600 uppercase tracking-widest self-center mr-1">Quick:</span>
                          {[
                            { label: '+200 Pro', action: () => { setEditCredit(p=>({...p,[shop.id]:'200'})); } },
                            { label: '+500 Advance', action: () => { setEditCredit(p=>({...p,[shop.id]:'500'})); } },
                            { label: '+1000 Business', action: () => { setEditCredit(p=>({...p,[shop.id]:'1000'})); } },
                          ].map((q, i) => (
                            <button key={i} onClick={q.action}
                              className="text-[10px] px-2.5 py-1.5 bg-slate-800 hover:bg-indigo-900 text-slate-400 hover:text-indigo-300 rounded-lg transition-all font-mono">
                              {q.label}
                            </button>
                          ))}
                          <button onClick={() => handleDelete(shop.id, shop.shop_name)}
                            className="ml-auto text-[10px] px-2.5 py-1.5 bg-rose-500/10 text-rose-500 hover:bg-rose-500 hover:text-white rounded-lg transition-all font-bold">
                            ลบร้านนี้
                          </button>
                        </div>
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>

        {/* Legend */}
        <div className="text-[10px] text-slate-600 text-center space-y-1">
          <p><span className="text-indigo-400 font-bold">⚡✓</span> = Manual payment (เปลี่ยน tier + เติมเครดิตตาม plan พร้อมกัน) &nbsp;|&nbsp; <span className="text-slate-400 font-bold">✓</span> = เปลี่ยน tier อย่างเดียว</p>
          <p><span className="text-emerald-400 font-bold">+</span> = เติมเครดิตเพิ่ม &nbsp;|&nbsp; <span className="text-blue-400 font-bold">=</span> ตั้งค่าเครดิตเป็นตัวเลขนี้เลย</p>
        </div>
        </> }
      </div>
    </div>
  );
}

// ════ Invoice Tab Component ════
const PLAN_NAMES = { advance: 'Advance', business: 'Business', enterprise: 'Enterprise', pro: 'Pro' };
const STATUS_LABEL = { pending: 'รอดำเนินการ', approved: 'อนุมัติแล้ว', issued: 'ออกใบกำกับแล้ว', rejected: 'ปฏิเสธ' };
const STATUS_COLOR = {
  pending:  'bg-orange-500/20 text-orange-400',
  approved: 'bg-blue-500/20 text-blue-400',
  issued:   'bg-emerald-500/20 text-emerald-400',
  rejected: 'bg-rose-500/20 text-rose-400',
};

const SELLER = {
  name: 'บริษัท สยาม โกลบอล เน็ทเวิร์ค เอ็นเตอร์ไพรส์ จำกัด',
  branch: 'สำนักงานใหญ่',
  taxId: '0505565019236',
  address: '76 หมู่ 9 ต.หางดง อ.หางดง จ.เชียงใหม่ 50230',
  phone: '062-929-9552',
  bank: 'ธนาคารกสิกรไทย',
  accountNo: '175-873-123-1',
};

function InvoiceTab({ invoices, invoiceFilter, setInvoiceFilter, handleIssue, handleInvoiceStatus, issuingId, fmt, adminToken, onRefresh }) {
  const [printTarget, setPrintTarget]   = useState(null);
  const [printMode,   setPrintMode]     = useState('original'); // 'original' | 'copy' | 'both'
  const [sendingEmail, setSendingEmail] = useState(null);

  const filtered = invoiceFilter === 'all' ? invoices : invoices.filter(i => i.status === invoiceFilter);

  const doPrint = (inv, mode) => {
    setPrintTarget(inv);
    setPrintMode(mode || 'original');
    setTimeout(() => window.print(), 400);
  };

  const handleSendEmail = async (inv) => {
    if (!inv.buyer_email) { alert('ไม่มีอีเมลผู้รับ'); return; }
    setSendingEmail(inv.id);
    try {
      const res = await fetch('/api/admin/send-email', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-admin-token': adminToken },
        body: JSON.stringify({ inv }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      alert(`✅ ส่งอีเมล PDF ไปที่ ${inv.buyer_email} แล้ว`);
    } catch (err) {
      alert('ส่งอีเมลไม่สำเร็จ: ' + err.message);
    }
    setSendingEmail(null);
  };

  return (
    <>
      {/* ── Print overlay (ต้องอยู่นอก #admin-screen เพื่อให้ visibility override ทำงาน) ── */}
      {printTarget && (
        <>
          <style>{`
            #tax-inv-print { position: fixed; left: -9999px; top: 0; width: 210mm; visibility: hidden; }
            @media print {
              body * { visibility: hidden !important; }
              #tax-inv-print, #tax-inv-print * { visibility: visible !important; }
              #tax-inv-print {
                position: absolute !important;
                top: 0 !important; left: 0 !important;
                width: 100% !important;
                background: white !important;
                z-index: 9999;
              }
              #admin-screen { height: 0 !important; overflow: hidden !important; min-height: 0 !important; }
              @page { size: A4; margin: 10mm; }
            }
          `}</style>
          <div id="tax-inv-print">
            <TaxInvoiceDoc inv={printTarget} fmt={fmt} copyLabel={printMode === 'copy' ? 'สำเนา' : 'ต้นฉบับ'}/>
            {printMode === 'both' && (
              <div style={{ pageBreakBefore:'always' }}>
                <TaxInvoiceDoc inv={printTarget} fmt={fmt} copyLabel="สำเนา"/>
              </div>
            )}
          </div>
        </>
      )}

    <div id="admin-screen" className="space-y-4">

      {/* Filter + Refresh */}
      <div className="flex gap-2 flex-wrap items-center justify-between">
        <div className="flex gap-2 flex-wrap">
          {['all','pending','approved','issued','rejected'].map(s => (
            <button key={s} onClick={() => setInvoiceFilter(s)}
              className={`px-3 py-1.5 rounded-xl text-xs font-bold transition-all ${invoiceFilter === s ? 'bg-indigo-600 text-white' : 'bg-slate-900 border border-slate-800 text-slate-400 hover:text-white'}`}>
              {s === 'all' ? 'ทั้งหมด' : STATUS_LABEL[s]}
              {s !== 'all' && <span className="ml-1 text-[10px] opacity-60">({invoices.filter(i=>i.status===s).length})</span>}
            </button>
          ))}
        </div>
        <button onClick={onRefresh}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-bold bg-slate-900 border border-slate-700 text-slate-400 hover:text-white hover:border-indigo-500 transition-all">
          ↻ รีเฟรช
        </button>
      </div>

      {filtered.length === 0 ? (
        <div className="bg-slate-900 border border-slate-800 rounded-3xl py-16 text-center text-slate-600 font-bold">
          ไม่มีรายการ
        </div>
      ) : (
        <div className="space-y-3">
          {filtered.map(inv => (
            <div key={inv.id} className="bg-slate-900 border border-slate-800 rounded-2xl p-5">
              <div className="flex items-start justify-between gap-4 flex-wrap">
                <div className="space-y-1 flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className={`text-[10px] font-black px-2 py-0.5 rounded-full ${STATUS_COLOR[inv.status]}`}>
                      {STATUS_LABEL[inv.status]}
                    </span>
                    <span className="text-xs font-black text-white">{inv.buyer_name}</span>
                    {inv.buyer_branch && <span className="text-[10px] text-slate-500">({inv.buyer_branch})</span>}
                  </div>
                  <p className="text-[10px] text-slate-500 font-mono">เลขภาษี: {inv.buyer_tax_id}</p>
                  <p className="text-[10px] text-slate-500">{inv.buyer_address}</p>
                  {inv.buyer_email && <p className="text-[10px] text-slate-500">{inv.buyer_email}</p>}
                  <div className="flex gap-3 mt-1">
                    <span className="text-xs font-bold text-indigo-400">{PLAN_NAMES[inv.plan_id]} {inv.is_yearly ? 'รายปี' : 'รายเดือน'}</span>
                    <span className="text-xs text-slate-400">฿{fmt(inv.total_price)} | สุทธิ ฿{fmt(inv.net_amount)}</span>
                    {inv.tax_invoice_no && <span className="text-xs text-emerald-400 font-mono">{inv.tax_invoice_no}</span>}
                  </div>
                  <p className="text-[9px] text-slate-600">{inv.invoice_no} · {new Date(inv.created_at).toLocaleDateString('th-TH')}</p>
                </div>

                {/* Actions */}
                <div className="flex gap-2 flex-wrap shrink-0">
                  {inv.status === 'pending' && (
                    <>
                      <button onClick={() => handleInvoiceStatus(inv.id, 'approve')}
                        className="px-3 py-1.5 bg-blue-500/20 text-blue-400 hover:bg-blue-500 hover:text-white rounded-xl text-xs font-bold transition-all">
                        อนุมัติ
                      </button>
                      <button onClick={() => handleInvoiceStatus(inv.id, 'reject')}
                        className="px-3 py-1.5 bg-slate-800 text-slate-400 hover:bg-rose-500 hover:text-white rounded-xl text-xs font-bold transition-all">
                        ปฏิเสธ
                      </button>
                    </>
                  )}
                  {inv.status === 'approved' && (
                    <button onClick={() => handleIssue(inv)} disabled={issuingId === inv.id}
                      className="flex items-center gap-1.5 px-3 py-1.5 bg-emerald-500/20 text-emerald-400 hover:bg-emerald-500 hover:text-white rounded-xl text-xs font-bold transition-all disabled:opacity-50">
                      <FileText size={12}/> {issuingId === inv.id ? 'กำลังออก...' : 'ออกใบกำกับภาษี'}
                    </button>
                  )}
                  {inv.status === 'issued' && (
                    <>
                      <button onClick={() => doPrint(inv,'original')}
                        className="flex items-center gap-1.5 px-3 py-1.5 bg-slate-700 text-slate-300 hover:bg-slate-600 rounded-xl text-xs font-bold transition-all">
                        <Printer size={12}/> ต้นฉบับ
                      </button>
                      <button onClick={() => doPrint(inv,'copy')}
                        className="flex items-center gap-1.5 px-3 py-1.5 bg-slate-700 text-slate-300 hover:bg-slate-600 rounded-xl text-xs font-bold transition-all">
                        <Printer size={12}/> สำเนา
                      </button>
                      <button onClick={() => doPrint(inv,'both')}
                        className="flex items-center gap-1.5 px-3 py-1.5 bg-slate-700 text-slate-300 hover:bg-slate-600 rounded-xl text-xs font-bold transition-all">
                        <Printer size={12}/> ทั้งสอง
                      </button>
                      <a href={`/api/admin/invoice-pdf?id=${inv.id}&token=${adminToken}`}
                        download
                        className="flex items-center gap-1.5 px-3 py-1.5 bg-emerald-500/20 text-emerald-400 hover:bg-emerald-500 hover:text-white rounded-xl text-xs font-bold transition-all">
                        ⬇ PDF
                      </a>
                      {inv.buyer_email && (
                        <button onClick={() => handleSendEmail(inv)}
                          disabled={sendingEmail === inv.id}
                          className="flex items-center gap-1.5 px-3 py-1.5 bg-indigo-500/20 text-indigo-400 hover:bg-indigo-500 hover:text-white rounded-xl text-xs font-bold transition-all disabled:opacity-50">
                          <Send size={12}/> {sendingEmail === inv.id ? 'กำลังส่ง...' : 'ส่งอีเมล PDF'}
                        </button>
                      )}
                    </>
                  )}
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
    </>
  );
}

function fmtNum(n) {
  return Number(n).toLocaleString('th-TH', { minimumFractionDigits:2, maximumFractionDigits:2 });
}

function bahtText(amount) {
  const ones = ['','หนึ่ง','สอง','สาม','สี่','ห้า','หก','เจ็ด','แปด','เก้า'];
  function spell(n) {
    if (!n) return '';
    const units = [[1000000,'ล้าน'],[100000,'แสน'],[10000,'หมื่น'],[1000,'พัน'],[100,'ร้อย']];
    let s = '';
    for (const [d,label] of units) {
      const q = Math.floor(n / d);
      if (q) { s += ones[q] + label; n %= d; }
    }
    const ten = Math.floor(n / 10), one = n % 10;
    if (ten === 1) s += 'สิบ';
    else if (ten === 2) s += 'ยี่สิบ';
    else if (ten > 0) s += ones[ten] + 'สิบ';
    if (one === 1 && ten > 0) s += 'เอ็ด';
    else if (one > 0) s += ones[one];
    return s;
  }
  const v = Math.round(Number(amount) * 100) / 100;
  const baht = Math.floor(v);
  const satang = Math.round((v - baht) * 100);
  return (baht ? spell(baht) : 'ศูนย์') + 'บาท' + (satang ? spell(satang) + 'สตางค์' : 'ถ้วน');
}

function TaxInvoiceDoc({ inv, fmt, copyLabel }) {
  const issueDate = inv.approved_at
    ? new Date(inv.approved_at).toLocaleDateString('th-TH', { year:'numeric', month:'long', day:'numeric' })
    : new Date().toLocaleDateString('th-TH', { year:'numeric', month:'long', day:'numeric' });
  const period = inv.is_yearly ? 'รายปี (12 เดือน)' : 'รายเดือน (1 เดือน)';
  const unit   = inv.is_yearly ? 'ปี' : 'เดือน';
  const isCopy = copyLabel === 'สำเนา';
  const page = { fontFamily:"'Sarabun','Noto Sans Thai',sans-serif", color:'#1e293b', backgroundColor:'white', padding:'20px 24px', fontSize:'9.5pt', lineHeight:1.5 };

  return (
    <div style={page}>

      {/* ════ HEADER ════ */}
      <div style={{ display:'flex', justifyContent:'space-between', alignItems:'flex-start', marginBottom:8 }}>

        {/* Logo + ผู้ขาย */}
        <div style={{ width:'54%' }}>
          <div style={{ display:'flex', alignItems:'center', gap:10, marginBottom:6 }}>
            <img src="/logo-siam-global-network-enterprise.jpg" alt="logo"
              style={{ width:50, height:50, objectFit:'contain' }}
              onError={e=>{ e.target.style.display='none'; }}/>
            <div>
              <div style={{ fontSize:'10.5pt', fontWeight:900, lineHeight:1.3 }}>{SELLER.name}</div>
              <div style={{ fontSize:'8pt', color:'#64748b' }}>({SELLER.branch})</div>
            </div>
          </div>
          <div style={{ fontSize:'8.5pt', color:'#475569', lineHeight:1.7 }}>
            {SELLER.address}<br/>
            <strong>เลขประจำตัวผู้เสียภาษี:</strong> {SELLER.taxId} &nbsp;|&nbsp; <strong>โทร.</strong> {SELLER.phone}
          </div>
        </div>

        {/* Title + copy label + doc info */}
        <div style={{ width:'43%' }}>
          {/* Title row */}
          <div style={{ display:'flex', alignItems:'baseline', justifyContent:'flex-end', gap:10, marginBottom:2 }}>
            <div style={{ textAlign:'right' }}>
              <div style={{ fontSize:'18pt', fontWeight:900, color:'#1e293b', lineHeight:1.1 }}>ใบกำกับภาษี / ใบเสร็จรับเงิน</div>
              <div style={{ fontSize:'9pt', color:'#475569' }}>Tax Invoice / Receipt</div>
            </div>
            {/* ต้นฉบับ/สำเนา badge — ขวาล่างของ title ไม่ทับ */}
            <div style={{ flexShrink:0, border:`2px solid ${isCopy?'#94a3b8':'#1e40af'}`, borderRadius:4, padding:'2px 8px', fontSize:'8pt', fontWeight:900, color:isCopy?'#64748b':'#1e40af', letterSpacing:1.5, alignSelf:'flex-start' }}>
              {copyLabel || 'ต้นฉบับ'}
            </div>
          </div>
          {/* Doc info table */}
          <div style={{ marginTop:6, border:'1px solid #cbd5e1', borderRadius:4, overflow:'hidden', fontSize:'8.5pt' }}>
            {[['เลขที่', inv.tax_invoice_no||'-'], ['วันที่ออก', issueDate], ['อ้างอิง', inv.invoice_no||'-']].map(([l,v])=>(
              <div key={l} style={{ display:'flex', borderBottom:'1px solid #e2e8f0' }}>
                <div style={{ width:'38%', padding:'3px 8px', fontWeight:700, color:'#64748b', borderRight:'1px solid #e2e8f0', backgroundColor:'#f8fafc' }}>{l}</div>
                <div style={{ padding:'3px 8px', fontFamily: l==='เลขที่'?'monospace':'inherit', fontWeight: l==='เลขที่'?700:400 }}>{v}</div>
              </div>
            ))}
          </div>
        </div>
      </div>

      <div style={{ borderTop:'2.5px solid #1e40af', marginBottom:8 }}/>

      {/* ════ BUYER ════ */}
      <div style={{ border:'1px solid #cbd5e1', borderRadius:4, padding:'7px 10px', marginBottom:8 }}>
        <div style={{ fontSize:'7.5pt', fontWeight:900, color:'#1e40af', marginBottom:3, textTransform:'uppercase', letterSpacing:1 }}>ผู้ซื้อ / Buyer</div>
        <div style={{ display:'flex', gap:16, flexWrap:'wrap' }}>
          <div style={{ flex:'1 1 55%' }}>
            <div style={{ fontWeight:700, fontSize:'10pt' }}>{inv.buyer_name}{inv.buyer_branch?` (${inv.buyer_branch})`:''}</div>
            <div style={{ fontSize:'8.5pt', color:'#475569', marginTop:2 }}>{inv.buyer_address}</div>
            <div style={{ fontSize:'8.5pt', color:'#475569' }}><strong>เลขภาษี:</strong> {inv.buyer_tax_id}</div>
          </div>
          <div style={{ flex:'1 1 35%', fontSize:'8.5pt', color:'#475569' }}>
            {inv.buyer_contact && <div><strong>ผู้ติดต่อ:</strong> {inv.buyer_contact}</div>}
            {inv.buyer_phone   && <div><strong>โทร.:</strong> {inv.buyer_phone}</div>}
            {inv.buyer_email   && <div><strong>Email:</strong> {inv.buyer_email}</div>}
          </div>
        </div>
      </div>

      {/* ════ ITEMS TABLE ════ */}
      <table style={{ width:'100%', borderCollapse:'collapse', border:'1px solid #cbd5e1', fontSize:'8.5pt', marginBottom:0 }}>
        <thead>
          <tr style={{ backgroundColor:'#1e293b', color:'white' }}>
            <th style={{ padding:'5px 7px', width:'5%',  borderRight:'1px solid #374151', textAlign:'center' }}>#</th>
            <th style={{ padding:'5px 7px', width:'49%', borderRight:'1px solid #374151', textAlign:'left'   }}>รายการสินค้า/บริการ</th>
            <th style={{ padding:'5px 7px', width:'7%',  borderRight:'1px solid #374151', textAlign:'center' }}>จำนวน</th>
            <th style={{ padding:'5px 7px', width:'7%',  borderRight:'1px solid #374151', textAlign:'center' }}>หน่วย</th>
            <th style={{ padding:'5px 7px', width:'16%', borderRight:'1px solid #374151', textAlign:'right'  }}>ราคาก่อน VAT</th>
            <th style={{ padding:'5px 7px', width:'16%', textAlign:'right' }}>ราคารวม VAT</th>
          </tr>
        </thead>
        <tbody>
          <tr style={{ borderBottom:'1px solid #e2e8f0' }}>
            <td style={{ padding:'7px', textAlign:'center', borderRight:'1px solid #e2e8f0' }}>1</td>
            <td style={{ padding:'7px', borderRight:'1px solid #e2e8f0' }}>
              <div style={{ fontWeight:700 }}>Smile Slip Pro — {PLAN_NAMES[inv.plan_id]||inv.plan_id}</div>
              <div style={{ fontSize:'7.5pt', color:'#64748b' }}>บริการซอฟต์แวร์บันทึกสลิปโอนเงินด้วย AI ({period})</div>
            </td>
            <td style={{ padding:'7px', textAlign:'center', borderRight:'1px solid #e2e8f0' }}>1</td>
            <td style={{ padding:'7px', textAlign:'center', borderRight:'1px solid #e2e8f0' }}>{unit}</td>
            <td style={{ padding:'7px', textAlign:'right', borderRight:'1px solid #e2e8f0', fontFamily:'monospace' }}>{fmtNum(inv.base_price)}</td>
            <td style={{ padding:'7px', textAlign:'right', fontFamily:'monospace', fontWeight:700 }}>{fmtNum(inv.total_price)}</td>
          </tr>
          <tr><td colSpan={6} style={{ padding:'6px' }}></td></tr>
          <tr><td colSpan={6} style={{ padding:'6px' }}></td></tr>
        </tbody>
      </table>

      {/* ════ TOTALS (ตัวอักษร + ตัวเลข) ════ */}
      <div style={{ display:'flex', border:'1px solid #cbd5e1', borderTop:'none', marginBottom:8 }}>
        {/* จำนวนเงินตัวอักษร */}
        <div style={{ flex:1, padding:'7px 10px', borderRight:'1px solid #cbd5e1', fontSize:'8.5pt' }}>
          <div style={{ fontSize:'7.5pt', color:'#94a3b8', marginBottom:2 }}>จำนวนเงินรวมทั้งสิ้น (ตัวอักษร) / Grand Total Baht (Text)</div>
          <div style={{ fontWeight:700, color:'#1e293b' }}>{bahtText(inv.total_price)}</div>
        </div>
        {/* ตัวเลข */}
        <div style={{ width:'42%', fontSize:'8.5pt' }}>
          {[
            ['มูลค่าสินค้า/บริการ (ก่อน VAT)', fmtNum(inv.base_price), false],
            ['ภาษีมูลค่าเพิ่ม 7%',              fmtNum(inv.vat_amount),  false],
            ['รวมทั้งสิ้น (รวม VAT)',            fmtNum(inv.total_price), true],
            ['หัก ณ ที่จ่าย 3% (WHT)',           `(${fmtNum(inv.wht_amount)})`, false],
          ].map(([l,v,bold],i)=>(
            <div key={i} style={{ display:'flex', justifyContent:'space-between', padding:'3px 10px', borderBottom:'1px solid #e2e8f0', fontWeight:bold?700:400, color: i===3?'#dc2626':'inherit' }}>
              <span>{l}</span><span style={{ fontFamily:'monospace' }}>{v}</span>
            </div>
          ))}
          <div style={{ display:'flex', justifyContent:'space-between', padding:'5px 10px', backgroundColor:'#eff6ff', fontWeight:900, fontSize:'10pt', borderTop:'2px solid #1e40af' }}>
            <span>ยอดสุทธิที่ชำระ</span>
            <span style={{ fontFamily:'monospace', color:'#1e40af' }}>{fmtNum(inv.net_amount)}</span>
          </div>
        </div>
      </div>

      {/* ════ ข้อมูลการชำระเงิน (ด้านล่างตาราง) ════ */}
      <div style={{ border:'1px solid #fde68a', borderRadius:4, padding:'7px 12px', backgroundColor:'#fefce8', marginBottom:10, fontSize:'8.5pt' }}>
        <div style={{ fontSize:'7.5pt', fontWeight:900, color:'#92400e', marginBottom:4, textTransform:'uppercase', letterSpacing:1 }}>ข้อมูลการชำระเงิน / Payment Information</div>
        <div style={{ display:'flex', gap:24, flexWrap:'wrap', color:'#78350f', lineHeight:1.8 }}>
          <div>
            <strong>ธนาคาร:</strong> {SELLER.bank} &nbsp;|&nbsp;
            <strong>เลขที่บัญชี:</strong> {SELLER.accountNo} &nbsp;|&nbsp;
            <strong>ชื่อบัญชี:</strong> {SELLER.name}
          </div>
          <div style={{ marginLeft:'auto', fontWeight:900, color:'#1e40af', fontSize:'9.5pt' }}>
            ยอดโอน (หัก WHT 3%): ฿{fmtNum(inv.net_amount)}
          </div>
        </div>
      </div>

      {/* ════ SIGNATURE AREA ════ */}
      <div style={{ display:'flex', justifyContent:'space-between', gap:12, fontSize:'8.5pt' }}>

        {/* ลูกค้าเซ็น */}
        <div style={{ flex:1, textAlign:'center', border:'1px dashed #cbd5e1', borderRadius:4, padding:'8px' }}>
          <div style={{ fontWeight:700, marginBottom:3, fontSize:'8pt' }}>ในนาม {inv.buyer_name}</div>
          <div style={{ height:52 }}/>
          <div style={{ borderTop:'1px solid #94a3b8', paddingTop:4, marginTop:4 }}>ลายมือชื่อผู้รับบริการ / Authorized Signature</div>
          <div style={{ color:'#94a3b8', marginTop:3, fontSize:'8pt' }}>วันที่ _____ / _____ / _________</div>
        </div>

        {/* ผู้ออกใบกำกับ (ลายเซ็น + ตราประทับแยกกัน) */}
        <div style={{ flex:1, textAlign:'center', border:'1px solid #e2e8f0', borderRadius:4, padding:'8px', position:'relative' }}>
          <div style={{ fontWeight:700, marginBottom:3, fontSize:'8pt' }}>{SELLER.name}</div>
          {/* Seal ซ้ายบน, Signature ขวา — ไม่ทับกัน */}
          <div style={{ display:'flex', alignItems:'center', justifyContent:'center', gap:8, height:60 }}>
            <img src="/seal.jpg" alt="ตราประทับ"
              style={{ height:56, width:56, objectFit:'contain', opacity:0.9 }}
              onError={e=>{ e.target.style.display='none'; }}/>
            <img src="/Signature.jpg" alt="ลายเซ็น"
              style={{ height:40, maxWidth:100, objectFit:'contain' }}
              onError={e=>{ e.target.style.display='none'; }}/>
          </div>
          <div style={{ borderTop:'1px solid #94a3b8', paddingTop:4, marginTop:4 }}>ผู้มีอำนาจลงนาม / Authorized Signatory</div>
          <div style={{ color:'#475569', marginTop:2, fontSize:'8pt' }}>{issueDate}</div>
        </div>
      </div>

      {/* ════ FOOTER ════ */}
      <div style={{ marginTop:10, padding:'5px 10px', backgroundColor:'#f1f5f9', borderRadius:4, fontSize:'7.5pt', color:'#64748b', borderTop:'1px solid #e2e8f0' }}>
        เอกสารนี้ออกโดย {SELLER.name} จดทะเบียนภาษีมูลค่าเพิ่ม (VAT Registered) ·
        เลขที่ใบกำกับภาษี: <strong>{inv.tax_invoice_no}</strong> ·
        LINE: lin.ee/uYhct4L · โทร. {SELLER.phone}
      </div>
    </div>
  );
}
