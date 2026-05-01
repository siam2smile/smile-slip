import React, { useState, useEffect } from 'react';
import { useRouter } from 'next/router';
import { createClient } from '@supabase/supabase-js';
import { 
  LayoutDashboard, Receipt, Wallet, LogOut, Edit3, 
  X, Save, Settings, Landmark, Plus, Trash2, 
  FileSpreadsheet, FolderOpen, ExternalLink, RefreshCcw 
} from 'lucide-react';

const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.NEXT_PUBLIC_SUPABASE_KEY);

export default function Dashboard() {
  const router = useRouter();
  const [activeTab, setActiveTab] = useState('home');
  const [shopInfo, setShopInfo] = useState(null);
  const [credits, setCredits] = useState(0);
  const [transactions, setTransactions] = useState([]);
  const [bankAccounts, setBankAccounts] = useState([]);
  const [googleConfig, setGoogleConfig] = useState(null);
  const [isLoaded, setIsLoaded] = useState(false);

  useEffect(() => {
    if (router.isReady) {
      const { userId } = router.query;
      // ถ้าไม่มี userId ให้เด้งไปหน้า login ไม่ต้องปล่อยให้หน้าจอค้าง
      if (!userId) {
        router.push('/login');
        return;
      }
      fetchData(userId);
    }
  }, [router.isReady, router.query]);

  const fetchData = async (userId) => {
    try {
      const { data: shop } = await supabase.from('shop_profiles').select('*').eq('owner_line_id', userId).maybeSingle();
      if (shop) {
        setShopInfo(shop);
        
        // ดึงข้อมูลพื้นฐาน
        const [creditRes, txRes, bankRes, gRes] = await Promise.all([
          supabase.from('shop_credits').select('balance_credits').eq('shop_id', shop.id).maybeSingle(),
          supabase.from('ledger_transactions').select('*').eq('shop_id', shop.id).order('created_at', { ascending: false }).limit(10),
          supabase.from('shop_bank_accounts').select('*').eq('shop_id', shop.id),
          supabase.from('shop_google_configs').select('*').eq('shop_id', shop.id).maybeSingle()
        ]);

        if (creditRes.data) setCredits(creditRes.data.balance_credits);
        if (txRes.data) setTransactions(txRes.data);
        if (bankRes.data) setBankAccounts(bankRes.data);
        if (gRes.data) setGoogleConfig(gRes.data);
      }
      setIsLoaded(true);
    } catch (err) {
      console.error("Fetch Error:", err);
      setIsLoaded(true);
    }
  };

  const handleConnectGoogle = () => {
    if (!shopInfo) return alert("ไม่พบข้อมูลร้านค้า");
    const clientId = "832247688217-3fgu04nhdj5dfd3iofb1sq8ab7lcib6k.apps.googleusercontent.com";
    const redirectUri = window.location.origin + "/api/auth/google/callback";
    const scope = "https://www.googleapis.com/auth/drive.file https://www.googleapis.com/auth/spreadsheets";
    // ใช้ shopInfo.id (UUID) เป็น state เพื่อความปลอดภัย
    window.location.href = `https://accounts.google.com/o/oauth2/v2/auth?response_type=code&client_id=${clientId}&redirect_uri=${redirectUri}&scope=${encodeURIComponent(scope)}&access_type=offline&prompt=consent&state=${shopInfo.id}`;
  };

  if (!isLoaded) return (
    <div className="min-h-screen flex flex-col items-center justify-center bg-slate-50 font-sans">
      <div className="text-4xl animate-bounce">😊</div>
      <p className="mt-4 text-slate-500 font-bold tracking-widest uppercase text-xs animate-pulse">Smile Slip Pro Loading...</p>
    </div>
  );

  return (
    <div className="min-h-screen bg-[#F8FAFC] flex font-sans text-slate-900">
      {/* Sidebar */}
      <aside className="w-72 bg-slate-900 text-white p-8 flex flex-col h-screen sticky top-0 shadow-2xl">
        <div className="flex items-center gap-4 mb-12">
          <div className="w-12 h-12 bg-indigo-500 rounded-2xl flex items-center justify-center font-bold shadow-lg shadow-indigo-500/20 text-2xl">😊</div>
          <h2 className="text-xl font-black uppercase italic tracking-tighter">Smile Slip</h2>
        </div>
        <nav className="space-y-3 flex-1">
          <button onClick={() => setActiveTab('home')} className={`w-full flex items-center gap-4 p-4 rounded-2xl font-bold transition-all ${activeTab === 'home' ? 'bg-indigo-600 shadow-lg' : 'text-slate-400 hover:bg-slate-800'}`}><LayoutDashboard size={20}/> หน้าหลัก</button>
          <button onClick={() => setActiveTab('settings')} className={`w-full flex items-center gap-4 p-4 rounded-2xl font-bold transition-all ${activeTab === 'settings' ? 'bg-indigo-600 shadow-lg' : 'text-slate-400 hover:bg-slate-800'}`}><Settings size={20}/> ตั้งค่า</button>
        </nav>
        <button onClick={() => router.push('/login')} className="flex items-center gap-4 p-4 text-slate-500 border-t border-slate-800 mt-auto hover:text-rose-400 transition-colors"><LogOut size={20}/> ออกจากระบบ</button>
      </aside>

      <main className="flex-1 p-12 overflow-y-auto">
        <header className="flex justify-between items-start mb-12">
          <div>
            <h1 className="text-4xl font-black text-slate-900 tracking-tight">สวัสดีคุณ <span className="text-indigo-600">{shopInfo?.shop_name || 'User'}</span></h1>
            <p className="text-slate-500 mt-2 font-medium uppercase text-[10px] tracking-[0.2em]">Management Console / {activeTab}</p>
          </div>
          <div className="bg-white p-6 rounded-[2rem] shadow-xl border border-slate-100 flex items-center gap-5">
            <div className="bg-indigo-50 p-4 rounded-2xl text-indigo-600"><Wallet size={28} /></div>
            <div><p className="text-xs font-bold text-slate-400 uppercase">เครดิต</p><p className="text-3xl font-black">{credits.toLocaleString()}</p></div>
          </div>
        </header>

        {activeTab === 'home' && (
          <div className="space-y-10 animate-in fade-in duration-500">
            {/* Google Sync Status */}
            <div className={`p-10 rounded-[3rem] border-2 flex items-center justify-between transition-all ${googleConfig ? 'bg-emerald-50 border-emerald-100 shadow-emerald-50' : 'bg-white border-dashed border-slate-200'}`}>
              <div className="flex items-center gap-8">
                <div className={`p-6 rounded-2xl shadow-sm ${googleConfig ? 'bg-emerald-500 text-white' : 'bg-slate-100 text-slate-400'}`}><FileSpreadsheet size={36} /></div>
                <div>
                  <h3 className="text-2xl font-black text-slate-800">{googleConfig ? 'Google Sheet พร้อมใช้งาน' : 'ยังไม่ได้เชื่อมต่อ Google Drive'}</h3>
                  <p className="text-slate-500 font-medium">{googleConfig ? 'ระบบกำลังซิงค์ข้อมูลลงสมุดบัญชีของคุณ' : 'เชื่อมต่อเพื่อบันทึกข้อมูลสลิปลง Google Sheet ส่วนตัว'}</p>
                </div>
              </div>
              {googleConfig ? ( 
                <a href={`https://docs.google.com/spreadsheets/d/${googleConfig.google_sheet_id}`} target="_blank" rel="noopener noreferrer" className="bg-white text-emerald-600 border-2 border-emerald-200 px-8 py-4 rounded-2xl font-black hover:bg-emerald-50 transition-all flex items-center gap-2 shadow-sm"><ExternalLink size={18}/> เปิดสมุดบัญชี</a> 
              ) : ( 
                <button onClick={handleConnectGoogle} className="bg-slate-900 text-white px-8 py-4 rounded-2xl font-black shadow-xl hover:bg-indigo-600 transition-all flex items-center gap-2"><RefreshCcw size={18}/> เชื่อมต่อ Google</button> 
              )}
            </div>

            {/* Recent Transactions */}
            <div className="bg-white rounded-[3rem] shadow-xl border border-slate-100 overflow-hidden">
              <div className="p-10 border-b border-slate-50 font-black text-2xl text-slate-800 tracking-tight">รายการล่าสุด</div>
              <table className="w-full text-left">
                <thead className="bg-slate-50/50 text-slate-400 text-[10px] uppercase font-black tracking-widest">
                  <tr><th className="px-10 py-6">วัน-เวลา</th><th className="px-10 py-6">ผู้โอน</th><th className="px-10 py-6 text-right">จำนวนเงิน</th></tr>
                </thead>
                <tbody className="divide-y divide-slate-50">
                  {transactions.map(tx => (
                    <tr key={tx.id} className="hover:bg-slate-50 transition-all group">
                      <td className="px-10 py-8 text-slate-500 font-medium">{new Date(tx.created_at).toLocaleString('th-TH')}</td>
                      <td className="px-10 py-8 font-black text-slate-700">{tx.sender_name || 'ไม่ระบุชื่อ'}</td>
                      <td className="px-10 py-8 text-right font-black text-indigo-600 text-xl font-mono italic">฿{Number(tx.amount || 0).toLocaleString()}</td>
                    </tr>
                  ))}
                  {transactions.length === 0 && (
                    <tr><td colSpan="3" className="p-20 text-center text-slate-300 italic font-medium">ยังไม่มีรายการสลิปในฐานข้อมูล</td></tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {activeTab === 'settings' && (
          <div className="bg-white p-12 rounded-[3rem] shadow-xl border border-slate-100 animate-in zoom-in-95 duration-300">
            <div className="flex items-center justify-between mb-10">
              <h3 className="text-2xl font-black text-slate-800 flex items-center gap-3"><Landmark className="text-indigo-600"/> บัญชีธนาคารรับเงิน</h3>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              {bankAccounts.map(bank => (
                <div key={bank.id} className="p-8 bg-slate-50 rounded-[2rem] border border-slate-100 flex justify-between items-center group hover:border-indigo-200 transition-all">
                  <div className="text-balance">
                    <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest">{bank.bank_name}</p>
                    <h4 className="text-xl font-black text-slate-800 mt-1">{bank.account_number}</h4>
                    <p className="text-slate-500 font-medium">{bank.account_name}</p>
                  </div>
                  <button className="p-3 text-slate-200 hover:text-rose-500 hover:bg-rose-50 rounded-xl transition-all"><Trash2 size={24}/></button>
                </div>
              ))}
              {bankAccounts.length === 0 && (
                <div className="md:col-span-2 py-10 text-center text-slate-300 italic">ยังไม่ได้เพิ่มบัญชีธนาคาร</div>
              )}
            </div>
          </div>
        )}
      </main>
    </div>
  );
}