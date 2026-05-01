                     </tr>
                   ))}
                 </tbody>
               </table>
            </div>
          </div>
        )}

        {activeTab === 'settings' && (
          <div className="bg-white p-12 rounded-[3rem] shadow-xl border border-slate-100 animate-in zoom-in-95 duration-300">
            <h3 className="text-2xl font-black mb-10 flex items-center gap-3"><Landmark className="text-indigo-600"/> บัญชีธนาคารรับเงิน</h3>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              {bankAccounts.map(bank => (
                <div key={bank.id} className="p-8 bg-slate-50 rounded-[2rem] border border-slate-100 flex justify-between items-center group hover:border-indigo-200 transition-all">
                  <div className="text-balance">
                    <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest">{bank.bank_name}</p>
                    <h4 className="text-xl font-black text-slate-800 mt-1">{bank.account_number}</h4>
                    <p className="text-slate-500 font-medium">{bank.account_name}</p>
                  </div>
                  <button className="text-slate-200 hover:text-rose-500 transition-colors"><Trash2 size={24}/></button>
                </div>
              ))}
            </div>
          </div>
        )}
      </main>
    </div>
  );
}
EOF

./deploy-web.sh
cd ~/smileslip-dashboard
cat <<EOF > deploy-web.sh
#!/bin/bash
export SERVICE_NAME="smileslip-dashboard"
export REGION="asia-southeast1"

# --- Supabase ---
SB_URL="https://sbgwwxuhzfeflexipgkz.supabase.co"
SB_PUB_KEY="sb_publishable_MaAMwA184SJU9jtF2BSCkg_8ZjmEvkJ"

# --- LINE ---
L_TOKEN="A8KnRecB7fCCpCTQ5KckJSv98Xy53Hq/zLhBSJi4eYPuH4HCOF3cAs22KsFNzjNYD/5RhFCytMZ+eQQwOInzoGuAF02n6HZ4wIJo/LryWPPQ0+C8xQGGRQ7H3vAeXkOAja/IznRwjqq07fihuZosBwdB04t89/1O/w1cDnyilFU="
L_LOGIN_ID="2009797558"
L_LOGIN_SECRET="685a6d7cf9b0411b616ac241a4f43845"

# --- Google (กุญแจใหม่จากคุณ Vespa) ---
G_CLIENT_ID="832247688217-3fgu04nhdj5dfd3iofb1sq8ab7lcib6k.apps.googleusercontent.com"
G_CLIENT_SECRET="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"
G_REDIRECT="https://smileslip-dashboard-832247688217.asia-southeast1.run.app/api/auth/google/callback"

gcloud run deploy \$SERVICE_NAME \\
  --source . \\
  --region \$REGION \\
  --allow-unauthenticated \\
  --set-env-vars "NEXT_PUBLIC_SUPABASE_URL=\$SB_URL,NEXT_PUBLIC_SUPABASE_KEY=\$SB_PUB_KEY,SUPABASE_URL=\$SB_URL,SUPABASE_KEY=\$SB_PUB_KEY,LINE_CHANNEL_ACCESS_TOKEN=\$L_TOKEN,LINE_LOGIN_ID=\$L_LOGIN_ID,LINE_LOGIN_SECRET=\$L_LOGIN_SECRET,GOOGLE_CLIENT_ID=\$G_CLIENT_ID,GOOGLE_CLIENT_SECRET=\$G_CLIENT_SECRET,GOOGLE_REDIRECT_URI=\$G_REDIRECT" \\
  --set-build-env-vars "NEXT_PUBLIC_SUPABASE_URL=\$SB_URL,NEXT_PUBLIC_SUPABASE_KEY=\$SB_PUB_KEY"
EOF

