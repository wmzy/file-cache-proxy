const fs = require('fs');
const util = require('util');
const miss = require('mississippi');
const EventEmitter = require('events');

const openFile = util.promisify(fs.open);
const debug = util.debuglog('file');

class File extends EventEmitter {
  constructor(filename) {
    super();
    this.status = 'init';
    this.size = 0;
    this.filename = filename;
  }

  createWriteStream() {
    if (this.status !== 'init') throw new Error('file is exists');
    this.status = 'writing';
    const writeStream = fs.createWriteStream(this.filename);

    const self = this;
    return miss.to({
      destroy(err) {
        writeStream.destroy(err);
        self.status = 'error';
        self.error = err;
        self.emit('change');
      }
    }, function (chunk, enc, callback) {
      const ok = writeStream.write(chunk, enc, () => {
        self.size += chunk.length;
        self.emit('change');
      });
      if (ok) return callback();
      writeStream.once('drain', callback);
    }, function(callback) {
      writeStream.end(() => {
        debug('write done');
        if (self.status === 'writing') self.status = 'done';
        callback();
        self.emit('change');
      })
    });
  }

  createReadStream() {
    if (this.status === 'done') return fs.createReadStream(this.filename);
    let fd;
    let bytesRead = 0;
    let closeFD = function (cb) {
      if (fd !== undefined) {
        fs.close(fd, cb)
        closeFD = function noop() {};
      }
    }
    const self = this;
    return miss.from({
      destroy(err, cb) {
        closeFD(cb)
      }
    }, function readFromFile(size, next) {
      if (self.status === 'error') {
        return next(new Error('file error on writing:' + self.error));
      }
      if (bytesRead >= self.size && self.status === 'done') {
        debug('write done');
        return closeFD(e => next(e, null));
      }
      if (bytesRead + size >= self.size && self.status !== 'done') {
        debug('file is writing, wait change');
        return self.once('change', () => readFromFile(size, next))
      }
      if (fd !== undefined) return read(fd)
      fs.open(self.filename, 'r', (err, _fd) => {
        debug('open file to read');
        if (err) return next(err);
        fd = _fd;
        debug('file is open');
        return read(fd);
      })

      function read(fd) {
        const length = Math.min(size, self.size - bytesRead);
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

module.exports = File;
