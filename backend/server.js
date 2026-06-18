require('dotenv').config();
const express = require('express');
const mongoose = require('mongoose');
const { fakeAuth } = require('./middleware/fakeAuth.dev');
const activityRoutes = require('./routes/activityRoutes');

const app = express();
app.use(express.json());

const PORT = process.env.PORT || 4000;
const MONGODB_URI = process.env.MONGODB_URI;

if (!MONGODB_URI || MONGODB_URI.includes('<username>')) {
  console.error(
    '\n✗ MONGODB_URI is not set (or still has placeholder values).\n' +
      '  Copy backend/.env.example to backend/.env and fill in your\n' +
      '  Atlas connection string before starting the server.\n'
  );
  process.exit(1);
}

// fakeAuth stands in for real authentication during local testing —
// see middleware/fakeAuth.dev.js. Swap this for real JWT middleware
// before deploying anywhere.
app.use(fakeAuth);

app.use('/api', activityRoutes);

app.get('/health', (req, res) => res.json({ status: 'ok' }));

async function start() {
  try {
    await mongoose.connect(MONGODB_URI);
    console.log('✓ Connected to MongoDB Atlas');

    app.listen(PORT, () => {
      console.log(`✓ Server listening on http://localhost:${PORT}`);
      console.log(`  Try: curl http://localhost:${PORT}/health`);
    });
  } catch (err) {
    console.error('✗ Failed to connect to MongoDB:', err.message);
    process.exit(1);
  }
}

start();