chmod +x deploy-web.sh
./deploy-web.sh
cd ~/smileslip-dashboard
cat <<'EOF' > pages/dashboard.js
import React, { useState, useEffect } from 'react';
import { useRouter } from 'next/router';
import { createClient } from '@supabase/supabase-js';
import { 
  LayoutDashboard, Receipt, Wallet, LogOut, Edit3, 
  X, Save, Settings, Landmark, Plus, Trash2, 
  FileSpreadsheet, FolderOpen, ExternalLink, RefreshCcw
} from 'lucide-react';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.NEXT_PUBLIC_SUPABASE_KEY
);

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
      if (userId) fetchData(userId);
    }
  }, [router.isReady, router.query]);

  const fetchData = async (userId) => {
    try {
      const { data: shop } = await supabase.from('shop_profiles').select('*').eq('owner_line_id', userId).maybeSingle();
      if (shop) {
        setShopInfo(shop);
        const { data: cr } = await supabase.from('shop_credits').select('balance_credits').eq('shop_id', shop.id).maybeSingle();
        if (cr) setCredits(cr.balance_credits);
        const { data: txs } = await supabase.from('ledger_transactions').select('*').eq('shop_id', shop.id).order('created_at', { ascending: false });
        if (txs) setTransactions(txs);
        const { data: banks } = await supabase.from('shop_bank_accounts').select('*').eq('shop_id', shop.id);
        if (banks) setBankAccounts(banks);
        const { data: gConfig } = await supabase.from('shop_google_configs').select('*').eq('shop_id', shop.id).maybeSingle();
        if (gConfig) setGoogleConfig(gConfig);
      }
      setIsLoaded(true);
    } catch (err) { console.error(err); }
  };

  const handleConnectGoogle = () => {
    const clientId = "832247688217-3fgu04nhdj5dfd3iofb1sq8ab7lcib6k.apps.googleusercontent.com";
    const redirectUri = window.location.origin + "/api/auth/google/callback";
    const scope = "https://www.googleapis.com/auth/drive.file https://www.googleapis.com/auth/spreadsheets";
    const state = shopInfo.id; 
    const authUrl = `https://accounts.google.com/o/oauth2/v2/auth?response_type=code&client_id=${clientId}&redirect_uri=${redirectUri}&scope=${encodeURIComponent(scope)}&access_type=offline&prompt=consent&state=${state}`;
    window.location.href = authUrl;
  };

  if (!isLoaded) return (
    <div className="min-h-screen flex flex-col items-center justify-center bg-slate-50 font-sans">
      <div className="text-4xl animate-bounce">😊</div>
      <p className="mt-4 text-slate-500 font-bold tracking-widest uppercase text-xs">Syncing Smile Slip Pro...</p>
    </div>
  );

  return (
    <div className="min-h-screen bg-[#F8FAFC] flex font-sans text-slate-900 relative">
      <aside className="w-72 bg-slate-900 text-white p-8 flex flex-col shadow-2xl sticky top-0 h-screen">
        <div className="flex items-center gap-4 mb-12">
          <div className="w-12 h-12 bg-indigo-500 rounded-2xl flex items-center justify-center text-2xl font-bold">😊</div>
          <h2 className="text-xl font-black tracking-tighter uppercase italic">Smile Slip</h2>
        </div>
        <nav className="space-y-3 flex-1">
          <button onClick={() => setActiveTab('home')} className={`w-full flex items-center gap-4 p-4 rounded-2xl transition-all font-bold ${activeTab === 'home' ? 'bg-indigo-600 shadow-lg' : 'text-slate-400 hover:bg-slate-800'}`}><LayoutDashboard size={20}/> หน้าหลัก</button>
          <button onClick={() => setActiveTab('settings')} className={`w-full flex items-center gap-4 p-4 rounded-2xl transition-all font-bold ${activeTab === 'settings' ? 'bg-indigo-600 shadow-lg' : 'text-slate-400 hover:bg-slate-800'}`}><Settings size={20}/> ตั้งค่าร้านค้า</button>
        </nav>
        <button onClick={() => router.push('/login')} className="flex items-center gap-4 p-4 text-slate-500 hover:text-rose-400 border-t border-slate-800 pt-8 mt-auto"><LogOut size={20}/> ออกจากระบบ</button>
      </aside>

      <main className="flex-1 p-12 overflow-y-auto">
        <header className="flex justify-between items-start mb-12">
          <div>
            <h1 className="text-4xl font-black text-slate-900">สวัสดีคุณ <span className="text-indigo-600">{shopInfo?.shop_name}</span></h1>
            <p className="text-slate-500 mt-2 font-medium tracking-wide">ยินดีต้อนรับสู่ SME Ecosystem ของคุณ</p>
          </div>
          <div className="bg-white p-6 rounded-[2rem] shadow-xl border border-slate-100 flex items-center gap-5">
            <div className="bg-indigo-50 p-4 rounded-2xl text-indigo-600"><Wallet size={28} /></div>
            <div><p className="text-[10px] font-black text-slate-400 uppercase mb-1">เครดิต</p><p className="text-3xl font-black">{credits.toLocaleString()} แผ่น</p></div>
          </div>
        </header>

        {activeTab === 'home' && (
          <div className="space-y-10 animate-in fade-in duration-500">
            <div className={`p-10 rounded-[3rem] border-2 flex items-center justify-between transition-all ${googleConfig ? 'bg-emerald-50 border-emerald-100 shadow-emerald-100' : 'bg-white border-dashed border-slate-200 shadow-sm'}`}>
              <div className="flex items-center gap-8">
                <div className={`p-6 rounded-[1.5rem] ${googleConfig ? 'bg-emerald-500 text-white' : 'bg-slate-100 text-slate-400'}`}>
                  <FileSpreadsheet size={36} />
                </div>
                <div>
                  <h3 className="text-2xl font-black text-slate-800">{googleConfig ? 'Google Sheet พร้อมใช้งาน' : 'ยังไม่ได้เชื่อมต่อ Google Drive'}</h3>
                  <p className="text-slate-600 font-medium">{googleConfig ? 'ข้อมูลสลิปจะถูกบันทึกลง Sheet ของคุณโดยอัตโนมัติ' : 'เชื่อมต่อเพื่อเปิดระบบบันทึกบัญชีอัตโนมัติลง Google Sheet ของคุณ'}</p>
                </div>
              </div>
              {googleConfig ? (
                <a href={`https://docs.google.com/spreadsheets/d/${googleConfig.google_sheet_id}`} target="_blank" rel="noopener noreferrer" className="bg-white text-emerald-600 border-2 border-emerald-200 px-8 py-4 rounded-2xl font-black flex items-center gap-3 hover:bg-emerald-100 transition-all active:scale-95 shadow-sm">
                  <ExternalLink size={20}/> เปิดสมุดบัญชี
                </a>
              ) : (
                <button onClick={handleConnectGoogle} className="bg-slate-900 text-white px-8 py-4 rounded-2xl font-black flex items-center gap-3 hover:bg-indigo-600 active:scale-95 transition-all shadow-xl shadow-slate-200">
                  <RefreshCcw size={20}/> เชื่อมต่อ Google Drive
                </button>
              )}
            </div>

            <div className="bg-white rounded-[3rem] shadow-xl border border-slate-100 overflow-hidden">
               <div className="p-10 border-b border-slate-50 font-black text-2xl text-slate-800">รายการสลิปล่าสุด</div>
               <table className="w-full text-left">
                 <thead className="bg-slate-50 text-slate-400 text-[10px] uppercase font-black tracking-widest"><tr className="text-balance"><th className="p-10 py-6">วัน-เวลา</th><th className="p-10 py-6">ผู้โอน</th><th className="p-10 py-6 text-right">จำนวนเงิน</th></tr></thead>
                 <tbody className="divide-y divide-slate-50">
                   {transactions.slice(0, 5).map(tx => (
                     <tr key={tx.id} className="hover:bg-slate-50 transition-all">
                       <td className="p-10 py-8 text-slate-500 font-medium">{new Date(tx.created_at).toLocaleString('th-TH')}</td>
                       <td className="p-10 py-8 font-black text-slate-700">{tx.sender_name || 'ไม่ระบุ'}</td>
                       <td className="p-10 py-8 text-right font-black text-indigo-600 text-xl">฿{Number(tx.amount).toLocaleString()}</td>
                     </tr>
                   ))}
                 </tbody>
               </table>
            </div>
          </div>
        )}

        {activeTab === 'settings' && (
          <div className="bg-white p-12 rounded-[3rem] shadow-xl border border-slate-100 animate-in zoom-in-95 duration-300">
            <h3 className="text-2xl font-black mb-10 flex items-center gap-3"><Landmark className="text-indigo-600"/> บัญชีธนาคารรับเงิน</h3>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              {bankAccounts.map(bank => (
                <div key={bank.id} className="p-8 bg-slate-50 rounded-[2rem] border border-slate-100 flex justify-between items-center group hover:border-indigo-200 transition-all">
                  <div className="text-balance">
                    <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest">{bank.bank_name}</p>
                    <h4 className="text-xl font-black text-slate-800 mt-1">{bank.account_number}</h4>
                    <p className="text-slate-500 font-medium">{bank.account_name}</p>
                  </div>
                  <button className="text-slate-200 hover:text-rose-500 transition-colors"><Trash2 size={24}/></button>
                </div>
              ))}
            </div>
          </div>
        )}
      </main>
    </div>
  );
}
EOF

