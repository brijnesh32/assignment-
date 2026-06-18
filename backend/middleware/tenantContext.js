/**
 * Tenant resolution middleware.
 *
 * Mandatory rule: tenantId NEVER comes from the request body or query
 * string. If a client could pass tenantId themselves, tenant isolation
 * is just a UI convention, not a security boundary — any authenticated
 * user could read or write another tenant's feed by changing a param.
 *
 * Instead, tenantId is derived server-side from the authenticated
 * session/JWT (req.user.tenantId), set by your auth middleware upstream.
 * This middleware just guarantees it's present and valid before any
 * controller runs, and attaches it to req.tenantId as the single
 * source of truth for the rest of the request lifecycle.
 */
const mongoose = require('mongoose');

function requireTenant(req, res, next) {
  // req.user is assumed to be populated by an upstream auth middleware
  // (e.g. JWT verification) that decoded the token server-side.
  const tenantId = req.user && req.user.tenantId;

  if (!tenantId) {
    return res.status(401).json({
      error: 'UNAUTHENTICATED',
      message: 'No tenant context found for this request.',
    });
  }

  if (!mongoose.Types.ObjectId.isValid(tenantId)) {
    return res.status(400).json({
      error: 'INVALID_TENANT',
      message: 'Tenant identifier is malformed.',
    });
  }

  req.tenantId = tenantId;
  next();
}

module.exports = { requireTenant };
