const http = require('http');
const httpProxy = require('http-proxy');
const LRU = require('lru-cache');
const FileCacheManager = require('./file-cache-manager');

const target = 'http://localhost:9000';
const bodyCache = new FileCacheManager();

const resCache = new LRU({
  max: 1000
});

const proxy = httpProxy.createProxyServer({target})

// Listen for the `error` event on `proxy`.
proxy.on('error', function (err, req, res) {
  res.writeHead(500, {
    'Content-Type': 'text/plain'
  });

  res.end('Something went wrong.');
});

proxy.on('proxyRes', function (proxyRes, req, res) {
  proxyRes.on('pipe', () => {
    proxyRes.unpipe(res);

    // cache req
    const key = getCacheKey(req);
    const bodyKey = getBodyCacheKey(res);
    const headers = getResHeaders(res);
    resCache.set(key, {headers, bodyKey})

    if (bodyCache.has(bodyKey)) {
      proxyRes.abort();
    } else {
      // save to cache
      const cacheWriteStream = bodyCache.getWriteStream(bodyKey);
      proxyRes.pipe(cacheWriteStream);
    }
    bodyCache.createReadStream(bodyKey).pipe(res);

    const resCollection = popResQueue(key)
    resCollection.forEach(res => {
      writeHeaders(res, headers);
      bodyCache.createReadStream(bodyKey).pipe(res);
    });
  });
});

function cacheIt(req, res) {
  const key = getCacheKey(req);
  const r = resCache.get(key)
  if (r && bodyCache.has(r.bodyKey)) {
    // serve from cache
    writeHeaders(r.headers, res);
    bodyCache.createReadStream(r.bodyKey).pipe(res)
    return;
  }
  if (isFetching(key)) {
    pushToQueue(key, res)
  } else {
    setFetching(key)
    proxy.web(req, res);
  }
}

class FileCacheProxy {
  constructor({target} = {}) {
    this.target = target;
  }
}

module.exports = cacheIt;