./deploy-web.sh
cd ~/smileslip-dashboard
cat <<'EOF' > pages/dashboard.js
import React, { useState, useEffect } from 'react';
import { useRouter } from 'next/router';
import { createClient } from '@supabase/supabase-js';
import { LayoutDashboard, Receipt, Wallet, LogOut, Edit3, X, Save, Settings, Landmark, Plus, Trash2, FileSpreadsheet, FolderOpen, ExternalLink, RefreshCcw } from 'lucide-react';

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

  useEffect(() => { if (router.isReady) { const { userId } = router.query; if (userId) fetchData(userId); } }, [router.isReady, router.query]);

  const fetchData = async (userId) => {
    try {
      const { data: shop } = await supabase.from('shop_profiles').select('*').eq('owner_line_id', userId).maybeSingle();
      if (shop) {
        setShopInfo(shop);
        const { data: cr } = await supabase.from('shop_credits').select('balance_credits').eq('shop_id', shop.id).maybeSingle();
        if (cr) setCredits(cr.balance_credits);
        const { data: txs } = await supabase.from('ledger_transactions').select('*').eq('shop_id', shop.id).order('created_at', { ascending: false });
        if (txs) setTransactions(txs);
        const { data: banks } = await supabase.from('shop_bank_accounts').select('*').eq('shop_id', shop.id);
        if (banks) setBankAccounts(banks);
        const { data: gConfig } = await supabase.from('shop_google_configs').select('*').eq('shop_id', shop.id).maybeSingle();
        if (gConfig) setGoogleConfig(gConfig);
      }
      setIsLoaded(true);
    } catch (err) { console.error(err); }
  };

  const handleConnectGoogle = () => {
    const clientId = "832247688217-3fgu04nhdj5dfd3iofb1sq8ab7lcib6k.apps.googleusercontent.com";
    const redirectUri = window.location.origin + "/api/auth/google/callback";
    const scope = "https://www.googleapis.com/auth/drive.file https://www.googleapis.com/auth/spreadsheets";
    const authUrl = `https://accounts.google.com/o/oauth2/v2/auth?response_type=code&client_id=${clientId}&redirect_uri=${redirectUri}&scope=${encodeURIComponent(scope)}&access_type=offline&prompt=consent&state=${shopInfo.id}`;
    window.location.href = authUrl;
  };

  if (!isLoaded) return <div className="min-h-screen flex flex-col items-center justify-center bg-slate-50 font-sans"><div className="text-4xl animate-bounce">😊</div><p className="mt-4 text-slate-500 font-bold tracking-widest uppercase text-xs">Syncing Smile Slip Pro...</p></div>;

  return (
    <div className="min-h-screen bg-[#F8FAFC] flex font-sans text-slate-900 relative">
      <aside className="w-72 bg-slate-900 text-white p-8 flex flex-col shadow-2xl sticky top-0 h-screen">
        <div className="flex items-center gap-4 mb-12"><div className="w-12 h-12 bg-indigo-500 rounded-2xl flex items-center justify-center text-2xl font-bold">😊</div><h2 className="text-xl font-black tracking-tighter uppercase italic">Smile Slip</h2></div>
        <nav className="space-y-3 flex-1">
          <button onClick={() => setActiveTab('home')} className={`w-full flex items-center gap-4 p-4 rounded-2xl transition-all font-bold ${activeTab === 'home' ? 'bg-indigo-600 shadow-lg' : 'text-slate-400 hover:bg-slate-800'}`}><LayoutDashboard size={20}/> หน้าหลัก</button>
          <button onClick={() => setActiveTab('settings')} className={`w-full flex items-center gap-4 p-4 rounded-2xl transition-all font-bold ${activeTab === 'settings' ? 'bg-indigo-600 shadow-lg' : 'text-slate-400 hover:bg-slate-800'}`}><Settings size={20}/> ตั้งค่าร้านค้า</button>
        </nav>
        <button onClick={() => router.push('/login')} className="flex items-center gap-4 p-4 text-slate-500 hover:text-rose-400 border-t border-slate-800 pt-8 mt-auto"><LogOut size={20}/> ออกจากระบบ</button>
      </aside>
      <main className="flex-1 p-12 overflow-y-auto">
        <header className="flex justify-between items-start mb-12">
          <div><h1 className="text-4xl font-black text-slate-900">สวัสดีคุณ <span className="text-indigo-600">{shopInfo?.shop_name}</span></h1><p className="text-slate-500 mt-2 font-medium tracking-wide text-balance">Management Console</p></div>
          <div className="bg-white p-6 rounded-[2rem] shadow-xl border border-slate-100 flex items-center gap-5"><div className="bg-indigo-50 p-4 rounded-2xl text-indigo-600"><Wallet size={28} /></div><div><p className="text-[10px] font-black text-slate-400 uppercase mb-1">เครดิต</p><p className="text-3xl font-black">{credits.toLocaleString()} แผ่น</p></div></div>
        </header>
        {activeTab === 'home' && (
          <div className="space-y-10 animate-in fade-in duration-500">
            <div className={`p-10 rounded-[3rem] border-2 flex items-center justify-between transition-all ${googleConfig ? 'bg-emerald-50 border-emerald-100 shadow-emerald-100' : 'bg-white border-dashed border-slate-200'}`}>
              <div className="flex items-center gap-8"><div className={`p-6 rounded-[1.5rem] ${googleConfig ? 'bg-emerald-500 text-white' : 'bg-slate-100 text-slate-400'}`}><FileSpreadsheet size={36} /></div><div><h3 className="text-2xl font-black text-slate-800">{googleConfig ? 'Google Sheet พร้อม' : 'เชื่อมต่อ Google Drive'}</h3><p className="text-slate-600 font-medium">{googleConfig ? 'ซิงค์ข้อมูลอัตโนมัติแล้ว' : 'เชื่อมต่อเพื่อบันทึกข้อมูลสลิปลง Sheet'}</p></div></div>
              {googleConfig ? ( <a href={`https://docs.google.com/spreadsheets/d/${googleConfig.google_sheet_id}`} target="_blank" rel="noopener noreferrer" className="bg-white text-emerald-600 border-2 border-emerald-200 px-8 py-4 rounded-2xl font-black flex items-center gap-3 hover:bg-emerald-100"><ExternalLink size={20}/> เปิดสมุดบัญชี</a> ) : ( <button onClick={handleConnectGoogle} className="bg-slate-900 text-white px-8 py-4 rounded-2xl font-black flex items-center gap-3 hover:bg-indigo-600 shadow-xl shadow-slate-200"><RefreshCcw size={20}/> เชื่อมต่อ Google</button> )}
            </div>
            <div className="bg-white rounded-[3rem] shadow-xl border border-slate-100 overflow-hidden"><div className="p-10 border-b border-slate-50 font-black text-2xl text-slate-800">รายการล่าสุด</div>
               <table className="w-full text-left">
                 <thead className="bg-slate-50 text-slate-400 text-[10px] uppercase font-black tracking-widest"><tr><th className="p-10 py-6">วัน-เวลา</th><th className="p-10 py-6">ผู้โอน</th><th className="p-10 py-6 text-right">จำนวนเงิน</th></tr></thead>
                 <tbody className="divide-y divide-slate-50">{transactions.slice(0, 5).map(tx => ( <tr key={tx.id} className="hover:bg-slate-50 transition-all"><td className="p-10 py-8 text-slate-500 font-medium">{new Date(tx.created_at).toLocaleString('th-TH')}</td><td className="p-10 py-8 font-black text-slate-700">{tx.sender_name || 'ไม่ระบุ'}</td><td className="p-10 py-8 text-right font-black text-indigo-600 text-xl font-mono">฿{Number(tx.amount).toLocaleString()}</td></tr> ))}</tbody>
               </table>
            </div>
          </div>
        )}
        {activeTab === 'settings' && (
          <div className="bg-white p-12 rounded-[3rem] shadow-xl border border-slate-100 animate-in zoom-in-95 duration-300">
            <h3 className="text-2xl font-black mb-10 flex items-center gap-3 text-balance"><Landmark className="text-indigo-600"/> บัญชีธนาคารรับเงิน</h3>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">{bankAccounts.map(bank => ( <div key={bank.id} className="p-8 bg-slate-50 rounded-[2rem] border border-slate-100 flex justify-between items-center group hover:border-indigo-200 transition-all"><div><p className="text-[10px] font-black text-slate-400 uppercase tracking-widest">{bank.bank_name}</p><h4 className="text-xl font-black text-slate-800 mt-1">{bank.account_number}</h4><p className="text-slate-500 font-medium">{bank.account_name}</p></div><button className="text-slate-200 hover:text-rose-500"><Trash2 size={24}/></button></div> ))}</div>
          </div>
        )}
      </main>
    </div>
  );
}
EOF

