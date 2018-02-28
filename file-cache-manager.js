const util = require('util');
const path = require('path');
const fs = require('fs');
const os = require('os');
const miss = require('mississippi');
const LRU = require('lru-cache');

const debug = util.debuglog('FCM');
const File = require('./file');

class FileCacheManager {
  constructor({
    filePath = os.tmpdir(),
    fileCount = 1024
  } = {}) {
    this.filePath = filePath;
    this.fileCache = new LRU({
      max: fileCount
    });
  }

  has(key) {
    return this.fileCache.has(key);
  }

  getWriteStream(key) {
    if (this.fileCache.has(key)) throw new Error('file is exists');
    const file = new File(path.join(this.filePath, Buffer.from(key).toString('hex')));
    this.fileCache.set(key, file);
    const writeStream = file.createWriteStream();
    writeStream.once('error', e => {
      this.fileCache.del(key);
    });
    return writeStream;
  }

  createReadStream(key) {
    const file = this.fileCache.get(key);
    if (!file) throw new Error('file not found');
    return file.createReadStream();
  }
}

module.exports = FileCacheManager;
