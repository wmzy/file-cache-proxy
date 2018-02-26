const fs = require('fs');
const http = require('http');
const FileCacheProxy = require('../');

const targetPort = 9000;
const target = `http://localhost:${targetPort}`;

const targetServer = http.createServer(function(req, res) {
  console.log('hit the target server');
  fs.createReadStream(__filename).pipe(res);
});

targetServer.listen(targetPort);

const fileCacheProxy = new FileCacheProxy({target})

const server = http.createServer(function(req, res) {
  // todo

  fileCacheProxy.cache(req, res);
});

const port = 3000;
console.log(`listening on port ${port}`);
server.listen(port);

