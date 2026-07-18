export default function handler(req, res) {
  const { shopId } = req.query;
  const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  if (!shopId || !UUID_REGEX.test(shopId)) return res.status(400).json({ error: 'Missing or invalid shopId' });

  // Google บล็อก OAuth จาก in-app browser (LINE, Facebook, Instagram)
  const ua = req.headers['user-agent'] || '';
  const isInAppBrowser = /FBAN|FBAV|Instagram|Line\/|MicroMessenger|WebView|wv\)|GSA\//.test(ua);
  if (isInAppBrowser) {
    const base = process.env.NEXT_PUBLIC_BASE_URL || process.env.FRONTEND_URL || '';
    return res.redirect(`${base}/api/auth/google/open-browser?shopId=${shopId}`);
  }

  const url = new URL('https://accounts.google.com/o/oauth2/v2/auth');
  url.searchParams.set('client_id', process.env.GOOGLE_CLIENT_ID);
  url.searchParams.set('redirect_uri', process.env.GOOGLE_REDIRECT_URI);
  url.searchParams.set('scope', 'https://www.googleapis.com/auth/drive https://www.googleapis.com/auth/spreadsheets');
  url.searchParams.set('response_type', 'code');
  url.searchParams.set('access_type', 'offline');
  url.searchParams.set('prompt', 'consent');
  url.searchParams.set('state', shopId);

  res.redirect(url.toString());
}
