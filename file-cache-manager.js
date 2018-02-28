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
    if (this.fileCache.has(key)) throw new Error('file is writing');
    const file = new File(path.join(this.filePath, Buffer.from(key).toString('hex')));
    this.fileCache.set(key, file);
    const writeStream = fs.createWriteStream(file.filename);
    writeStream.on('error', e => {
      this.fileCache.del(key);
      file.error = e;
      file.status = 'error';
      file.emit('change');
    });

    const self = this;
    return miss.to({
      destroy(err) {
        self.fileCache.del(key);
        writeStream.destroy(err);
        file.status = 'error';
        file.emit('change');
      }
    }, function (chunk, enc, callback) {
      const ok = writeStream.write(chunk, enc, () => {
        file.size += chunk.length;
        file.emit('change');
      });
      if (ok) return callback();
      writeStream.once('drain', callback);
    }, function(callback) {
      writeStream.end(() => {
        debug('write done');
        if (file.status === 'writing') file.status = 'done';
        callback();
        file.emit('change');
      })
    });
  }

  createReadStream(key) {
    const file = this.fileCache.get(key);
    if (!file) throw new Error('file not found');
    if (file.status === 'done') return fs.createReadStream(file.filename);
    let fd;
    let bytesRead = 0;
    let closeFD = function (cb) {
      if (fd !== undefined) {
        fs.close(fd, cb)
        closeFD = function noop() {};
      }
    }
    return miss.from({
      destroy(err, cb) {
        closeFD(cb)
      }
    }, function readFromFile(size, next) {
      if (file.status === 'error') {
        return next(new Error('file error on writing:' + file.error));
      }
      if (bytesRead >= file.size && file.status === 'done') {
        debug('write done');
        return closeFD(e => next(e, null));
      }
      if (bytesRead + size >= file.size && file.status !== 'done') {
        debug('file is writing, wait change');
        return file.once('change', () => readFromFile(size, next))
      }
      if (fd !== undefined) return read(fd)
      fs.open(file.filename, 'r', (err, _fd) => {
        debug('open file to read');
        if (err) return next(err);
        fd = _fd;
        debug('file is open');
        return read(fd);
      })

      function read(fd) {
        const length = Math.min(size, file.size - bytesRead);
        fs.read(fd, Buffer.alloc(length), 0, length, null, (err, br, buffer) => {
          if (err) {
            return next(err)
          }
          bytesRead += br;
          debug('read size:', br);
          next(null, buffer)
        })
      }
    })
  }
}

module.exports = FileCacheManager;
