#!/bin/bash
# Quick smoke test for the Activity Feed API once the server is running.
# Run: bash docs/curl-examples.sh

BASE="http://localhost:4000"
TENANT_ID="65a1f2c3b4d5e6f7a8b9c0d1"   # any valid 24-char hex string
USER_ID="65a1f2c3b4d5e6f7a8b9c0d2"     # any valid 24-char hex string

echo "1. Health check"
curl -s "$BASE/health"
echo -e "\n"

echo "2. Create an activity"
curl -s -X POST "$BASE/api/activities" \
  -H "Content-Type: application/json" \
  -H "x-tenant-id: $TENANT_ID" \
  -H "x-user-id: $USER_ID" \
  -H "x-user-name: Alice" \
  -d '{
    "type": "comment_added",
    "entityId": "65a1f2c3b4d5e6f7a8b9c0d3",
    "metadata": { "text": "This is a test comment" }
  }'
echo -e "\n"

echo "3. List activities (first page, cursor pagination)"
curl -s "$BASE/api/activities?limit=10" \
  -H "x-tenant-id: $TENANT_ID" \
  -H "x-user-id: $USER_ID"
echo -e "\n"

echo "4. Try without tenant header (should 401)"
curl -s "$BASE/api/activities"
echo -e "\n"
