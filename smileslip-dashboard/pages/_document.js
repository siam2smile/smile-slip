import { Html, Head, Main, NextScript } from 'next/document';

// ต้องมีไฟล์นี้เพื่อฝัง <link rel="manifest">/theme-color ให้ทุกหน้าเว็บพร้อมกันครั้งเดียว
// (ต่างจาก _app.js ที่ครอบแค่ React tree ของแต่ละหน้า — _document.js คือจุดเดียวที่คุม <html>/<head>
// ระดับเอกสารทั้งไซต์) เดิมโปรเจกต์นี้ไม่มีไฟล์นี้เลย แต่ละหน้าเซ็ต <title>/meta เองแยกกัน (ยังทำแบบนั้น
// ต่อไปได้ตามปกติ — ไฟล์นี้เพิ่มแค่ tag ที่ต้องซ้ำทุกหน้าเสมอสำหรับ PWA/แอป Android เท่านั้น)
export default function Document() {
  return (
    <Html lang="th">
      <Head>
        <link rel="manifest" href="/manifest.json" />
        <meta name="theme-color" content="#14345a" />
        <link rel="icon" href="/icons/favicon-32.png" sizes="32x32" />
        <link rel="apple-touch-icon" href="/icons/apple-touch-icon.png" />
      </Head>
      <body>
        <Main />
        <NextScript />
      </body>
    </Html>
  );
}
