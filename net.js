/**
 * http server and websocket server using different port
 */

const fs = require('fs')
const net = require('net')
const http = require('http')
const Websocket = require('./websocket')

http.createServer((req, res) => {
  fs.readFile('./index.html', (err, file) => {
    if (err) {
      throw err
    }
    res.writeHeader(200, {"Content-Type": "text/html"})
    res.write(file)
    res.end()
  })
}).listen(7000)

net.createServer(socket => {
  socket.once('data', data => {
    let json = {}
    data.toString().split('\r\n').forEach(item => {
      let [key, value] = item.split(':')
      if(item.indexOf(':') !== -1){
        json[key] = value.trim()
      }
    })
    new Websocket().connect(json, socket)
  })
}).listen(7001)