const fs = require('fs');
const util = require('util');
const EventEmitter = require('events');

const openFile = util.promisify(fs.open);

class File extends EventEmitter {
  constructor(filename) {
    super();
    this.status = 'writing';
    this.size = 0;
    this.filename = filename;
  }
}

module.exports = File;
