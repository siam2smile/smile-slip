import React, { useState, useEffect } from 'react';
import { useRouter } from 'next/router';
import Head from 'next/head';
import {
  LayoutDashboard, TrendingUp, GitBranch, Settings, CreditCard,
  LogOut, FileSpreadsheet, FolderOpen, RefreshCcw, CheckCircle2, Circle,
  ExternalLink, Edit3, Landmark, Receipt, Wallet,
  PlusCircle, Trash2, Clock, Download, AlertTriangle,
  Menu, ChevronLeft, ChevronRight, BarChart2, Copy, Share2, Users,
  Shield, UserPlus, UserX, HelpCircle, X
} from 'lucide-react';
import Link from 'next/link';

// ─── Tier utilities ───
const TIER_ORDER = { normal: 0, pro: 1, advance: 2, business: 3, enterprise: 4, super: 4 };
const tierBadge = {
  normal:     'bg-slate-100 text-slate-600',
  pro:        'bg-amber-100 text-amber-700',
  advance:    'bg-indigo-100 text-indigo-700',
  business:   'bg-emerald-100 text-emerald-700',
  enterprise: 'bg-violet-100 text-violet-700',
  super:      'bg-violet-100 text-violet-700',
};
const tierLabel = {
  normal: 'Starter', pro: 'PRO', advance: 'Advance',
  business: 'Business', enterprise: 'Enterprise', super: 'Enterprise',
};
const MAX_BRANCHES = { normal: 1, pro: 1, advance: 5, business: 10, enterprise: 20, super: 20 };
const hasFeature = (tier, minTier) => (TIER_ORDER[tier] || 0) >= (TIER_ORDER[minTier] || 0);