./deploy-web.sh
reset
tail -n 10 pages/dashboard.js
cd ~/smileslip-dashboard
rm pages/dashboard.js
cd ~/smileslip-dashboard
cat <<'EOF' > pages/dashboard.js
import React, { useState, useEffect } from 'react';
import { useRouter } from 'next/router';
import { createClient } from '@supabase/supabase-js';
import { LayoutDashboard, Receipt, Wallet, LogOut, Edit3, X, Save, Settings, Landmark, Plus, Trash2, FileSpreadsheet, FolderOpen, ExternalLink, RefreshCcw } from 'lucide-react';

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

  useEffect(() => { if (router.isReady) { const { userId } = router.query; if (userId) fetchData(userId); } }, [router.isReady, router.query]);

  const fetchData = async (userId) => {
    try {
      const { data: shop } = await supabase.from('shop_profiles').select('*').eq('owner_line_id', userId).maybeSingle();
      if (shop) {
        setShopInfo(shop);
        const { data: cr } = await supabase.from('shop_credits').select('balance_credits').eq('shop_id', shop.id).maybeSingle();
        if (cr) setCredits(cr.balance_credits);
        const { data: txs } = await supabase.from('ledger_transactions').select('*').eq('shop_id', shop.id).order('created_at', { ascending: false });
        if (txs) setTransactions(txs);
        const { data: banks } = await supabase.from('shop_bank_accounts').select('*').eq('shop_id', shop.id);
        if (banks) setBankAccounts(banks);
        const { data: gConfig } = await supabase.from('shop_google_configs').select('*').eq('shop_id', shop.id).maybeSingle();
        if (gConfig) setGoogleConfig(gConfig);
      }
      setIsLoaded(true);
    } catch (err) { console.error(err); }
  };

  const handleConnectGoogle = () => {
    const clientId = "832247688217-3fgu04nhdj5dfd3iofb1sq8ab7lcib6k.apps.googleusercontent.com";
    const redirectUri = window.location.origin + "/api/auth/google/callback";
    const scope = "https://www.googleapis.com/auth/drive.file https://www.googleapis.com/auth/spreadsheets";
    window.location.href = `https://accounts.google.com/o/oauth2/v2/auth?response_type=code&client_id=${clientId}&redirect_uri=${redirectUri}&scope=${encodeURIComponent(scope)}&access_type=offline&prompt=consent&state=${shopInfo.id}`;
  };
