const redis = require('redis');
const client = redis.createClient();

client.connect().then(() => {
  console.log('✅ Connected to Redis');
  
  client.set('testKey', 'Hello Redis')
    .then(() => client.get('testKey'))
    .then(value => {
      console.log('📦 Redis Value:', value);
      client.quit();
    })
    .catch(err => {
      console.error('❌ Redis Error:', err);
      client.quit();
    });

}).catch(err => {
  console.error('❌ Connection Error:', err);
});
