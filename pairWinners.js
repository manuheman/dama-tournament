// checkPendingFixtures.js

const mongoose = require('mongoose');
const Fixture = require('./models/fixture'); // adjust path to your Fixture model

// Replace with your MongoDB connection string
const MONGODB_URI = 'mongodb://localhost:27017/yourdbname';

async function findPendingFixtures() {
  try {
    // Find all fixtures with status 'pending'
    const pendingFixtures = await Fixture.find({ status: 'pending' });
    console.log('Pending fixtures:', pendingFixtures);
    return pendingFixtures;
  } catch (err) {
    console.error('Error finding pending fixtures:', err);
  }
}

async function main() {
  try {
    await mongoose.connect(MONGODB_URI, {
      useNewUrlParser: true,
      useUnifiedTopology: true,
    });
    console.log('Connected to MongoDB');

    await findPendingFixtures();

    await mongoose.disconnect();
    console.log('Disconnected from MongoDB');
  } catch (err) {
    console.error('MongoDB connection error:', err);
  }
}

main();
