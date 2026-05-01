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

gcloud run deploy $SERVICE_NAME \
  --source . \
  --region $REGION \
  --allow-unauthenticated \
  --set-env-vars "NEXT_PUBLIC_SUPABASE_URL=$SB_URL,NEXT_PUBLIC_SUPABASE_KEY=$SB_PUB_KEY,SUPABASE_URL=$SB_URL,SUPABASE_KEY=$SB_PUB_KEY,LINE_CHANNEL_ACCESS_TOKEN=$L_TOKEN,LINE_LOGIN_ID=$L_LOGIN_ID,LINE_LOGIN_SECRET=$L_LOGIN_SECRET,GOOGLE_CLIENT_ID=$G_CLIENT_ID,GOOGLE_CLIENT_SECRET=$G_CLIENT_SECRET,GOOGLE_REDIRECT_URI=$G_REDIRECT" \
  --set-build-env-vars "NEXT_PUBLIC_SUPABASE_URL=$SB_URL,NEXT_PUBLIC_SUPABASE_KEY=$SB_PUB_KEY"
