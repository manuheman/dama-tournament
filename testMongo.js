require('dotenv').config();
const mongoose = require('mongoose');

const mongoURL = process.env.MONGO_URL;

mongoose
  .connect(mongoURL, {
    serverSelectionTimeoutMS: 5000, // fail fast if cannot connect
  })
  .then(() => {
    console.log("✅ MongoDB connected successfully!");
    process.exit(0);
  })
  .catch((err) => {
    console.error("❌ MongoDB connection error:", err);
    process.exit(1);
  });
