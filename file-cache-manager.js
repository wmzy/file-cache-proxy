const os = require('os');
const miss = require('mississippi');
const LRU = require('lru-cache');

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
    const file = new File(path.join(this.filePath, key));
    this.fileCache.set(key, file);
    const writeStream = fs.createWriteStream(path.join(this.filePath, key));
    writeStream.on('error', () => {
      this.fileCache.del(key);
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
        if (file.status === 'writing') file.status = 'done';
        callback();
      })
    });
  }

  createReadStream(key) {
    const file = this.fileCache.get(key);
    if (!file) throw new Error('file not found');
    if (file.status === 'done') return fs.createReadStream(file.filename);
    let fd;
    let bytesRead = 0;
    return miss.from({
      destroy(err) {
        if (fd !== undefined) fs.close(fd);
      }
    }, function readFromFile(size, next) {
      if (file.status === 'error') {
        if (fd !== undefined) fs.close(fd);
        return next(new Error('file error on writing'));
      }
      if (bytesRead >= file.size && file.status === 'done') {
        return fs.close(fd, next)
      }
      if (bytesRead + size >= file.size && file.status !== 'done') {
        return file.once('change', () => readFromFile(size, next))
      }
      if (fd !== undefined) return read(fd)
      fs.open(file.filename, 'r', (err, _fd) => {
        if (err) return next(err);
        fd = _fd;
        return read(fd);
      })

      function read(fd) {
        const length = Math.min(size, file.size - bytesRead);
        fs.read(fd, Buffer.alloc(length), 0, length, null, (err, br, buffer) => {
          if (err) {
            fs.close(fd);
            return next(err)
          }
          bytesRead += br;
          next(null, buffer)
        })
      }
    })
  }
}

module.exports = FileCacheManager;