EOF

cat <<'EOF' >> pages/dashboard.js
  if (!isLoaded) return <div className="min-h-screen flex items-center justify-center bg-slate-50 font-sans font-bold">😊 Smile Slip Pro...</div>;

  return (
    <div className="min-h-screen bg-[#F8FAFC] flex font-sans text-slate-900">
      <aside className="w-72 bg-slate-900 text-white p-8 flex flex-col h-screen sticky top-0">
        <div className="flex items-center gap-4 mb-12"><div className="w-12 h-12 bg-indigo-500 rounded-2xl flex items-center justify-center font-bold">😊</div><h2 className="text-xl font-black uppercase italic">Smile Slip</h2></div>
        <nav className="space-y-3 flex-1">
          <button onClick={() => setActiveTab('home')} className={`w-full flex items-center gap-4 p-4 rounded-2xl font-bold ${activeTab === 'home' ? 'bg-indigo-600' : 'text-slate-400 hover:bg-slate-800'}`}><LayoutDashboard size={20}/> หน้าหลัก</button>
          <button onClick={() => setActiveTab('settings')} className={`w-full flex items-center gap-4 p-4 rounded-2xl font-bold ${activeTab === 'settings' ? 'bg-indigo-600' : 'text-slate-400 hover:bg-slate-800'}`}><Settings size={20}/> ตั้งค่า</button>
        </nav>
        <button onClick={() => router.push('/login')} className="flex items-center gap-4 p-4 text-slate-500 border-t border-slate-800 mt-auto"><LogOut size={20}/> ออกจากระบบ</button>
      </aside>

      <main className="flex-1 p-12 overflow-y-auto">
        <header className="flex justify-between items-start mb-12">
          <div><h1 className="text-4xl font-black text-slate-900 tracking-tight">สวัสดีคุณ <span className="text-indigo-600">{shopInfo?.shop_name}</span></h1><p className="text-slate-500 mt-2 font-medium">Dashboard System</p></div>
          <div className="bg-white p-6 rounded-[2rem] shadow-xl border border-slate-100 flex items-center gap-5"><div className="bg-indigo-50 p-4 rounded-2xl text-indigo-600"><Wallet size={28} /></div><div><p className="text-xs font-bold text-slate-400">เครดิต</p><p className="text-3xl font-black">{credits.toLocaleString()}</p></div></div>
        </header>

        {activeTab === 'home' && (
          <div className="space-y-10 animate-in fade-in duration-500">
            <div className={`p-10 rounded-[3rem] border-2 flex items-center justify-between ${googleConfig ? 'bg-emerald-50 border-emerald-100' : 'bg-white border-dashed border-slate-200'}`}>
              <div className="flex items-center gap-8"><div className={`p-6 rounded-2xl ${googleConfig ? 'bg-emerald-500 text-white' : 'bg-slate-100 text-slate-400'}`}><FileSpreadsheet size={36} /></div><div><h3 className="text-2xl font-black">{googleConfig ? 'เชื่อมต่อ Google แล้ว' : 'เชื่อมต่อ Google Drive'}</h3><p className="text-slate-500">{googleConfig ? 'ซิงค์ข้อมูลลง Sheet แล้ว' : 'เชื่อมต่อเพื่อบันทึกบัญชีลง Google Sheet'}</p></div></div>
              {googleConfig ? ( <a href={`https://docs.google.com/spreadsheets/d/${googleConfig.google_sheet_id}`} target="_blank" className="bg-white text-emerald-600 border-2 border-emerald-200 px-8 py-4 rounded-2xl font-black">เปิดสมุดบัญชี</a> ) : ( <button onClick={handleConnectGoogle} className="bg-slate-900 text-white px-8 py-4 rounded-2xl font-black shadow-xl">เชื่อมต่อ Google</button> )}
            </div>
            <div className="bg-white rounded-[3rem] shadow-xl border border-slate-100 overflow-hidden"><div className="p-10 border-b border-slate-50 font-black text-2xl text-slate-800 tracking-tight">รายการล่าสุด</div><table className="w-full text-left"><tbody className="divide-y divide-slate-50">{transactions.slice(0, 5).map(tx => (<tr key={tx.id} className="hover:bg-slate-50 transition-all"><td className="px-10 py-8 text-slate-500 font-medium">{new Date(tx.created_at).toLocaleDateString('th-TH')}</td><td className="px-10 py-8 font-black">{tx.sender_name || 'ไม่ระบุ'}</td><td className="px-10 py-8 text-right font-black text-indigo-600 text-xl">฿{Number(tx.amount).toLocaleString()}</td></tr>))}</tbody></table></div>
          </div>
        )}

        {activeTab === 'settings' && (
          <div className="bg-white p-12 rounded-[3rem] shadow-xl border border-slate-100 animate-in zoom-in-95">
            <h3 className="text-2xl font-black mb-10 flex items-center gap-3"><Landmark className="text-indigo-600"/> บัญชีธนาคารรับเงิน</h3>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">{bankAccounts.map(bank => (<div key={bank.id} className="p-8 bg-slate-50 rounded-[2rem] border border-slate-100 flex justify-between items-center group hover:border-indigo-200 transition-all"><div><p className="text-[10px] font-black text-slate-400 uppercase tracking-widest">{bank.bank_name}</p><h4 className="text-xl font-black text-slate-800 mt-1">{bank.account_number}</h4><p className="text-slate-500 font-medium">{bank.account_name}</p></div></div>))}</div>
          </div>
        )}
      </main>
    </div>
  );
}
EOF

