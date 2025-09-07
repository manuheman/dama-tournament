const mongoose = require('mongoose');
const User = require('./models/user');
const Tournament = require('./models/tournament');
const Fixture = require('./models/fixture');

async function createTestData() {
  try {
    // Connect to MongoDB
    console.log('🔄 Connecting to MongoDB...');
    await mongoose.connect('mongodb://localhost:27017/my_node_project', {
      useNewUrlParser: true,
      useUnifiedTopology: true,
    });
    console.log('✅ Connected to MongoDB');

    // Clear existing data
    console.log('🧹 Clearing existing data...');
    await User.deleteMany({});
    await Tournament.deleteMany({});
    await Fixture.deleteMany({});
    console.log('✅ Cleared existing data');

    // Create test users
    console.log('👥 Creating test users...');
    const users = await User.insertMany([
      {
        name: 'Alice Johnson',
        telegram_id: 'player1',
        telegram_username: 'alice_j',
        phone_number: '+1234567890'
      },
      {
        name: 'Bob Smith',
        telegram_id: 'player2', 
        telegram_username: 'bob_s',
        phone_number: '+0987654321'
      },
      {
        name: 'Charlie Brown',
        telegram_id: 'player3',
        telegram_username: 'charlie_b',
        phone_number: '+1122334455'
      },
      {
        name: 'Diana Prince',
        telegram_id: 'player4',
        telegram_username: 'diana_p',
        phone_number: '+5566778899'
      }
    ]);
    
    console.log(`✅ Created ${users.length} users:`);
    users.forEach(user => console.log(`   - ${user.name} (${user.telegram_id})`));

    // Create test tournament
    console.log('🏆 Creating test tournament...');
    const tournament = new Tournament({
      type: 'Daily',
      balance: 50,
      players: users.map(user => user._id),
      maxPlayers: 4,
      status: 'open',
      uniqueId: 'GAME-TEST',
      createdAt: new Date()
    });
    
    await tournament.save();
    console.log(`✅ Created tournament: ${tournament.uniqueId}`);

    // Create test fixtures
    console.log('⚔️ Creating test fixtures...');
    const fixtures = [];
    
    // Create fixtures for pairs of players
    for (let i = 0; i < users.length; i += 2) {
      if (i + 1 < users.length) {
        const fixture = new Fixture({
          tournament: tournament._id,
          player1: users[i]._id,
          player2: users[i + 1]._id,
          result: 'pending',
          status: 'pending',
          matchTime: null,
          createdAt: new Date()
        });
        
        fixtures.push(fixture);
      }
    }
    
    await Fixture.insertMany(fixtures);
    console.log(`✅ Created ${fixtures.length} fixtures`);

    // Verify data was created
    console.log('\n🔍 VERIFICATION:');
    const userCount = await User.countDocuments();
    const tournamentCount = await Tournament.countDocuments();
    const fixtureCount = await Fixture.countDocuments();
    
    console.log(`Users in database: ${userCount}`);
    console.log(`Tournaments in database: ${tournamentCount}`);
    console.log(`Fixtures in database: ${fixtureCount}`);

    // Show sample data
    console.log('\n📋 SAMPLE DATA:');
    const sampleUser = await User.findOne();
    console.log('Sample user:', {
      name: sampleUser.name,
      telegram_id: sampleUser.telegram_id
    });

    const sampleTournament = await Tournament.findOne().populate('players', 'name');
    console.log('Sample tournament:', {
      uniqueId: sampleTournament.uniqueId,
      type: sampleTournament.type,
      playerCount: sampleTournament.players.length
    });

    const sampleFixture = await Fixture.findOne()
      .populate('player1', 'name')
      .populate('player2', 'name')
      .populate('tournament', 'uniqueId');
    
    console.log('Sample fixture:', {
      player1: sampleFixture.player1.name,
      player2: sampleFixture.player2.name,
      tournament: sampleFixture.tournament.uniqueId
    });

    console.log('\n🎮 TEST URLS:');
    console.log('Alice Dashboard: http://localhost:3000/user-dashboard.html?userId=player1&tournamentId=GAME-TEST');
    console.log('Bob Dashboard: http://localhost:3000/user-dashboard.html?userId=player2&tournamentId=GAME-TEST');
    console.log('Admin Users: http://localhost:3000/admin-user.html');
    console.log('Admin Tournaments: http://localhost:3000/admin-tournament.html');

  } catch (error) {
    console.error('❌ Error creating test data:', error);
  } finally {
    await mongoose.disconnect();
    console.log('🔌 Disconnected from MongoDB');
  }
}

// Run the function
createTestData();