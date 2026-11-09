require('dotenv').config({ path: require('path').resolve(__dirname, '../.env') });
const mongoose = require('mongoose');
const User = require('../src/models/User');

const targetEmails = ['quangson2112004@gmail.com', 'sondnqhe180515@fpt.edu.vn'];

async function deleteUsers() {
  const uri = process.env.MONGO_URI || 'mongodb://127.0.0.1:27017/hotel_booking';
  await mongoose.connect(uri);
  console.log('Connected to MongoDB:', uri);

  const found = await User.find({ email: { $in: targetEmails.map(e => e.toLowerCase().trim()) } });
  console.log(`Found ${found.length} account(s):`, found.map(u => `${u.email} (${u.username}, status: ${u.status})`));

  const result = await User.deleteMany({ email: { $in: targetEmails.map(e => e.toLowerCase().trim()) } });
  console.log(`Successfully deleted ${result.deletedCount} account(s).`);

  await mongoose.disconnect();
}

deleteUsers().catch(err => {
  console.error('Failed to delete users:', err.message);
  process.exit(1);
});

