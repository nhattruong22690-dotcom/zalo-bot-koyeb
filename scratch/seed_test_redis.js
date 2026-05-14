const { Redis } = require('@upstash/redis');
const dotenv = require('dotenv');
dotenv.config();

const redis = new Redis({
    url: process.env.UPSTASH_REDIS_REST_URL,
    token: process.env.UPSTASH_REDIS_REST_TOKEN,
});

async function seed() {
    const orderCode = '90062162937';
    const fakeOldStatus = 'Đã tiếp nhận';
    const redisKey = `track:247:status:${orderCode}`;
    
    await redis.set(redisKey, fakeOldStatus);
    console.log(`✅ Seeded Redis with fake status for ${orderCode}: ${fakeOldStatus}`);
}

seed();
