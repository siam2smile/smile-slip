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
          <span className="text-xl font-bold tracking-tight text-blue-700">
            😊 Smile Slip <span className="text-slate-900 font-medium text-lg">Pro</span>
          </span>
          <button onClick={() => window.history.back()} className="text-sm font-semibold text-blue-700 hover:text-blue-600 transition-colors">
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
            <p className="text-sm text-slate-400">มีผลบังคับใช้ ณ วันที่ 16 สิงหาคม 2569 | เวอร์ชัน 2.0.0</p>
          </div>

          {/* ผู้ควบคุมข้อมูลส่วนบุคคล */}
          <div className="bg-slate-50 rounded-xl p-5 border border-slate-200 mb-4 text-sm text-slate-600 space-y-1">
            <p className="font-bold text-slate-800">ผู้ควบคุมข้อมูลส่วนบุคคล (Data Controller)</p>
            <p>บริษัท สยาม โกลบอล เน็ทเวิร์ค เอ็นเตอร์ไพรส์ จำกัด</p>
            <p>เลขทะเบียนนิติบุคคล: 0505565019236</p>
            <p>76 หมู่ 9 ต.หางดง อ.หางดง จ.เชียงใหม่ 50230</p>
            <p>อีเมล: <a href="mailto:smileslip.official@gmail.com" className="underline hover:text-slate-800">smileslip.official@gmail.com</a></p>
          </div>

          <div className="bg-amber-50/60 rounded-xl p-5 border border-amber-100/80 mb-4 text-sm text-slate-600 space-y-2">
            <p className="font-bold text-slate-800">บทบาทของเราต่อข้อมูลแต่ละประเภท (Controller vs Processor)</p>
            <p>
              สำหรับ <strong>ข้อมูลของร้านค้าที่สมัครใช้บริการกับเราโดยตรง</strong> (เช่น ชื่อร้าน อีเมล
              บัญชีธนาคาร แพ็กเกจที่ใช้งาน) เราเป็น <strong>ผู้ควบคุมข้อมูล (Data Controller)</strong> ตามปกติ
            </p>
            <p>
              สำหรับ <strong>ข้อมูลสมาชิกร้านค้า/ผู้ติดต่อของร้านค้า</strong> (ชื่อ เบอร์โทร ที่อยู่ ที่ลูกค้าปลายทางให้ไว้กับร้านค้าโดยตรงเพื่อสมัครเป็นสมาชิก)
              และ <strong>ข้อมูลธุรกรรมทางธุรกิจของร้านค้า</strong> (ยอดขาย สต็อกสินค้า บัญชี พนักงาน) เราทำหน้าที่เป็นเพียง
              <strong> ผู้ประมวลผลข้อมูล (Data Processor)</strong> ที่รับจ้างเก็บรักษาข้อมูลแทนร้านค้าเท่านั้น
              ร้านค้าที่ใช้บริการของเรายังคงเป็นผู้ควบคุมข้อมูล (Data Controller) สำหรับข้อมูลลูกค้า/ธุรกรรมของร้านตนเอง
              เราไม่ใช่เจ้าของข้อมูลเหล่านี้ ไม่นำไปใช้เพื่อวัตถุประสงค์อื่นนอกเหนือจากการให้บริการตามที่ร้านค้าว่าจ้าง
              และเก็บรักษาความปลอดภัยผ่านระบบมาตรฐานสากลของผู้ให้บริการฐานข้อมูลที่เราใช้งาน (ดูข้อ 3)
            </p>
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
                    <strong>ข้อมูลร้านค้าที่สมัครใช้บริการ (เก็บใน Database ของเรา):</strong> ชื่อร้านค้า, LINE User ID,
                    อีเมล, เบอร์โทรศัพท์, ที่อยู่, ข้อมูลบัญชีธนาคาร, ยอดเครดิตคงเหลือ, แพ็กเกจที่ใช้งาน
                  </p>
                  <p>
                    <strong>ข้อมูลผู้ดูแลระบบ/พนักงานของร้าน:</strong> หากเจ้าของร้านมอบสิทธิ์ให้พนักงานเป็นผู้ดูแลระบบหรือใช้งานระบบขายหน้าร้าน (POS)
                    เราจะเก็บ LINE User ID, ชื่อที่แสดง, เบอร์โทร และรหัสยืนยันตัวตน (เข้ารหัสแล้ว) ของพนักงานคนนั้นไว้
                    เพื่อยืนยันสิทธิ์การทำรายการ — สำหรับพนักงานที่ร้านค้าเปิดใช้ระบบเงินเดือน เราอาจเก็บเลขบัตรประชาชนและ
                    อัตราเงินเดือนเพิ่มเติมตามที่ร้านค้ากรอกเข้าระบบด้วย
                  </p>
                  <p>
                    <strong>ข้อมูลสมาชิกร้านค้า/ผู้ติดต่อของร้าน:</strong> หากร้านค้าใช้ระบบ POS ของเรา ร้านค้าสามารถบันทึกข้อมูล
                    ลูกค้า/ผู้จำหน่ายของตนเอง (ชื่อ เบอร์โทร ที่อยู่) ไว้ในระบบได้ — ข้อมูลนี้เป็นข้อมูลที่ <strong>ลูกค้าปลายทางให้ไว้กับร้านค้าโดยตรง</strong>
                    ด้วยความยินยอมเพื่อให้ร้านค้านำไปใช้บริหารจัดการ/การตลาดของร้านค้าเอง เราเก็บรักษาข้อมูลนี้แทนร้านค้าในฐานะผู้ประมวลผลข้อมูลเท่านั้น
                    (ดูรายละเอียดบทบาทด้านบน) ไม่นำไปใช้เพื่อวัตถุประสงค์อื่น และไม่นำไปรวม/เปรียบเทียบกับข้อมูลของร้านค้าอื่น
                  </p>
                  <p>
                    <strong>ข้อมูลธุรกรรมทางธุรกิจ (ยอดขาย/สต็อกสินค้า/บัญชี):</strong> เมื่อร้านค้าใช้ระบบขายหน้าร้าน ระบบบัญชี
                    หรือบันทึกรายรับ-รายจ่าย ข้อมูลธุรกรรมเหล่านี้ (เช่น รายการสินค้าที่ขาย ยอดขาย ยอดค้างชำระ) จะถูกบันทึกไว้ใน
                    ฐานข้อมูลของเราโดยตรง เพื่อให้บริการด้านบัญชี รายงานภาษี และการกระทบยอดแก่ร้านค้าได้อย่างสมบูรณ์
                    <strong> เราไม่นำข้อมูลธุรกรรมของร้านค้าไปจำหน่ายหรือเปิดเผยต่อบุคคลภายนอกเด็ดขาด</strong>
                  </p>
                  <p>
                    <strong>ข้อมูลจากสลิปโอนเงิน (ชื่อผู้โอน):</strong> เมื่อร้านค้าส่งรูปสลิปโอนเงินเข้าระบบเพื่อบันทึกบัญชี
                    ระบบ AI จะอ่านข้อมูลบนสลิป (เช่น ชื่อผู้โอน ยอดเงิน วันที่) เพื่อช่วยร้านค้าบันทึกรายรับ-รายจ่ายให้ถูกต้อง —
                    <strong> ชื่อผู้โอนเป็นข้อมูลของบุคคลภายนอกที่ไม่ได้เป็นผู้ใช้บริการหรือสมาชิกของเรา และไม่เคยให้ความยินยอมกับเราโดยตรง</strong>
                    เราเก็บข้อมูลนี้เท่าที่จำเป็นเพื่อช่วยร้านค้ากระทบยอดบัญชีเท่านั้น จะไม่นำไปใช้เพื่อการตลาดกับบุคคลนั้น
                    และจะไม่เปิดเผย/ขายให้บุคคลที่สามในรูปแบบที่ระบุตัวตนได้เด็ดขาด — หากนำไปใช้ในเชิงสถิติ/แนวโน้ม
                    (ดูข้อ 8) เราจะใช้เฉพาะข้อมูลที่ผ่านการเข้ารหัสแบบย้อนกลับไม่ได้แล้วเท่านั้น
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
                    <strong>เพื่อปฏิบัติตามสัญญา (Contract):</strong> ให้บริการตรวจสอบสลิป ระบบขายหน้าร้าน (POS)
                    บัญชี รายงานภาษี และฟีเจอร์อื่นตามแพ็กเกจที่ท่านสมัคร รวมถึงบริหารจัดการเครดิตของท่าน
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
                    <li><strong>Google LLC (สหรัฐอเมริกา)</strong> — Google Drive (จัดเก็บรูปสลิป/ใบเสร็จที่ท่านอัปโหลด — ท่านควบคุมโฟลเดอร์นี้ได้เอง), Google Sheets (สำหรับบัญชีที่เคยเชื่อมต่อไว้ก่อนหน้า อาจยังมีสำเนาข้อมูลเก่าอยู่ในชีทของท่านเอง), Gemini AI (อ่านข้อมูลจากรูปสลิปด้วย AI), Cloud Run (โฮสต์ระบบ)</li>
                    <li><strong>Stripe, Inc. (สหรัฐอเมริกา)</strong> — ประมวลผลการชำระเงิน</li>
                    <li><strong>LINE Corporation (ญี่ปุ่น)</strong> — แพลตฟอร์มสื่อสารสำหรับรับส่งสลิปและแจ้งเตือน</li>
                    <li><strong>Supabase, Inc. (สหรัฐอเมริกา)</strong> — ฐานข้อมูลหลักของระบบ เก็บข้อมูลร้านค้า เครดิต และข้อมูลธุรกรรมทางธุรกิจ (ยอดขาย สต็อกสินค้า บัญชี สมาชิกร้านค้า) เพื่อให้บริการระบบบัญชี/POS แบบครบวงจร (ดูบทบาท Controller/Processor ด้านบน)</li>
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
                  <p><strong>ข้อมูลร้านค้า/สมาชิกร้าน/ธุรกรรมทางธุรกิจ:</strong> เก็บไว้ในฐานข้อมูลของเราตลอดระยะเวลาที่ร้านค้าใช้บริการ
                    เพื่อให้บริการรายงานย้อนหลัง/บัญชี/ภาษี — ร้านค้าสามารถลบข้อมูลผู้ติดต่อ/พนักงานแต่ละรายได้เองตลอดเวลาผ่านระบบ
                    เมื่อร้านค้ากด "ลบร้าน" ผ่านเมนูตั้งค่า (ต้องยืนยันตัวตนก่อนดำเนินการ) ระบบจะยกเลิกการสมัครสมาชิก/หยุดเรียกเก็บเงินทันที
                    และปิดการเข้าถึงร้านนั้นทันที แต่จะยัง<strong>เก็บข้อมูลไว้ต่ออีก 6 เดือน</strong>ก่อนลบถาวรจริง —
                    ในช่วง 6 เดือนนี้ ถ้าเจ้าของบัญชี LINE เดิมสมัครใหม่ ระบบจะถามว่าต้องการกู้คืนข้อมูลเดิมหรือเริ่มระบบใหม่ทั้งหมด —
                    หลังพ้น 6 เดือนแล้วข้อมูลจะถูกลบถาวรโดยอัตโนมัติ กู้คืนไม่ได้อีกต่อไป
                    (ยกเว้นบันทึกว่าบัญชี LINE นี้เคยใช้สิทธิ์ทดลองใช้ฟรีไปแล้ว เพื่อป้องกันการสมัครซ้ำเพื่อรับสิทธิ์ทดลองฟรีไม่จำกัดรอบ — บันทึกนี้อยู่ถาวรแยกจากข้อมูลร้านค้า)</p>
                  <p><strong>รูปสลิป/ใบเสร็จ:</strong> เก็บใน Google Drive ของท่านเอง ท่านเป็นผู้ควบคุมและลบได้โดยตรง</p>
                  <p><strong>ข้อมูล Pattern การใช้งานแบบ Anonymized (ดูข้อ 8):</strong> เก็บไว้ตลอดอายุบัญชีเพื่อแสดงแนวโน้มย้อนหลัง และลบตามกำหนดเวลาเดียวกับข้อมูลร้านค้าด้านบน</p>
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
                <h2 className="text-lg font-bold text-slate-900 tracking-tight">การใช้คุกกี้และการเก็บข้อมูลในเบราว์เซอร์</h2>
                <p className="text-slate-600 leading-relaxed text-sm md:text-base">
                  แดชบอร์ดของเรา<strong>ไม่ใช้ Cookie</strong> ในการรักษาสถานะการเข้าสู่ระบบ แต่ใช้ Local Storage/Session Storage
                  ของเบราว์เซอร์ท่านเองในการเก็บ token ยืนยันตัวตนหลัง login ชั่วคราว (ข้อมูลอยู่ในเครื่องของท่าน ไม่ถูกส่งไปที่อื่น
                  นอกจากใช้แนบยืนยันตัวตนตอนเรียกใช้ระบบของเรา) เราไม่ใช้กลไกเหล่านี้เพื่อติดตามพฤติกรรมการท่องเว็บหรือการโฆษณา
                  ท่านสามารถล้างข้อมูลนี้ได้เองผ่านการ "ออกจากระบบ" หรือล้างข้อมูลเว็บไซต์ในเบราว์เซอร์ แต่จะทำให้ต้องเข้าสู่ระบบใหม่
                  ทั้งนี้บริการภายนอกที่ฝังอยู่ในหน้าเว็บของเรา (เช่น LINE LIFF SDK สำหรับ login ผ่าน LINE) อาจตั้งค่า Cookie ของตัวเอง
                  ตามนโยบายของผู้ให้บริการนั้นๆ ซึ่งอยู่นอกเหนือการควบคุมโดยตรงของเรา
                </p>
              </div>
            </section>

            <section className="flex items-start">
              <div className="flex-shrink-0 bg-emerald-600 text-white font-mono font-bold rounded-lg w-8 h-8 flex items-center justify-center text-sm mr-4 shadow-sm">8</div>
              <div className="space-y-2">
                <h2 className="text-lg font-bold text-slate-900 tracking-tight">ข้อมูล Pattern การใช้งาน (Anonymized Analytics)</h2>
                <div className="text-slate-600 leading-relaxed text-sm md:text-base space-y-2">
                  <p>
                    เราเก็บข้อมูล pattern การใช้งานของร้านค้า เช่น ช่วงเวลาที่มีรายการเข้า ประเภทการชำระเงิน
                    และยอดรวมรายเดือน <strong>โดยไม่เก็บข้อมูลส่วนบุคคลของผู้โอนเงิน</strong>
                  </p>
                  <p>ข้อมูลทั้งหมดถูก anonymized ก่อนนำไปใช้ โดยมีมาตรการดังนี้:</p>
                  <ul className="list-disc list-inside space-y-1 pl-2">
                    <li>ชื่อผู้โอน — แปลงเป็น SHA-256 hash ย้อนกลับไม่ได้ก่อนบันทึก</li>
                    <li>ยอดเงิน — เก็บเป็น range bucket เท่านั้น (เช่น "500–2,000 บาท") ไม่เก็บยอดจริง</li>
                    <li>ข้อมูลไม่สามารถนำไปใช้ระบุตัวตนผู้โอนได้ในทุกกรณี</li>
                  </ul>
                  <p>
                    <strong>วัตถุประสงค์การใช้งาน:</strong> นอกจากใช้ปรับปรุงบริการของเราเองแล้ว ข้อมูลที่ anonymized แล้วนี้
                    จะถูกนำไปประมวลผลเป็นฟีเจอร์ "Marketing Intelligence" (เช่น Peak Time Heatmap, การจัดกลุ่มพฤติกรรมลูกค้า
                    แบบ RFM) เพื่อแสดงผลให้แก่ <strong>เจ้าของร้านค้า (เฉพาะแพ็กเกจ Enterprise)</strong> ใช้ประกอบการวางแผนธุรกิจของร้านนั้นๆ เท่านั้น
                  </p>
                  <p>
                    <strong>กรณีร้านค้ามีหลายสาขา:</strong> หากเจ้าของร้านกำหนดให้หลายสาขาอยู่ในแบรนด์เดียวกัน
                    ระบบจะรวมข้อมูล pattern ของลูกค้า (ที่ผ่านการ hash แล้ว) จากสาขาเหล่านั้นเข้าด้วยกัน เพื่อให้เห็นภาพรวม
                    ความสัมพันธ์กับลูกค้าทั้งแบรนด์ — การรวมข้อมูลนี้เกิดขึ้น<strong>ภายในร้านค้าเดียวกันเท่านั้น</strong>
                    เราไม่นำข้อมูลของร้านค้าหนึ่งไปรวมหรือเปรียบเทียบกับร้านค้าอื่นที่ไม่เกี่ยวข้องกัน
                  </p>
                  <p>ข้อมูล analytics จะไม่ถูกเปิดเผยแก่บุคคลที่สามรายอื่นนอกเหนือจากที่ระบุไว้ในข้อนี้</p>
                  <p>
                    <strong>หมายเหตุ:</strong> ฟีเจอร์นี้ (ข้อ 8) แยกต่างหากจากฟีเจอร์ "Customer 360 / วิเคราะห์กลุ่มลูกค้าสมาชิกร้าน"
                    ที่ใช้ข้อมูลสมาชิกร้านค้าที่ระบุตัวตนได้จริง (ชื่อ/เบอร์โทรจริงตามที่อธิบายไว้ในข้อ 1) — ฟีเจอร์หลังนี้ใช้ข้อมูล
                    สมาชิกที่ลูกค้าให้ไว้กับร้านค้าโดยตรงเท่านั้น (ไม่ใช้ชื่อผู้โอนจากสลิป) แสดงผลเฉพาะแก่<strong>เจ้าของร้านค้านั้นๆ</strong>
                    เพื่อดูข้อมูลลูกค้าของร้านตนเองเท่านั้น ไม่มีการนำไปรวม/เปรียบเทียบข้ามร้านค้า และไม่เปิดเผยต่อบุคคลภายนอกเช่นเดียวกัน
                  </p>
                </div>
              </div>
            </section>

            <section className="flex items-start">
              <div className="flex-shrink-0 bg-emerald-600 text-white font-mono font-bold rounded-lg w-8 h-8 flex items-center justify-center text-sm mr-4 shadow-sm">9</div>
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
              className="w-full sm:w-auto inline-flex items-center justify-center px-6 py-3 bg-blue-800 text-white text-sm font-bold rounded-xl shadow-sm hover:bg-blue-700 transition-all active:scale-[0.98] focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-800"
            >
              รับทราบและยอมรับนโยบาย
            </button>
          </div>

        </div>
      </main>

      {/* ════ FOOTER ════ */}
      <footer className="border-t border-slate-200 py-6 px-4">
        <div className="max-w-4xl mx-auto flex flex-col sm:flex-row items-center justify-between gap-3">
          <div className="flex items-center gap-1 text-xs text-slate-400 flex-wrap justify-center">
            <a href="/terms" className="hover:text-blue-600 transition-colors px-2 py-1">เงื่อนไขการใช้งาน</a>
            <span className="text-slate-300">·</span>
            <a href="/privacy" className="hover:text-blue-600 transition-colors px-2 py-1 font-medium text-blue-700">นโยบายความเป็นส่วนตัว (PDPA)</a>
            <span className="text-slate-300">·</span>
            <a href="mailto:smileslip.official@gmail.com" className="hover:text-blue-600 transition-colors px-2 py-1">ติดต่อเรา</a>
          </div>
          <p className="text-xs text-slate-300 whitespace-nowrap">© {new Date().getFullYear()} Siam Global Network Enterprise</p>
        </div>
      </footer>
    </div>
  );
}
