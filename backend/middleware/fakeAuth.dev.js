/**
 * DEV-ONLY STAND-IN for real authentication.
 *
 * In production this would be JWT verification (e.g. passport-jwt,
 * or manual jsonwebtoken.verify) that decodes a token from the
 * Authorization header and sets req.user from its claims.
 *
 * For local testing without a full auth system, this reads tenantId
 * and userId from request headers so you can simulate different
 * tenants/users with curl:
 *
 *   curl -H "x-tenant-id: 65a1f2c3b4d5e6f7a8b9c0d1" \
 *        -H "x-user-id:   65a1f2c3b4d5e6f7a8b9c0d2" \
 *        -H "x-user-name: Alice" \
 *        http://localhost:4000/api/activities
 *
 * DO NOT use this in any deployed environment — it trusts whatever
 * the client claims, which is the exact thing real auth exists to
 * prevent.
 */
const mongoose = require('mongoose');

function fakeAuth(req, res, next) {
  const tenantId = req.header('x-tenant-id');
  const userId = req.header('x-user-id');
  const userName = req.header('x-user-name') || 'Test User';

  if (!tenantId || !mongoose.Types.ObjectId.isValid(tenantId)) {
    return res.status(401).json({
      error: 'UNAUTHENTICATED',
      message:
        'Missing or invalid x-tenant-id header. Provide a 24-char hex ObjectId.',
    });
  }

  if (!userId || !mongoose.Types.ObjectId.isValid(userId)) {
    return res.status(401).json({
      error: 'UNAUTHENTICATED',
      message:
        'Missing or invalid x-user-id header. Provide a 24-char hex ObjectId.',
    });
  }

  req.user = {
    _id: userId,
    tenantId,
    name: userName,
  };

  next();
}

module.exports = { fakeAuth };
