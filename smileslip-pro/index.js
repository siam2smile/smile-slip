const express = require('express');
const app = express();
app.use(express.json());
app.get('/', (req, res) => res.send('System is Back Online!'));
app.post('/webhook', (req, res) => {
  console.log('Webhook received!');
  res.sendStatus(200);
});
app.listen(8080);
