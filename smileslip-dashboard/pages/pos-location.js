import { useState, useEffect } from 'react';
import Head from 'next/head';

export default function PosLocation() {
  const [orderNo, setOrderNo] = useState('');
  const [shopId, setShopId] = useState('');
  const [mapsLink, setMapsLink] = useState('');
  const [locating, setLocating] = useState(false);
  const [saving, setSaving] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    const p = new URLSearchParams(window.location.search);
    setOrderNo(p.get('order_no') || '');
    setShopId(p.get('shopId') || '');
  }, []);

  async function getCurrentLocation() {
    if (!navigator.geolocation) { setError('Browser ไม่รองรับ GPS'); return; }
    setLocating(true);
    setError('');
    navigator.geolocation.getCurrentPosition(
      pos => {
        const { latitude, longitude } = pos.coords;
        setMapsLink(`https://www.google.com/maps?q=${latitude},${longitude}`);
        setLocating(false);
      },
      () => { setError('ไม่สามารถรับพิกัดได้ — ลองวางลิงก์ Maps เอง'); setLocating(false); }
    );
  }

  async function saveLocation() {
    if (!mapsLink.trim() || !orderNo || !shopId || saving) return;
    setSaving(true);
    setError('');
    try {
      const r = await fetch('/api/pos/delivery', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ shopId, order_no: orderNo, maps_link: mapsLink.trim(), status: 'กำลังส่ง' }),
      });
      const d = await r.json();
      if (d.ok) setDone(true);
      else setError(d.error || 'เกิดข้อผิดพลาด');
    } catch (err) { setError(err.message); }
    setSaving(false);
  }

  return (
    <>
      <Head><title>บันทึกพิกัดส่ง — Smile Slip POS</title></Head>
      <div style={{ minHeight: '100vh', background: '#111827', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '16px' }}>
        <div style={{ background: '#1f2937', borderRadius: '16px', padding: '24px', width: '100%', maxWidth: '400px', border: '1px solid #374151' }}>
          <div style={{ textAlign: 'center', marginBottom: '20px' }}>
            <div style={{ fontSize: '40px', marginBottom: '8px' }}>📍</div>
            <h1 style={{ color: '#fff', fontSize: '18px', fontWeight: 'bold', margin: '0 0 4px' }}>บันทึกพิกัดส่งสินค้า</h1>
            {orderNo && <div style={{ color: '#6b7280', fontSize: '12px', fontFamily: 'monospace' }}>{orderNo}</div>}
          </div>

          {done ? (
            <div style={{ textAlign: 'center' }}>
              <div style={{ fontSize: '48px', marginBottom: '12px' }}>✅</div>
              <p style={{ color: '#4ade80', fontWeight: 'bold', marginBottom: '16px' }}>บันทึกพิกัดเรียบร้อย</p>
              {mapsLink && (
                <a href={mapsLink} target="_blank" rel="noreferrer"
                  style={{ display: 'inline-block', background: '#22c55e', color: '#fff', padding: '12px 24px', borderRadius: '12px', textDecoration: 'none', fontWeight: 'bold', fontSize: '14px' }}>
                  🗺️ เปิด Google Maps
                </a>
              )}
            </div>
          ) : (
            <div>
              <button
                onClick={getCurrentLocation}
                disabled={locating}
                style={{ width: '100%', background: '#1d4ed8', color: '#fff', border: 'none', borderRadius: '12px', padding: '14px', fontSize: '15px', fontWeight: 'bold', cursor: 'pointer', marginBottom: '12px', opacity: locating ? 0.6 : 1 }}>
                {locating ? '⏳ กำลังรับพิกัด...' : '📍 รับพิกัดปัจจุบัน (GPS)'}
              </button>

              <div style={{ color: '#6b7280', textAlign: 'center', fontSize: '12px', marginBottom: '12px' }}>— หรือ —</div>

              <div style={{ marginBottom: '16px' }}>
                <label style={{ color: '#9ca3af', fontSize: '12px', display: 'block', marginBottom: '6px' }}>วางลิงก์ Google Maps</label>
                <input
                  value={mapsLink}
                  onChange={e => setMapsLink(e.target.value)}
                  placeholder="https://maps.app.goo.gl/..."
                  style={{ width: '100%', background: '#374151', color: '#fff', border: '1px solid #4b5563', borderRadius: '8px', padding: '10px 12px', fontSize: '13px', boxSizing: 'border-box' }}
                />
              </div>

              {error && <div style={{ color: '#f87171', fontSize: '12px', marginBottom: '12px', textAlign: 'center' }}>{error}</div>}

              <button
                onClick={saveLocation}
                disabled={saving || !mapsLink.trim()}
                style={{ width: '100%', background: mapsLink.trim() ? '#16a34a' : '#374151', color: '#fff', border: 'none', borderRadius: '12px', padding: '14px', fontSize: '15px', fontWeight: 'bold', cursor: mapsLink.trim() ? 'pointer' : 'default', opacity: saving ? 0.6 : 1 }}>
                {saving ? 'กำลังบันทึก...' : '✅ บันทึกพิกัด'}
              </button>
            </div>
          )}
        </div>
      </div>
    </>
  );
}
