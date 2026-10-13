require('dotenv').config();
const app = require('./app');
const connectDatabase = require('./config/database');

const port = Number(process.env.PORT || 3000);
connectDatabase().then(() => app.listen(port, () => console.log(`API listening on ${port}`)))
  .catch(error => { console.error('Unable to start API:', error.message); process.exit(1); });
