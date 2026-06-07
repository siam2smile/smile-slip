import React from 'react';
import Link from 'next/link';
import Head from 'next/head';

export default function TermsOfService() {
  return (
    <div className="min-h-screen bg-slate-50 text-slate-800 font-sans antialiased">
      <Head>
        <title>เงื่อนไขและข้อตกลงการใช้บริการ | Smile Slip Pro</title>
        <meta name="description" content="เงื่อนไขและข้อตกลงการใช้บริการของ Smile Slip Pro สำหรับระบบ Stripe และมาตรฐาน PDPA" />
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
              เงื่อนไขและข้อตกลงการใช้บริการ (Terms of Service)
            </h1>
            <p className="text-sm text-slate-400">มีผลบังคับใช้ ณ วันที่ 3 มิถุนายน 2569 | เวอร์ชัน 1.1.0</p>
          </div>

          {/* ข้อมูลผู้ให้บริการ */}
          <div className="bg-slate-50 rounded-xl p-5 border border-slate-200 mb-6 text-sm text-slate-600 space-y-1">
            <p className="font-bold text-slate-800">ผู้ให้บริการ</p>
            <p>บริษัท สยาม โกลบอล เน็ทเวิร์ค เอ็นเตอร์ไพรส์ จำกัด</p>
            <p>เลขทะเบียนนิติบุคคล: 0505565019236</p>
            <p>76 หมู่ 9 ต.หางดง อ.หางดง จ.เชียงใหม่ 50230</p>
            <p>อีเมล: smileslip.official@gmail.com</p>
          </div>

          <div className="bg-indigo-50/50 rounded-xl p-5 border border-indigo-100/50 mb-8">
            <p className="text-slate-600 leading-relaxed text-sm md:text-base">
              ยินดีต้อนรับสู่ <strong>Smile Slip Pro</strong> แพลตฟอร์มระบบผู้ช่วยจัดการข้อมูลธุรกรรมทางการเงินและตรวจสอบสลิปอัตโนมัติ
              การเริ่มใช้งานบริการถือว่าท่านได้อ่านและยอมรับข้อตกลงฉบับนี้แล้ว โปรดอ่านอย่างละเอียดก่อนเริ่มใช้งาน
            </p>
          </div>

          <div className="space-y-8">

            <section className="flex items-start">
              <div className="flex-shrink-0 bg-indigo-600 text-white font-mono font-bold rounded-lg w-8 h-8 flex items-center justify-center text-sm mr-4 shadow-sm">1</div>
              <div className="space-y-2">
                <h2 className="text-lg font-bold text-slate-900 tracking-tight">ขอบเขตการให้บริการ</h2>
                <p className="text-slate-600 leading-relaxed text-sm md:text-base">
                  ผู้ให้บริการจัดเตรียมระบบแชทบอท AI และหน้าจอแดชบอร์ดเพื่ออำนวยความสะดวกในการอ่าน ดึงข้อมูล
                  และตรวจสอบสลิปโอนเงินธนาคารผ่าน LINE บันทึกข้อมูลลง Google Sheets และ Google Drive
                  โดยระบบไม่ได้ทำหน้าที่เป็นสถาบันการเงินหรือผู้ให้บริการกระเป๋าเงินอิเล็กทรอนิกส์
                </p>
              </div>
            </section>

            <section className="flex items-start">
              <div className="flex-shrink-0 bg-indigo-600 text-white font-mono font-bold rounded-lg w-8 h-8 flex items-center justify-center text-sm mr-4 shadow-sm">2</div>
              <div className="space-y-2">
                <h2 className="text-lg font-bold text-slate-900 tracking-tight">หน้าที่และความรับผิดชอบของผู้ใช้บริการ</h2>
                <p className="text-slate-600 leading-relaxed text-sm md:text-base">
                  ผู้ใช้บริการต้องไม่นำระบบ Smile Slip Pro ไปใช้ในทางที่ผิดกฎหมาย หรือการทำธุรกรรมที่เข้าข่ายการทุจริต
                  ฟอกเงิน หรือฉ้อโกงทุกรูปแบบ หากตรวจพบ ผู้ให้บริการขอสงวนสิทธิ์ในการระงับบัญชีทันทีโดยไม่ต้องแจ้งให้ทราบล่วงหน้า
                  และจะไม่คืนเงินค่าบริการในทุกกรณี
                </p>
              </div>
            </section>

            <section className="flex items-start">
              <div className="flex-shrink-0 bg-indigo-600 text-white font-mono font-bold rounded-lg w-8 h-8 flex items-center justify-center text-sm mr-4 shadow-sm">3</div>
              <div className="space-y-2">
                <h2 className="text-lg font-bold text-slate-900 tracking-tight">นโยบายการคืนเงิน (Refund Policy)</h2>
                <p className="text-slate-600 leading-relaxed text-sm md:text-base">
                  เนื่องจากบริการของเราเป็นซอฟต์แวร์รูปแบบใช้งานทันที การซื้อเครดิตตรวจสลิป (One-time credit)
                  หรือการสมัครสมาชิกรายเดือน/รายปี (Subscription) ที่ประมวลผลสำเร็จแล้ว จะไม่สามารถขอคืนเงินเป็นเงินสดได้
                  เว้นแต่เกิดจากความผิดพลาดของระบบตัดเงินซ้ำซ้อน ซึ่งผู้ใช้บริการสามารถติดต่อเจ้าหน้าที่ทาง{' '}
                  <a href="mailto:smileslip.official@gmail.com" className="underline hover:text-slate-800">smileslip.official@gmail.com</a>{' '}
                  เพื่อปรับปรุงยอดเครดิตให้ถูกต้องได้ภายใน 7 วัน
                </p>
              </div>
            </section>

            <section className="flex items-start">
              <div className="flex-shrink-0 bg-indigo-600 text-white font-mono font-bold rounded-lg w-8 h-8 flex items-center justify-center text-sm mr-4 shadow-sm">4</div>
              <div className="space-y-2">
                <h2 className="text-lg font-bold text-slate-900 tracking-tight">การจำกัดความรับผิดชอบ</h2>
                <p className="text-slate-600 leading-relaxed text-sm md:text-base">
                  ผู้ให้บริการมุ่งมั่นพัฒนา AI ให้มีความแม่นยำสูงสุด อย่างไรก็ตาม ผู้ให้บริการจะไม่รับผิดชอบต่อความเสียหายทางธุรกิจ
                  หรือความสูญเสียใดๆ ที่เกิดจากระบบเครือข่ายอินเทอร์เน็ตขัดข้อง ธนาคารปิดปรับปรุงระบบ
                  หรือเหตุสุดวิสัยภายนอกที่ทำให้ระบบไม่สามารถส่งข้อมูลได้ชั่วคราว
                </p>
              </div>
            </section>

            <section className="flex items-start">
              <div className="flex-shrink-0 bg-indigo-600 text-white font-mono font-bold rounded-lg w-8 h-8 flex items-center justify-center text-sm mr-4 shadow-sm">5</div>
              <div className="space-y-2">
                <h2 className="text-lg font-bold text-slate-900 tracking-tight">การสมัครสมาชิก การต่ออายุ และการยกเลิก</h2>
                <div className="text-slate-600 leading-relaxed text-sm md:text-base space-y-2">
                  <p>
                    แพ็กเกจสมาชิก (Shop Pro, Advance, Super) จะถูกเรียกเก็บเงินตามรอบรายเดือนหรือรายปีโดยอัตโนมัติผ่านระบบ Stripe
                  </p>
                  <p>
                    <strong>การยกเลิก:</strong> ผู้ใช้บริการสามารถยกเลิก Subscription ได้ตลอดเวลาโดยติดต่อทางอีเมล{' '}
                    <a href="mailto:smileslip.official@gmail.com" className="underline hover:text-slate-800">smileslip.official@gmail.com</a>{' '}
                    ก่อนวันครบรอบการเรียกเก็บเงินรอบถัดไปอย่างน้อย 24 ชั่วโมง
                    การยกเลิกจะมีผลในรอบบิลถัดไป ท่านยังสามารถใช้บริการได้ถึงสิ้นสุดรอบที่ชำระเงินไปแล้ว
                  </p>
                  <p>
                    <strong>เครดิตคงเหลือ:</strong> เครดิตที่ซื้อแบบ One-time จะไม่มีวันหมดอายุตราบเท่าที่บัญชียังใช้งานอยู่
                  </p>
                </div>
              </div>
            </section>

            <section className="flex items-start">
              <div className="flex-shrink-0 bg-indigo-600 text-white font-mono font-bold rounded-lg w-8 h-8 flex items-center justify-center text-sm mr-4 shadow-sm">6</div>
              <div className="space-y-2">
                <h2 className="text-lg font-bold text-slate-900 tracking-tight">ทรัพย์สินทางปัญญา</h2>
                <p className="text-slate-600 leading-relaxed text-sm md:text-base">
                  แพลตฟอร์ม Smile Slip Pro รวมถึงซอฟต์แวร์ การออกแบบ โลโก้ และเนื้อหาทั้งหมดเป็นทรัพย์สินของ
                  บริษัท สยาม โกลบอล เน็ทเวิร์ค เอ็นเตอร์ไพรส์ จำกัด ผู้ใช้บริการไม่มีสิทธิ์คัดลอก ดัดแปลง
                  หรือนำไปใช้เพื่อวัตถุประสงค์เชิงพาณิชย์โดยไม่ได้รับอนุญาตเป็นลายลักษณ์อักษร
                </p>
              </div>
            </section>

            <section className="flex items-start">
              <div className="flex-shrink-0 bg-indigo-600 text-white font-mono font-bold rounded-lg w-8 h-8 flex items-center justify-center text-sm mr-4 shadow-sm">7</div>
              <div className="space-y-2">
                <h2 className="text-lg font-bold text-slate-900 tracking-tight">กฎหมายที่ใช้บังคับและการระงับข้อพิพาท</h2>
                <p className="text-slate-600 leading-relaxed text-sm md:text-base">
                  ข้อตกลงฉบับนี้อยู่ภายใต้การบังคับใช้และตีความตามกฎหมายแห่งราชอาณาจักรไทย
                  หากเกิดข้อพิพาท คู่สัญญาตกลงระงับข้อขัดแย้งโดยการเจรจาก่อน
                  หากไม่สามารถตกลงกันได้ภายใน 30 วัน ให้นำคดีขึ้นสู่ศาลที่มีเขตอำนาจในจังหวัดเชียงใหม่
                </p>
              </div>
            </section>

            <section className="flex items-start">
              <div className="flex-shrink-0 bg-indigo-600 text-white font-mono font-bold rounded-lg w-8 h-8 flex items-center justify-center text-sm mr-4 shadow-sm">8</div>
              <div className="space-y-2">
                <h2 className="text-lg font-bold text-slate-900 tracking-tight">การแก้ไขข้อตกลง</h2>
                <p className="text-slate-600 leading-relaxed text-sm md:text-base">
                  ผู้ให้บริการขอสงวนสิทธิ์ในการแก้ไขเงื่อนไขการใช้บริการได้ตลอดเวลา
                  โดยจะแจ้งให้ผู้ใช้บริการทราบล่วงหน้าอย่างน้อย 30 วัน ผ่านทางอีเมลที่ลงทะเบียนไว้หรือแจ้งเตือนในแดชบอร์ด
                  การใช้บริการต่อหลังจากวันที่ข้อตกลงใหม่มีผลบังคับใช้ ถือว่าท่านยอมรับข้อตกลงที่แก้ไขแล้ว
                </p>
              </div>
            </section>

          </div>

          <div className="mt-12 pt-8 border-t border-slate-100 flex flex-col sm:flex-row items-center justify-between gap-4">
            <div className="text-xs text-slate-400 text-center sm:text-left">
              หากมีข้อสงสัย โปรดติดต่อ{' '}
              <a href="mailto:smileslip.official@gmail.com" className="underline hover:text-slate-600">
                smileslip.official@gmail.com
              </a>
            </div>
            <button
              onClick={() => window.history.back()}
              className="w-full sm:w-auto inline-flex items-center justify-center px-6 py-3 bg-slate-900 text-white text-sm font-bold rounded-xl shadow-sm hover:bg-slate-800 transition-all active:scale-[0.98] focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-slate-900"
            >
              ฉันเข้าใจและยอมรับข้อตกลง
            </button>
          </div>

        </div>
      </main>
    </div>
  );
}
