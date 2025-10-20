let ioRef = null;

function init(io) {
  ioRef = io;
}

function getIO() {
  return ioRef;
}

function emitToUser(telegramId, event, payload) {
  if (!ioRef || !telegramId) return;
  try {
    ioRef.to(`tg:${String(telegramId)}`).emit(event, payload);
  } catch {}
}

module.exports = { init, getIO, emitToUser };
