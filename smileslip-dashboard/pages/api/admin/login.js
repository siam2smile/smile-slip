export default function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end();
  const { password } = req.body;
  const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD;
  if (!ADMIN_PASSWORD) return res.status(500).json({ error: 'Admin password not configured' });
  if (password === ADMIN_PASSWORD) {
    const token = Buffer.from(`smileslip-admin:${Date.now()}`).toString('base64');
    return res.status(200).json({ token });
  }
  return res.status(401).json({ error: 'รหัสผ่านไม่ถูกต้อง' });
}
