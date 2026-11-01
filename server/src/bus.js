// Process-local events → the browser's /api/events stream (new chat messages etc.).
const { EventEmitter } = require('events');
const bus = new EventEmitter();
bus.setMaxListeners(500);
module.exports = bus;
