import React from 'react';
import Link from 'next/link';
import Head from 'next/head';

export default function PrivacyPolicy() {
  return (
    <div className="min-h-screen bg-slate-50 text-slate-800 font-sans antialiased">
      <Head>
        <title>นโยบายความเป็นส่วนตัว (Privacy Policy) | Smile Slip Pro</title>
        <meta name="description" content="นโยบายความเป็นส่วนตัวของ Smile Slip Pro ตามพระราชบัญญัติคุ้มครองข้อมูลส่วนบุคคล พ.ศ. 2562 (PDPA)" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
      </Head>

      <header className="bg-white border-b border-slate-200 sticky top-0 z-50">
        <div className="max-w-4xl mx-auto px-6 h-16 flex items-center justify-between">
          <span className="text-xl font-bold tracking-tight text-indigo-600">
            😊 Smile Slip <span className="text-slate-900 font-medium text-lg">Pro</span>
          </span>
          <button onClick={() => window.history.back()} className="text-sm font-semibold text-indigo-600 hover:text-indigo-500 transition-colors">
            ← กลับ
          </button>
        </div>
      </header>

      <main className="max-w-4xl mx-auto px-4 py-12 md:py-16">
        <div className="bg-white rounded-2xl shadow-sm border border-slate-200 p-6 md:p-12">

          <div className="border-b border-slate-100 pb-6 mb-8">
            <h1 className="text-2xl md:text-3xl font-black text-slate-950 mb-3 tracking-tight">
              นโยบายความเป็นส่วนตัว (Privacy Policy)
            </h1>
            <p className="text-sm text-slate-400">มีผลบังคับใช้ ณ วันที่ 3 มิถุนายน 2569 | เวอร์ชัน 1.1.0</p>
          </div>

          {/* ผู้ควบคุมข้อมูลส่วนบุคคล */}
          <div className="bg-slate-50 rounded-xl p-5 border border-slate-200 mb-6 text-sm text-slate-600 space-y-1">
            <p className="font-bold text-slate-800">ผู้ควบคุมข้อมูลส่วนบุคคล (Data Controller)</p>
            <p>บริษัท สยาม โกลบอล เน็ทเวิร์ค เอ็นเตอร์ไพรส์ จำกัด</p>
            <p>เลขทะเบียนนิติบุคคล: 0505565019236</p>
            <p>76 หมู่ 9 ต.หางดง อ.หางดง จ.เชียงใหม่ 50230</p>
            <p>อีเมล: <a href="mailto:smileslip.official@gmail.com" className="underline hover:text-slate-800">smileslip.official@gmail.com</a></p>
          </div>

          <div className="bg-emerald-50/60 rounded-xl p-5 border border-emerald-100/80 mb-8">
            <p className="text-slate-600 leading-relaxed text-sm md:text-base">
              แพลตฟอร์ม <strong>Smile Slip Pro</strong> ให้ความสำคัญกับการคุ้มครองข้อมูลส่วนบุคคลตาม
              พระราชบัญญัติคุ้มครองข้อมูลส่วนบุคคล พ.ศ. 2562 (PDPA) โดยมีรายละเอียดดังนี้:
            </p>
          </div>

          <div className="space-y-8">

            <section className="flex items-start">
              <div className="flex-shrink-0 bg-emerald-600 text-white font-mono font-bold rounded-lg w-8 h-8 flex items-center justify-center text-sm mr-4 shadow-sm">1</div>
              <div className="space-y-2">
                <h2 className="text-lg font-bold text-slate-900 tracking-tight">ข้อมูลที่เราประมวลผล</h2>
                <div className="text-slate-600 leading-relaxed text-sm md:text-base space-y-2">
                  <p>
                    <strong>ข้อมูลร้านค้า (เก็บใน Database ของเรา):</strong> ชื่อร้านค้า, LINE User ID,
                    อีเมล, เบอร์โทรศัพท์, ที่อยู่, ข้อมูลบัญชีธนาคาร, ยอดเครดิตคงเหลือ
                  </p>
                  <p>
                    <strong>ข้อมูลธุรกรรม (ประมวลผลชั่วคราว ไม่เก็บใน Database ของเรา):</strong> ข้อมูลในรูปสลิป
                    เช่น ชื่อผู้โอน, ยอดเงิน, วันที่ โดยระบบจะประมวลผลผ่าน AI แล้วบันทึกลง Google Drive
                    และ Google Sheets ของร้านค้าโดยตรง เพื่อให้เจ้าของข้อมูลควบคุมได้เอง (PDPA-by-design)
                  </p>
                  <p>
                    <strong>ข้อมูลการชำระเงิน:</strong> ดำเนินการผ่าน Stripe โดยตรง เราไม่เก็บข้อมูลบัตรเครดิต/เดบิตใดๆ
                  </p>
                </div>
              </div>
            </section>

            <section className="flex items-start">
              <div className="flex-shrink-0 bg-emerald-600 text-white font-mono font-bold rounded-lg w-8 h-8 flex items-center justify-center text-sm mr-4 shadow-sm">2</div>
              <div className="space-y-2">
                <h2 className="text-lg font-bold text-slate-900 tracking-tight">วัตถุประสงค์และฐานทางกฎหมายในการประมวลผล</h2>
                <div className="text-slate-600 leading-relaxed text-sm md:text-base space-y-2">
                  <p>
                    <strong>เพื่อปฏิบัติตามสัญญา (Contract):</strong> ให้บริการตรวจสอบสลิป
                    บันทึกข้อมูลลง Google Sheets/Drive ของท่าน และบริหารจัดการเครดิต
                  </p>
                  <p>
                    <strong>ประโยชน์โดยชอบด้วยกฎหมาย (Legitimate Interest):</strong> ป้องกันการทุจริต
                    ตรวจสอบความถูกต้องของ Webhook และรักษาความปลอดภัยของระบบ
                  </p>
                  <p>
                    <strong>การยินยอม (Consent):</strong> การส่งการแจ้งเตือนผ่าน LINE เกี่ยวกับการอัปเดตบริการ
                  </p>
                </div>
              </div>
            </section>

            <section className="flex items-start">
              <div className="flex-shrink-0 bg-emerald-600 text-white font-mono font-bold rounded-lg w-8 h-8 flex items-center justify-center text-sm mr-4 shadow-sm">3</div>
              <div className="space-y-2">
                <h2 className="text-lg font-bold text-slate-900 tracking-tight">การส่งข้อมูลให้บุคคลที่สาม</h2>
                <div className="text-slate-600 leading-relaxed text-sm md:text-base space-y-2">
                  <p>เราส่งข้อมูลให้ผู้ให้บริการภายนอก (Processors) เพื่อการดำเนินงาน ดังนี้:</p>
                  <ul className="list-disc list-inside space-y-1 pl-2">
                    <li><strong>Google LLC (สหรัฐอเมริกา)</strong> — Google Drive, Sheets (จัดเก็บข้อมูลธุรกรรมของท่าน), Gemini AI (OCR), Cloud Run (Hosting)</li>
                    <li><strong>Stripe, Inc. (สหรัฐอเมริกา)</strong> — ประมวลผลการชำระเงิน</li>
                    <li><strong>LINE Corporation (ญี่ปุ่น)</strong> — แพลตฟอร์มสื่อสารสำหรับรับส่งสลิปและแจ้งเตือน</li>
                    <li><strong>Supabase, Inc. (สหรัฐอเมริกา)</strong> — ฐานข้อมูลสำหรับข้อมูลร้านค้าและเครดิต (ไม่รวมข้อมูลธุรกรรม)</li>
                  </ul>
                  <p className="text-xs text-slate-400">ผู้ให้บริการทั้งหมดผ่านมาตรฐานความปลอดภัยระดับสากล (ISO 27001 / SOC 2)</p>
                </div>
              </div>
            </section>

            <section className="flex items-start">
              <div className="flex-shrink-0 bg-emerald-600 text-white font-mono font-bold rounded-lg w-8 h-8 flex items-center justify-center text-sm mr-4 shadow-sm">4</div>
              <div className="space-y-2">
                <h2 className="text-lg font-bold text-slate-900 tracking-tight">ระยะเวลาในการเก็บข้อมูล (Data Retention)</h2>
                <div className="text-slate-600 leading-relaxed text-sm md:text-base space-y-1">
                  <p><strong>ข้อมูลร้านค้า:</strong> เก็บตลอดอายุบัญชี และลบภายใน 90 วันหลังปิดบัญชี</p>
                  <p><strong>ข้อมูลธุรกรรม (สลิป):</strong> เก็บใน Google Drive/Sheets ของท่านเอง ท่านเป็นผู้ควบคุมและลบได้โดยตรง</p>
                  <p><strong>ประวัติการชำระเงิน:</strong> เก็บไว้ 7 ปีตามกฎหมายบัญชีไทย</p>
                  <p><strong>Log การใช้งาน:</strong> เก็บไว้ 90 วันเพื่อวัตถุประสงค์ด้านความปลอดภัย</p>
                </div>
              </div>
            </section>

            <section className="flex items-start">
              <div className="flex-shrink-0 bg-emerald-600 text-white font-mono font-bold rounded-lg w-8 h-8 flex items-center justify-center text-sm mr-4 shadow-sm">5</div>
              <div className="space-y-2">
                <h2 className="text-lg font-bold text-slate-900 tracking-tight">มาตรการรักษาความปลอดภัยและความลับ</h2>
                <p className="text-slate-600 leading-relaxed text-sm md:text-base">
                  ผู้ให้บริการขอสัญญาว่าจะ <strong>ไม่มีการนำข้อมูลธุรกรรมทางการเงิน หรือข้อมูลส่วนบุคคลของลูกค้าไปจำหน่าย
                  แจกจ่าย หรือเผยแพร่ให้แก่บุคคลภายนอกโดยเด็ดขาด</strong> นอกเหนือจากที่ระบุในข้อ 3
                  ข้อมูลที่อยู่ใน Database ของเราจะถูกเข้ารหัสและรักษาความปลอดภัยบนคลาวด์เซิร์ฟเวอร์ที่ได้มาตรฐานสากล
                </p>
              </div>
            </section>

            <section className="flex items-start">
              <div className="flex-shrink-0 bg-emerald-600 text-white font-mono font-bold rounded-lg w-8 h-8 flex items-center justify-center text-sm mr-4 shadow-sm">6</div>
              <div className="space-y-2">
                <h2 className="text-lg font-bold text-slate-900 tracking-tight">สิทธิ์ของเจ้าของข้อมูล (PDPA มาตรา 30–36)</h2>
                <div className="text-slate-600 leading-relaxed text-sm md:text-base space-y-2">
                  <p>ท่านมีสิทธิ์ดังต่อไปนี้ สามารถใช้สิทธิ์ได้ผ่านหน้า Dashboard หรือติดต่อ DPO ทางอีเมล:</p>
                  <ul className="list-disc list-inside space-y-1 pl-2">
                    <li><strong>สิทธิ์ขอเข้าถึงข้อมูล (Access)</strong> — ตรวจสอบข้อมูลที่เราเก็บได้</li>
                    <li><strong>สิทธิ์ขอแก้ไข (Rectification)</strong> — แก้ไขข้อมูลที่ไม่ถูกต้อง</li>
                    <li><strong>สิทธิ์ขอลบ (Erasure)</strong> — ขอให้ลบข้อมูลออกจากระบบ</li>
                    <li><strong>สิทธิ์ขอระงับการใช้ (Restriction)</strong> — ระงับการประมวลผลชั่วคราว</li>
                    <li><strong>สิทธิ์คัดค้าน (Objection)</strong> — คัดค้านการประมวลผลในบางกรณี</li>
                    <li><strong>สิทธิ์โอนย้ายข้อมูล (Portability)</strong> — ขอรับข้อมูลในรูปแบบที่อ่านได้</li>
                    <li><strong>สิทธิ์ถอนความยินยอม (Withdraw Consent)</strong> — ถอนความยินยอมได้ตลอดเวลา โดยไม่กระทบสิทธิ์การประมวลผลที่ทำไปแล้ว</li>
                  </ul>
                </div>
              </div>
            </section>

            <section className="flex items-start">
              <div className="flex-shrink-0 bg-emerald-600 text-white font-mono font-bold rounded-lg w-8 h-8 flex items-center justify-center text-sm mr-4 shadow-sm">7</div>
              <div className="space-y-2">
                <h2 className="text-lg font-bold text-slate-900 tracking-tight">การใช้คุกกี้ (Cookies)</h2>
                <p className="text-slate-600 leading-relaxed text-sm md:text-base">
                  แดชบอร์ดของเราใช้ Session Cookie เพื่อรักษาสถานะการเข้าสู่ระบบเท่านั้น
                  เราไม่ใช้ Cookie เพื่อติดตามพฤติกรรมการท่องเว็บหรือการโฆษณา
                  ท่านสามารถปิด Cookie ในเบราว์เซอร์ได้ แต่อาจส่งผลให้ใช้งานแดชบอร์ดไม่ได้
                </p>
              </div>
            </section>

            <section className="flex items-start">
              <div className="flex-shrink-0 bg-emerald-600 text-white font-mono font-bold rounded-lg w-8 h-8 flex items-center justify-center text-sm mr-4 shadow-sm">8</div>
              <div className="space-y-2">
                <h2 className="text-lg font-bold text-slate-900 tracking-tight">ติดต่อเจ้าหน้าที่คุ้มครองข้อมูล (DPO)</h2>
                <div className="text-slate-600 leading-relaxed text-sm md:text-base space-y-1">
                  <p>หากต้องการใช้สิทธิ์ตาม PDPA หรือมีข้อสงสัยเกี่ยวกับการจัดการข้อมูล สามารถติดต่อได้ที่:</p>
                  <p><strong>อีเมล:</strong> <a href="mailto:smileslip.official@gmail.com" className="underline hover:text-slate-800">smileslip.official@gmail.com</a></p>
                  <p><strong>บริษัท:</strong> สยาม โกลบอล เน็ทเวิร์ค เอ็นเตอร์ไพรส์ จำกัด</p>
                  <p><strong>ที่อยู่:</strong> 76 หมู่ 9 ต.หางดง อ.หางดง จ.เชียงใหม่ 50230</p>
                  <p className="text-xs text-slate-400 mt-2">เราจะตอบกลับคำขอของท่านภายใน 30 วันนับจากวันที่ได้รับคำขอ</p>
                </div>
              </div>
            </section>

          </div>

          <div className="mt-12 pt-8 border-t border-slate-100 flex flex-col sm:flex-row items-center justify-between gap-4">
            <div className="text-xs text-slate-400 text-center sm:text-left max-w-md">
              นโยบายนี้จัดทำให้สอดคล้องกับ PDPA พ.ศ. 2562 หากมีข้อสงสัยติดต่อ{' '}
              <a href="mailto:smileslip.official@gmail.com" className="underline hover:text-slate-600">smileslip.official@gmail.com</a>
            </div>
            <button
              onClick={() => window.history.back()}
              className="w-full sm:w-auto inline-flex items-center justify-center px-6 py-3 bg-slate-900 text-white text-sm font-bold rounded-xl shadow-sm hover:bg-slate-800 transition-all active:scale-[0.98] focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-slate-900"
            >
              รับทราบและยอมรับนโยบาย
            </button>
          </div>

        </div>
      </main>
    </div>
  );
}
