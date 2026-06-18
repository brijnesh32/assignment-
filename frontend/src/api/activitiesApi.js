const BASE_URL = import.meta.env.VITE_API_URL || "/api";

// Hardcoded for local dev — swap these for real auth headers in production
const DEV_HEADERS = {
  "x-tenant-id": "65a1f2c3b4d5e6f7a8b9c0d1",
  "x-user-id": "65a1f2c3b4d5e6f7a8b9c0d2",
  "x-user-name": "Test User",
};

export async function fetchActivities({ cursor, limit = 20, type } = {}) {
  const params = new URLSearchParams();
  if (cursor) params.set("cursor", cursor);
  if (limit) params.set("limit", String(limit));
  if (type) params.set("type", type);

  const res = await fetch(`${BASE_URL}/activities?${params.toString()}`, {
    credentials: "include",
    headers: DEV_HEADERS,
  });

  if (!res.ok) throw new Error(`Failed to fetch activities: ${res.status}`);
  return res.json();
}

export async function createActivity(payload) {
  const res = await fetch(`${BASE_URL}/activities`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...DEV_HEADERS },
    credentials: "include",
    body: JSON.stringify(payload),
  });

  if (!res.ok) {
    const error = new Error(`Failed to create activity: ${res.status}`);
    error.status = res.status;
    throw error;
  }

  return res.json();
}
