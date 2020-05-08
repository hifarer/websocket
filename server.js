
/**
 * http server and websocket server using same port
 */

const http = require('http')
const fs = require('fs')
const Websocket = require('./websocket')

let server = http.createServer((req, res) => {
  fs.readFile('./index.html', (err, file) => {
    if (err) throw err
    res.writeHeader(200, {"Content-Type": "text/html"})
    res.write(file)
    res.end()
  })
})
server.on('upgrade', (req, socket, head) => {
  new Websocket().connect(req, socket, head)
})
server.listen(5000)