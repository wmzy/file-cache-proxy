const http = require('http');
const cacheIt = require('../');

const target = 'http://localhost:9000';
const port = 3000;

const server = http.createServer(function(req, res) {
  // todo

  cacheIt(req, res);
});

console.log(`listening on port ${port}`);
server.listen(port);

