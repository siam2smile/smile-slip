/**
 * GET /api/admin/google/connect
 * Redirect admin to Google OAuth เพื่อเชื่อม Google Drive/Sheets ของบริษัท
 */
export default function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).end();

  const params = new URLSearchParams({
    client_id:     process.env.GOOGLE_CLIENT_ID,
    redirect_uri:  `${process.env.NEXT_PUBLIC_BASE_URL || process.env.FRONTEND_URL}/api/admin/google/callback`,
    response_type: 'code',
    scope:         'https://www.googleapis.com/auth/drive https://www.googleapis.com/auth/spreadsheets https://www.googleapis.com/auth/userinfo.email',
    access_type:   'offline',
    prompt:        'consent',
    state:         'admin_connect',
  });

  return res.redirect(`https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`);
}