// ─── Mini bar chart (CSS-based, no dependency) ───
function MiniBar({ value, max, color = 'bg-blue-500', height = 'h-full', label }) {
  const pct = max > 0 ? Math.round((value / max) * 100) : 0;
  return (
    <div className="flex flex-col items-center gap-1 flex-1">
      <div className="w-full bg-slate-100 rounded-t-sm flex-1 flex flex-col justify-end" style={{ height: 80 }}>
        <div className={`${color} rounded-t-sm transition-all`} style={{ height: `${pct}%` }}/>
      </div>
      {label && <span className="text-[9px] text-slate-400 text-center whitespace-nowrap">{label}</span>}
    </div>
  );
}

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
  const [newBranchBrand, setNewBranchBrand] = useState('');
  const [editBranchBrand, setEditBranchBrand] = useState({}); // branchId -> brand_name ระหว่างแก้ไข
  const [branchLoading, setBranchLoading] = useState(false);
  const [currentTime, setCurrentTime] = useState(new Date());
  const [isEditingProfile, setIsEditingProfile] = useState(false);
  const [editForm, setEditForm] = useState({ shopName: '', email: '', phone: '', taxId: '', userType: 'individual', address: '' });
  const [savingProfile, setSavingProfile] = useState(false);

  // Sidebar
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

  // Accounts tab sub-tab
  const [accountsSubTab, setAccountsSubTab] = useState('ledger'); // 'ledger' | 'tax'

  // Ledger
  const [ledgerYear, setLedgerYear] = useState(new Date().getFullYear().toString());
  const [ledgerMonth, setLedgerMonth] = useState((new Date().getMonth() + 1).toString().padStart(2, '0'));
  const [exportLoading, setExportLoading] = useState(false);
  const [ledgerConnected, setLedgerConnected] = useState(true);

  // Bank account form
  const BANK_LIST = ['กสิกรไทย','กรุงเทพ','กรุงไทย','กรุงศรีอยุธยา','ไทยพาณิชย์','ออมสิน','ทหารไทยธนชาต','เกียรตินาคินภัทร','ซีไอเอ็มบี','ยูโอบี','แลนด์แอนด์เฮาส์','อาคารสงเคราะห์','อิสลาม','ทิสโก้','ธ.ก.ส.','ไทยเครดิต','สแตนดาร์ดชาร์เตอร์ด'];
  const [addBankForm, setAddBankForm] = useState({ bankName: 'กสิกรไทย', accountName: '', accountNumber: '', accountType: 'ออมทรัพย์' });
  const [addingBank, setAddingBank] = useState(false);
  const [showAddBank, setShowAddBank] = useState(false);

  // Analytics
  const [analyticsData, setAnalyticsData] = useState(null);
  const [analyticsLoading, setAnalyticsLoading] = useState(false);
  const [marketingData, setMarketingData] = useState(null);
  const [marketingLoading, setMarketingLoading] = useState(false);
  const [heatmapBranch, setHeatmapBranch] = useState('all');
  const [rfmBrand, setRfmBrand] = useState('');
  const [rfmSelectedSeg, setRfmSelectedSeg] = useState(null); // key ของ segment ที่กด
  const [analyticsYear, setAnalyticsYear] = useState(new Date().getFullYear().toString());
  const [analyticsView, setAnalyticsView] = useState('daily'); // 'daily' | 'monthly'
  const [analyticsMonth, setAnalyticsMonth] = useState((new Date().getMonth() + 1).toString().padStart(2, '0'));
  const [analyticsBranch, setAnalyticsBranch] = useState('all'); // 'all' = รวมทุกสาขา

  // Tax Report
  const [taxReport, setTaxReport] = useState(null);
  const [taxReportLoading, setTaxReportLoading] = useState(false);
  const [taxReportYear, setTaxReportYear] = useState(new Date().getFullYear().toString());
  const [taxReportMonth, setTaxReportMonth] = useState('');
  const [taxExpandedId, setTaxExpandedId] = useState(null);

  // Ledger pagination + date filter
  const [ledgerPage, setLedgerPage] = useState(0);
  const [ledgerDate, setLedgerDate] = useState('');
  const [ledgerTypeFilter, setLedgerTypeFilter] = useState('all'); // all | income | income-transfer | income-cash | expense | expense-transfer | expense-cash
  const [ledgerBranchFilter, setLedgerBranchFilter] = useState('all');
  const LEDGER_PAGE_SIZE = 20;

  // Referral
  const [referralInfo, setReferralInfo] = useState(null);
  const [copiedRef, setCopiedRef] = useState(false);

  // Testimonial
  const [testimonialSubmitted, setTestimonialSubmitted] = useState(null); // null = ยังไม่เช็ค
  const [testimonialForm, setTestimonialForm] = useState({ name: '', role: '', message: '', stars: 5 });
  const [savingTestimonial, setSavingTestimonial] = useState(false);

  // Admin mode
  const [adminId, setAdminId] = useState(null); // LINE ID ของแอดมินที่ login อยู่

  // Subscription status
  const [subInfo, setSubInfo] = useState(null);
  const [cancellingSubscription, setCancellingSubscription] = useState(false);

  // Admin management (สำหรับเจ้าของร้าน)
  const [shopAdmins, setShopAdmins] = useState([]);
  const [pendingAdmins, setPendingAdmins] = useState([]);
  const [addingAdmin, setAddingAdmin] = useState(false);

  // Manual entry modal
  const [showAddModal, setShowAddModal] = useState(false);
  const [addForm, setAddForm] = useState({ type: 'รายรับ', amount: '', date: '', time: '', sender: '', receiver: '', note: '', method: 'โอน' });
  const [addingSaving, setAddingSaving] = useState(false);

  // ─── Timers ───
  useEffect(() => {
    const timer = setInterval(() => setCurrentTime(new Date()), 1000);
    return () => clearInterval(timer);
  }, []);

  // ─── Router ready ───
  useEffect(() => {
    if (router.isReady) {
      const { userId, reconnectGoogle: rg, adminId: aid, tab } = router.query;
      if (!userId) { router.push('/login'); return; }
      if (rg === 'true') setReconnectGoogle(true);
      if (aid) setAdminId(aid);
      if (tab) setActiveTab(tab);
      fetchData(userId);
    }
  }, [router.isReady, router.query]);

  // ─── Derived from shopInfo state (must come before useEffect that references them) ───
  const tierKey = (shopInfo?.subscription_tier || 'normal').toLowerCase();
  const isUnlimited = tierKey === 'enterprise' || tierKey === 'super';
  const isPaidTier = tierKey !== 'normal';

  useEffect(() => {
    if (shopInfo?.id && isPaidTier) {
      fetch(`/api/shop/testimonial?shopId=${shopInfo.id}`)
        .then(r => r.json())
        .then(d => setTestimonialSubmitted(!!d.alreadySubmitted))
        .catch(() => {});
    }
  }, [shopInfo?.id, isPaidTier]);

  const handleSubmitTestimonial = async (e) => {
    e.preventDefault();
    if (!testimonialForm.name || !testimonialForm.message) return alert('กรอกชื่อและข้อความรีวิวก่อนครับ');
    setSavingTestimonial(true);
    try {
      const res = await fetch('/api/shop/testimonial', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ shopId: shopInfo.id, ...testimonialForm }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      setTestimonialSubmitted(true);
      alert(`✅ ขอบคุณสำหรับรีวิว! ได้รับ ${data.creditsAdded} เครดิตฟรีแล้วครับ`);
    } catch (err) { alert('ไม่สำเร็จ: ' + err.message); }
    setSavingTestimonial(false);
  };

  // ─── Tab changes ───
  useEffect(() => {
    if (activeTab === 'accounts' && shopInfo?.id) fetchTransactions(shopInfo.id, ledgerYear, ledgerMonth);
    if (activeTab === 'branches' && shopInfo?.id) fetchBranches(shopInfo.id);
    if (activeTab === 'analytics' && shopInfo?.id) {
      fetchAnalytics(shopInfo.id, analyticsYear);
      if (isUnlimited) fetchMarketing(shopInfo.id);
    }
  }, [activeTab, shopInfo, isUnlimited]);

  // ─── Fetch functions ───
  const fetchData = async (userId) => {
    setIsLoaded(false);
    try {
      const res = await fetch(`/api/shop/data?userId=${encodeURIComponent(userId)}`);
      const data = await res.json();
      if (data.profile) {
        setShopInfo(data.profile);
        setEditForm({ shopName: data.profile.shop_name || '', email: data.profile.email || '', phone: data.profile.phone || '', taxId: data.profile.tax_id || '', userType: data.profile.user_type || 'individual', address: data.profile.address || '' });
        setCredits(data.credits ?? 0);
        setGoogleConfig(data.googleConfig);
        setBankAccounts(data.bankAccounts || []);
        fetchReferral(data.profile.id);
        fetchSubscription(data.profile.id);
        fetchAdmins(data.profile.id);
        fetchBranches(data.profile.id);
      }
      setIsLoaded(true);
    } catch (error) {
      console.error('fetchData error:', error);
      setIsLoaded(true);
    }
  };

  const fetchReferral = async (shopId) => {
    try {
      const res = await fetch(`/api/shop/referral?shopId=${shopId}`);
      const data = await res.json();
      if (!data.error) setReferralInfo(data);
    } catch {}
  };

  const fetchSubscription = async (shopId) => {
    try {
      const res = await fetch(`/api/shop/subscription?shopId=${shopId}`);
      const data = await res.json();
      setSubInfo(data);
    } catch {}
  };

  const fetchAdmins = async (shopId) => {
    try {
      const res = await fetch(`/api/shop/admins?shopId=${shopId}`);
      const data = await res.json();
      setShopAdmins(data.admins || []);
      setPendingAdmins(data.pending || []);
    } catch {}
  };

  const handleApproveAdmin = async (adminRowId) => {
    setAddingAdmin(true);
    try {
      const res = await fetch('/api/shop/admins', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ shopId: shopInfo.id, adminId: adminRowId, action: 'approve' }),
      });
      const data = await res.json();
      if (data.error) alert('เกิดข้อผิดพลาด: ' + data.error);
      else await fetchAdmins(shopInfo.id);
    } catch { alert('เกิดข้อผิดพลาด กรุณาลองใหม่'); }
    finally { setAddingAdmin(false); }
  };

  const handleRejectAdmin = async (adminRowId) => {
    await fetch('/api/shop/admins', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ shopId: shopInfo.id, adminId: adminRowId, action: 'reject' }),
    });
    await fetchAdmins(shopInfo.id);
  };

  const handleRemoveAdmin = async (adminRowId) => {
    if (!confirm('ยืนยันลบแอดมินคนนี้?')) return;
    await fetch('/api/shop/admins', {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ shopId: shopInfo.id, adminId: adminRowId }),
    });
    await fetchAdmins(shopInfo.id);
  };

  const fetchAnalytics = async (shopId, year, month, branch) => {
    setAnalyticsLoading(true);
    try {
      const m = month || analyticsMonth;
      const b = branch !== undefined ? branch : analyticsBranch;
      const res = await fetch(`/api/shop/analytics?shopId=${shopId}&year=${year}&month=${m}&branch=${encodeURIComponent(b)}`);
      const data = await res.json();
      if (!data.error) setAnalyticsData(data);
      else setAnalyticsData({ error: data.error, requireUpgrade: data.requireUpgrade, notConnected: data.notConnected });
    } catch (err) {
      setAnalyticsData({ error: err.message });
    }
    setAnalyticsLoading(false);
  };

  const fetchMarketing = async (shopId, branch, brand) => {
    setMarketingLoading(true);
    try {
      const b = branch !== undefined ? branch : heatmapBranch;
      const br = brand !== undefined ? brand : rfmBrand;
      const params = new URLSearchParams({ shopId });
      if (b && b !== 'all') params.set('branch', b);
      if (br) params.set('brand', br);
      const res = await fetch(`/api/shop/heatmap?${params.toString()}`);
      const data = await res.json();
      setMarketingData(data.error ? null : data);
    } catch { setMarketingData(null); }
    setMarketingLoading(false);
  };

  const fetchTaxReport = async (shopId, year, month) => {
    setTaxReportLoading(true);
    try {
      const url = `/api/sheets/tax-report?shopId=${shopId}&year=${year}${month ? `&month=${month}` : ''}`;
      const res = await fetch(url);
      const data = await res.json();
      setTaxReport(data.error ? { error: data.error } : data);
    } catch (err) {
      setTaxReport({ error: err.message });
    }
    setTaxReportLoading(false);
  };

  const fetchBranches = async (shopId) => {
    const res = await fetch(`/api/shop/branches?shopId=${shopId}`);
    const data = await res.json();
    setBranches(data.branches || []);
  };

  const handleCancelSubscription = async () => {
    if (!confirm('ยืนยันยกเลิกแพ็กเกจ?\n\nคุณยังสามารถใช้งานได้จนถึงสิ้นรอบบิล หลังจากนั้นจะถูก downgrade เป็น Starter อัตโนมัติ')) return;
    setCancellingSubscription(true);
    try {
      const res = await fetch('/api/shop/subscription', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ shopId: shopInfo.id, action: 'cancel' }),
      });
      const data = await res.json();
      if (data.error) alert('เกิดข้อผิดพลาด: ' + data.error);
      else await fetchSubscription(shopInfo.id);
    } catch { alert('เกิดข้อผิดพลาด กรุณาลองใหม่อีกครั้ง'); }
    finally { setCancellingSubscription(false); }
  };

  const handleResumeSubscription = async () => {
    setCancellingSubscription(true);
    try {
      const res = await fetch('/api/shop/subscription', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ shopId: shopInfo.id, action: 'resume' }),
      });
      const data = await res.json();
      if (data.error) alert('เกิดข้อผิดพลาด: ' + data.error);
      else await fetchSubscription(shopInfo.id);
    } catch { alert('เกิดข้อผิดพลาด กรุณาลองใหม่อีกครั้ง'); }
    finally { setCancellingSubscription(false); }
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
      setShopInfo(prev => ({ ...prev, shop_name: editForm.shopName, email: editForm.email, phone: editForm.phone, tax_id: editForm.taxId, user_type: editForm.userType, address: editForm.address }));
      setIsEditingProfile(false);
    } catch { alert('เกิดข้อผิดพลาด กรุณาลองใหม่อีกครั้ง'); }
    finally { setSavingProfile(false); }
  };

  const fetchTransactions = async (shopId, year, month) => {
    setLoadingTransactions(true);
    try {
      const params = new URLSearchParams({ shopId });
      if (year) params.set('year', year);
      if (month) params.set('month', month);
      const res = await fetch(`/api/sheets/transactions?${params}`);
      const data = await res.json();
      setLedgerConnected(data.connected !== false);
      setTransactions(data.rows || []);
    } catch (err) {
      console.error('Ledger error:', err);
      setLedgerConnected(false);
    }
    setLoadingTransactions(false);
  };

  const handleAddBranch = async () => {
    const tierKey = (shopInfo?.subscription_tier || 'normal').toLowerCase();
    const branchLimit = MAX_BRANCHES[tierKey] || 1;
    if (!newBranchName.trim() || !newBranchGroupId.trim()) return alert('กรุณากรอกชื่อสาขาและ Group ID ให้ครบค่ะ');
    if (branches.length >= branchLimit) return alert(`แพ็กเกจของคุณรองรับสูงสุด ${branchLimit} สาขาค่ะ`);
    setBranchLoading(true);
    const res = await fetch(`/api/shop/branches?shopId=${shopInfo.id}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ branchName: newBranchName, lineGroupId: newBranchGroupId, brandName: newBranchBrand }),
    });
    const data = await res.json();
    if (data.error) alert('เกิดข้อผิดพลาด: ' + data.error);
    else { setNewBranchName(''); setNewBranchGroupId(''); setNewBranchBrand(''); await fetchBranches(shopInfo.id); }
    setBranchLoading(false);
  };

  const handleUpdateBranchBrand = async (branchId, brandName) => {
    await fetch(`/api/shop/branches?shopId=${shopInfo.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ branchId, brandName }),
    });
    setEditBranchBrand(p => { const n = { ...p }; delete n[branchId]; return n; });
    await fetchBranches(shopInfo.id);
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

  const handleAddBankAccount = async () => {
    if (!addBankForm.accountName.trim() || !addBankForm.accountNumber.trim())
      return alert('กรุณากรอกชื่อบัญชีและเลขที่บัญชีให้ครบ');
    setAddingBank(true);
    try {
      const res = await fetch('/api/shop/bank-accounts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ shopId: shopInfo.id, ...addBankForm }),
      });
      const data = await res.json();
      if (data.error) return alert('เกิดข้อผิดพลาด: ' + data.error);
      setBankAccounts(prev => [...prev, data.account]);
      setAddBankForm({ bankName: 'กสิกรไทย', accountName: '', accountNumber: '', accountType: 'ออมทรัพย์' });
      setShowAddBank(false);
    } catch (err) { alert('เกิดข้อผิดพลาด: ' + err.message); }
    finally { setAddingBank(false); }
  };

  const handleDeleteBankAccount = async (accountId) => {
    if (!confirm('ยืนยันลบบัญชีธนาคารนี้?')) return;
    const res = await fetch('/api/shop/bank-accounts', {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ accountId, shopId: shopInfo.id }),
    });
    const data = await res.json();
    if (data.error) return alert('เกิดข้อผิดพลาด: ' + data.error);
    setBankAccounts(prev => prev.filter(b => b.id !== accountId));
  };

  const handleExportExcel = async () => {
    if (!shopInfo?.id) return;
    setExportLoading(true);
    try {
      const params = new URLSearchParams({ shopId: shopInfo.id, year: ledgerYear, month: ledgerMonth });
      const res = await fetch(`/api/export/excel?${params}`);
      if (!res.ok) { const e = await res.json(); alert('Export ล้มเหลว: ' + (e.error || '')); return; }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `SmileSlip_${shopInfo.shop_name}_${ledgerMonth}-${ledgerYear}.xlsx`;
      document.body.appendChild(a); a.click();
      document.body.removeChild(a); URL.revokeObjectURL(url);
    } catch (err) { alert('Export ล้มเหลว: ' + err.message); }
    finally { setExportLoading(false); }
  };

  const handleAddTransaction = async (e) => {
    e.preventDefault();
    if (!shopInfo?.id) return;
    const amt = parseFloat(addForm.amount);
    if (isNaN(amt) || amt <= 0) return alert('กรุณากรอกจำนวนเงินให้ถูกต้อง');
    setAddingSaving(true);
    try {
      const res = await fetch('/api/sheets/add-transaction', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ shopId: shopInfo.id, ...addForm }),
      });
      const data = await res.json();
      if (data.error) { alert('เกิดข้อผิดพลาด: ' + data.error); return; }
      setShowAddModal(false);
      setAddForm({ type: 'รายรับ', amount: '', date: '', time: '', sender: '', receiver: '', note: '', method: 'โอน' });
      fetchTransactions(shopInfo.id, ledgerYear, ledgerMonth);
    } catch (err) { alert('บันทึกไม่สำเร็จ: ' + err.message); }
    finally { setAddingSaving(false); }
  };

  const handleCopyReferral = () => {
    if (referralInfo?.referralUrl) {
      navigator.clipboard.writeText(referralInfo.referralUrl).then(() => {
        setCopiedRef(true);
        setTimeout(() => setCopiedRef(false), 2000);
      });
    }
  };

  // ─── Nav items ───
  const branchLimit = MAX_BRANCHES[tierKey] || 1;

  const isAdminMode = !!adminId;
  const ADMIN_LIMIT = { normal: 0, pro: 0, advance: 0, business: 3, enterprise: 10, super: 10 };
  const adminLimit = ADMIN_LIMIT[tierKey] ?? 0;

  const navItems = [
    { id: 'home',      label: 'ภาพรวม',         icon: <LayoutDashboard size={18}/> },
    { id: 'analytics', label: 'กราฟวิเคราะห์',   icon: <BarChart2 size={18}/>, proOnly: true },
    { id: 'accounts',  label: 'บัญชี',            icon: <Landmark size={18}/> },
    { id: 'branches',  label: 'จัดการสาขา',      icon: <GitBranch size={18}/>, adminReadOnly: true },
    { id: 'help',      label: 'ช่วยเหลือ',        icon: <HelpCircle size={18}/> },
    ...(!isAdminMode ? [{ id: 'settings', label: 'ตั้งค่า', icon: <Settings size={18}/> }] : []),
  ];

  if (!isLoaded) return (
    <div className="min-h-screen flex flex-col items-center justify-center bg-blue-800 text-white font-sans">
      <div className="text-5xl animate-bounce mb-4">😊</div>
      <p className="animate-pulse font-bold tracking-widest text-blue-200 text-sm uppercase">กำลังโหลด Smile Slip Pro...</p>
    </div>
  );


  return (
    <div className="flex h-screen overflow-hidden bg-slate-100 font-sans">
      <Head>
        <title>{shopInfo?.shop_name || 'Smile Slip Pro'} — Dashboard</title>
      </Head>

      {mobileMenuOpen && (
        <div className="fixed inset-0 bg-black/40 z-40 sm:hidden backdrop-blur-sm"
          onClick={() => setMobileMenuOpen(false)}/>
      )}

      {/* ══════════ SIDEBAR ══════════ */}
      <aside className={`
        bg-blue-800 flex flex-col flex-shrink-0
        transition-all duration-200 ease-in-out overflow-hidden
        fixed sm:relative top-0 left-0 h-full z-50 sm:z-auto
        ${sidebarCollapsed ? 'w-14' : 'w-56'}
        ${mobileMenuOpen ? 'translate-x-0' : '-translate-x-full sm:translate-x-0'}
      `}>
        {/* Logo */}
        <div className="flex items-center gap-2.5 px-3 py-3 border-b border-white/10 flex-shrink-0 min-h-[57px]">
          {sidebarCollapsed ? (
            <img src="/Logo-smile-slip.jpg" alt="Smile Slip"
              onError={e => { e.target.style.display='none'; }}
              className="w-8 h-8 object-cover rounded-lg flex-shrink-0"/>
          ) : (
            <img src="/Logo-smile-slip.jpg" alt="Smile Slip Pro"
              onError={e => { e.target.style.display='none'; }}
              className="h-9 object-contain max-w-[144px]"/>
          )}
          {!sidebarCollapsed && (
            <div className="overflow-hidden min-w-0 ml-1">
              <p className="text-[9px] text-blue-300 truncate">
                {shopInfo?.shop_name || 'ร้านของฉัน'} · <span className="uppercase">{tierLabel[tierKey] || 'Starter'}</span>
              </p>
            </div>
          )}
        </div>

        {/* Navigation */}
        <nav className="flex-1 p-2 overflow-y-auto overflow-x-hidden">
          {!sidebarCollapsed && (
            <p className="text-[9px] text-blue-400/70 uppercase tracking-wider px-2 mt-2 mb-1">เมนูหลัก</p>
          )}
          {navItems.map(item => {
            const locked = item.proOnly && !hasFeature(tierKey, 'pro');
            return (
              <button key={item.id}
                onClick={() => {
                  if (locked) { router.push(`/pricing?userId=${shopInfo?.owner_line_id}`); return; }
                  setActiveTab(item.id); setMobileMenuOpen(false);
                }}
                title={sidebarCollapsed ? item.label : undefined}
                className={`w-full flex items-center gap-3 px-2.5 py-2.5 rounded-xl mb-0.5 transition-all text-left group relative
                  ${activeTab === item.id ? 'bg-white/20 text-white' : 'text-blue-200 hover:bg-white/10 hover:text-white'}
                  ${locked ? 'opacity-50' : ''}
                `}>
                <span className="flex-shrink-0 w-5 flex items-center justify-center">{item.icon}</span>
                {!sidebarCollapsed && (
                  <span className="text-sm font-medium whitespace-nowrap flex items-center gap-1">
                    {item.label}
                    {locked && <span className="text-[8px] bg-amber-400/80 text-amber-900 px-1 rounded">Pro</span>}
                  </span>
                )}
                {sidebarCollapsed && (
                  <span className="absolute left-full ml-2 px-2.5 py-1.5 bg-blue-900 text-white text-xs rounded-lg whitespace-nowrap opacity-0 group-hover:opacity-100 pointer-events-none transition-opacity z-50 shadow-xl border border-blue-700">
                    {item.label} {locked ? '(Pro+)' : ''}
                  </span>
                )}
              </button>
            );
          })}

          {!sidebarCollapsed && (
            <p className="text-[9px] text-blue-400/70 uppercase tracking-wider px-2 mt-4 mb-1">ระบบเสริม</p>
          )}
          <Link href={`/pos?userId=${shopInfo?.owner_line_id}`}
            onClick={() => setMobileMenuOpen(false)}
            title={sidebarCollapsed ? 'ระบบ POS ขายหน้าร้าน' : undefined}
            className="w-full flex items-center gap-3 px-2.5 py-2.5 rounded-xl mb-0.5 transition-all group relative text-blue-200 hover:bg-white/10 hover:text-white">
            <span className="flex-shrink-0 w-5 flex items-center justify-center">🛒</span>
            {!sidebarCollapsed && <span className="text-sm font-medium whitespace-nowrap">POS ขายหน้าร้าน</span>}
            {sidebarCollapsed && (
              <span className="absolute left-full ml-2 px-2.5 py-1.5 bg-blue-900 text-white text-xs rounded-lg whitespace-nowrap opacity-0 group-hover:opacity-100 pointer-events-none transition-opacity z-50 shadow-xl border border-blue-700">
                POS ขายหน้าร้าน
              </span>
            )}
          </Link>

          {!sidebarCollapsed && (
            <p className="text-[9px] text-blue-400/70 uppercase tracking-wider px-2 mt-4 mb-1">บัญชี</p>
          )}
          <Link href={`/pricing?userId=${shopInfo?.owner_line_id}`}
            onClick={() => setMobileMenuOpen(false)}
            title={sidebarCollapsed ? 'เติมเครดิต / แพ็กเกจ' : undefined}
            className="w-full flex items-center gap-3 px-2.5 py-2.5 rounded-xl mb-0.5 transition-all group relative text-blue-200 hover:bg-white/10 hover:text-white">
            <span className="flex-shrink-0 w-5 flex items-center justify-center"><CreditCard size={18}/></span>
            {!sidebarCollapsed && <span className="text-sm font-medium whitespace-nowrap">แพ็กเกจ / เครดิต</span>}
            {sidebarCollapsed && (
              <span className="absolute left-full ml-2 px-2.5 py-1.5 bg-blue-900 text-white text-xs rounded-lg whitespace-nowrap opacity-0 group-hover:opacity-100 pointer-events-none transition-opacity z-50 shadow-xl border border-blue-700">
                แพ็กเกจ / เครดิต
              </span>
            )}
          </Link>
        </nav>

        {/* Credit bar */}
        {!sidebarCollapsed && (
          <div className="mx-2 mb-2 bg-white/10 rounded-xl p-3 flex-shrink-0">
            <div className="flex justify-between items-center mb-1.5">
              <span className="text-[10px] text-blue-200">🪙 {isUnlimited ? 'สแกน' : 'เครดิตคงเหลือ'}</span>
              <span className={`text-sm font-bold font-mono ${isUnlimited ? 'text-violet-300' : 'text-white'}`}>
                {isUnlimited ? '∞' : (credits || 0).toLocaleString()}
              </span>
            </div>
            <div className="h-1.5 bg-white/20 rounded-full overflow-hidden">
              <div className={`h-full rounded-full transition-all duration-500 ${isUnlimited ? 'bg-gradient-to-r from-violet-400 to-pink-400 w-full' : 'bg-gradient-to-r from-blue-300 to-violet-400'}`}
                style={isUnlimited ? {} : { width: `${Math.min(100, Math.max(2, (credits / 500) * 100))}%` }}/>
            </div>
            {isUnlimited ? (
              <p className="text-[9px] text-violet-300 mt-1">ไม่จำกัดการสแกน · เครดิตสำรอง {(credits||0).toLocaleString()}</p>
            ) : credits <= 0 && tierKey === 'normal' ? (
              <p className="text-[9px] text-red-300 mt-1">Bot หยุดทำงาน — เติมเครดิตหรืออัปเกรด</p>
            ) : null}
          </div>
        )}

        {/* Toggle button */}
        <div className="p-2 border-t border-white/10 flex-shrink-0">
          <button onClick={() => setSidebarCollapsed(c => !c)}
            className="w-full flex items-center justify-center gap-2 px-2 py-2 rounded-xl text-blue-300 hover:bg-white/10 hover:text-white transition-all text-xs">
            {sidebarCollapsed
              ? <ChevronRight size={16}/>
              : <><ChevronLeft size={16}/><span>พับเมนู</span></>
            }
          </button>
        </div>
      </aside>

      {/* ══════════ MAIN AREA ══════════ */}
      <div className="flex-1 flex flex-col min-w-0 overflow-hidden">

        {/* Top bar */}
        <header className="bg-white border-b border-slate-200 h-14 flex items-center justify-between px-4 sm:px-6 flex-shrink-0 z-30">
          <div className="flex items-center gap-3">
            <button onClick={() => setMobileMenuOpen(true)}
              className="sm:hidden p-1.5 rounded-lg text-slate-500 hover:bg-slate-100 transition-colors">
              <Menu size={20}/>
            </button>
            <div>
              <h1 className="text-base font-bold text-blue-900 leading-tight">
                {navItems.find(n => n.id === activeTab)?.label || 'ภาพรวม'}
              </h1>
              <p className="text-[10px] text-slate-400 hidden sm:block leading-tight">
                สวัสดี, {shopInfo?.shop_name} 👋
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2 sm:gap-3">
            <span className="text-xs font-mono text-slate-400 hidden md:block">
              {currentTime.toLocaleTimeString('th-TH')}
            </span>
            <span className={`text-[10px] px-2.5 py-1 rounded-full font-bold uppercase tracking-wide ${tierBadge[tierKey] || tierBadge.normal}`}>
              {tierLabel[tierKey] || 'Starter'}
            </span>
            <button onClick={() => router.push('/logout')}
              className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-xl text-xs font-semibold text-slate-400 hover:bg-red-50 hover:text-red-500 transition-all">
              <LogOut size={14}/>
              <span className="hidden sm:inline">ออก</span>
            </button>
          </div>
        </header>

        {/* Scrollable content */}
        <main className="flex-1 overflow-y-auto bg-slate-50">
          {/* Admin Mode Banner */}
          {isAdminMode && (
            <div className="bg-amber-400 text-amber-900 px-4 py-2 flex items-center justify-center gap-2 text-xs font-bold">
              <Shield size={13}/>
              โหมดแอดมิน — คุณกำลังดูแลร้าน <span className="underline">{shopInfo?.shop_name}</span> ในฐานะผู้ช่วย · ไม่สามารถแก้ไขตั้งค่าร้านหรือจัดการแพ็กเกจได้
            </div>
          )}
          <div className="p-4 sm:p-6 lg:p-8 min-h-full flex flex-col">
            <div className="flex-1">

              {/* ════ HOME TAB ════ */}
              {activeTab === 'home' && (
                <div className="max-w-5xl space-y-6">

                  {/* ════ Onboarding Steps (แสดงเฉพาะตอนยังไม่ครบ) ════ */}
                  {isLoaded && shopInfo && (!googleConfig || !shopInfo.line_group_id) && (
                    <div className="bg-gradient-to-br from-blue-50 to-indigo-50 border border-blue-200 rounded-2xl p-5">
                      <div className="flex items-center gap-2 mb-4">
                        <span className="text-lg">🚀</span>
                        <h3 className="font-bold text-slate-700 text-sm">เริ่มต้นใช้งาน Smile Slip</h3>
                        <span className="ml-auto text-[10px] text-blue-400">ทำให้ครบเพื่อเริ่มสแกนสลิปได้ทันที</span>
                      </div>
                      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                        {/* Step 1: สมัคร */}
                        <div className="flex items-start gap-3 bg-white/70 rounded-xl p-3">
                          <span className="w-6 h-6 rounded-full bg-emerald-500 text-white flex items-center justify-center text-xs font-black shrink-0">✓</span>
                          <div>
                            <p className="text-xs font-bold text-emerald-700">สมัครสมาชิก</p>
                            <p className="text-[10px] text-slate-500 mt-0.5">เสร็จแล้ว ✓</p>
                          </div>
                        </div>
                        {/* Step 2: เชื่อม Google Drive */}
                        <div className={`flex items-start gap-3 rounded-xl p-3 ${googleConfig ? 'bg-white/70' : 'bg-amber-50 border border-amber-200'}`}>
                          <span className={`w-6 h-6 rounded-full flex items-center justify-center text-xs font-black shrink-0 ${googleConfig ? 'bg-emerald-500 text-white' : 'bg-amber-400 text-white'}`}>
                            {googleConfig ? '✓' : '2'}
                          </span>
                          <div className="flex-1">
                            <p className={`text-xs font-bold ${googleConfig ? 'text-emerald-700' : 'text-amber-700'}`}>เชื่อมต่อ Google Drive</p>
                            {googleConfig ? (
                              <p className="text-[10px] text-slate-500 mt-0.5">เชื่อมต่อแล้ว ✓</p>
                            ) : (
                              <>
                                <p className="text-[10px] text-amber-600 mt-0.5">บันทึกสลิปอัตโนมัติลง Sheets</p>
                                <button
                                  onClick={() => setActiveTab('settings')}
                                  className="mt-1.5 text-[10px] bg-amber-500 hover:bg-amber-600 text-white font-bold px-2.5 py-1 rounded-lg transition-all">
                                  ไปตั้งค่า →
                                </button>
                              </>
                            )}
                          </div>
                        </div>
                        {/* Step 3: เพิ่มบอทเข้ากลุ่ม */}
                        <div className={`flex items-start gap-3 rounded-xl p-3 ${shopInfo.line_group_id ? 'bg-white/70' : 'bg-blue-50 border border-blue-200'}`}>
                          <span className={`w-6 h-6 rounded-full flex items-center justify-center text-xs font-black shrink-0 ${shopInfo.line_group_id ? 'bg-emerald-500 text-white' : 'bg-blue-500 text-white'}`}>
                            {shopInfo.line_group_id ? '✓' : '3'}
                          </span>
                          <div>
                            <p className={`text-xs font-bold ${shopInfo.line_group_id ? 'text-emerald-700' : 'text-blue-700'}`}>เพิ่มบอทเข้ากลุ่ม LINE</p>
                            {shopInfo.line_group_id ? (
                              <p className="text-[10px] text-slate-500 mt-0.5">พร้อมใช้งาน ✓</p>
                            ) : (
                              <p className="text-[10px] text-blue-600 mt-0.5">เพิ่ม @574unjqj เข้ากลุ่มร้าน</p>
                            )}
                          </div>
                        </div>
                      </div>
                    </div>
                  )}

                  {/* ยังไม่ได้เพิ่ม LINE Bot */}
                  {shopInfo && !shopInfo.line_group_id && (
                    <div className="bg-[#06C755]/10 border-2 border-[#06C755]/40 rounded-2xl p-4 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
                      <div className="flex items-start gap-3">
                        <span className="text-2xl shrink-0">🤖</span>
                        <div>
                          <p className="font-bold text-slate-800 text-sm">ยังไม่ได้เพิ่ม LINE Bot เข้ากลุ่ม</p>
                          <p className="text-slate-500 text-xs mt-0.5 leading-relaxed">
                            เพิ่ม <strong>@574unjqj</strong> เป็นเพื่อน → เชิญเข้ากลุ่ม LINE ของร้าน → พิมพ์ <strong>#ช่วยเหลือ</strong> เพื่อเริ่มต้น
                          </p>
                        </div>
                      </div>
                      <div className="flex items-center gap-2 shrink-0 w-full sm:w-auto">
                        <a href="https://lin.ee/wdnoEN5" target="_blank" rel="noreferrer"
                          className="flex-1 sm:flex-none flex items-center justify-center gap-1.5 bg-[#06C755] hover:bg-[#05a848] text-white font-bold text-xs px-4 py-2 rounded-xl transition-all">
                          <svg width="14" height="14" viewBox="0 0 48 48" fill="currentColor"><path d="M24 4C12.95 4 4 11.86 4 21.5c0 5.5 2.93 10.4 7.52 13.6L9.5 44l9.3-4.64C20.5 39.78 22.22 40 24 40c11.05 0 20-7.86 20-17.5S35.05 4 24 4z"/></svg>
                          เพิ่ม LINE Bot
                        </a>
                        <button onClick={() => setActiveTab('settings')}
                          className="flex-1 sm:flex-none text-xs px-4 py-2 rounded-xl border border-slate-300 text-slate-500 hover:border-slate-500 hover:text-slate-700 transition-all font-medium">
                          ตั้งค่า Group ID
                        </button>
                      </div>
                    </div>
                  )}

                  {/* เครดิตหมด warning */}
                  {credits < 10 && !isUnlimited && (
                    <div className="bg-red-50 border border-red-200 rounded-2xl p-4 flex items-center justify-between gap-4">
                      <div className="flex items-center gap-3">
                        <AlertTriangle size={20} className="text-red-500 shrink-0"/>
                        <div>
                          <p className="font-bold text-red-700 text-sm">
                            {credits <= 0 ? '🚨 เครดิตหมดแล้ว — Bot หยุดรับสลิป' : `⚠️ เครดิตเหลือเพียง ${credits} แผ่น`}
                          </p>
                          <p className="text-red-400 text-xs mt-0.5">
                            {credits <= 0
                              ? 'คีย์รายการเองใน Dashboard ได้ระหว่างนี้ หรือเติมเครดิต / อัปเกรด'
                              : 'เติมเครดิตก่อนหมดเพื่อไม่ให้การใช้งานสะดุด'}
                          </p>
                        </div>
                      </div>
                      <button onClick={() => router.push(`/pricing?userId=${shopInfo?.owner_line_id}`)}
                        className="shrink-0 bg-red-600 hover:bg-red-700 text-white font-bold text-xs px-4 py-2 rounded-xl transition-all">
                        เติมเครดิต
                      </button>
                    </div>
                  )}

                  {reconnectGoogle && (
                    <div className="bg-amber-50 border border-amber-200 rounded-2xl p-4 flex items-center justify-between gap-4">
                      <div className="flex items-center gap-3">
                        <span className="text-xl">⚠️</span>
                        <div>
                          <p className="font-bold text-amber-700 text-sm">Google Drive ขาดการเชื่อมต่อ</p>
                          <p className="text-amber-500 text-xs mt-0.5">สลิปล่าสุดไม่ถูกบันทึกลง Google Sheets</p>
                        </div>
                      </div>
                      <a href={`/api/auth/google/connect?shopId=${shopInfo?.id}`}
                        className="shrink-0 bg-amber-500 hover:bg-amber-600 text-white font-bold text-xs px-4 py-2 rounded-xl transition-all">
                        เชื่อมต่อใหม่
                      </a>
                    </div>
                  )}

                  {/* Greeting */}
                  <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                    <div>
                      <h2 className="text-xl font-bold text-blue-900">สวัสดี, {shopInfo?.shop_name} 😊</h2>
                      <p className="text-slate-500 text-sm mt-0.5">
                        {currentTime.toLocaleDateString('th-TH', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })}
                      </p>
                    </div>
                    <div className="flex items-center gap-2 bg-white border border-slate-200 rounded-xl px-3 py-2 text-sm self-start sm:self-auto">
                      <span className="w-2 h-2 rounded-full bg-green-500 shadow shadow-green-300 animate-pulse"/>
                      <span className="text-slate-600 text-xs font-medium">LINE Bot พร้อมรับสลิป</span>
                    </div>
                  </div>

                  {/* Stats grid */}
                  <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
                    <div className="bg-white rounded-2xl border border-slate-200 p-5 relative overflow-hidden">
                      <div className="absolute top-0 left-0 right-0 h-0.5 bg-blue-500 rounded-t-2xl"/>
                      <div className="text-2xl mb-2">{isUnlimited ? '♾️' : '💰'}</div>
                      <p className="text-xs text-slate-500 mb-1">{isUnlimited ? 'การสแกน' : 'เครดิตคงเหลือ'}</p>
                      <p className={`text-2xl font-bold font-mono ${isUnlimited ? 'text-violet-700' : 'text-blue-900'}`}>
                        {isUnlimited ? '∞' : (credits || 0).toLocaleString()}
                      </p>
                      <p className="text-xs text-slate-400 mt-1">{isUnlimited ? `สำรอง ${(credits||0).toLocaleString()} แผ่น` : 'แผ่น'}</p>
                    </div>
                    <div className="bg-white rounded-2xl border border-slate-200 p-5 relative overflow-hidden">
                      <div className="absolute top-0 left-0 right-0 h-0.5 bg-green-500 rounded-t-2xl"/>
                      <div className="text-2xl mb-2">✅</div>
                      <p className="text-xs text-slate-500 mb-1">สถานะ Google</p>
                      <p className={`text-sm font-bold mt-1 ${googleConfig ? 'text-green-600' : 'text-amber-500'}`}>
                        {googleConfig ? 'เชื่อมต่อแล้ว' : 'ยังไม่เชื่อมต่อ'}
                      </p>
                      <p className="text-xs text-slate-400 mt-0.5">Drive & Sheets</p>
                    </div>
                    <div className="bg-white rounded-2xl border border-slate-200 p-5 relative overflow-hidden">
                      <div className="absolute top-0 left-0 right-0 h-0.5 bg-violet-500 rounded-t-2xl"/>
                      <div className="text-2xl mb-2">🏢</div>
                      <p className="text-xs text-slate-500 mb-1">สาขาที่ใช้งาน</p>
                      <p className="text-2xl font-bold text-blue-900 font-mono">{branches.length || '—'}</p>
                      <p className="text-xs text-slate-400 mt-1">จากสูงสุด {branchLimit}</p>
                    </div>
                    <div className="bg-white rounded-2xl border border-slate-200 p-5 relative overflow-hidden">
                      <div className="absolute top-0 left-0 right-0 h-0.5 bg-amber-500 rounded-t-2xl"/>
                      <div className="text-2xl mb-2">🎁</div>
                      <p className="text-xs text-slate-500 mb-1">แนะนำเพื่อนแล้ว</p>
                      <p className="text-2xl font-bold text-blue-900 font-mono">{referralInfo?.referralCount || 0}</p>
                      <p className="text-xs text-slate-400 mt-1">+{(referralInfo?.creditsEarned || 0)} เครดิต</p>
                    </div>
                  </div>

                  {/* Credit + Google row */}
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
                    <div className="bg-gradient-to-br from-blue-800 to-blue-700 rounded-2xl p-6 text-white relative overflow-hidden">
                      <Wallet className="absolute -right-3 -bottom-3 w-24 h-24 opacity-10"/>
                      <p className="text-blue-300 text-xs font-medium uppercase tracking-widest mb-2">
                        {isUnlimited ? 'สแกนสลิป' : 'เครดิตคงเหลือ'}
                      </p>
                      <h3 className="text-5xl font-bold tracking-tighter font-mono">
                        {isUnlimited ? '∞' : (credits || 0).toLocaleString()}
                      </h3>
                      <p className="text-blue-300 text-xs mt-1">
                        {isUnlimited ? 'ไม่จำกัด' : 'แผ่น'}
                      </p>
                      {isUnlimited ? (
                        <div className="mt-3">
                          <div className="h-1.5 bg-white/20 rounded-full overflow-hidden">
                            <div className="h-full w-full rounded-full bg-gradient-to-r from-violet-400 to-pink-400"/>
                          </div>
                          <p className="text-violet-200 text-[10px] mt-1.5">
                            🔒 เครดิตสำรองล็อคไว้ {(credits||0).toLocaleString()} แผ่น (ใช้เมื่อลดแพ็กเกจ)
                          </p>
                        </div>
                      ) : (
                        <div className="mt-3 h-1.5 bg-white/20 rounded-full overflow-hidden">
                          <div className="h-full rounded-full bg-gradient-to-r from-blue-300 to-violet-300 transition-all"
                            style={{ width: `${Math.min(100, Math.max(2, (credits / 500) * 100))}%` }}/>
                        </div>
                      )}
                      {!isUnlimited && tierKey === 'normal' && (
                        <p className="text-blue-300 text-[10px] mt-1.5">
                          {credits > 0 ? `${credits}/50 แผ่นฟรี — หมดแล้วอัปเกรดต่อ ฿199/เดือน` : 'หมดแล้ว → คีย์เองหรืออัปเกรด Pro'}
                        </p>
                      )}
                      <div className="mt-4 flex gap-2">
                        {isUnlimited ? (
                          <button onClick={() => setActiveTab('analytics')}
                            className="bg-violet-600 hover:bg-violet-500 px-4 py-2 rounded-xl text-xs font-medium transition-all">
                            ดูกราฟวิเคราะห์
                          </button>
                        ) : (
                          <button onClick={() => router.push(`/pricing?userId=${shopInfo?.owner_line_id}`)}
                            className="bg-blue-600 hover:bg-blue-500 px-4 py-2 rounded-xl text-xs font-medium transition-all">
                            {tierKey === 'normal' ? 'อัปเกรด / เติมเครดิต' : 'เติมเครดิต'}
                          </button>
                        )}
                        <button onClick={() => setActiveTab('ledger')}
                          className="bg-white/10 hover:bg-white/20 px-4 py-2 rounded-xl text-xs font-medium transition-all">
                          ดูรายการ
                        </button>
                      </div>
                    </div>

                    {/* Google sync */}
                    <div className="bg-white rounded-2xl border border-slate-200 p-6 flex flex-col justify-between">
                      <div className="flex justify-between items-start mb-4">
                        <div className={`p-2.5 rounded-xl ${googleConfig ? 'bg-green-50 text-green-600' : 'bg-amber-50 text-amber-500'}`}>
                          <FileSpreadsheet size={24}/>
                        </div>
                        <span className={`px-2.5 py-1 rounded-full text-[10px] font-bold uppercase tracking-wider
                          ${googleConfig ? 'bg-green-50 text-green-600' : 'bg-amber-50 text-amber-600'}`}>
                          {googleConfig ? 'Active' : 'ไม่ได้เชื่อมต่อ'}
                        </span>
                      </div>
                      <div>
                        <h4 className="text-base font-bold text-slate-800 mb-3">Google Drive & Sheets</h4>
                        {googleConfig ? (
                          <div className="space-y-1.5">
                            <a href={`https://docs.google.com/spreadsheets/d/${googleConfig.google_sheet_id}`}
                              target="_blank" rel="noreferrer"
                              className="flex items-center gap-2 text-blue-600 font-medium hover:bg-blue-50 px-3 py-2 rounded-xl transition-all text-sm">
                              <ExternalLink size={13}/> เปิด Google Sheet
                            </a>
                            <a href={`https://drive.google.com/drive/folders/${googleConfig.google_folder_id}`}
                              target="_blank" rel="noreferrer"
                              className="flex items-center gap-2 text-amber-600 font-medium hover:bg-amber-50 px-3 py-2 rounded-xl transition-all text-sm">
                              <FolderOpen size={13}/> โฟลเดอร์รูปสลิป
                            </a>
                            <a href={`/api/auth/google/connect?shopId=${shopInfo?.id}`}
                              className="flex items-center gap-2 text-slate-500 font-medium hover:bg-slate-50 px-3 py-2 rounded-xl transition-all text-sm">
                              <RefreshCcw size={13}/> เชื่อมต่อใหม่
                            </a>
                          </div>
                        ) : (
                          <a href={`/api/auth/google/connect?shopId=${shopInfo?.id}`}
                            className="flex items-center justify-center gap-2 bg-blue-800 text-white px-4 py-3 rounded-xl font-medium text-sm hover:bg-blue-700 transition-all">
                            <RefreshCcw size={15}/> เชื่อมต่อ Google Drive (+30 เครดิต)
                          </a>
                        )}
                      </div>
                    </div>
                  </div>

                  {/* ─── Referral Section ─── */}
                  <div className="bg-gradient-to-r from-indigo-800 to-blue-800 rounded-2xl p-6 text-white">
                    <div className="flex items-center justify-between mb-4">
                      <div className="flex items-center gap-2">
                        <Share2 size={18} className="text-indigo-300"/>
                        <h3 className="font-bold text-sm">แนะนำเพื่อน — รับ 50 เครดิต/คน</h3>
                      </div>
                      {referralInfo?.referralCount > 0 && (
                        <span className="bg-white/20 text-white text-xs font-bold px-2.5 py-1 rounded-full">
                          แนะนำแล้ว {referralInfo.referralCount} ร้าน = +{referralInfo.creditsEarned} เครดิต
                        </span>
                      )}
                    </div>
                    {referralInfo?.referralUrl ? (
                      <div className="space-y-3">
                        <p className="text-indigo-200 text-xs">คุณและเพื่อนจะได้รับ <span className="text-white font-bold">50 เครดิต</span> ทันทีเมื่อเพื่อนสมัครและเชื่อมต่อ Google</p>
                        <div className="flex gap-2">
                          <div className="flex-1 bg-white/10 rounded-xl px-3 py-2.5 font-mono text-xs text-white truncate border border-white/20">
                            {referralInfo.referralUrl}
                          </div>
                          <button onClick={handleCopyReferral}
                            className={`flex items-center gap-1.5 px-3 py-2.5 rounded-xl font-medium text-xs transition-all shrink-0
                              ${copiedRef ? 'bg-green-500 text-white' : 'bg-white text-blue-800 hover:bg-blue-50'}`}>
                            <Copy size={12}/>
                            {copiedRef ? 'คัดลอกแล้ว!' : 'คัดลอก'}
                          </button>
                        </div>
                        <p className="text-indigo-300 text-[10px]">
                          รหัสของคุณ: <span className="text-white font-mono font-bold">{referralInfo.referralCode}</span>
                        </p>
                      </div>
                    ) : (
                      <p className="text-indigo-300 text-xs">กำลังโหลดลิงก์แนะนำ...</p>
                    )}
                  </div>

                  {/* Checklist */}
                  <div className="bg-white rounded-2xl border border-slate-200 p-5">
                    <h3 className="text-sm font-bold text-slate-700 mb-4 flex items-center gap-2">
                      <span>📋</span> เช็คลิสต์การตั้งค่า
                    </h3>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                      {[
                        { done: true,  label: 'เชื่อมต่อ LINE Bot', detail: 'webhook พร้อมรับสลิปแล้ว' },
                        { done: true,  label: 'สร้างบัญชีธุรกิจ', detail: shopInfo?.shop_name },
                        { done: !!googleConfig, label: 'เชื่อมต่อ Google Drive', detail: googleConfig ? googleConfig.google_email : 'คลิกเพื่อเชื่อมต่อ (+30 เครดิต)' },
                        { done: credits > 0, label: 'มีเครดิตพร้อมใช้', detail: `${credits} แผ่น` },
                      ].map((item, i) => (
                        <div key={i} className={`flex items-center gap-3 p-3 rounded-xl border ${item.done ? 'bg-green-50 border-green-100' : 'bg-slate-50 border-slate-200'}`}>
                          {item.done
                            ? <CheckCircle2 size={16} className="text-green-500 shrink-0"/>
                            : <Circle size={16} className="text-slate-300 shrink-0"/>
                          }
                          <div>
                            <p className={`text-xs font-medium ${item.done ? 'text-green-700' : 'text-slate-500'}`}>{item.label}</p>
                            <p className="text-[10px] text-slate-400">{item.detail}</p>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>

                  {/* ─── POS Add-on ─── */}
                  <div className="bg-gradient-to-r from-emerald-900 to-emerald-700 rounded-2xl p-5 text-white">
                    <div className="flex items-center justify-between gap-3">
                      <div className="flex items-center gap-3">
                        <span className="text-3xl">🛒</span>
                        <div>
                          <h3 className="font-bold text-sm">ระบบขายหน้าร้าน (POS)</h3>
                          <p className="text-emerald-200 text-xs mt-0.5">จัดการสต็อค · บันทึกยอดขาย · ดูรายงาน</p>
                        </div>
                      </div>
                      <a
                        href={`/pos?userId=${shopInfo?.owner_line_id}`}
                        className="shrink-0 bg-white text-emerald-800 hover:bg-emerald-50 font-bold text-xs px-4 py-2.5 rounded-xl transition-colors shadow-md"
                      >
                        เปิดระบบ →
                      </a>
                    </div>
                  </div>

                  {/* ─── Delivery Add-on ─── */}
                  <div className="bg-gradient-to-r from-blue-900 to-blue-700 rounded-2xl p-5 text-white">
                    <div className="flex items-center justify-between gap-3">
                      <div className="flex items-center gap-3">
                        <span className="text-3xl">🚚</span>
                        <div>
                          <h3 className="font-bold text-sm">ระบบส่งของ (Delivery)</h3>
                          <p className="text-blue-200 text-xs mt-0.5">บันทึกออเดอร์ · ติดตามสถานะ · ดูประวัติลูกค้า</p>
                        </div>
                      </div>
                      <a
                        href={`/delivery?userId=${shopInfo?.owner_line_id}`}
                        className="shrink-0 bg-white text-blue-800 hover:bg-blue-50 font-bold text-xs px-4 py-2.5 rounded-xl transition-colors shadow-md"
                      >
                        เปิดระบบ →
                      </a>
                    </div>
                  </div>

                  {/* LINE Commands */}
                  {tierKey !== 'normal' && (
                    <div className="bg-blue-800 rounded-2xl p-6 text-white">
                      <h3 className="font-bold text-sm mb-4 flex items-center gap-2">📲 คำสั่ง LINE สำหรับเจ้าของ</h3>
                      <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                        {[
                          '#สรุปวันนี้', '#สรุปเดือนนี้', '#กำไรขาดทุน',
                          ...(hasFeature(tierKey, 'advance') ? ['#สรุปทุกสาขา'] : []),
                          '#ช่วยเหลือ'
                        ].map(cmd => (
                          <div key={cmd} className="bg-white/10 rounded-xl px-3 py-2 text-sm font-mono text-cyan-300">{cmd}</div>
                        ))}
                      </div>
                      <p className="text-blue-300 text-xs mt-3">พิมพ์คำสั่งในแชท LINE กับบอทได้เลยค่ะ</p>
                    </div>
                  )}
                </div>
              )}

              {/* ════ ANALYTICS TAB ════ */}
              {activeTab === 'analytics' && (
                <div className="max-w-5xl space-y-6">

                  {/* View controls */}
                  <div className="bg-white rounded-2xl border border-slate-200 p-3 flex flex-wrap items-center gap-3">
                    {/* View toggle */}
                    <div className="flex rounded-xl overflow-hidden border border-slate-200">
                      {[['daily','รายวัน'],['monthly','รายเดือน']].map(([v,l]) => (
                        <button key={v} onClick={() => {
                          setAnalyticsView(v);
                          fetchAnalytics(shopInfo.id, analyticsYear, v === 'daily' ? analyticsMonth : undefined);
                        }}
                          className={`px-4 py-1.5 text-sm font-bold transition-all ${analyticsView === v ? 'bg-blue-800 text-white' : 'bg-white text-slate-500 hover:bg-slate-50'}`}>
                          {l}
                        </button>
                      ))}
                    </div>
                    {/* Month selector (รายวัน only) */}
                    {analyticsView === 'daily' && (
                      <select value={analyticsMonth}
                        onChange={e => { setAnalyticsMonth(e.target.value); fetchAnalytics(shopInfo.id, analyticsYear, e.target.value); }}
                        className="border border-slate-200 rounded-xl px-3 py-1.5 text-sm font-medium focus:outline-none bg-white">
                        {[['01','ม.ค.'],['02','ก.พ.'],['03','มี.ค.'],['04','เม.ย.'],['05','พ.ค.'],['06','มิ.ย.'],
                          ['07','ก.ค.'],['08','ส.ค.'],['09','ก.ย.'],['10','ต.ค.'],['11','พ.ย.'],['12','ธ.ค.']
                        ].map(([v,l]) => <option key={v} value={v}>{l}</option>)}
                      </select>
                    )}
                    {/* Year selector */}
                    <select value={analyticsYear}
                      onChange={e => { setAnalyticsYear(e.target.value); fetchAnalytics(shopInfo.id, e.target.value, analyticsView === 'daily' ? analyticsMonth : undefined); }}
                      className="border border-slate-200 rounded-xl px-3 py-1.5 text-sm font-medium focus:outline-none bg-white">
                      {Array.from({length: 10}, (_, i) => new Date().getFullYear() + 1 - i).map(y => <option key={y} value={y}>{y}</option>)}
                    </select>
                    {/* สาขา — ดูแนวโน้มรายสาขา หรือรวมทุกสาขา */}
                    {hasFeature(tierKey, 'advance') && branches.length > 0 && (
                      <select value={analyticsBranch}
                        onChange={e => { setAnalyticsBranch(e.target.value); fetchAnalytics(shopInfo.id, analyticsYear, analyticsView === 'daily' ? analyticsMonth : undefined, e.target.value); }}
                        className="border border-slate-200 rounded-xl px-3 py-1.5 text-sm font-medium focus:outline-none bg-white">
                        <option value="all">รวมทุกสาขา</option>
                        {branches.map(b => <option key={b.id} value={b.branch_name}>{b.branch_name}</option>)}
                      </select>
                    )}
                    <button onClick={() => fetchAnalytics(shopInfo.id, analyticsYear, analyticsView === 'daily' ? analyticsMonth : undefined)}
                      className="flex items-center gap-1.5 bg-blue-800 text-white px-4 py-1.5 rounded-xl text-xs font-medium hover:bg-blue-700 transition-all">
                      <RefreshCcw size={13}/> โหลดใหม่
                    </button>
                    {analyticsView === 'daily' && (
                      <a href={`/api/export/analytics-pdf?shopId=${shopInfo?.id}&year=${analyticsYear}&month=${analyticsMonth}`}
                        target="_blank" rel="noopener noreferrer"
                        className="flex items-center gap-1.5 bg-slate-700 text-white px-4 py-1.5 rounded-xl text-xs font-medium hover:bg-slate-600 transition-all">
                        ⬇ PDF
                      </a>
                    )}
                  </div>

                  {/* Loading */}
                  {analyticsLoading && (
                    <div className="text-center py-16 text-slate-400 animate-pulse">กำลังโหลดข้อมูลจาก Google Sheets...</div>
                  )}

                  {/* Require upgrade */}
                  {!analyticsLoading && analyticsData?.requireUpgrade && (
                    <div className="bg-amber-50 border border-amber-200 rounded-2xl p-10 text-center">
                      <p className="text-3xl mb-3">📊</p>
                      <p className="font-bold text-amber-700 text-lg mb-2">กราฟวิเคราะห์ใช้ได้เฉพาะ Pro ขึ้นไป</p>
                      <p className="text-amber-500 text-sm mb-5">อัปเกรดเพื่อดูกราฟรายรับ-รายจ่าย, สรุปรายเดือน และอื่นๆ</p>
                      <Link href={`/pricing?userId=${shopInfo?.owner_line_id}`}
                        className="inline-block bg-amber-500 hover:bg-amber-600 text-white font-bold px-6 py-3 rounded-xl transition-all">
                        อัปเกรดเป็น Pro — ฿199/เดือน
                      </Link>
                    </div>
                  )}

                  {/* Not connected */}
                  {!analyticsLoading && analyticsData?.notConnected && (
                    <div className="bg-white border border-slate-200 rounded-2xl p-10 text-center">
                      <p className="text-3xl mb-3">📁</p>
                      <p className="font-bold text-slate-700 text-lg mb-2">ยังไม่ได้เชื่อมต่อ Google Sheets</p>
                      <a href={`/api/auth/google/connect?shopId=${shopInfo?.id}`}
                        className="inline-flex items-center gap-2 bg-blue-800 text-white px-6 py-3 rounded-xl font-medium hover:bg-blue-700 transition-all mt-3">
                        <RefreshCcw size={15}/> เชื่อมต่อ Google Drive (+30 เครดิต)
                      </a>
                    </div>
                  )}

                  {/* Charts */}
                  {!analyticsLoading && analyticsData?.summary && (
                    <>
                      {/* Summary cards — แสดงตาม view */}
                      {(() => {
                        const sd = analyticsView === 'daily' && analyticsData.dailySummary
                          ? analyticsData.dailySummary : analyticsData.summary;
                        const THAI_M = ['ม.ค.','ก.พ.','มี.ค.','เม.ย.','พ.ค.','มิ.ย.','ก.ค.','ส.ค.','ก.ย.','ต.ค.','พ.ย.','ธ.ค.'];
                        const periodLabel = analyticsView === 'daily'
                          ? `${THAI_M[parseInt(analyticsMonth)-1]} ${analyticsYear}`
                          : `ทั้งปี ${analyticsYear}`;
                        return (
                          <>
                            <p className="text-xs text-slate-400 -mb-2">สรุป: {periodLabel}</p>
                            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                              {[
                                { label:'รายรับ',      value: sd.income,  color:'text-green-600', bg:'bg-green-50', icon:'↑' },
                                { label:'รายจ่าย',     value: sd.expense, color:'text-red-500',   bg:'bg-red-50',   icon:'↓' },
                                { label:'กำไร/ขาดทุน', value: sd.profit,  color: sd.profit >= 0 ? 'text-emerald-600':'text-red-600', bg:'bg-slate-50', icon:'=' },
                                { label:'รายการ',      value: sd.count,   color:'text-blue-600',  bg:'bg-blue-50',  icon:'#', noMoney:true },
                              ].map((s,i) => (
                                <div key={i} className={`${s.bg} rounded-2xl p-5 border border-slate-100`}>
                                  <span className={`text-xl font-black ${s.color}`}>{s.icon}</span>
                                  <p className="text-xs text-slate-500 mt-2 mb-1">{s.label}</p>
                                  <p className={`text-2xl font-black font-mono ${s.color}`}>
                                    {s.noMoney ? (s.value||0).toLocaleString() : `฿${(s.value||0).toLocaleString()}`}
                                  </p>
                                </div>
                              ))}
                            </div>
                          </>
                        );
                      })()}

                      {/* Daily bar chart */}
                      {analyticsView === 'daily' && analyticsData.dailyData && (
                        <div className="bg-white rounded-2xl border border-slate-200 p-6">
                          <div className="flex items-center justify-between mb-4">
                            <h3 className="font-bold text-slate-700 text-sm">
                              รายรับ-รายจ่ายรายวัน ({['ม.ค.','ก.พ.','มี.ค.','เม.ย.','พ.ค.','มิ.ย.','ก.ค.','ส.ค.','ก.ย.','ต.ค.','พ.ย.','ธ.ค.'][parseInt(analyticsMonth)-1]} {analyticsYear})
                            </h3>
                            <div className="flex items-center gap-3 text-xs text-slate-400">
                              <span className="flex items-center gap-1"><span className="w-3 h-3 rounded-sm bg-green-400 inline-block"/> รายรับ</span>
                              <span className="flex items-center gap-1"><span className="w-3 h-3 rounded-sm bg-red-400 inline-block"/> รายจ่าย</span>
                            </div>
                          </div>
                          {(() => {
                            const dailyMax = Math.max(...analyticsData.dailyData.map(d => Math.max(d.income, d.expense)), 1);
                            return (
                              <>
                                <div className="flex gap-px items-end h-28 overflow-x-auto">
                                  {analyticsData.dailyData.map((d, i) => (
                                    <div key={i} className="flex-1 min-w-[10px] flex gap-px items-end h-full group relative">
                                      <div className="absolute bottom-full mb-1 left-1/2 -translate-x-1/2 bg-slate-800 text-white text-[9px] px-2 py-1 rounded-lg whitespace-nowrap opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none z-10">
                                        วันที่ {d.day}: รับ ฿{d.income.toLocaleString()} / จ่าย ฿{d.expense.toLocaleString()}
                                      </div>
                                      <div className="flex-1 bg-slate-100 rounded-t-sm flex flex-col justify-end overflow-hidden" style={{height:'100%'}}>
                                        <div className="bg-green-400 rounded-t-sm transition-all"
                                          style={{height:`${Math.round((d.income/dailyMax)*100)}%`, minHeight: d.income>0?2:0}}/>
                                      </div>
                                      <div className="flex-1 bg-slate-100 rounded-t-sm flex flex-col justify-end overflow-hidden" style={{height:'100%'}}>
                                        <div className="bg-red-400 rounded-t-sm transition-all"
                                          style={{height:`${Math.round((d.expense/dailyMax)*100)}%`, minHeight: d.expense>0?2:0}}/>
                                      </div>
                                    </div>
                                  ))}
                                </div>
                                <div className="flex mt-1 overflow-hidden">
                                  {analyticsData.dailyData.map((d, i) => (
                                    <div key={i} className="flex-1 text-center text-[8px] text-slate-300">{d.day}</div>
                                  ))}
                                </div>
                              </>
                            );
                          })()}
                        </div>
                      )}

                      {/* Monthly bar chart */}
                      {analyticsView === 'monthly' && (
                        <div className="bg-white rounded-2xl border border-slate-200 p-6">
                          <div className="flex items-center justify-between mb-6">
                            <h3 className="font-bold text-slate-700 text-sm">รายรับ-รายจ่ายรายเดือน ({analyticsYear})</h3>
                            <div className="flex items-center gap-3 text-xs text-slate-400">
                              <span className="flex items-center gap-1"><span className="w-3 h-3 rounded-sm bg-green-400 inline-block"/> รายรับ</span>
                              <span className="flex items-center gap-1"><span className="w-3 h-3 rounded-sm bg-red-400 inline-block"/> รายจ่าย</span>
                            </div>
                          </div>
                          {(() => {
                            const monthlyMax = Math.max(...analyticsData.monthlyData.map(m => Math.max(m.income, m.expense)), 1);
                            return (
                              <>
                                <div className="flex gap-1 items-end h-32">
                                  {analyticsData.monthlyData.map((m, i) => (
                                    <div key={i} className="flex-1 flex gap-0.5 items-end h-full group relative">
                                      <div className="absolute bottom-full mb-1 left-1/2 -translate-x-1/2 bg-slate-800 text-white text-[9px] px-2 py-1 rounded-lg whitespace-nowrap opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none z-10">
                                        {m.month}: รับ ฿{m.income.toLocaleString()} / จ่าย ฿{m.expense.toLocaleString()}
                                      </div>
                                      <div className="flex-1 bg-slate-100 rounded-t-sm flex flex-col justify-end overflow-hidden" style={{height:'100%'}}>
                                        <div className="bg-green-400 rounded-t-sm transition-all"
                                          style={{height:`${Math.round((m.income/monthlyMax)*100)}%`, minHeight:m.income>0?2:0}}/>
                                      </div>
                                      <div className="flex-1 bg-slate-100 rounded-t-sm flex flex-col justify-end overflow-hidden" style={{height:'100%'}}>
                                        <div className="bg-red-400 rounded-t-sm transition-all"
                                          style={{height:`${Math.round((m.expense/monthlyMax)*100)}%`, minHeight:m.expense>0?2:0}}/>
                                      </div>
                                    </div>
                                  ))}
                                </div>
                                <div className="flex mt-2">
                                  {analyticsData.monthlyData.map((m, i) => (
                                    <div key={i} className="flex-1 text-center text-[9px] text-slate-400">{m.month}</div>
                                  ))}
                                </div>
                              </>
                            );
                          })()}
                        </div>
                      )}

                      {/* Branch comparison (Advance+) */}
                      {hasFeature(tierKey, 'advance') && analyticsData.branchData?.length > 0 && (
                        <div className="bg-white rounded-2xl border border-slate-200 p-6">
                          <h3 className="font-bold text-slate-700 text-sm mb-5">เปรียบเทียบรายสาขา ({analyticsYear})</h3>
                          <div className="space-y-3">
                            {analyticsData.branchData.map((b, i) => {
                              const maxBranch = Math.max(...analyticsData.branchData.map(x => x.income), 1);
                              return (
                                <div key={i}>
                                  <div className="flex justify-between text-xs mb-1">
                                    <span className="font-medium text-slate-700">{b.branch}</span>
                                    <span className="text-green-600 font-bold">฿{b.income.toLocaleString()}</span>
                                  </div>
                                  <div className="h-2 bg-slate-100 rounded-full overflow-hidden">
                                    <div className="h-full bg-gradient-to-r from-blue-400 to-indigo-500 rounded-full transition-all"
                                      style={{ width: `${Math.round((b.income / maxBranch) * 100)}%` }}/>
                                  </div>
                                </div>
                              );
                            })}
                          </div>
                        </div>
                      )}

                      {/* Top Senders (Business+) */}
                      {hasFeature(tierKey, 'business') && analyticsData.topSenders?.length > 0 && (
                        <div className="bg-white rounded-2xl border border-slate-200 p-6">
                          <div className="flex items-center justify-between mb-5">
                            <div className="flex items-center gap-2">
                              <Users size={16} className="text-emerald-600"/>
                              <h3 className="font-bold text-slate-700 text-sm">Top Sender รายปี ({analyticsYear})</h3>
                            </div>
                            {isUnlimited && (
                              <span className="text-[10px] bg-violet-100 text-violet-600 px-2 py-0.5 rounded-full font-bold">
                                👑 Enterprise — ทั้งหมด {analyticsData.topSenders.length} ราย
                              </span>
                            )}
                          </div>
                          <div className="space-y-2">
                            {(isUnlimited ? analyticsData.topSenders : analyticsData.topSenders.slice(0, 10)).map((s, i) => (
                              <div key={i} className="flex items-center gap-3 p-2.5 rounded-xl hover:bg-slate-50 transition-colors">
                                <span className={`w-6 h-6 rounded-full flex items-center justify-center text-[10px] font-black shrink-0
                                  ${i === 0 ? 'bg-amber-400 text-white' : i === 1 ? 'bg-slate-300 text-white' : i === 2 ? 'bg-amber-700 text-white' : 'bg-slate-100 text-slate-500'}`}>
                                  {i + 1}
                                </span>
                                <span className="flex-1 text-sm font-medium text-slate-700 truncate">{s.name}</span>
                                <span className="text-xs text-slate-400">{s.count} ครั้ง</span>
                                <span className="text-sm font-bold text-green-600 font-mono">฿{s.amount.toLocaleString()}</span>
                              </div>
                            ))}
                          </div>
                        </div>
                      )}

                      {/* Upgrade prompt for Business features */}
                      {!hasFeature(tierKey, 'business') && (
                        <div className="bg-gradient-to-r from-emerald-50 to-teal-50 border border-emerald-200 rounded-2xl p-5 flex items-center justify-between gap-4">
                          <div>
                            <p className="font-bold text-emerald-700 text-sm">🏆 Top Sender — ใช้ได้กับ Business ขึ้นไป</p>
                            <p className="text-emerald-500 text-xs mt-0.5">รู้ว่าลูกค้าคนไหนโอนมากที่สุด</p>
                          </div>
                          <Link href={`/pricing?userId=${shopInfo?.owner_line_id}`}
                            className="shrink-0 bg-emerald-600 hover:bg-emerald-700 text-white font-bold text-xs px-4 py-2 rounded-xl transition-all">
                            ดู Business Plan
                          </Link>
                        </div>
                      )}

                      {/* ════ สรุปตามหมวดหมู่ (Business+) ════ */}
                      {hasFeature(tierKey, 'business') && (analyticsData.incomeByCategory?.length > 0 || analyticsData.expenseByCategory?.length > 0) && (() => {
                        const THAI_M = ['ม.ค.','ก.พ.','มี.ค.','เม.ย.','พ.ค.','มิ.ย.','ก.ค.','ส.ค.','ก.ย.','ต.ค.','พ.ย.','ธ.ค.'];
                        const mIdx = parseInt(analyticsData.dailySummary?.month || (new Date().getMonth()+1)) - 1;
                        const mLabel = THAI_M[mIdx] || '';
                        const fmtB = n => Number(n||0).toLocaleString('th-TH', { maximumFractionDigits: 0 });
                        const CatBar = ({ items, color, max }) => (
                          <div className="space-y-2.5">
                            {items.map((c, i) => {
                              const pct = max > 0 ? Math.round((c.amount / max) * 100) : 0;
                              return (
                                <div key={i}>
                                  <div className="flex justify-between items-center mb-1">
                                    <span className="text-xs font-medium text-slate-600">{c.category}</span>
                                    <div className="flex items-center gap-2">
                                      <span className="text-[10px] text-slate-400">{c.count} รายการ</span>
                                      <span className={`text-xs font-bold ${color === 'green' ? 'text-emerald-600' : 'text-red-500'}`}>฿{fmtB(c.amount)}</span>
                                    </div>
                                  </div>
                                  <div className="h-2 bg-slate-100 rounded-full overflow-hidden">
                                    <div className={`h-full rounded-full transition-all ${color === 'green' ? 'bg-emerald-400' : 'bg-red-400'}`}
                                      style={{ width: `${pct}%` }}/>
                                  </div>
                                </div>
                              );
                            })}
                          </div>
                        );
                        const incMax  = Math.max(...(analyticsData.incomeByCategory||[]).map(c => c.amount), 1);
                        const expMax  = Math.max(...(analyticsData.expenseByCategory||[]).map(c => c.amount), 1);
                        return (
                          <div className="bg-white rounded-2xl border border-slate-200 p-6">
                            <div className="flex items-center gap-2 mb-5">
                              <span className="text-base">🏷️</span>
                              <h3 className="font-bold text-slate-700 text-sm">สรุปตามหมวดหมู่ — {mLabel} {analyticsData.summary?.year}</h3>
                              <span className="ml-auto text-[10px] bg-purple-100 text-purple-600 px-2 py-0.5 rounded-full font-bold">Business+</span>
                            </div>
                            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                              {analyticsData.incomeByCategory?.length > 0 && (
                                <div>
                                  <p className="text-xs font-bold text-emerald-600 mb-3 flex items-center gap-1">💚 รายรับแยกหมวดหมู่</p>
                                  <CatBar items={analyticsData.incomeByCategory} color="green" max={incMax}/>
                                </div>
                              )}
                              {analyticsData.expenseByCategory?.length > 0 && (
                                <div>
                                  <p className="text-xs font-bold text-red-500 mb-3 flex items-center gap-1">🔴 รายจ่ายแยกหมวดหมู่</p>
                                  <CatBar items={analyticsData.expenseByCategory} color="red" max={expMax}/>
                                </div>
                              )}
                            </div>
                            <p className="text-[10px] text-slate-400 mt-4">* หมวดหมู่จะแสดงเมื่อบอทสแกนสลิปให้ร้าน Business+ ขึ้นไปเท่านั้น แก้ไขได้ที่ปุ่ม ✏️ ในหน้า Ledger</p>
                          </div>
                        );
                      })()}

                      {hasFeature(tierKey, 'business') && analyticsData.incomeByCategory?.length === 0 && analyticsData.expenseByCategory?.length === 0 && (
                        <div className="bg-purple-50 border border-purple-100 rounded-2xl p-5 text-center">
                          <p className="text-2xl mb-2">🏷️</p>
                          <p className="font-bold text-purple-700 text-sm">ยังไม่มีข้อมูลหมวดหมู่เดือนนี้</p>
                          <p className="text-purple-400 text-xs mt-1">บอทจะจัดหมวดหมู่ให้อัตโนมัติทุกครั้งที่สแกนสลิปใหม่</p>
                        </div>
                      )}

                      {/* ════ Enterprise Marketing Intelligence ════ */}
                      {isUnlimited && (() => {
                        const DAY_TH  = ['อา.','จ.','อ.','พ.','พฤ.','ศ.','ส.'];
                        const DAY_FULL = ['อาทิตย์','จันทร์','อังคาร','พุธ','พฤหัส','ศุกร์','เสาร์'];
                        const fmtB = n => Number(n||0).toLocaleString('th-TH', { maximumFractionDigits: 0 });

                        // ── 1. Peak Time Heatmap ──
                        const hm = marketingData?.heatmap;
                        const PeakHeatmap = hm ? (() => {
                          const maxC = hm.maxCell || 1;
                          const intensityBg = (v) => {
                            const pct = v / maxC;
                            if (pct === 0) return 'bg-slate-50';
                            if (pct < 0.2) return 'bg-amber-100';
                            if (pct < 0.4) return 'bg-amber-200';
                            if (pct < 0.6) return 'bg-amber-300';
                            if (pct < 0.8) return 'bg-amber-400';
                            return 'bg-amber-500';
                          };
                          return (
                            <div className="bg-white rounded-2xl border border-slate-200 p-6">
                              <div className="flex items-center gap-2 mb-1 flex-wrap">
                                <span className="text-base">🔥</span>
                                <h3 className="font-bold text-slate-700 text-sm">Peak Time Heatmap</h3>
                                <span className="text-[10px] bg-violet-100 text-violet-600 px-2 py-0.5 rounded-full font-bold">Enterprise</span>
                                {marketingData?.branches?.length > 0 && (
                                  <select value={heatmapBranch}
                                    onChange={e => { setHeatmapBranch(e.target.value); fetchMarketing(shopInfo.id, e.target.value, rfmBrand); }}
                                    className="ml-auto border border-slate-200 rounded-lg px-2 py-1 text-xs font-medium outline-none focus:border-amber-400 bg-white">
                                    <option value="all">ทุกสาขา (รวม)</option>
                                    <option value="__main__">สำนักงานใหญ่</option>
                                    {marketingData.branches.map(b => <option key={b.id} value={b.id}>{b.name}</option>)}
                                  </select>
                                )}
                              </div>
                              <p className="text-[11px] text-slate-400 mb-4">90 วันล่าสุด · {hm.totalTransactions.toLocaleString()} รายการ · ขายดีที่สุด {DAY_FULL[hm.peakDay]} เวลา {hm.peakHour}:00–{hm.peakHour+1}:00 น.</p>
                              <div className="overflow-x-auto">
                                <div className="min-w-max">
                                  {/* hour labels */}
                                  <div className="flex ml-8 mb-1 gap-px">
                                    {Array.from({length:24},(_,h)=>(
                                      <div key={h} className={`w-5 text-center text-[8px] font-medium ${h===hm.peakHour?'text-amber-600 font-black':'text-slate-300'}`}>{h}</div>
                                    ))}
                                  </div>
                                  {hm.grid.map((row, d) => (
                                    <div key={d} className="flex items-center gap-px mb-px">
                                      <div className={`w-7 text-[9px] font-bold shrink-0 text-right pr-1 ${d===hm.peakDay?'text-amber-600':'text-slate-400'}`}>{DAY_TH[d]}</div>
                                      {row.map((v,h) => (
                                        <div key={h} title={`${DAY_FULL[d]} ${h}:00 — ${v} รายการ`}
                                          className={`w-5 h-5 rounded-sm ${intensityBg(v)} transition-colors cursor-default`}/>
                                      ))}
                                    </div>
                                  ))}
                                  <div className="flex items-center gap-2 mt-3 ml-8">
                                    <span className="text-[9px] text-slate-400">น้อย</span>
                                    {['bg-slate-50','bg-amber-100','bg-amber-200','bg-amber-300','bg-amber-400','bg-amber-500'].map((c,i)=>(
                                      <div key={i} className={`w-4 h-3 rounded-sm ${c} border border-slate-100`}/>
                                    ))}
                                    <span className="text-[9px] text-slate-400">มาก</span>
                                  </div>
                                </div>
                              </div>
                              <div className="grid grid-cols-2 gap-3 mt-4">
                                <div className="bg-amber-50 rounded-xl p-3">
                                  <p className="text-[10px] text-amber-600 font-medium">ชั่วโมงขายดีที่สุด</p>
                                  <p className="text-lg font-black text-amber-700">{hm.peakHour}:00 น.</p>
                                  <p className="text-[10px] text-amber-400">{hm.hourTotals[hm.peakHour]} รายการ</p>
                                </div>
                                <div className="bg-amber-50 rounded-xl p-3">
                                  <p className="text-[10px] text-amber-600 font-medium">วันขายดีที่สุด</p>
                                  <p className="text-lg font-black text-amber-700">วัน{DAY_FULL[hm.peakDay]}</p>
                                  <p className="text-[10px] text-amber-400">{hm.dayTotals[hm.peakDay]} รายการ</p>
                                </div>
                              </div>
                            </div>
                          );
                        })() : marketingLoading ? (
                          <div className="bg-white rounded-2xl border border-slate-200 p-8 text-center text-slate-300 text-sm animate-pulse">กำลังโหลด Peak Time Heatmap...</div>
                        ) : null;

                        // ── 2. RFM Customer Segments ──
                        const rfm = marketingData?.rfm;
                        const RFMPanel = rfm ? (() => {
                          const segs = [
                            { key:'champions', label:'Champions', emoji:'🏆', desc:'โอนบ่อย เพิ่งมา', color:'emerald', count: rfm.champions },
                            { key:'loyal',     label:'Loyal',     emoji:'💎', desc:'ลูกค้าประจำ',    color:'blue',    count: rfm.loyal },
                            { key:'regular',   label:'Regular',   emoji:'😊', desc:'ปกติทั่วไป',    color:'sky',     count: rfm.regular },
                            { key:'new',       label:'New',       emoji:'🌱', desc:'ลูกค้าใหม่',    color:'teal',    count: rfm.new },
                            { key:'at_risk',   label:'At Risk',   emoji:'⚠️',  desc:'เคยมาแต่หาย',   color:'amber',   count: rfm.at_risk },
                            { key:'lost',      label:'Lost',      emoji:'👻', desc:'ไม่มา 90+ วัน',  color:'rose',    count: rfm.lost },
                            { key:'dormant',   label:'Dormant',   emoji:'😴', desc:'นานๆ มาที',      color:'slate',   count: rfm.dormant || 0 },
                          ];
                          const colorMap = {
                            emerald:'bg-emerald-50 border-emerald-200 text-emerald-700',
                            blue:'bg-blue-50 border-blue-200 text-blue-700',
                            sky:'bg-sky-50 border-sky-200 text-sky-700',
                            teal:'bg-teal-50 border-teal-200 text-teal-700',
                            amber:'bg-amber-50 border-amber-200 text-amber-700',
                            rose:'bg-rose-50 border-rose-200 text-rose-700',
                            slate:'bg-slate-50 border-slate-200 text-slate-600',
                          };
                          // ── Action Card ──
                          const rfmSenders = marketingData?.rfmSenders || [];
                          const segSenders = rfmSelectedSeg ? rfmSenders.filter(s => s.segment === rfmSelectedSeg) : [];
                          const selectedSegMeta = segs.find(s => s.key === rfmSelectedSeg);

                          const SEG_INSIGHT = {
                            champions: {
                              insight: 'ลูกค้าที่ดีที่สุดของร้าน — โอนบ่อย ยอดสูง และเพิ่งมาใน 7 วันที่ผ่านมา',
                              action: 'รักษาคุณภาพบริการให้สม่ำเสมอ กลุ่มนี้คือรายได้หลักของร้าน อย่าให้พวกเขาผิดหวัง',
                            },
                            loyal: {
                              insight: 'ลูกค้าประจำที่ไว้วางใจร้านคุณ — มาสม่ำเสมอและเพิ่งมาเร็วๆ นี้',
                              action: 'ลองเสนอโปรพิเศษหรือของขวัญเล็กๆ น้อยๆ เพื่อยกระดับขึ้นเป็น Champions',
                            },
                            new: {
                              insight: 'ลูกค้าใหม่ที่เพิ่งทดลองใช้บริการเป็นครั้งแรก',
                              action: 'สร้างความประทับใจแรก — บริการที่ดีในครั้งแรกคือโอกาสที่จะได้ลูกค้าประจำ',
                            },
                            regular: {
                              insight: 'ลูกค้าที่มาใช้บริการเป็นประจำในระดับปกติ',
                              action: 'ดูแลอย่างสม่ำเสมอ มีโอกาสยกระดับเป็น Loyal ถ้าได้รับประสบการณ์ที่ดีต่อเนื่อง',
                            },
                            at_risk: {
                              insight: 'เคยเป็นลูกค้าประจำ แต่หายไปแล้ว 30–90 วัน — ยังมีโอกาสดึงกลับได้สูง',
                              action: 'ส่ง promotion หรือแจ้งสินค้าใหม่ใน LINE กลุ่ม — คนกลุ่มนี้รู้จักร้านดีอยู่แล้ว',
                            },
                            lost: {
                              insight: 'ไม่มีธุรกรรมมานานกว่า 90 วัน — ความสัมพันธ์เริ่มจางลง',
                              action: 'ลอง flash sale หรือโปรพิเศษ อาจกระตุ้นได้ แต่อย่าลงทุนสูงกับกลุ่มนี้',
                            },
                            dormant: {
                              insight: 'มาไม่บ่อย แต่ยังไม่ขาดการติดต่อ — ลูกค้าประเภทโอกาสพิเศษ',
                              action: 'กระตุ้นด้วยโปรโมชั่นตามฤดูกาลหรือวันพิเศษ เช่น สงกรานต์ ปีใหม่',
                            },
                          };

                          // คำนวณ stats ของ segment ที่เลือก
                          const avgTx   = segSenders.length > 0 ? Math.round(segSenders.reduce((s,x) => s+x.transactions,0) / segSenders.length) : 0;
                          const avgDays = segSenders.length > 0 ? Math.round(segSenders.reduce((s,x) => s+x.daysSince,0) / segSenders.length) : 0;
                          const highCnt = segSenders.filter(x => x.amountBucket === 'high').length;
                          const medCnt  = segSenders.filter(x => x.amountBucket === 'medium').length;
                          const dominantBucket = highCnt > medCnt && highCnt > (segSenders.length - highCnt - medCnt) ? 'สูง' : medCnt > (segSenders.length - highCnt - medCnt) ? 'กลาง' : 'ต่ำ';
                          // สาขาที่ลูกค้ากลุ่มนี้ไปบ่อยที่สุด (ถ้าร้านมีหลายสาขาในแบรนด์เดียวกัน)
                          const branchCounts = {};
                          segSenders.forEach(x => { if (x.homeBranch) branchCounts[x.homeBranch] = (branchCounts[x.homeBranch]||0)+1; });
                          const branchEntries = Object.entries(branchCounts).sort((a,b)=>b[1]-a[1]);

                          return (
                            <div className="bg-white rounded-2xl border border-slate-200 p-6">
                              <div className="flex items-center gap-2 mb-1 flex-wrap">
                                <span className="text-base">👥</span>
                                <h3 className="font-bold text-slate-700 text-sm">RFM Customer Segments</h3>
                                <span className="text-[10px] bg-violet-100 text-violet-600 px-2 py-0.5 rounded-full font-bold">Enterprise</span>
                                {marketingData?.availableBrands?.length > 1 && (
                                  <select value={rfmBrand || marketingData.selectedBrandKey}
                                    onChange={e => { setRfmBrand(e.target.value); fetchMarketing(shopInfo.id, heatmapBranch, e.target.value); }}
                                    className="ml-auto border border-slate-200 rounded-lg px-2 py-1 text-xs font-medium outline-none focus:border-violet-400 bg-white">
                                    {marketingData.availableBrands.map(b => <option key={b.key} value={b.key}>🏷️ {b.label}</option>)}
                                  </select>
                                )}
                              </div>
                              <p className="text-[11px] text-slate-400 mb-4">
                                ลูกค้าทั้งหมด {rfm.total.toLocaleString()} ราย · Retention Rate <span className={`font-black ${rfm.retentionRate >= 60 ? 'text-emerald-600' : rfm.retentionRate >= 30 ? 'text-amber-500' : 'text-rose-500'}`}>{rfm.retentionRate}%</span>
                                {rfm.at_risk > 0 && <span className="ml-2 text-amber-500 font-semibold">· ⚠️ {rfm.at_risk} รายเสี่ยงหาย</span>}
                              </p>

                              {/* Segment cards */}
                              <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
                                {segs.map(s => {
                                  const isSelected = rfmSelectedSeg === s.key;
                                  return (
                                    <button
                                      key={s.key}
                                      onClick={() => setRfmSelectedSeg(isSelected ? null : s.key)}
                                      className={`rounded-xl p-3.5 border text-left transition-all ${colorMap[s.color]} ${isSelected ? 'ring-2 ring-offset-1 ring-current shadow-md scale-[1.02]' : 'hover:opacity-80 hover:shadow-sm'} ${s.count === 0 ? 'opacity-40 cursor-default' : 'cursor-pointer'}`}
                                      disabled={s.count === 0}
                                    >
                                      <div className="flex items-center justify-between mb-1">
                                        <span className="text-base">{s.emoji}</span>
                                        <span className="text-xl font-black">{s.count}</span>
                                      </div>
                                      <p className="text-xs font-bold">{s.label}</p>
                                      <p className="text-[10px] opacity-70 mt-0.5">{s.desc}</p>
                                      {isSelected && <p className="text-[9px] font-bold mt-1 opacity-90">▲ กดเพื่อปิด</p>}
                                    </button>
                                  );
                                })}
                              </div>

                              {/* Action Card */}
                              {rfmSelectedSeg && selectedSegMeta && segSenders.length > 0 && (
                                <div className={`mt-4 rounded-2xl border p-5 ${colorMap[selectedSegMeta.color]}`}>
                                  <div className="flex items-center gap-2 mb-3">
                                    <span className="text-lg">{selectedSegMeta.emoji}</span>
                                    <span className="font-bold text-sm">{selectedSegMeta.label} · {segSenders.length} ราย</span>
                                    <button onClick={() => setRfmSelectedSeg(null)} className="ml-auto text-[10px] opacity-50 hover:opacity-100 px-1">✕</button>
                                  </div>

                                  {/* Stats row */}
                                  <div className="grid grid-cols-3 gap-2 mb-4">
                                    <div className="bg-white/60 rounded-xl p-2.5 text-center">
                                      <p className="text-lg font-black">{avgTx}</p>
                                      <p className="text-[10px] opacity-70">เฉลี่ย ครั้ง/ราย</p>
                                    </div>
                                    <div className="bg-white/60 rounded-xl p-2.5 text-center">
                                      <p className="text-lg font-black">{avgDays === 0 ? 'วันนี้' : avgDays}</p>
                                      <p className="text-[10px] opacity-70">{avgDays === 0 ? 'ล่าสุด' : 'วันที่แล้ว (เฉลี่ย)'}</p>
                                    </div>
                                    <div className="bg-white/60 rounded-xl p-2.5 text-center">
                                      <p className="text-lg font-black">{dominantBucket}</p>
                                      <p className="text-[10px] opacity-70">ระดับยอดส่วนใหญ่</p>
                                    </div>
                                  </div>

                                  {branchEntries.length > 1 && (
                                    <div className="bg-white/60 rounded-xl p-2.5 mb-3 text-[11px]">
                                      <span className="font-bold">📍 สาขาประจำของกลุ่มนี้:</span>{' '}
                                      {branchEntries.map(([name, c], i) => (
                                        <span key={name}>{i > 0 && ', '}{name} ({c})</span>
                                      ))}
                                    </div>
                                  )}

                                  {/* Insight */}
                                  <p className="text-xs mb-3 opacity-80 leading-relaxed">{SEG_INSIGHT[rfmSelectedSeg]?.insight}</p>

                                  {/* Recommended action */}
                                  <div className="bg-white/70 rounded-xl p-3 flex items-start gap-2">
                                    <span className="text-sm shrink-0">💡</span>
                                    <div>
                                      <p className="text-[10px] font-bold mb-0.5">แนะนำ</p>
                                      <p className="text-[11px] leading-relaxed">{SEG_INSIGHT[rfmSelectedSeg]?.action}</p>
                                    </div>
                                  </div>
                                </div>
                              )}

                              {rfm.at_risk > 0 && !rfmSelectedSeg && (
                                <div className="mt-4 bg-amber-50 border border-amber-200 rounded-xl p-3 flex items-start gap-2">
                                  <span className="text-base shrink-0">💡</span>
                                  <div>
                                    <p className="text-xs font-bold text-amber-700">แนะนำ: กด At Risk เพื่อดูแผนดึงลูกค้ากลับ</p>
                                    <p className="text-[10px] text-amber-600 mt-0.5">มีลูกค้า {rfm.at_risk} รายที่เคยโอนบ่อย แต่หายไปแล้ว 30–90 วัน</p>
                                  </div>
                                </div>
                              )}
                            </div>
                          );
                        })() : marketingLoading ? (
                          <div className="bg-white rounded-2xl border border-slate-200 p-8 text-center text-slate-300 text-sm animate-pulse">กำลังโหลด RFM Segments...</div>
                        ) : null;

                        // ── 3. Marketing ROI ──
                        const roiData = analyticsData?.marketingROI || [];
                        const totalSpend  = roiData.reduce((s,d) => s + d.marketingSpend, 0);
                        const roiIncome   = roiData.reduce((s,d) => s + d.income, 0);
                        const roiRatio    = totalSpend > 0 ? (roiIncome / totalSpend).toFixed(1) : null;
                        const roiMaxInc   = Math.max(...roiData.map(d => d.income), 1);
                        const roiMaxSpend = Math.max(...roiData.map(d => d.marketingSpend), 1);
                        const roiMax      = Math.max(roiMaxInc, roiMaxSpend, 1);
                        const MarketingROI = (
                          <div className="bg-white rounded-2xl border border-slate-200 p-6">
                            <div className="flex items-center gap-2 mb-1">
                              <span className="text-base">📈</span>
                              <h3 className="font-bold text-slate-700 text-sm">Marketing ROI</h3>
                              <span className="ml-auto text-[10px] bg-violet-100 text-violet-600 px-2 py-0.5 rounded-full font-bold">Enterprise</span>
                            </div>
                            <p className="text-[11px] text-slate-400 mb-4">เปรียบเทียบค่าโฆษณา vs รายรับ เดือนที่เลือก · หมวดหมู่: ค่าการตลาด/โฆษณา</p>
                            {roiData.length === 0 ? (
                              <div className="text-center py-6">
                                <p className="text-2xl mb-2">📣</p>
                                <p className="text-sm text-slate-500 font-medium">ยังไม่มีรายจ่ายหมวด "ค่าการตลาด/โฆษณา" เดือนนี้</p>
                                <p className="text-[11px] text-slate-400 mt-1">บันทึกรายจ่ายค่าโฆษณาผ่านบอท แล้วตั้งหมวดหมู่ที่ปุ่ม ✏️ ใน Ledger</p>
                              </div>
                            ) : (
                              <>
                                <div className="grid grid-cols-3 gap-3 mb-5">
                                  <div className="bg-orange-50 rounded-xl p-3 text-center">
                                    <p className="text-[10px] text-orange-500 font-medium">ค่าโฆษณารวม</p>
                                    <p className="text-base font-black text-orange-700">฿{fmtB(totalSpend)}</p>
                                  </div>
                                  <div className="bg-emerald-50 rounded-xl p-3 text-center">
                                    <p className="text-[10px] text-emerald-600 font-medium">รายรับรวม</p>
                                    <p className="text-base font-black text-emerald-700">฿{fmtB(roiIncome)}</p>
                                  </div>
                                  <div className={`rounded-xl p-3 text-center ${roiRatio >= 3 ? 'bg-emerald-50' : roiRatio >= 1 ? 'bg-amber-50' : 'bg-rose-50'}`}>
                                    <p className={`text-[10px] font-medium ${roiRatio >= 3 ? 'text-emerald-600' : roiRatio >= 1 ? 'text-amber-500' : 'text-rose-500'}`}>ROI Ratio</p>
                                    <p className={`text-base font-black ${roiRatio >= 3 ? 'text-emerald-700' : roiRatio >= 1 ? 'text-amber-600' : 'text-rose-600'}`}>{roiRatio}x</p>
                                  </div>
                                </div>
                                <div className="space-y-1">
                                  {roiData.map((d,i) => (
                                    <div key={i} className="flex items-center gap-2">
                                      <span className="text-[10px] text-slate-400 w-5 text-right shrink-0">{d.day}</span>
                                      <div className="flex-1 space-y-0.5">
                                        <div className="h-2 bg-emerald-100 rounded-full overflow-hidden">
                                          <div className="h-full bg-emerald-400 rounded-full" style={{width:`${Math.round((d.income/roiMax)*100)}%`}}/>
                                        </div>
                                        {d.marketingSpend > 0 && (
                                          <div className="h-2 bg-orange-100 rounded-full overflow-hidden">
                                            <div className="h-full bg-orange-400 rounded-full" style={{width:`${Math.round((d.marketingSpend/roiMax)*100)}%`}}/>
                                          </div>
                                        )}
                                      </div>
                                    </div>
                                  ))}
                                </div>
                                <div className="flex gap-4 mt-3">
                                  <span className="flex items-center gap-1 text-[10px] text-slate-500"><span className="w-3 h-2 bg-emerald-400 rounded-sm inline-block"/>รายรับ</span>
                                  <span className="flex items-center gap-1 text-[10px] text-slate-500"><span className="w-3 h-2 bg-orange-400 rounded-sm inline-block"/>ค่าโฆษณา</span>
                                </div>
                              </>
                            )}
                          </div>
                        );

                        // ── 4. Revenue Forecast ──
                        const months12 = analyticsData?.monthlyData || [];
                        const THAI_M = ['ม.ค.','ก.พ.','มี.ค.','เม.ย.','พ.ค.','มิ.ย.','ก.ค.','ส.ค.','ก.ย.','ต.ค.','พ.ย.','ธ.ค.'];
                        const currentMonth = parseInt(analyticsData?.summary?.month || (new Date().getMonth()+1));

                        // เอาเฉพาะเดือนที่ผ่านมา (count > 0) สำหรับ regression
                        const historicMonths = months12.filter((m,i) => i < currentMonth && (m.income > 0 || m.expense > 0));

                        // Linear regression อย่างง่าย
                        const forecast = (() => {
                          const pts = historicMonths.map((m, i) => ({ x: i, y: m.income }));
                          if (pts.length < 2) return [];
                          const n = pts.length;
                          const sumX = pts.reduce((s,p) => s+p.x, 0);
                          const sumY = pts.reduce((s,p) => s+p.y, 0);
                          const sumXY = pts.reduce((s,p) => s+p.x*p.y, 0);
                          const sumXX = pts.reduce((s,p) => s+p.x*p.x, 0);
                          const denom = n*sumXX - sumX*sumX;
                          if (denom === 0) return [];
                          const slope = (n*sumXY - sumX*sumY) / denom;
                          const intercept = (sumY - slope*sumX) / n;
                          const lastX = pts[pts.length-1].x;
                          return [1,2,3].map(i => ({
                            monthIdx: currentMonth - 1 + i, // 0-based
                            y: Math.max(0, Math.round(intercept + slope*(lastX+i))),
                          })).filter(f => f.monthIdx < 12);
                        })();

                        const fcMax = Math.max(
                          ...historicMonths.map(m => Math.max(m.income, m.expense)),
                          ...forecast.map(f => f.y),
                          1
                        );

                        const RevForecast = historicMonths.length >= 2 ? (
                          <div className="bg-white rounded-2xl border border-slate-200 p-6">
                            <div className="flex items-center gap-2 mb-1">
                              <span className="text-base">🔮</span>
                              <h3 className="font-bold text-slate-700 text-sm">Revenue Forecast</h3>
                              <span className="ml-auto text-[10px] bg-violet-100 text-violet-600 px-2 py-0.5 rounded-full font-bold">Enterprise</span>
                            </div>
                            <p className="text-[11px] text-slate-400 mb-4">พยากรณ์รายรับ 3 เดือนข้างหน้า จาก {historicMonths.length} เดือนย้อนหลัง (Linear Trend)</p>
                            {forecast.length > 0 && (
                              <div className="grid grid-cols-3 gap-3 mb-5">
                                {forecast.map((f,i) => (
                                  <div key={i} className="bg-violet-50 border border-violet-100 rounded-xl p-3 text-center">
                                    <p className="text-[10px] text-violet-500 font-medium">{THAI_M[f.monthIdx % 12]}</p>
                                    <p className="text-sm font-black text-violet-700">฿{fmtB(f.y)}</p>
                                    <p className="text-[9px] text-violet-400">คาดการณ์</p>
                                  </div>
                                ))}
                              </div>
                            )}
                            <div className="space-y-2">
                              {historicMonths.map((m, i) => (
                                <div key={i} className="flex items-center gap-2">
                                  <span className="text-[10px] text-slate-400 w-8 shrink-0 text-right">{m.month}</span>
                                  <div className="flex-1 space-y-0.5">
                                    <div className="h-2 bg-slate-100 rounded-full overflow-hidden">
                                      <div className="h-full bg-emerald-400 rounded-full" style={{width:`${Math.round((m.income/fcMax)*100)}%`}}/>
                                    </div>
                                    <div className="h-1.5 bg-slate-100 rounded-full overflow-hidden">
                                      <div className="h-full bg-red-300 rounded-full" style={{width:`${Math.round((m.expense/fcMax)*100)}%`}}/>
                                    </div>
                                  </div>
                                  <span className="text-[10px] text-emerald-600 font-bold w-16 text-right shrink-0">฿{fmtB(m.income)}</span>
                                </div>
                              ))}
                              {forecast.map((f, i) => (
                                <div key={`f${i}`} className="flex items-center gap-2 opacity-60">
                                  <span className="text-[10px] text-violet-500 w-8 shrink-0 text-right font-medium">{THAI_M[f.monthIdx % 12]}</span>
                                  <div className="flex-1">
                                    <div className="h-2 rounded-full overflow-hidden" style={{background:'repeating-linear-gradient(90deg,#a78bfa 0,#a78bfa 4px,transparent 4px,transparent 8px)'}}>
                                      <div className="h-full" style={{width:`${Math.round((f.y/fcMax)*100)}%`}}/>
                                    </div>
                                  </div>
                                  <span className="text-[10px] text-violet-600 font-black w-16 text-right shrink-0">฿{fmtB(f.y)}</span>
                                </div>
                              ))}
                            </div>
                            <div className="flex gap-4 mt-3">
                              <span className="flex items-center gap-1 text-[10px] text-slate-500"><span className="w-3 h-2 bg-emerald-400 rounded-sm inline-block"/>รายรับ</span>
                              <span className="flex items-center gap-1 text-[10px] text-slate-500"><span className="w-3 h-2 bg-red-300 rounded-sm inline-block"/>รายจ่าย</span>
                              <span className="flex items-center gap-1 text-[10px] text-slate-500"><span className="w-3 h-1.5 rounded-sm inline-block" style={{background:'repeating-linear-gradient(90deg,#a78bfa 0,#a78bfa 4px,transparent 4px,transparent 8px)'}}/>คาดการณ์</span>
                            </div>
                          </div>
                        ) : null;

                        return (
                          <>
                            {PeakHeatmap}
                            {RFMPanel}
                            {MarketingROI}
                            {RevForecast}
                          </>
                        );
                      })()}

                      {/* Upgrade to Enterprise prompt */}
                      {!isUnlimited && hasFeature(tierKey, 'business') && (
                        <div className="bg-gradient-to-r from-violet-50 to-purple-50 border border-violet-200 rounded-2xl p-5 flex items-center justify-between gap-4">
                          <div>
                            <p className="font-bold text-violet-700 text-sm">👑 Marketing Intelligence — เฉพาะ Enterprise</p>
                            <p className="text-violet-500 text-xs mt-0.5">Peak Time Heatmap · RFM Segments · Marketing ROI · Revenue Forecast</p>
                          </div>
                          <Link href={`/pricing?userId=${shopInfo?.owner_line_id}`}
                            className="shrink-0 bg-violet-600 hover:bg-violet-700 text-white font-bold text-xs px-4 py-2 rounded-xl transition-all">
                            ดู Enterprise
                          </Link>
                        </div>
                      )}

                      {/* ════ Enterprise Exclusive Panel ════ */}
                      {isUnlimited && (
                        <div className="rounded-2xl overflow-hidden border border-violet-200">
                          <div className="bg-gradient-to-r from-violet-600 to-purple-600 px-6 py-4 flex items-center justify-between">
                            <div className="flex items-center gap-2">
                              <span className="text-lg">👑</span>
                              <div>
                                <p className="font-black text-white text-sm">Enterprise — ฟีเจอร์พิเศษเฉพาะ</p>
                                <p className="text-violet-200 text-[10px]">ฟีเจอร์ทั้งหมดปลดล็อค · Unlimited Scan · VIP Support</p>
                              </div>
                            </div>
                            <span className="text-[10px] bg-white/20 text-white px-3 py-1 rounded-full font-bold uppercase tracking-wider">Enterprise</span>
                          </div>
                          <div className="bg-white p-5 grid grid-cols-2 sm:grid-cols-3 gap-4">
                            {[
                              { icon:'♾️', label:'สแกนสลิป', value:'ไม่จำกัด', sub:'ไม่ตัดเครดิต' },
                              { icon:'🏢', label:'สาขา', value:'สูงสุด 20 สาขา', sub:'Multi-branch full' },
                              { icon:'👥', label:'Shop Admin', value:'สูงสุด 10 คน', sub:'จัดการทีมใหญ่' },
                              { icon:'📊', label:'Analytics', value:'ทุกฟีเจอร์', sub:'Daily · Monthly · Branch · Tax' },
                              { icon:'📤', label:'Export', value:'Excel + CSV', sub:'รายงานครบวงจร' },
                              { icon:'🎯', label:'VIP Support', value:'ติดต่อโดยตรง', sub:'Priority response' },
                            ].map((f,i) => (
                              <div key={i} className="bg-violet-50 rounded-xl p-3 border border-violet-100">
                                <div className="text-xl mb-1">{f.icon}</div>
                                <p className="text-[10px] text-violet-500 font-medium">{f.label}</p>
                                <p className="text-xs font-bold text-violet-800 mt-0.5">{f.value}</p>
                                <p className="text-[9px] text-violet-400 mt-0.5">{f.sub}</p>
                              </div>
                            ))}
                          </div>
                          <div className="bg-violet-50 border-t border-violet-100 px-5 py-3 flex items-center gap-3">
                            <span className="text-xs text-violet-600">🔒 เครดิตสำรองของคุณ:</span>
                            <span className="text-sm font-black text-violet-700 font-mono">{(credits||0).toLocaleString()} แผ่น</span>
                            <span className="text-[10px] text-violet-400">(ล็อคไว้ — จะใช้ได้เมื่อลดแพ็กเกจในอนาคต)</span>
                            <a href="https://lin.ee/wdnoEN5" target="_blank" rel="noreferrer"
                              className="ml-auto shrink-0 flex items-center gap-1.5 bg-violet-600 hover:bg-violet-700 text-white font-bold text-xs px-4 py-1.5 rounded-xl transition-all">
                              VIP Support LINE
                            </a>
                          </div>
                        </div>
                      )}

                    </>
                  )}
                </div>
              )}

              {/* ════ ACCOUNTS TAB ════ */}
              {activeTab === 'accounts' && (
                <div className="max-w-6xl space-y-5">

                  {/* Sub-tab switcher */}
                  <div className="flex gap-2 border-b border-slate-200 pb-1">
                    <button
                      onClick={() => setAccountsSubTab('ledger')}
                      className={`flex items-center gap-1.5 px-4 py-2 text-sm font-semibold rounded-t-xl transition-colors ${accountsSubTab === 'ledger' ? 'bg-white border border-b-white border-slate-200 text-blue-600 -mb-px' : 'text-slate-500 hover:text-slate-700'}`}>
                      <TrendingUp size={14}/> รายรับ-รายจ่าย
                    </button>
                    <button
                      onClick={() => setAccountsSubTab('tax')}
                      className={`flex items-center gap-1.5 px-4 py-2 text-sm font-semibold rounded-t-xl transition-colors ${accountsSubTab === 'tax' ? 'bg-white border border-b-white border-slate-200 text-indigo-600 -mb-px' : 'text-slate-500 hover:text-slate-700'}`}>
                      <Receipt size={14}/> รายงานภาษี {hasFeature(tierKey,'business') ? '' : <span className="ml-1 text-[9px] bg-amber-100 text-amber-600 px-1 rounded">Business+</span>}
                    </button>
                  </div>

                  {/* ── รายรับ-รายจ่าย ── */}
                  {accountsSubTab === 'ledger' && <div className="space-y-5">
                  <div className="bg-white rounded-2xl border border-slate-200 p-4 flex flex-wrap items-center gap-3">
                    <select value={ledgerYear}
                      onChange={e => { setLedgerYear(e.target.value); setLedgerPage(0); fetchTransactions(shopInfo.id, e.target.value, ledgerMonth); }}
                      className="border border-slate-200 rounded-xl px-3 py-2 text-sm font-medium focus:outline-none focus:ring-2 focus:ring-blue-300 bg-white">
                      {Array.from({length: 10}, (_, i) => new Date().getFullYear() + 1 - i).map(y => <option key={y} value={y}>{y}</option>)}
                    </select>
                    <select value={ledgerMonth}
                      onChange={e => { setLedgerMonth(e.target.value); setLedgerPage(0); setLedgerDate(''); fetchTransactions(shopInfo.id, ledgerYear, e.target.value); }}
                      className="border border-slate-200 rounded-xl px-3 py-2 text-sm font-medium focus:outline-none focus:ring-2 focus:ring-blue-300 bg-white">
                      {[['01','ม.ค.'],['02','ก.พ.'],['03','มี.ค.'],['04','เม.ย.'],['05','พ.ค.'],['06','มิ.ย.'],
                        ['07','ก.ค.'],['08','ส.ค.'],['09','ก.ย.'],['10','ต.ค.'],['11','พ.ย.'],['12','ธ.ค.']
                      ].map(([v, l]) => <option key={v} value={v}>{l} {ledgerYear}</option>)}
                    </select>
                    {/* รายรับ/รายจ่าย + โอน/เงินสด */}
                    <select value={ledgerTypeFilter}
                      onChange={e => { setLedgerTypeFilter(e.target.value); setLedgerPage(0); }}
                      className="border border-slate-200 rounded-xl px-3 py-2 text-sm font-medium focus:outline-none focus:ring-2 focus:ring-blue-300 bg-white">
                      <option value="all">ทั้งหมด (รับ+จ่าย)</option>
                      <option value="income">รายรับ — ทั้งหมด</option>
                      <option value="income-transfer">รายรับ — โอน</option>
                      <option value="income-cash">รายรับ — เงินสด</option>
                      <option value="expense">รายจ่าย — ทั้งหมด</option>
                      <option value="expense-transfer">รายจ่าย — โอน</option>
                      <option value="expense-cash">รายจ่าย — เงินสด</option>
                    </select>
                    {/* สาขา */}
                    {branches.length > 0 && (
                      <select value={ledgerBranchFilter}
                        onChange={e => { setLedgerBranchFilter(e.target.value); setLedgerPage(0); }}
                        className="border border-slate-200 rounded-xl px-3 py-2 text-sm font-medium focus:outline-none focus:ring-2 focus:ring-blue-300 bg-white">
                        <option value="all">ทุกสาขา</option>
                        {branches.map(b => <option key={b.id} value={b.branch_name}>{b.branch_name}</option>)}
                      </select>
                    )}
                    {/* Date filter */}
                    <input type="number" min="1" max="31" placeholder="วันที่ 1-31"
                      value={ledgerDate}
                      onChange={e => { setLedgerDate(e.target.value); setLedgerPage(0); }}
                      className="border border-slate-200 rounded-xl px-3 py-2 text-sm font-medium focus:outline-none focus:ring-2 focus:ring-blue-300 bg-white w-28"
                    />
                    {ledgerDate && (
                      <button onClick={() => { setLedgerDate(''); setLedgerPage(0); }}
                        className="text-slate-400 hover:text-slate-600 text-xs px-2 py-2 rounded-xl border border-slate-200">
                        ✕ ล้าง
                      </button>
                    )}
                    <button onClick={() => { setLedgerPage(0); fetchTransactions(shopInfo.id, ledgerYear, ledgerMonth); }}
                      className="flex items-center gap-1.5 bg-blue-800 text-white px-4 py-2 rounded-xl text-xs font-medium hover:bg-blue-700 transition-all">
                      <RefreshCcw size={13}/> โหลดใหม่
                    </button>
                    <div className="flex-1"/>
                    <button onClick={() => setShowAddModal(true)}
                      className="flex items-center gap-1.5 bg-indigo-600 hover:bg-indigo-700 text-white px-4 py-2 rounded-xl text-xs font-medium transition-all">
                      <PlusCircle size={13}/> บันทึกเอง
                    </button>
                    <button onClick={handleExportExcel} disabled={exportLoading || transactions.length === 0}
                      className="flex items-center gap-1.5 bg-green-600 hover:bg-green-700 text-white px-4 py-2 rounded-xl text-xs font-medium transition-all disabled:opacity-40 disabled:cursor-not-allowed">
                      <Download size={13}/>
                      {exportLoading ? 'กำลัง Export...' : 'Export Excel'}
                    </button>
                  </div>

                  <div className="bg-white rounded-2xl border border-slate-200 overflow-hidden">
                  <div className="overflow-x-auto">
                    <table className="w-full text-left min-w-[640px]">
                      <thead>
                        <tr className="bg-slate-50 border-b border-slate-200 text-slate-400 text-[10px] font-bold uppercase tracking-wider">
                          <th className="px-5 py-3.5">วันที่ / เวลา</th>
                          <th className="px-5 py-3.5">ผู้โอน / รายการ</th>
                          <th className="hidden lg:table-cell px-5 py-3.5">ผู้รับ</th>
                          <th className="hidden lg:table-cell px-5 py-3.5">หมายเหตุ</th>
                          <th className="px-5 py-3.5 text-right">ยอด (฿)</th>
                          <th className="hidden md:table-cell px-5 py-3.5">อ้างอิง</th>
                          <th className="px-5 py-3.5 text-center">สลิป</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100">
                        {loadingTransactions ? (
                          <tr><td colSpan="7" className="py-20 text-center text-slate-300 text-sm animate-pulse">กำลังดึงข้อมูลจาก Google Sheets...</td></tr>
                        ) : !ledgerConnected ? (
                          <tr><td colSpan="7" className="py-16 text-center">
                            <p className="text-slate-400 text-sm mb-3">⚠️ ยังไม่ได้เชื่อมต่อ Google Sheets</p>
                            <a href={`/api/auth/google/connect?shopId=${shopInfo?.id}`}
                              className="inline-flex items-center gap-2 bg-blue-800 text-white px-5 py-2.5 rounded-xl text-sm font-medium hover:bg-blue-700 transition-all">
                              เชื่อมต่อ Google Drive & Sheets
                            </a>
                          </td></tr>
                        ) : (() => {
                          let filteredTx = transactions;
                          if (ledgerDate) {
                            filteredTx = filteredTx.filter(tx => {
                              const d = (tx.date || '').split('/')[0];
                              return d === String(ledgerDate).padStart(2,'0') || d === String(ledgerDate);
                            });
                          }
                          if (ledgerTypeFilter !== 'all') {
                            const [wantType, wantMethod] = ledgerTypeFilter.split('-');
                            const wantTypeLabel = wantType === 'income' ? 'รายรับ' : 'รายจ่าย';
                            filteredTx = filteredTx.filter(tx => {
                              if (tx.type !== wantTypeLabel) return false;
                              if (!wantMethod) return true;
                              const wantMethodLabel = wantMethod === 'transfer' ? 'โอน' : 'เงินสด';
                              return (tx.method || '-') === wantMethodLabel;
                            });
                          }
                          if (ledgerBranchFilter !== 'all') {
                            filteredTx = filteredTx.filter(tx => tx.branch === ledgerBranchFilter);
                          }
                          const totalPages = Math.ceil(filteredTx.length / LEDGER_PAGE_SIZE);
                          const pageTx = filteredTx.slice(ledgerPage * LEDGER_PAGE_SIZE, (ledgerPage + 1) * LEDGER_PAGE_SIZE);
                          if (filteredTx.length === 0) return (
                            <tr><td colSpan="7" className="py-20 text-center text-slate-300 text-sm italic">
                              {ledgerDate ? `ไม่มีรายการวันที่ ${ledgerDate}` : 'ยังไม่มีรายการในเดือนนี้'}
                            </td></tr>
                          );
                          return pageTx.map((tx, idx) => (
                          <tr key={idx} className="hover:bg-blue-50/40 transition-colors">
                            <td className="px-5 py-3.5">
                              <p className="font-medium text-slate-700 text-sm">{tx.date}</p>
                              <p className="text-[10px] text-slate-400 font-mono">{tx.time}</p>
                            </td>
                            <td className="px-5 py-3.5">
                              <p className="font-medium text-slate-800 text-sm">{tx.sender || 'ไม่ระบุ'}</p>
                              {tx.note && tx.note !== '-' && (
                                <p className="text-[11px] text-slate-500 mt-0.5 truncate lg:hidden" title={tx.note}>{tx.note}</p>
                              )}
                              <p className="text-[10px] text-slate-400">
                                <span className={`inline-block px-1.5 py-0.5 rounded text-[9px] font-medium mr-1
                                  ${tx.type === 'รายรับ' ? 'bg-green-50 text-green-600' : 'bg-red-50 text-red-500'}`}>
                                  {tx.type === 'รายรับ' ? '↑ รายรับ' : '↓ รายจ่าย'}
                                </span>
                                {tx.method && tx.method !== '-' && (
                                  <span className="inline-block px-1.5 py-0.5 rounded text-[9px] font-medium mr-1 bg-slate-100 text-slate-500">
                                    {tx.method === 'โอน' ? '🏦 โอน' : '💵 เงินสด'}
                                  </span>
                                )}
                                {tx.branch && tx.branch !== '-' ? tx.branch : ''}
                              </p>
                            </td>
                            <td className="hidden lg:table-cell px-5 py-3.5">
                              <p className="text-sm text-slate-600 font-medium">{tx.receiver && tx.receiver !== '-' ? tx.receiver : <span className="text-slate-200">—</span>}</p>
                            </td>
                            <td className="hidden lg:table-cell px-5 py-3.5 max-w-[200px]">
                              <p className="text-sm text-slate-500 truncate" title={tx.note && tx.note !== '-' ? tx.note : ''}>
                                {tx.note && tx.note !== '-' ? tx.note : <span className="text-slate-200">—</span>}
                              </p>
                            </td>
                            <td className="px-5 py-3.5 text-right">
                              <span className={`font-bold text-lg font-mono ${tx.type === 'รายรับ' ? 'text-green-600' : 'text-red-500'}`}>
                                ฿{Number(tx.amount || 0).toLocaleString()}
                              </span>
                            </td>
                            <td className="hidden md:table-cell px-5 py-3.5">
                              {tx.refNo && tx.refNo !== '-' ? (
                                <span className="text-[10px] font-mono text-slate-400 bg-slate-50 px-2 py-1 rounded-lg border border-slate-100">
                                  {tx.refNo.length > 16 ? tx.refNo.substring(0, 8) + '…' : tx.refNo}
                                </span>
                              ) : <span className="text-slate-200 text-xs">—</span>}
                            </td>
                            <td className="px-5 py-3.5 text-center">
                              <div className="inline-flex items-center gap-1.5">
                                {tx.slipUrl && tx.slipUrl !== 'ไม่มีรูปภาพ (คีย์เอง)' && tx.slipUrl !== 'ไม่มีรูปภาพ' ? (
                                  <a href={tx.slipUrl} target="_blank" rel="noreferrer"
                                    className="inline-flex items-center gap-1 bg-white border border-slate-200 text-slate-500 px-3 py-1.5 rounded-lg font-medium hover:bg-blue-800 hover:text-white hover:border-blue-800 transition-all text-xs">
                                    <Receipt size={11}/> ดูสลิป
                                  </a>
                                ) : tx.slipUrl === 'ไม่มีรูปภาพ (คีย์เอง)' ? (
                                  <span className="text-[10px] text-amber-600 bg-amber-50 border border-amber-100 px-2 py-1 rounded-lg">✍️ คีย์เอง</span>
                                ) : <span className="text-slate-300 text-xs">—</span>}
                                {tx.refNo && tx.refNo !== '-' && (
                                  <a href={`/transaction/edit?userId=${shopInfo?.owner_line_id}&ref=${encodeURIComponent(tx.refNo)}&year=${ledgerYear}`}
                                    title="แก้ไขรายการนี้"
                                    className="inline-flex items-center bg-white border border-slate-200 text-slate-400 px-2 py-1.5 rounded-lg hover:bg-amber-500 hover:text-white hover:border-amber-500 transition-all text-xs">
                                    ✏️
                                  </a>
                                )}
                              </div>
                            </td>
                          </tr>
                        ));
                        })()}
                      </tbody>
                    </table>
                  </div>
                  </div>

                  {/* Pagination */}
                  {(() => {
                    const filteredTx = ledgerDate
                      ? transactions.filter(tx => {
                          const d = (tx.date || '').split('/')[0];
                          return d === String(ledgerDate).padStart(2,'0') || d === String(ledgerDate);
                        })
                      : transactions;
                    const totalPages = Math.ceil(filteredTx.length / LEDGER_PAGE_SIZE);
                    if (totalPages <= 1) return null;
                    const start = ledgerPage * LEDGER_PAGE_SIZE + 1;
                    const end = Math.min((ledgerPage + 1) * LEDGER_PAGE_SIZE, filteredTx.length);
                    return (
                      <div className="bg-white rounded-2xl border border-slate-200 p-3 flex items-center justify-between">
                        <span className="text-xs text-slate-500">
                          แสดง {start}–{end} จาก {filteredTx.length} รายการ
                        </span>
                        <div className="flex items-center gap-2">
                          <button onClick={() => setLedgerPage(p => Math.max(0, p-1))} disabled={ledgerPage === 0}
                            className="px-3 py-1.5 rounded-xl border border-slate-200 text-sm text-slate-600 hover:bg-slate-50 disabled:opacity-30 disabled:cursor-not-allowed">
                            ← ก่อนหน้า
                          </button>
                          <span className="text-xs text-slate-500 font-medium px-2">หน้า {ledgerPage+1}/{totalPages}</span>
                          <button onClick={() => setLedgerPage(p => Math.min(totalPages-1, p+1))} disabled={ledgerPage >= totalPages-1}
                            className="px-3 py-1.5 rounded-xl border border-slate-200 text-sm text-slate-600 hover:bg-slate-50 disabled:opacity-30 disabled:cursor-not-allowed">
                            ถัดไป →
                          </button>
                        </div>
                      </div>
                    );
                  })()}
                </div>}

                  {/* ── รายงานภาษี ── */}
                  {accountsSubTab === 'tax' && (
                    <div className="space-y-5">
                      {hasFeature(tierKey, 'business') ? (
                        <div className="bg-white rounded-2xl border border-slate-200 p-6">
                          <div className="flex flex-wrap items-center justify-between gap-3 mb-5">
                            <div className="flex items-center gap-2">
                              <span className="text-base">🧾</span>
                              <h3 className="font-bold text-slate-700 text-sm">รายงานภาษี / VAT</h3>
                            </div>
                            <div className="flex flex-wrap items-center gap-2">
                              <select value={taxReportYear} onChange={e => setTaxReportYear(e.target.value)}
                                className="border border-slate-200 rounded-xl px-3 py-1.5 text-xs font-medium focus:outline-none bg-white">
                                {Array.from({length: 10}, (_, i) => new Date().getFullYear() + 1 - i).map(y => <option key={y} value={y}>{y}</option>)}
                              </select>
                              <select value={taxReportMonth} onChange={e => setTaxReportMonth(e.target.value)}
                                className="border border-slate-200 rounded-xl px-3 py-1.5 text-xs font-medium focus:outline-none bg-white">
                                <option value="">ทุกเดือน</option>
                                {['01','02','03','04','05','06','07','08','09','10','11','12'].map((m,i) => (
                                  <option key={m} value={m}>{['ม.ค.','ก.พ.','มี.ค.','เม.ย.','พ.ค.','มิ.ย.','ก.ค.','ส.ค.','ก.ย.','ต.ค.','พ.ย.','ธ.ค.'][i]}</option>
                                ))}
                              </select>
                              <button onClick={() => fetchTaxReport(shopInfo.id, taxReportYear, taxReportMonth)}
                                disabled={taxReportLoading}
                                className="bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 text-white font-bold text-xs px-4 py-1.5 rounded-xl transition-all">
                                {taxReportLoading ? 'กำลังโหลด...' : 'ดูรายงาน'}
                              </button>
                              {taxReport && !taxReport.error && taxReport.totalRows > 0 && (
                                <a href={`/api/sheets/tax-report?shopId=${shopInfo.id}&year=${taxReportYear}${taxReportMonth ? `&month=${taxReportMonth}` : ''}&format=csv`}
                                  download
                                  className="bg-emerald-600 hover:bg-emerald-700 text-white font-bold text-xs px-4 py-1.5 rounded-xl transition-all flex items-center gap-1.5">
                                  ⬇ Export CSV
                                </a>
                              )}
                            </div>
                          </div>
                          {taxReport?.error && (
                            <div className="text-center py-6 text-slate-400 text-sm">{taxReport.error}</div>
                          )}
                          {taxReport && !taxReport.error && (
                            <>
                              <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 mb-5">
                                <div className="bg-indigo-50 rounded-xl p-3 text-center">
                                  <p className="text-xs text-indigo-500 font-medium">ภาษีรวมทั้งหมด</p>
                                  <p className="text-lg font-black text-indigo-700 mt-0.5">฿{taxReport.grandTotal.toLocaleString(undefined,{minimumFractionDigits:2,maximumFractionDigits:2})}</p>
                                </div>
                                <div className="bg-slate-50 rounded-xl p-3 text-center">
                                  <p className="text-xs text-slate-500 font-medium">รายการที่มีภาษี</p>
                                  <p className="text-lg font-black text-slate-700 mt-0.5">{taxReport.totalRows} รายการ</p>
                                </div>
                                <div className="bg-slate-50 rounded-xl p-3 text-center col-span-2 sm:col-span-1">
                                  <p className="text-xs text-slate-500 font-medium">จำนวนผู้ขาย</p>
                                  <p className="text-lg font-black text-slate-700 mt-0.5">{taxReport.summary?.length || 0} ราย</p>
                                </div>
                              </div>
                              {taxReport.summary?.length > 0 ? (
                                <div className="space-y-2">
                                  <p className="text-xs font-bold text-slate-500 uppercase tracking-wider mb-2">สรุปตามผู้ขาย/ผู้ให้บริการ</p>
                                  {taxReport.summary.map((s, i) => (
                                    <div key={i} className="border border-slate-100 rounded-xl overflow-hidden">
                                      <button
                                        onClick={() => setTaxExpandedId(taxExpandedId === s.taxId ? null : s.taxId)}
                                        className="w-full flex items-center gap-3 p-3 hover:bg-slate-50 transition-colors text-left">
                                        <span className="w-6 h-6 rounded-full bg-indigo-100 text-indigo-600 flex items-center justify-center text-[10px] font-black shrink-0">{i+1}</span>
                                        <div className="flex-1 min-w-0">
                                          <p className="text-sm font-semibold text-slate-700 truncate">{s.taxpayerName}</p>
                                          <p className="text-xs text-slate-400">{s.taxId} · {s.transactionCount} รายการ</p>
                                        </div>
                                        <div className="text-right shrink-0">
                                          <p className="text-sm font-black text-indigo-600">฿{s.totalTaxAmount.toLocaleString(undefined,{minimumFractionDigits:2,maximumFractionDigits:2})}</p>
                                          <p className="text-[10px] text-slate-400">{taxExpandedId === s.taxId ? '▲ ซ่อน' : '▼ ดูรายการ'}</p>
                                        </div>
                                      </button>
                                      {taxExpandedId === s.taxId && (
                                        <div className="border-t border-slate-100 bg-slate-50 px-3 py-2">
                                          <p className="text-xs text-slate-400 mb-1">{s.taxAddress}</p>
                                          <div className="space-y-1">
                                            {s.transactions.map((t, j) => (
                                              <div key={j} className="flex items-center gap-2 text-xs py-1">
                                                <span className="text-slate-400 w-16 shrink-0">{t.date}</span>
                                                <span className="flex-1 text-slate-600 truncate">{t.note}</span>
                                                <span className={`font-bold ${t.type === 'รายรับ' ? 'text-green-600' : 'text-red-500'}`}>
                                                  ฿{t.taxAmount.toLocaleString(undefined,{minimumFractionDigits:2,maximumFractionDigits:2})}
                                                </span>
                                              </div>
                                            ))}
                                          </div>
                                        </div>
                                      )}
                                    </div>
                                  ))}
                                </div>
                              ) : (
                                <div className="text-center py-8 text-slate-400">
                                  <p className="text-2xl mb-2">🧾</p>
                                  <p className="text-sm">ไม่พบรายการที่มีข้อมูลภาษีในช่วงเวลานี้</p>
                                  <p className="text-xs mt-1">สลิปที่อ่านได้ข้อมูลภาษี (เลขภาษี, ชื่อผู้เสียภาษี, ยอดภาษี) จะปรากฏที่นี่</p>
                                </div>
                              )}
                            </>
                          )}
                          {!taxReport && !taxReportLoading && (
                            <div className="text-center py-8 text-slate-400">
                              <p className="text-2xl mb-2">📊</p>
                              <p className="text-sm">เลือกปีและเดือน แล้วกด "ดูรายงาน"</p>
                            </div>
                          )}
                        </div>
                      ) : (
                        <div className="bg-gradient-to-r from-indigo-50 to-purple-50 border border-indigo-200 rounded-2xl p-5 flex items-center justify-between gap-4">
                          <div>
                            <p className="font-bold text-indigo-700 text-sm">🧾 รายงานภาษี / VAT — ใช้ได้กับ Business ขึ้นไป</p>
                            <p className="text-indigo-500 text-xs mt-0.5">สรุปภาษีแยกตามผู้ขาย พร้อมเลขภาษีและยอดรวม</p>
                          </div>
                          <Link href={`/pricing?userId=${shopInfo?.owner_line_id}`}
                            className="shrink-0 bg-indigo-600 hover:bg-indigo-700 text-white font-bold text-xs px-4 py-2 rounded-xl transition-all">
                            อัปเกรดเป็น Business
                          </Link>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              )}

              {/* ════ BRANCHES TAB ════ */}
              {activeTab === 'branches' && (
                <div className="max-w-3xl space-y-5">
                  <p className="text-slate-500 text-sm">
                    แพ็กเกจของคุณรองรับสูงสุด <span className="font-bold text-blue-700">{branchLimit} สาขา</span> (ใช้แล้ว {branches.length})
                  </p>

                  {branches.length < branchLimit && !isAdminMode ? (
                    <div className="bg-white p-6 rounded-2xl border border-slate-200">
                      <h3 className="text-sm font-bold text-slate-700 mb-4 flex items-center gap-2">
                        <PlusCircle size={16} className="text-blue-600"/> เพิ่มสาขาใหม่
                      </h3>
                      <div className="space-y-3">
                        <div>
                          <label className="text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-1.5 block">ชื่อสาขา</label>
                          <input value={newBranchName} onChange={e => setNewBranchName(e.target.value)}
                            placeholder="เช่น สาขาสีลม"
                            className="w-full border border-slate-200 rounded-xl px-4 py-2.5 text-sm font-medium outline-none focus:border-blue-400 transition-colors"/>
                        </div>
                        <div>
                          <label className="text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-1.5 block">LINE Group ID</label>
                          <input value={newBranchGroupId} onChange={e => setNewBranchGroupId(e.target.value)}
                            placeholder="C1234567890abcdef..."
                            className="w-full border border-slate-200 rounded-xl px-4 py-2.5 text-sm font-mono outline-none focus:border-blue-400 transition-colors"/>
                          <p className="text-xs text-slate-400 mt-1.5">💡 เพิ่มบอทเข้ากลุ่ม LINE สาขา — บอทจะส่ง Group ID มาอัตโนมัติ</p>
                        </div>
                        <div>
                          <label className="text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-1.5 block">ชื่อแบรนด์ (ไม่บังคับ)</label>
                          <input value={newBranchBrand} onChange={e => setNewBranchBrand(e.target.value)}
                            placeholder="เว้นว่าง = แบรนด์เดียวกับร้านหลัก"
                            className="w-full border border-slate-200 rounded-xl px-4 py-2.5 text-sm font-medium outline-none focus:border-blue-400 transition-colors"/>
                          <p className="text-xs text-slate-400 mt-1.5">💡 ถ้าสาขานี้ขายของแบบเดียวกับร้านหลัก (เช่นแฟรนไชส์) ไม่ต้องกรอก ระบบจะรวมข้อมูลลูกค้าให้อัตโนมัติ — กรอกเฉพาะถ้าสาขานี้เป็นร้าน/แบรนด์คนละแบบ</p>
                        </div>
                        <button onClick={handleAddBranch} disabled={branchLoading}
                          className="w-full bg-blue-800 hover:bg-blue-700 text-white py-2.5 rounded-xl font-medium text-sm transition-colors disabled:opacity-50">
                          {branchLoading ? 'กำลังเพิ่ม...' : '+ เพิ่มสาขา'}
                        </button>
                      </div>
                    </div>
                  ) : (
                    <div className="bg-amber-50 border border-amber-200 p-5 rounded-2xl text-center">
                      <p className="font-bold text-amber-700 text-sm">ถึงขีดจำกัดสาขาของแพ็กเกจแล้ว</p>
                      <Link href={`/pricing?userId=${shopInfo?.owner_line_id}`}
                        className="inline-block mt-3 bg-amber-500 hover:bg-amber-600 text-white px-5 py-2 rounded-xl text-sm font-medium transition-colors">
                        อัปเกรดเพื่อเพิ่มสาขา
                      </Link>
                    </div>
                  )}

                  <div className="bg-white rounded-2xl border border-slate-200 overflow-hidden">
                    <div className="px-5 py-3.5 border-b border-slate-100">
                      <h3 className="font-bold text-slate-700 text-sm">สาขาที่ลงทะเบียน</h3>
                    </div>
                    {branches.length === 0 ? (
                      <div className="py-16 text-center text-slate-400 text-sm italic">ยังไม่มีสาขา</div>
                    ) : (
                      <div className="divide-y divide-slate-100">
                        {branches.map(b => (
                          <div key={b.id} className="flex items-center justify-between px-5 py-4 hover:bg-slate-50 transition-colors">
                            <div className="flex-1">
                              <p className="font-bold text-slate-800 text-sm">{b.branch_name}</p>
                              <p className="text-[10px] font-mono text-slate-400 mt-0.5">{b.line_group_id}</p>
                              {editBranchBrand[b.id] !== undefined ? (
                                <div className="flex items-center gap-1.5 mt-1.5">
                                  <input value={editBranchBrand[b.id]}
                                    onChange={e => setEditBranchBrand(p => ({ ...p, [b.id]: e.target.value }))}
                                    placeholder="เว้นว่าง = แบรนด์เดียวกับร้านหลัก"
                                    className="border border-slate-200 rounded-lg px-2 py-1 text-xs outline-none focus:border-blue-400 w-56"/>
                                  <button onClick={() => handleUpdateBranchBrand(b.id, editBranchBrand[b.id])}
                                    className="p-1 bg-blue-600 text-white rounded-lg hover:bg-blue-700"><CheckCircle2 size={12}/></button>
                                  <button onClick={() => setEditBranchBrand(p => { const n={...p}; delete n[b.id]; return n; })}
                                    className="p-1 bg-slate-200 text-slate-500 rounded-lg hover:bg-slate-300"><X size={12}/></button>
                                </div>
                              ) : (
                                <button onClick={() => setEditBranchBrand(p => ({ ...p, [b.id]: b.brand_name || '' }))}
                                  className="text-[10px] text-violet-500 hover:text-violet-700 mt-1 flex items-center gap-1">
                                  🏷️ แบรนด์: {b.brand_name || 'เดียวกับร้านหลัก'} <Edit3 size={9}/>
                                </button>
                              )}
                            </div>
                            <div className="flex items-center gap-2">
                              <span className={`text-[10px] px-2.5 py-1 rounded-full font-medium ${b.is_active ? 'bg-green-50 text-green-600' : 'bg-slate-100 text-slate-400'}`}>
                                {b.is_active ? 'ใช้งาน' : 'ปิด'}
                              </span>
                              {!isAdminMode && (
                                <button onClick={() => handleDeleteBranch(b.id)}
                                  className="p-1.5 text-red-400 hover:bg-red-50 rounded-lg transition-colors">
                                  <Trash2 size={14}/>
                                </button>
                              )}
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
              )}

              {/* ════ HELP TAB ════ */}
              {activeTab === 'help' && (
                <div className="max-w-3xl space-y-6">
                  <div>
                    <h2 className="text-lg font-black text-slate-800">ช่วยเหลือ</h2>
                    <p className="text-sm text-slate-500 mt-1">รวมคำสั่ง LINE และคำถามที่พบบ่อย ศึกษาเองได้ ไม่ต้องทักแอดมิน</p>
                  </div>

                  {/* คำสั่ง LINE สำหรับเจ้าของ */}
                  <div className="bg-white rounded-2xl border border-slate-200 p-5">
                    <h3 className="font-bold text-slate-700 text-sm mb-4 flex items-center gap-2">
                      <span className="text-base">💬</span> คำสั่ง LINE สำหรับเจ้าของร้าน
                    </h3>
                    <div className="space-y-2">
                      {[
                        ['📸 ส่งรูปสลิป/บิล', 'บอทอ่านและบันทึกอัตโนมัติ (ทุกแพ็กเกจ)'],
                        ['รับ [จำนวน] [หมายเหตุ]', 'คีย์รายรับเอง — ค่าเริ่มต้นเป็นเงินสด เช่น "รับ 500 ค่าแก๊ส"'],
                        ['รับโอน [จำนวน] [หมายเหตุ]', 'คีย์รายรับที่เป็นเงินโอน (ไม่มีสลิป)'],
                        ['จ่าย [จำนวน] [หมายเหตุ]', 'คีย์รายจ่ายเอง — ค่าเริ่มต้นเป็นเงินสด เช่น "จ่าย 1200 ค่าไฟ"'],
                        ['จ่ายโอน [จำนวน] [หมายเหตุ]', 'คีย์รายจ่ายที่เป็นเงินโอน'],
                        ['#วิธีใช้งาน', 'เมนูสอนใช้งานแบบละเอียด/คร่าวๆ แยกตามหัวข้อ'],
                        ['#ช่วยเหลือ', 'แสดงคำสั่งทั้งหมดที่ใช้ได้ตามแพ็กเกจของร้าน'],
                        ['#สรุปวันนี้ / #สรุปเดือนนี้ / #สรุปอาทิตย์นี้ / #สรุปปีนี้', 'สรุปยอดตามช่วงเวลา (Pro+)'],
                        ['#สรุปวันที่ 07/06', 'สรุปยอดวันที่ย้อนหลัง (Pro+)'],
                        ['#กำไรขาดทุน / #รายงาน', 'สรุปกำไร-ขาดทุนเดือนนี้ (Pro+)'],
                        ['#สรุปทุกสาขา', 'สรุปยอดแยกรายสาขา (Advance+)'],
                        ['#สมัครแอดมิน', 'พนักงานในกลุ่มขอสิทธิ์แอดมินร้าน (ต้องรอเจ้าของอนุมัติในเว็บ)'],
                      ].map(([cmd, desc], i) => (
                        <div key={i} className="flex flex-col sm:flex-row sm:items-baseline gap-1 sm:gap-3 py-2 border-b border-slate-50 last:border-0">
                          <code className="text-xs font-bold text-blue-700 bg-blue-50 px-2 py-1 rounded-lg shrink-0 sm:w-64 break-words">{cmd}</code>
                          <span className="text-xs text-slate-500">{desc}</span>
                        </div>
                      ))}
                    </div>
                  </div>

                  {/* FAQ */}
                  <div>
                    <h3 className="font-bold text-slate-700 text-sm mb-3 flex items-center gap-2">
                      <span className="text-base">❓</span> คำถามที่พบบ่อย
                    </h3>
                    <div className="space-y-2">
                      {[
                        { q: 'ส่งสลิปแล้วบอทไม่ตอบ/ไม่บันทึก ทำยังไง?', a: 'เช็คก่อนว่า (1) เครดิตยังเหลืออยู่ไหม ดูได้ที่หน้า "ภาพรวม" (2) เชื่อมต่อ Google Drive ไว้แล้วหรือยัง ดูที่ "ตั้งค่า" ถ้ายังไม่เชื่อมต่อ บอทจะไม่บันทึกลง Sheets ให้ ลองส่งสลิปใหม่อีกครั้งหลังแก้ 2 จุดนี้' },
                        { q: 'รับ/จ่ายเอง กับ ส่งรูปสลิป ต่างกันยังไง?', a: 'ส่งรูปสลิป = ระบบอ่าน OCR อัตโนมัติ ถือเป็น "โอน" เสมอ ส่วนคีย์เอง (พิมพ์ รับ/จ่าย) ใช้ตอนไม่มีสลิป เช่น รับเงินสดหน้าร้าน — ถ้าพิมพ์ "รับ"/"จ่าย" เปล่าๆ ระบบจะถือเป็นเงินสด ถ้าอยากให้เป็นเงินโอนให้พิมพ์ "รับโอน"/"จ่ายโอน"' },
                        { q: 'แก้ไขรายการที่บันทึกผิดได้ไหม?', a: 'ได้ครับ กดปุ่ม "✏️" ที่แถวรายการในหน้า "บัญชี" หรือกดปุ่ม "แก้ไขข้อมูล" ใต้การ์ดที่บอทตอบกลับมาทาง LINE ได้เลย' },
                        { q: 'เครดิตหมดจะเกิดอะไรขึ้น?', a: 'บอท LINE จะหยุดรับสลิปชั่วคราว แต่ยังเข้าหน้าเว็บมาคีย์รายการเองได้เสมอ พอเติมเครดิตแล้วบอทจะกลับมาทำงานทันที' },
                        { q: 'มีหลายสาขา ต้องทำยังไง?', a: 'ไปที่ "จัดการสาขา" → เพิ่มชื่อสาขา + ผูก Group LINE ของสาขานั้น แต่ละสาขาส่งสลิปเข้ากลุ่มตัวเอง ข้อมูลจะรวมอยู่ใน Sheets เดียวกัน แยกดูได้ที่หน้า "บัญชี" และ "กราฟวิเคราะห์" (Advance ขึ้นไปดูเปรียบเทียบสาขาได้)' },
                        { q: 'ทำไมหมวดหมู่/วิธีรับ-จ่ายไม่โชว์ในรายการเก่า?', a: 'ฟีเจอร์นี้เพิ่มมาทีหลัง รายการที่บันทึกก่อนหน้านี้จะไม่มีข้อมูลนี้ย้อนหลัง แต่รายการใหม่ตั้งแต่นี้ไปจะมีครบ' },
                        { q: 'ต้องการใบกำกับภาษี ทำยังไง?', a: 'ไปที่หน้า "ขอใบแจ้งหนี้" (ลิงก์จากอีเมลหรือแจ้งแอดมิน) กรอกข้อมูล ส่งคำขอ แอดมินจะตรวจสอบและออกใบกำกับภาษีพร้อมส่งอีเมลให้อัตโนมัติ' },
                      ].map((faq, i) => (
                        <details key={i} className="bg-white rounded-2xl border border-slate-200 p-4 cursor-pointer group">
                          <summary className="font-bold text-slate-700 text-sm list-none flex justify-between items-center gap-3">
                            <span>{faq.q}</span>
                            <span className="text-slate-400 group-open:rotate-45 transition-transform text-lg font-light shrink-0">+</span>
                          </summary>
                          <p className="mt-3 text-slate-500 text-xs leading-relaxed">{faq.a}</p>
                        </details>
                      ))}
                    </div>
                  </div>

                  <div className="text-center text-xs text-slate-400 pt-2">
                    ยังไม่พบคำตอบ? พิมพ์ <code className="bg-slate-100 px-1.5 py-0.5 rounded">#วิธีใช้งาน</code> ในแชท LINE กับบอท หรือติดต่อทีมงานได้เลยค่ะ
                  </div>
                </div>
              )}

              {/* ════ SETTINGS TAB ════ */}
              {activeTab === 'settings' && (
                <div className="max-w-3xl space-y-5">

                  {/* ข้อมูลร้านค้า */}
                  <div className="bg-white p-6 rounded-2xl border border-slate-200">
                    <div className="flex items-center justify-between mb-5">
                      <h3 className="text-sm font-bold text-slate-700 flex items-center gap-2">
                        <Settings size={16} className="text-blue-600"/> ข้อมูลร้านค้า
                      </h3>
                      {!isEditingProfile ? (
                        <button onClick={() => setIsEditingProfile(true)}
                          className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-blue-600 bg-blue-50 hover:bg-blue-100 rounded-xl transition-all">
                          <Edit3 size={12}/> แก้ไข
                        </button>
                      ) : (
                        <div className="flex gap-2">
                          <button onClick={() => setIsEditingProfile(false)}
                            className="px-3 py-1.5 text-xs font-medium text-slate-500 bg-slate-100 hover:bg-slate-200 rounded-xl transition-all">ยกเลิก</button>
                          <button onClick={handleSaveProfile} disabled={savingProfile}
                            className="px-3 py-1.5 text-xs font-medium text-white bg-blue-700 hover:bg-blue-800 rounded-xl transition-all disabled:opacity-50">
                            {savingProfile ? 'กำลังบันทึก...' : 'บันทึก'}
                          </button>
                        </div>
                      )}
                    </div>

                    {isEditingProfile ? (
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                        {[
                          { key: 'shopName', label: 'ชื่อร้าน / ธุรกิจ' },
                          { key: 'taxId',    label: 'เลขประจำตัวผู้เสียภาษี' },
                          { key: 'email',    label: 'อีเมล' },
                          { key: 'phone',    label: 'เบอร์โทรศัพท์' },
                        ].map(f => (
                          <div key={f.key}>
                            <label className="text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-1.5 block">{f.label}</label>
                            <input value={editForm[f.key]}
                              onChange={e => setEditForm(prev => ({ ...prev, [f.key]: e.target.value }))}
                              className="w-full border border-slate-200 rounded-xl px-4 py-2.5 text-sm font-medium outline-none focus:border-blue-400 transition-colors"/>
                          </div>
                        ))}
                        <div>
                          <label className="text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-1.5 block">ประเภทผู้เสียภาษี</label>
                          <select value={editForm.userType} onChange={e => setEditForm(prev => ({ ...prev, userType: e.target.value }))}
                            className="w-full border border-slate-200 rounded-xl px-4 py-2.5 text-sm font-medium outline-none focus:border-blue-400 transition-colors bg-white">
                            <option value="individual">บุคคลธรรมดา</option>
                            <option value="corporate">นิติบุคคล</option>
                          </select>
                        </div>
                        <div className="md:col-span-2">
                          <label className="text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-1.5 block">ที่อยู่</label>
                          <textarea value={editForm.address} rows={3}
                            onChange={e => setEditForm(prev => ({ ...prev, address: e.target.value }))}
                            className="w-full border border-slate-200 rounded-xl px-4 py-2.5 text-sm font-medium outline-none focus:border-blue-400 transition-colors resize-none"/>
                        </div>
                      </div>
                    ) : (
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                        {[
                          { label: 'ชื่อร้าน / ธุรกิจ',           value: shopInfo?.shop_name },
                          { label: 'ประเภทผู้เสียภาษี',            value: shopInfo?.user_type === 'corporate' ? 'นิติบุคคล' : 'บุคคลธรรมดา' },
                          { label: 'เลขประจำตัวผู้เสียภาษี',      value: shopInfo?.tax_id || '—' },
                          { label: 'สาขา',                         value: shopInfo?.branch_name },
                          { label: 'อีเมล',                        value: shopInfo?.email || '—' },
                          { label: 'เบอร์โทรศัพท์',               value: shopInfo?.phone || '—' },
                          { label: 'แพ็กเกจ',                      value: tierLabel[tierKey] },
                        ].map(item => (
                          <div key={item.label} className="bg-slate-50 rounded-xl p-3.5 border border-slate-100">
                            <p className="text-[9px] font-bold text-slate-400 uppercase tracking-wider mb-1">{item.label}</p>
                            <p className="font-medium text-slate-800 text-sm">{item.value || '—'}</p>
                          </div>
                        ))}
                        <div className="md:col-span-2 bg-slate-50 rounded-xl p-3.5 border border-slate-100">
                          <p className="text-[9px] font-bold text-slate-400 uppercase tracking-wider mb-1">ที่อยู่</p>
                          <p className="font-medium text-slate-700 text-sm">{shopInfo?.address || '—'}</p>
                        </div>
                      </div>
                    )}
                  </div>

                  {/* ════ Subscription Status Card ════ */}
                  {tierKey !== 'normal' && (
                    <div className={`bg-white p-6 rounded-2xl border-2 ${subInfo?.cancelAtPeriodEnd ? 'border-orange-200' : 'border-emerald-200'}`}>
                      <div className="flex items-center justify-between mb-4">
                        <h3 className="text-sm font-bold text-slate-700 flex items-center gap-2">
                          <CreditCard size={16} className={subInfo?.cancelAtPeriodEnd ? 'text-orange-500' : 'text-emerald-600'}/>
                          สถานะแพ็กเกจ
                        </h3>
                        <span className={`text-[11px] font-bold px-2.5 py-1 rounded-full ${subInfo?.cancelAtPeriodEnd ? 'bg-orange-100 text-orange-700' : 'bg-emerald-100 text-emerald-700'}`}>
                          {subInfo?.cancelAtPeriodEnd ? 'กำหนดยกเลิก' : 'ใช้งานอยู่'}
                        </span>
                      </div>

                      <div className="grid grid-cols-3 gap-3 mb-4">
                        <div className="bg-slate-50 rounded-xl p-3 text-center border border-slate-100">
                          <p className="text-2xl font-black text-blue-900">{subInfo?.daysLeft ?? '—'}</p>
                          <p className="text-[10px] text-slate-400 mt-0.5">วันที่เหลือ</p>
                        </div>
                        <div className="bg-slate-50 rounded-xl p-3 text-center border border-slate-100">
                          <p className="text-sm font-black text-slate-800">{subInfo?.interval === 'year' ? 'รายปี' : 'รายเดือน'}</p>
                          <p className="text-[10px] text-slate-400 mt-0.5">รูปแบบ</p>
                        </div>
                        <div className="bg-slate-50 rounded-xl p-3 text-center border border-slate-100">
                          <p className="text-sm font-black text-slate-800">
                            {subInfo?.currentPeriodEnd
                              ? new Date(subInfo.currentPeriodEnd).toLocaleDateString('th-TH', { day: 'numeric', month: 'short' })
                              : '—'}
                          </p>
                          <p className="text-[10px] text-slate-400 mt-0.5">หมดรอบ</p>
                        </div>
                      </div>

                      {subInfo?.cancelAtPeriodEnd ? (
                        <div className="space-y-3">
                          <div className="flex items-start gap-2.5 p-3.5 bg-orange-50 rounded-xl border border-orange-100">
                            <AlertTriangle size={15} className="text-orange-500 mt-0.5 shrink-0"/>
                            <p className="text-xs text-orange-700">
                              แพ็กเกจจะถูกยกเลิกและ downgrade เป็น Starter โดยอัตโนมัติในวันที่{' '}
                              <strong>
                                {subInfo.currentPeriodEnd
                                  ? new Date(subInfo.currentPeriodEnd).toLocaleDateString('th-TH', { day: 'numeric', month: 'long', year: 'numeric' })
                                  : '—'}
                              </strong>
                            </p>
                          </div>
                          <button onClick={handleResumeSubscription} disabled={cancellingSubscription}
                            className="w-full py-2.5 bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl font-bold text-sm transition-all disabled:opacity-50">
                            {cancellingSubscription ? 'กำลังดำเนินการ...' : '↩ ยกเลิกการยกเลิก (ต่ออายุต่อ)'}
                          </button>
                        </div>
                      ) : (
                        <div className="space-y-3">
                          <p className="text-xs text-slate-500">
                            หากต้องการลดแพ็กเกจ ให้ยกเลิกก่อน แล้วสมัครแพ็กเกจที่ต้องการหลังจากที่รอบบิลสิ้นสุด
                          </p>
                          <button onClick={handleCancelSubscription} disabled={cancellingSubscription}
                            className="w-full py-2.5 bg-red-50 hover:bg-red-100 text-red-700 border border-red-200 rounded-xl font-bold text-sm transition-all disabled:opacity-50">
                            {cancellingSubscription ? 'กำลังดำเนินการ...' : '✕ ยกเลิกแพ็กเกจเมื่อสิ้นรอบบิล'}
                          </button>
                        </div>
                      )}
                    </div>
                  )}

                  {/* ════ Admin Management (Business+) ════ */}
                  {adminLimit > 0 && (
                    <div className="bg-white p-6 rounded-2xl border border-slate-200">
                      <div className="flex items-center justify-between mb-1">
                        <h3 className="text-sm font-bold text-slate-700 flex items-center gap-2">
                          <Shield size={16} className="text-blue-600"/> แอดมินร้าน
                          <span className="text-[10px] font-normal text-slate-400">({shopAdmins.length}/{adminLimit} อนุมัติแล้ว)</span>
                        </h3>
                        {pendingAdmins.length > 0 && (
                          <span className="text-[10px] font-bold px-2 py-0.5 bg-orange-100 text-orange-700 rounded-full animate-pulse">
                            {pendingAdmins.length} รออนุมัติ
                          </span>
                        )}
                      </div>

                      {/* วิธีเพิ่มแอดมิน */}
                      <div className="mb-4 p-3 bg-blue-50 rounded-xl border border-blue-100">
                        <p className="text-xs font-bold text-blue-700 mb-1">วิธีเพิ่มแอดมิน</p>
                        <p className="text-[11px] text-blue-600">
                          ให้สมาชิกในกลุ่ม LINE พิมพ์ <span className="font-mono font-bold bg-white px-1.5 py-0.5 rounded border border-blue-200">#สมัครแอดมิน</span> แล้วกดอนุมัติด้านล่าง
                        </p>
                      </div>

                      {/* Pending requests */}
                      {pendingAdmins.length > 0 && (
                        <div className="mb-4">
                          <p className="text-[10px] font-bold text-orange-600 uppercase tracking-wider mb-2">รออนุมัติ</p>
                          <div className="space-y-2">
                            {pendingAdmins.map(admin => (
                              <div key={admin.id} className="flex items-center justify-between p-3 bg-orange-50 rounded-xl border border-orange-100">
                                <div className="flex items-center gap-3">
                                  <div className="w-8 h-8 bg-orange-100 rounded-full flex items-center justify-center text-orange-600 font-bold text-xs shrink-0">
                                    {(admin.display_name || '?')[0].toUpperCase()}
                                  </div>
                                  <div>
                                    <p className="text-sm font-bold text-slate-800">{admin.display_name || 'สมาชิก LINE'}</p>
                                    <p className="text-[10px] text-slate-400">{new Date(admin.created_at).toLocaleDateString('th-TH')}</p>
                                  </div>
                                </div>
                                <div className="flex gap-1.5">
                                  <button onClick={() => handleApproveAdmin(admin.id)} disabled={addingAdmin || shopAdmins.length >= adminLimit}
                                    className="px-3 py-1.5 bg-emerald-600 hover:bg-emerald-700 text-white rounded-lg text-xs font-bold disabled:opacity-40 transition-all">
                                    อนุมัติ
                                  </button>
                                  <button onClick={() => handleRejectAdmin(admin.id)}
                                    className="px-3 py-1.5 bg-slate-100 hover:bg-red-50 text-slate-500 hover:text-red-600 rounded-lg text-xs font-bold transition-all">
                                    ปฏิเสธ
                                  </button>
                                </div>
                              </div>
                            ))}
                          </div>
                        </div>
                      )}

                      {/* Approved admins */}
                      {shopAdmins.length === 0 && pendingAdmins.length === 0 ? (
                        <div className="text-center py-6 text-slate-400">
                          <Shield size={28} className="mx-auto mb-2 opacity-20"/>
                          <p className="text-sm">ยังไม่มีแอดมิน</p>
                          <p className="text-xs mt-1">ให้สมาชิกพิมพ์ #สมัครแอดมิน ในกลุ่ม LINE</p>
                        </div>
                      ) : shopAdmins.length > 0 && (
                        <div>
                          <p className="text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-2">อนุมัติแล้ว</p>
                          <div className="space-y-2">
                            {shopAdmins.map(admin => (
                              <div key={admin.id} className="flex items-center justify-between p-3 bg-slate-50 rounded-xl border border-slate-100">
                                <div className="flex items-center gap-3">
                                  <div className="w-8 h-8 bg-blue-100 rounded-full flex items-center justify-center text-blue-600 font-bold text-xs shrink-0">
                                    {(admin.display_name || 'A')[0].toUpperCase()}
                                  </div>
                                  <div>
                                    <p className="text-sm font-bold text-slate-800">{admin.display_name || 'แอดมิน'}</p>
                                    <p className="text-[10px] text-slate-400">เข้าร่วม {new Date(admin.created_at).toLocaleDateString('th-TH')}</p>
                                  </div>
                                </div>
                                <button onClick={() => handleRemoveAdmin(admin.id)}
                                  className="p-1.5 text-red-400 hover:text-red-600 hover:bg-red-50 rounded-lg transition-all">
                                  <UserX size={15}/>
                                </button>
                              </div>
                            ))}
                          </div>
                        </div>
                      )}

                      <div className="mt-4 p-3 bg-amber-50 rounded-xl border border-amber-100">
                        <p className="text-[10px] text-amber-700">
                          <strong>ทำได้:</strong> ดูภาพรวม, บันทึกธุรกรรม, รายรับ-รายจ่าย, กราฟวิเคราะห์, Export Excel<br/>
                          <strong>ทำไม่ได้:</strong> เปลี่ยนแพ็กเกจ, แก้ข้อมูลร้าน, บัญชีธนาคาร, Google Drive
                        </p>
                      </div>
                    </div>
                  )}

                  {/* Referral code in settings */}
                  {referralInfo?.referralCode && (
                    <div className="bg-white p-6 rounded-2xl border border-slate-200">
                      <h3 className="text-sm font-bold text-slate-700 flex items-center gap-2 mb-4">
                        <Share2 size={16} className="text-indigo-600"/> รหัสแนะนำเพื่อนของคุณ
                      </h3>
                      <div className="flex items-center gap-3 p-4 bg-indigo-50 rounded-xl border border-indigo-100">
                        <div className="flex-1">
                          <p className="text-[10px] text-indigo-400 uppercase tracking-wider mb-0.5">Referral Code</p>
                          <p className="font-black text-indigo-700 text-lg font-mono">{referralInfo.referralCode}</p>
                        </div>
                        <button onClick={handleCopyReferral}
                          className={`flex items-center gap-1.5 px-3 py-2 rounded-xl font-medium text-xs transition-all
                            ${copiedRef ? 'bg-green-500 text-white' : 'bg-indigo-600 text-white hover:bg-indigo-700'}`}>
                          <Copy size={12}/>
                          {copiedRef ? 'คัดลอกแล้ว!' : 'คัดลอกลิงก์'}
                        </button>
                      </div>
                      <div className="mt-3 grid grid-cols-2 gap-3">
                        <div className="bg-slate-50 rounded-xl p-3 text-center border border-slate-100">
                          <p className="text-2xl font-black text-blue-900">{referralInfo.referralCount || 0}</p>
                          <p className="text-xs text-slate-400">ร้านที่แนะนำแล้ว</p>
                        </div>
                        <div className="bg-slate-50 rounded-xl p-3 text-center border border-slate-100">
                          <p className="text-2xl font-black text-emerald-600">+{referralInfo.creditsEarned || 0}</p>
                          <p className="text-xs text-slate-400">เครดิตที่ได้รับ</p>
                        </div>
                      </div>
                    </div>
                  )}

                  {/* Google Drive */}
                  <div className="bg-white p-6 rounded-2xl border border-slate-200">
                    <h3 className="text-sm font-bold text-slate-700 flex items-center gap-2 mb-5">
                      <FileSpreadsheet size={16} className="text-green-600"/> Google Drive & Sheets
                    </h3>
                    {googleConfig ? (
                      <div className="space-y-2.5">
                        <div className="flex items-center gap-3 p-3.5 bg-green-50 rounded-xl border border-green-100">
                          <CheckCircle2 size={16} className="text-green-500 shrink-0"/>
                          <div>
                            <p className="font-bold text-green-700 text-sm">เชื่อมต่อแล้ว</p>
                            <p className="text-green-500 text-xs">{googleConfig.google_email || 'Google Account'}</p>
                          </div>
                        </div>
                        <div className="flex flex-col sm:flex-row gap-2">
                          <a href={`https://docs.google.com/spreadsheets/d/${googleConfig.google_sheet_id}`}
                            target="_blank" rel="noreferrer"
                            className="flex-1 flex items-center justify-center gap-2 bg-blue-50 text-blue-700 p-3 rounded-xl font-medium text-sm hover:bg-blue-100 transition-all">
                            <ExternalLink size={14}/> เปิด Sheet
                          </a>
                          <a href={`https://drive.google.com/drive/folders/${googleConfig.google_folder_id}`}
                            target="_blank" rel="noreferrer"
                            className="flex-1 flex items-center justify-center gap-2 bg-amber-50 text-amber-700 p-3 rounded-xl font-medium text-sm hover:bg-amber-100 transition-all">
                            <FolderOpen size={14}/> โฟลเดอร์
                          </a>
                          <a href={`/api/auth/google/connect?shopId=${shopInfo?.id}`}
                            className="flex items-center justify-center gap-2 bg-slate-100 text-slate-600 p-3 rounded-xl font-medium text-sm hover:bg-slate-200 transition-all">
                            <RefreshCcw size={14}/> เชื่อมใหม่
                          </a>
                        </div>
                      </div>
                    ) : (
                      <div className="text-center py-3">
                        <p className="text-slate-500 text-sm mb-4">เชื่อมต่อ Google เพื่อให้บอทบันทึกสลิปอัตโนมัติ</p>
                        <a href={`/api/auth/google/connect?shopId=${shopInfo?.id}`}
                          className="inline-flex items-center gap-2 bg-blue-800 text-white px-6 py-3 rounded-xl font-medium text-sm hover:bg-blue-700 transition-all">
                          <RefreshCcw size={15}/> เชื่อมต่อ Google Drive & Sheets
                        </a>
                        <p className="text-xs text-slate-400 mt-2">รับเครดิตโบนัส 30 แผ่น เมื่อเชื่อมต่อสำเร็จ</p>
                      </div>
                    )}
                  </div>

                  {/* บัญชีธนาคาร */}
                  <div className="bg-white p-6 rounded-2xl border border-slate-200">
                    <div className="flex items-center justify-between mb-5">
                      <h3 className="text-sm font-bold text-slate-700 flex items-center gap-2">
                        <Landmark size={16} className="text-blue-600"/> บัญชีธนาคารรับเงิน
                      </h3>
                      <button onClick={() => setShowAddBank(v => !v)}
                        className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-white bg-blue-700 hover:bg-blue-800 rounded-xl transition-all">
                        <PlusCircle size={12}/> เพิ่มบัญชี
                      </button>
                    </div>

                    {showAddBank && (
                      <div className="mb-4 p-4 bg-blue-50 rounded-xl border border-blue-100 space-y-3">
                        <p className="text-xs font-bold text-blue-700">เพิ่มบัญชีธนาคารใหม่</p>
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                          <div>
                            <label className="text-[10px] font-bold text-slate-400 uppercase block mb-1">ธนาคาร</label>
                            <select value={addBankForm.bankName}
                              onChange={e => setAddBankForm(p => ({ ...p, bankName: e.target.value }))}
                              className="w-full border border-slate-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-300 bg-white">
                              {BANK_LIST.map(b => <option key={b} value={b}>{b}</option>)}
                            </select>
                          </div>
                          <div>
                            <label className="text-[10px] font-bold text-slate-400 uppercase block mb-1">ประเภทบัญชี</label>
                            <select value={addBankForm.accountType}
                              onChange={e => setAddBankForm(p => ({ ...p, accountType: e.target.value }))}
                              className="w-full border border-slate-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-300 bg-white">
                              {['ออมทรัพย์','กระแสรายวัน','ฝากประจำ'].map(t => <option key={t} value={t}>{t}</option>)}
                            </select>
                          </div>
                          <div>
                            <label className="text-[10px] font-bold text-slate-400 uppercase block mb-1">ชื่อบัญชี</label>
                            <input value={addBankForm.accountName}
                              onChange={e => setAddBankForm(p => ({ ...p, accountName: e.target.value }))}
                              placeholder="ชื่อ-นามสกุล หรือชื่อร้าน"
                              className="w-full border border-slate-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-300"/>
                          </div>
                          <div>
                            <label className="text-[10px] font-bold text-slate-400 uppercase block mb-1">เลขที่บัญชี</label>
                            <input value={addBankForm.accountNumber}
                              onChange={e => setAddBankForm(p => ({ ...p, accountNumber: e.target.value }))}
                              placeholder="xxx-x-xxxxx-x"
                              className="w-full border border-slate-200 rounded-xl px-3 py-2 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-blue-300"/>
                          </div>
                        </div>
                        <div className="flex gap-2 pt-1">
                          <button onClick={handleAddBankAccount} disabled={addingBank}
                            className="px-4 py-2 text-xs font-medium text-white bg-blue-700 hover:bg-blue-800 rounded-xl disabled:opacity-50 transition-all">
                            {addingBank ? 'กำลังบันทึก...' : 'บันทึก'}
                          </button>
                          <button onClick={() => setShowAddBank(false)}
                            className="px-4 py-2 text-xs font-medium text-slate-500 bg-slate-100 hover:bg-slate-200 rounded-xl transition-all">
                            ยกเลิก
                          </button>
                        </div>
                      </div>
                    )}

                    <div className="space-y-3">
                      {bankAccounts.map(bank => (
                        <div key={bank.id} className="p-4 bg-slate-50 rounded-xl border border-slate-100 flex items-start justify-between gap-3">
                          <div>
                            <p className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">{bank.bank_name} · {bank.account_type}</p>
                            <h4 className="text-lg font-bold text-slate-800 mt-0.5 font-mono tracking-tight">{bank.account_number}</h4>
                            <p className="text-slate-500 text-sm">{bank.account_name}</p>
                          </div>
                          <button onClick={() => handleDeleteBankAccount(bank.id)}
                            className="p-1.5 rounded-lg text-slate-300 hover:text-red-500 hover:bg-red-50 transition-all flex-shrink-0">
                            <Trash2 size={14}/>
                          </button>
                        </div>
                      ))}
                      {bankAccounts.length === 0 && (
                        <div className="py-10 border-2 border-dashed border-slate-200 rounded-xl text-center text-slate-400 text-sm">
                          <Landmark size={24} className="mx-auto mb-2 opacity-20"/>
                          ยังไม่มีข้อมูลบัญชีธนาคาร<br/>
                          <span className="text-xs">กดปุ่ม "เพิ่มบัญชี" เพื่อเพิ่มบัญชีรับเงิน</span>
                        </div>
                      )}
                    </div>
                  </div>

                  {/* รีวิวจากลูกค้า — เฉพาะ paid tier */}
                  {isPaidTier && (
                    <div className="bg-white p-6 rounded-2xl border border-slate-200">
                      <h3 className="text-sm font-bold text-slate-700 flex items-center gap-2 mb-1">
                        ⭐ เขียนรีวิวให้เรา
                      </h3>
                      {testimonialSubmitted === true ? (
                        <p className="text-sm text-emerald-600 font-medium">✅ ขอบคุณสำหรับรีวิวของคุณครับ — แสดงในหน้าแรกของเว็บแล้ว</p>
                      ) : testimonialSubmitted === null ? (
                        <p className="text-xs text-slate-400">กำลังเช็คสถานะ...</p>
                      ) : (
                        <>
                          <p className="text-xs text-slate-400 mb-4">เขียนรีวิวสั้นๆ เกี่ยวกับการใช้งาน Smile Slip Pro รับ 50 เครดิตฟรีทันที (กรอกได้ครั้งเดียวต่อร้าน)</p>
                          <form onSubmit={handleSubmitTestimonial} className="space-y-3">
                            <div className="grid grid-cols-2 gap-3">
                              <input placeholder="ชื่อที่จะแสดง เช่น คุณนก" required
                                value={testimonialForm.name} onChange={e => setTestimonialForm({ ...testimonialForm, name: e.target.value })}
                                className="border border-slate-200 rounded-xl px-4 py-2.5 text-sm font-medium outline-none focus:border-blue-400"/>
                              <input placeholder="บทบาท เช่น เจ้าของร้านกาแฟ"
                                value={testimonialForm.role} onChange={e => setTestimonialForm({ ...testimonialForm, role: e.target.value })}
                                className="border border-slate-200 rounded-xl px-4 py-2.5 text-sm font-medium outline-none focus:border-blue-400"/>
                            </div>
                            <textarea placeholder="เล่าประสบการณ์การใช้งานสั้นๆ" required rows={3}
                              value={testimonialForm.message} onChange={e => setTestimonialForm({ ...testimonialForm, message: e.target.value })}
                              className="w-full border border-slate-200 rounded-xl px-4 py-2.5 text-sm font-medium outline-none focus:border-blue-400 resize-none"/>
                            <div className="flex items-center gap-1">
                              {[1,2,3,4,5].map(n => (
                                <button key={n} type="button" onClick={() => setTestimonialForm({ ...testimonialForm, stars: n })}
                                  className={`text-2xl ${n <= testimonialForm.stars ? 'text-amber-400' : 'text-slate-200'}`}>★</button>
                              ))}
                            </div>
                            <button type="submit" disabled={savingTestimonial}
                              className="w-full py-2.5 bg-amber-500 hover:bg-amber-600 text-white rounded-xl text-sm font-bold transition-all disabled:opacity-50">
                              {savingTestimonial ? 'กำลังส่ง...' : 'ส่งรีวิว รับ 50 เครดิต'}
                            </button>
                          </form>
                        </>
                      )}
                    </div>
                  )}
                </div>
              )}

            </div>{/* /flex-1 */}

            {/* Footer */}
            <footer className="mt-12 pt-6 border-t border-slate-200">
              <div className="flex flex-col sm:flex-row items-center justify-between gap-3">
                <div className="flex items-center gap-1 text-xs text-slate-400 flex-wrap justify-center">
                  <Link href="/terms" className="hover:text-blue-600 transition-colors px-2 py-1">เงื่อนไขการใช้งาน</Link>
                  <span className="text-slate-200">·</span>
                  <Link href="/privacy" className="hover:text-blue-600 transition-colors px-2 py-1">นโยบายความเป็นส่วนตัว (PDPA)</Link>
                  <span className="text-slate-200">·</span>
                  <a href="mailto:support@smileslip.pro" className="hover:text-blue-600 transition-colors px-2 py-1">ติดต่อเรา</a>
                </div>
                <p className="text-xs text-slate-300 whitespace-nowrap">© {new Date().getFullYear()} Siam Global Network Enterprise</p>
              </div>
            </footer>

          </div>
        </main>
      </div>

      {/* ─── Modal: บันทึกรายการด้วยมือ ─── */}
      {showAddModal && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4" onClick={e => e.target === e.currentTarget && setShowAddModal(false)}>
          <div className="bg-white rounded-2xl border border-slate-200 w-full max-w-md shadow-2xl">
            <div className="px-5 py-4 border-b border-slate-100 flex items-center justify-between">
              <h3 className="font-black text-slate-900 text-sm">✍️ บันทึกรายการด้วยมือ</h3>
              <button onClick={() => setShowAddModal(false)} className="text-slate-400 hover:text-slate-600 text-xl leading-none">×</button>
            </div>
            <form onSubmit={handleAddTransaction} className="p-5 space-y-4">
              {/* ประเภท */}
              <div>
                <label className="text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-1.5 block">ประเภทรายการ</label>
                <div className="grid grid-cols-2 gap-2">
                  <button type="button" onClick={() => setAddForm({...addForm, type: 'รายรับ'})}
                    className={`py-2.5 rounded-xl text-sm font-bold border-2 transition-all ${addForm.type === 'รายรับ' ? 'bg-green-50 border-green-500 text-green-600' : 'border-slate-200 text-slate-400 hover:border-slate-300'}`}>
                    💚 รายรับ
                  </button>
                  <button type="button" onClick={() => setAddForm({...addForm, type: 'รายจ่าย'})}
                    className={`py-2.5 rounded-xl text-sm font-bold border-2 transition-all ${addForm.type === 'รายจ่าย' ? 'bg-red-50 border-red-500 text-red-500' : 'border-slate-200 text-slate-400 hover:border-slate-300'}`}>
                    🔴 รายจ่าย
                  </button>
                </div>
              </div>
              {/* วิธีรับ-จ่าย */}
              <div>
                <label className="text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-1.5 block">วิธีรับ-จ่าย</label>
                <div className="grid grid-cols-2 gap-2">
                  <button type="button" onClick={() => setAddForm({...addForm, method: 'โอน'})}
                    className={`py-2.5 rounded-xl text-sm font-bold border-2 transition-all ${addForm.method === 'โอน' ? 'bg-blue-50 border-blue-500 text-blue-600' : 'border-slate-200 text-slate-400 hover:border-slate-300'}`}>
                    🏦 โอน
                  </button>
                  <button type="button" onClick={() => setAddForm({...addForm, method: 'เงินสด'})}
                    className={`py-2.5 rounded-xl text-sm font-bold border-2 transition-all ${addForm.method === 'เงินสด' ? 'bg-amber-50 border-amber-500 text-amber-600' : 'border-slate-200 text-slate-400 hover:border-slate-300'}`}>
                    💵 เงินสด
                  </button>
                </div>
              </div>
              {/* จำนวนเงิน */}
              <div>
                <label className="text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-1.5 block">จำนวนเงิน (บาท) *</label>
                <input type="number" step="0.01" min="0" required value={addForm.amount}
                  onChange={e => setAddForm({...addForm, amount: e.target.value})}
                  placeholder="0.00"
                  className="w-full border border-slate-200 rounded-xl px-4 py-2.5 text-sm font-medium outline-none focus:border-blue-400 transition-colors"/>
              </div>
              {/* วันที่ + เวลา */}
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-1.5 block">วันที่</label>
                  <input type="text" value={addForm.date} onChange={e => setAddForm({...addForm, date: e.target.value})}
                    placeholder="11/06/2026"
                    className="w-full border border-slate-200 rounded-xl px-4 py-2.5 text-sm font-medium outline-none focus:border-blue-400 transition-colors"/>
                </div>
                <div>
                  <label className="text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-1.5 block">เวลา</label>
                  <input type="text" value={addForm.time} onChange={e => setAddForm({...addForm, time: e.target.value})}
                    placeholder="14:30"
                    className="w-full border border-slate-200 rounded-xl px-4 py-2.5 text-sm font-medium outline-none focus:border-blue-400 transition-colors"/>
                </div>
              </div>
              {/* ผู้โอน + ผู้รับ */}
              <div>
                <label className="text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-1.5 block">ผู้โอน</label>
                <input type="text" value={addForm.sender} onChange={e => setAddForm({...addForm, sender: e.target.value})}
                  placeholder="ชื่อผู้โอนเงิน"
                  className="w-full border border-slate-200 rounded-xl px-4 py-2.5 text-sm font-medium outline-none focus:border-blue-400 transition-colors"/>
              </div>
              <div>
                <label className="text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-1.5 block">ผู้รับ</label>
                <input type="text" value={addForm.receiver} onChange={e => setAddForm({...addForm, receiver: e.target.value})}
                  placeholder="ชื่อผู้รับเงิน"
                  className="w-full border border-slate-200 rounded-xl px-4 py-2.5 text-sm font-medium outline-none focus:border-blue-400 transition-colors"/>
              </div>
              {/* หมายเหตุ */}
              <div>
                <label className="text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-1.5 block">หมายเหตุ</label>
                <input type="text" value={addForm.note} onChange={e => setAddForm({...addForm, note: e.target.value})}
                  placeholder="รายละเอียดเพิ่มเติม"
                  className="w-full border border-slate-200 rounded-xl px-4 py-2.5 text-sm font-medium outline-none focus:border-blue-400 transition-colors"/>
              </div>
              <div className="flex gap-2 pt-1">
                <button type="button" onClick={() => setShowAddModal(false)}
                  className="flex-1 py-2.5 bg-slate-100 text-slate-600 rounded-xl text-sm font-bold hover:bg-slate-200 transition-all">
                  ยกเลิก
                </button>
                <button type="submit" disabled={addingSaving}
                  className="flex-1 py-2.5 bg-indigo-600 hover:bg-indigo-700 text-white rounded-xl text-sm font-bold transition-all disabled:opacity-50 flex items-center justify-center gap-2">
                  <PlusCircle size={14}/>
                  {addingSaving ? 'กำลังบันทึก...' : 'บันทึกรายการ'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
// deploy-trigger: Sun Jun  8 2026
