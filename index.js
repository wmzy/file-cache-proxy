const util = require('util');
const http = require('http');
const httpProxy = require('http-proxy');
const LRU = require('lru-cache');
const FileCacheManager = require('./file-cache-manager');

const debug = util.debuglog('FCP');

class FileCacheProxy {
  constructor({
    cacheMax = 1000,
    ...proxyOption
  } = {}) {
    this.fetchQueue = {};
    const bodyCache = this.bodyCache = new FileCacheManager();

    const resCache = this.resCache = new LRU({
      max: cacheMax
    });

    const proxy = this.proxy = httpProxy.createProxyServer(proxyOption)

    // Listen for the `error` event on `proxy`.
    proxy.on('error', function (err, req, res) {
      debug('proxy on error:', err);
      res.writeHead(500, {
        'Content-Type': 'text/plain'
      });

      res.end('Something went wrong.');
    });

    proxy.on('proxyRes', (proxyRes, req, res) => {
      debug('proxy on proxyRes');
      res.once('pipe', () => {
        debug('proxyRes on pipe');
        proxyRes.unpipe(res);

        // cache req
        const key = this.getCacheKey(req);
        const bodyKey = this.getBodyCacheKey(req, res);
        const headers = res.getHeaders();
        resCache.set(key, {
          headers,
          bodyKey
        })

        if (this.bodyCache.has(bodyKey)) {
          debug('proxyRes abort due to the body in cache');
          proxyRes.destroy();
        } else {
          // save to cache
          debug('proxyRes body save to cache');
          const cacheWriteStream = bodyCache.getWriteStream(bodyKey);
          proxyRes.pipe(cacheWriteStream);
        }
        debug('proxyRes serve body from cache');
        bodyCache.createReadStream(bodyKey)
          .on('error', e => {
            debug(e);
            res.destroy(e);
          })
          .pipe(res)
          .on('error', e => {
            debug(e);
          });

        const resCollection = this.popResQueue(key);
        debug('proxyRes serve body for queue req', resCollection.length);
        resCollection.forEach(res => {
          writeHeaders(res, headers);
          bodyCache.createReadStream(bodyKey)
            .on('error', e => {
              debug(e);
              res.destroy(e);
            })
            .pipe(res)
            .on('error', e => {
              debug(e);
            });
        });
      });
    });
  }

  cache(req, res) {
    const key = this.getCacheKey(req);
    debug('[cache] req key:', key);
    const r = this.resCache.get(key)
    if (r && this.bodyCache.has(r.bodyKey)) {
      debug('[cache] hit req', key);
      // serve from cache
      writeHeaders(res, r.headers);
      this.bodyCache.createReadStream(r.bodyKey).pipe(res)
      return;
    }
    if (this.isFetching(key)) {
      debug('[cache] push to key', key);
      this.pushToQueue(key, res)
    } else {
      this.setFetching(key)
      debug('[cache] fetch by proxy', key);
      this.proxy.web(req, res);
    }
  }

  isFetching(key) {
    return !!this.fetchQueue[key];
  }

  setFetching(key) {
    debug('[setFetching] key:', key)
    this.fetchQueue[key] = [];
  }

  pushToQueue(key, res) {
    this.fetchQueue[key].push(res);
  }

  popResQueue(key) {
    debug('[popResQueue] key:', key)
    const q = this.fetchQueue[key];
    this.fetchQueue[key] = undefined;
    return q || [];
  }

  getCacheKey(req) {
    return req.method + ':' + req.url;
  }

  getBodyCacheKey(req, res) {
    return this.getCacheKey(req)
  }
}

function writeHeaders(res, headers) {
  for (let k in headers) {
    res.setHeader(k, headers[k])
  }
}

module.exports = FileCacheProxy;
