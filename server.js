
const http = require('http');
const fs = require('fs');
const Websocket = require('./websocket');

let server = http.createServer((req, res) => {
  fs.readFile('./index.html', function (err, file) {
    if (err) {
      throw err;
    }
    res.writeHeader(200, {"Content-Type": "text/html"});
    res.write(file);
    res.end();
  });
});
server.listen(5000);
server.on('upgrade', function (req, socket, head) {
  new Websocket().connect(req, socket, head);
});