gcloud run deploy smileslip-service \
    --source . \
    --region asia-southeast1 \
    --set-env-vars SUPABASE_URL="https://sbgwwxuhzfeflexipgkz.supabase.co" \
    --set-env-vars SUPABASE_KEY="sb_secret_yWo1yAFTJHWaTukbyMdFBw_CrmcHaQ8" \
    --set-env-vars LINE_CHANNEL_ACCESS_TOKEN="A8KnRecB7fCCpCTQ5KckJSv98Xy53Hq/zLhBSJi4eYPuH4HCOF3cAs22KsFNzjNYD/5RhFCytMZ+eQQwOInzoGuAF02n6HZ4wIJo/LryWPPQ0+C8xQGGRQ7H3vAeXkOAja/IznRwjqq07fihuZosBwdB04t89/1O/w1cDnyilFU=" \
    --set-env-vars GOOGLE_API_KEY="AIzaSyArEV-fk2eVGpxsJCTik0UukqfeFzBuLOY" \
    --clear-base-image \
    --allow-unauthenticated