./deploy-web.sh
gcloud auth login
./deploy-web.sh
pwd
ls
cat <<EOF > deploy-web.sh
#!/bin/bash
export SERVICE_NAME="smileslip-dashboard"
export REGION="asia-southeast1"

# --- Supabase ---
SB_URL="https://sbgwwxuhzfeflexipgkz.supabase.co"
SB_PUB_KEY="sb_publishable_MaAMwA184SJU9jtF2BSCkg_8ZjmEvkJ"

# --- LINE ---
L_TOKEN="A8KnRecB7fCCpCTQ5KckJSv98Xy53Hq/zLhBSJi4eYPuH4HCOF3cAs22KsFNzjNYD/5RhFCytMZ+eQQwOInzoGuAF02n6HZ4wIJo/LryWPPQ0+C8xQGGRQ7H3vAeXkOAja/IznRwjqq07fihuZosBwdB04t89/1O/w1cDnyilFU="
L_LOGIN_ID="2009797558"
L_LOGIN_SECRET="685a6d7cf9b0411b616ac241a4f43845"

# --- Google ---
G_CLIENT_ID="832247688217-3fgu04nhdj5dfd3iofb1sq8ab7lcib6k.apps.googleusercontent.com"
G_CLIENT_SECRET="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"
G_REDIRECT="https://smileslip-dashboard-832247688217.asia-southeast1.run.app/api/auth/google/callback"

