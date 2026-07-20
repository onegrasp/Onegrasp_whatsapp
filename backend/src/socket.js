let ioInstance = null;

module.exports = {
  setIo(io) {
    ioInstance = io;
  },
  getIo() {
    return ioInstance;
  }
};
