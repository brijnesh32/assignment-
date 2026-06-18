const express = require('express');
const router = express.Router();
const { requireTenant } = require('../middleware/tenantContext');
const { createActivity, listActivities } = require('../controllers/activityController');

// requireTenant runs on every route here — there is no code path
// in this router that can touch the Activity collection without a
// resolved, validated tenantId attached to req.
router.use(requireTenant);

router.post('/activities', createActivity);
router.get('/activities', listActivities);

module.exports = router;