gcloud run deploy \$SERVICE_NAME \\
  --source . \\
  --region \$REGION \\
  --allow-unauthenticated \\
  --set-env-vars "NEXT_PUBLIC_SUPABASE_URL=\$SB_URL,NEXT_PUBLIC_SUPABASE_KEY=\$SB_PUB_KEY,SUPABASE_URL=\$SB_URL,SUPABASE_KEY=\$SB_PUB_KEY,LINE_CHANNEL_ACCESS_TOKEN=\$L_TOKEN,LINE_LOGIN_ID=\$L_LOGIN_ID,LINE_LOGIN_SECRET=\$L_LOGIN_SECRET,GOOGLE_CLIENT_ID=\$G_CLIENT_ID,GOOGLE_CLIENT_SECRET=\$G_CLIENT_SECRET,GOOGLE_REDIRECT_URI=\$G_REDIRECT" \\
  --set-build-env-vars "NEXT_PUBLIC_SUPABASE_URL=\$SB_URL,NEXT_PUBLIC_SUPABASE_KEY=\$SB_PUB_KEY"
EOF

chmod +x deploy-web.sh
./deploy-web.sh
cd ~/smileslip-dashboard
cat <<EOF > deploy-web.sh
#!/bin/bash
export SERVICE_NAME="smileslip-dashboard"
export REGION="asia-southeast1"

# --- Supabase ---
SB_URL="https://sbgwwxuhzfeflexipgkz.supabase.co"
SB_PUB_KEY="sb_publishable_MaAMwA184SJU9jtF2BSCkg_8ZjmEvkJ"

# --- LINE ---
L_TOKEN="A8KnRecB7fCCpCTQ5KckJSv98Xy53Hq/zLhBSJi4eYPuH4HCOF3cAs22KsFNzjNYD/5RhFCytMZ+eQQwOInzoGuAF02n6HZ4wIJo/LryWPPQ0+C8xQGGRQ7H3vAeXkOAja/IznRwjqq07fihuZosBwdB04t89/1O/w1cDnyilFU="
L_LOGIN_ID="2009797558"
L_LOGIN_SECRET="685a6d7cf9b0411b616ac241a4f43845"

# --- Google ---
G_CLIENT_ID="832247688217-3fgu04nhdj5dfd3iofb1sq8ab7lcib6k.apps.googleusercontent.com"
G_CLIENT_SECRET="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"
G_REDIRECT="https://smileslip-dashboard-832247688217.asia-southeast1.run.app/api/auth/google/callback"

gcloud run deploy \$SERVICE_NAME \\
  --source . \\
  --region \$REGION \\
  --allow-unauthenticated \\
  --clear-base-image \\
  --set-env-vars "NEXT_PUBLIC_SUPABASE_URL=\$SB_URL,NEXT_PUBLIC_SUPABASE_KEY=\$SB_PUB_KEY,SUPABASE_URL=\$SB_URL,SUPABASE_KEY=\$SB_PUB_KEY,LINE_CHANNEL_ACCESS_TOKEN=\$L_TOKEN,LINE_LOGIN_ID=\$L_LOGIN_ID,LINE_LOGIN_SECRET=\$L_LOGIN_SECRET,GOOGLE_CLIENT_ID=\$G_CLIENT_ID,GOOGLE_CLIENT_SECRET=\$G_CLIENT_SECRET,GOOGLE_REDIRECT_URI=\$G_REDIRECT" \\
  --set-build-env-vars "NEXT_PUBLIC_SUPABASE_URL=\$SB_URL,NEXT_PUBLIC_SUPABASE_KEY=\$SB_PUB_KEY"
EOF

chmod +x deploy-web.sh
./deploy-web.sh
cd ~/smileslip-dashboard
cat <<EOF > deploy-web.sh
#!/bin/bash
export SERVICE_NAME="smileslip-dashboard"
export REGION="asia-southeast1"

# --- Supabase ---
SB_URL="https://sbgwwxuhzfeflexipgkz.supabase.co"
SB_PUB_KEY="sb_publishable_MaAMwA184SJU9jtF2BSCkg_8ZjmEvkJ"

# --- LINE ---
L_TOKEN="A8KnRecB7fCCpCTQ5KckJSv98Xy53Hq/zLhBSJi4eYPuH4HCOF3cAs22KsFNzjNYD/5RhFCytMZ+eQQwOInzoGuAF02n6HZ4wIJo/LryWPPQ0+C8xQGGRQ7H3vAeXkOAja/IznRwjqq07fihuZosBwdB04t89/1O/w1cDnyilFU="
L_LOGIN_ID="2009797558"
L_LOGIN_SECRET="685a6d7cf9b0411b616ac241a4f43845"

# --- Google ---
G_CLIENT_ID="832247688217-3fgu04nhdj5dfd3iofb1sq8ab7lcib6k.apps.googleusercontent.com"
G_CLIENT_SECRET="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"
G_REDIRECT="https://smileslip-dashboard-832247688217.asia-southeast1.run.app/api/auth/google/callback"

gcloud run deploy \$SERVICE_NAME \\
  --source . \\
  --region \$REGION \\
  --allow-unauthenticated \\
  --clear-base-image \\
  --set-env-vars "NEXT_PUBLIC_SUPABASE_URL=\$SB_URL,NEXT_PUBLIC_SUPABASE_KEY=\$SB_PUB_KEY,SUPABASE_URL=\$SB_URL,SUPABASE_KEY=\$SB_PUB_KEY,LINE_CHANNEL_ACCESS_TOKEN=\$L_TOKEN,LINE_LOGIN_ID=\$L_LOGIN_ID,LINE_LOGIN_SECRET=\$L_LOGIN_SECRET,GOOGLE_CLIENT_ID=\$G_CLIENT_ID,GOOGLE_CLIENT_SECRET=\$G_CLIENT_SECRET,GOOGLE_REDIRECT_URI=\$G_REDIRECT" \\
  --set-build-env-vars "NEXT_PUBLIC_SUPABASE_URL=\$SB_URL,NEXT_PUBLIC_SUPABASE_KEY=\$SB_PUB_KEY"
EOF

chmod +x deploy-web.sh
./deploy-web.sh
# บอกให้ Git รู้ว่าคุณคือใคร
git config --global user.name "Your Name"
git config --global user.email "your-email@example.com"
# เข้าไปในโฟลเดอร์โปรเจกต์ของคุณ
cd /path/to/your/code
# เริ่มต้นสร้างระบบติดตามไฟล์ในโฟลเดอร์นี้
git ini
# กำหนดข้อมูลผู้ใช้ (ใช้อีเมลที่คุณระบุ)
git config --global user.email "smileslip.official@gmail.com"
git config --global user.name "Vespa"
# เชื่อมต่อและส่งโค้ด
git init
git add .
git commit -m "Initialize Smile Slip project structure"
git remote add origin https://github.com/siam2smile/smile-slip.git
git branch -M main
git push -u origin main
git log --oneline
git push -u origin main
cat <<EOT > .gitignore
.cache/
node_modules/
__pycache__/
.env
EOT

# ย้อนกลับมาที่สถานะก่อน Commit (แต่โค้ดยังอยู่ครบ)
git reset --soft HEAD~1
# ลบไฟล์ที่อยู่ใน .cache ออกจากการเตรียมส่ง (Staging)
git rm -r --cached .cache/
# บันทึกไฟล์ที่เหลือ (ซึ่งตอนนี้จะไม่มีไฟล์ใหญ่จาก .cache แล้ว)
git add .
git commit -m "Initialize project and ignore cache files"
# ส่งขึ้น GitHub อีกครั้ง
git push -u origin main
git reset --mixed HEAD~1
cat <<EOT > .gitignore
.cache/
node_modules/
__pycache__/
.env
.pytest_cache/
.vscode/
EOT

git rm -r --cached .
git add .
git commit -m "Smile Slip: Initial clean commit without cache"
git push -u origin main --force
rm -rf .git
git init
cat <<EOT > .gitignore
.cache/
node_modules/
__pycache__/
.env
EOT

git add .
git commit -m "Smile Slip: Clean start with only source code"
git remote add origin https://github.com/siam2smile/smile-slip.git
git push -u origin main --force
git branch -M main
git add .
git commit -m "Smile Slip: Final clean push"
git push -u origin main --force
# พิมพ์คำสั่งนี้เพื่อสร้างไฟล์เก็บความลับ
cat <<EOT > .env
SUPABASE_URL=your_url_here
SUPABASE_KEY=your_key_here
DATABASE_URL=your_db_url
EOT

echo ".env" >> .gitignore
git rm -r --cached .
git add .
git commit -m "Smile Slip: Secure code by removing secrets"
git push origin main
cat <<EOT > .env
# ใส่รหัสของคุณตรงนี้
SUPABASE_URL=ของคุณ
SUPABASE_KEY=ของคุณ
DB_PASSWORD=ของคุณ
EOT

import os
# แทนที่จะเขียนรหัสตรงๆ ให้ใช้แบบนี้ครับ
supabase_url = os.getenv("SUPABASE_URL")
supabase_key = os.getenv("SUPABASE_KEY")
