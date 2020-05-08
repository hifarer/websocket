
const crypto = require('crypto')

class WebSocket {
  constructor() {
    this.pingTimes = 0
    this.state = ''
    this.unfinished = null
  }
  connect(req, socket, head) {
    this.socket = socket
    this.handshake(req)
    this.socket.on('connect', data => {
      this.action(data)
    })
    this.socket.on('data', data => {
      this.action(data)
    })
    this.socket.on('close', () => {
      console.log('on close')
      this.state = 'CLOSE'
    })
    this.sendText('hello from server')
  }
  handshake(req) {
    let shasum = crypto.createHash('sha1')
    let key = req['Sec-WebSocket-Key'] || req.headers['sec-websocket-key']
    key = shasum.update(key + '258EAFA5-E914-47DA-95CA-C5AB0DC85B11').digest('base64')
    let headers = [
      'HTTP/1.1 101 Switching Protocols',
      'Connection: Upgrade',
      'Upgrade: websocket',
      'Sec-WebSocket-Accept: ' + key,
      'Sec-WebSocket-Version: 13'
    ]
    this.socket.setNoDelay(true)
    this.socket.write(headers.join('\r\n') + '\r\n\r\n')      // 后面必须空两行，一行不行。
    this.state = 'OPEN'
    this.check()
  }

  action(data) {
    let { fin, opcode, payload } = this.decode(data)
    // 0 附加, 1 文本, 2 二进制, 8 连接关闭, 9 'ping', 10 'pong'
    // 规范上说3~7预留的非控制帧 11~15预留的控制帧，当数据超级大的时候会受到3~7 11~15不知道怎么回事
    // 收到ping发送pong, 收到pong不需要操作
    if (opcode !== 10) {
      console.log(`fin: ${fin}, opcode: ${opcode}`)
    }
    switch (opcode) {
      case 0: {
        this.unfinished.payload = Buffer.concat([
          this.unfinished.payload, payload], 
          this.unfinished.payload.length + payload.length
        )
        if (fin === 1) {
          if (this.unfinished.opcode === 1) {
            console.log(this.unfinished.payload.toString())
          } else {
            // todo 二进制处理
          }
        }
      }
      case 1: 
      case 2: 
        // FIN=0, opcode=0x1 表示文本开始
        if (fin === 0) {
          this.unfinished = {
            payload,
            opcode
          }
        } else {
          if (opcode === 1) {
            console.log(payload.toString())
          } else {
            // todo 二进制处理
          }
        }
        break
      case 8:
        this.socket.destroy()
        break
      case 9:
        this.heartbeat('pong')
        break
      case 10:
        this.pingTimes = 0 // 接到Pong清零
        break
      default:
        break
    }
  }
  sendText(msg) {
    this.socket.write(this.encode(msg))
  }
  check() {
    setTimeout(() => {
      if (this.state != 'OPEN' || this.pingTimes > 3) {
        this.socket.destroy()
      } else {
        this.pingTimes++
        this.heartbeat('ping')
        this.check()
      }
    }, 10000)
  }
  heartbeat(type) {
    let opcode = type == 'ping' ? 0b10001001 : 0b10001010
    let buffer = new Buffer(2)
    buffer[0] = opcode
    buffer[1] = 0
    this.socket.write(buffer)
  }
  decode(buffer) {
    let payloadIndex = 2    // 表示payload的开始索引，payloadLen小于125且masked=0的情况下为2
    let fin = buffer[0] >= 128 ? 1 : 0
    let opcode = (buffer[0] | 0b11110000) - 0b11110000
    let masked = buffer[1] >= 128
    let payloadLen = masked ? buffer[1] - 128 : buffer[1]

    // 后面十六位 buffer[2] buffer[3] 表示真正的长度
    if (payloadLen == 126) {
      payloadIndex += 2
    }
    // 后面六十四位即8字节 buffer[2] buffer[3]...buffer[9] 表示真正的长度
    else if (payloadLen == 127) {
      payloadIndex += 8
    }
    if (masked) {
      payloadIndex += 4
    }
    // buffer[payloadIndex] 真正的数据开始
    let payloadData = new Buffer(buffer.length - payloadIndex)
    if (masked) {
      let maskedData = buffer.slice(payloadIndex - 4, payloadIndex)  //32位，即3个, slice 不改变原数组
      for (let i = payloadIndex, j = 0; i < buffer.length; i++, j++) {  //maskedData, payloadData都是新的buffer, 下标不能从payloadIndex开始(即不能用i)
        payloadData[j] = buffer[i] ^ maskedData[j % 4]
      }
    } else {
      payloadData = buffer.slice(payloadIndex, buffer.length)
    }
    return { fin, opcode, payload: payloadData }
  }
  encode(msg) {
    let byteLength = Buffer.byteLength(msg)
    let byte1 = byteLength    // 第二个字节的内容（下标为1），不需要masked直接取长度
    let payloadIndex = 2    // 默认第三个字节是payload开始
    if (byteLength > 125) {
      // 后面16位为真实长度
      if (byteLength <= 65535) {
        payloadIndex += 2
        byte1 = 126
      }
      // 后面8字节64位为真实长度
      else {
        payloadIndex += 8
        byte1 = 127
      }
    }
    let buffer = new Buffer(payloadIndex + byteLength)
    buffer[0] = 0b10000001 // fin + rsv123 + opcode, 文本且一次发完
    buffer[1] = byte1
    if (byteLength > 125) {
      let binLen = (byteLength).toString(2) // 字符串格式的二进制
      // 假设binLen是12位二进制110100000000，(8 - 12 % 8) % 8的结果是4，'0000000'.substr(0, (8 - 12 % 8) % 8)的结果是'0000'
      // 最终结果是'0000110100000000'，即补齐字节位
      binLen = '0000000'.substr(0, (8 - binLen.length % 8) % 8) + binLen
      // 这里写的是payload length 而不是payload data
      for (let i = payloadIndex - 1, j = binLen.length / 8 - 1; i >= 2; i--, j--) {
        buffer[i] = parseInt(j >= 0 ? binLen.substr(j * 8, 8) : '00000000', 2)
      }
    }
    buffer.write(msg, payloadIndex)
    return buffer
  }

}

module.exports = WebSocket

/*
 https://developer.mozilla.org/zh-CN/docs/WebSockets/Writing_WebSocket_servers
 hello world! 对应的buffer<Buffer 81 8c 4d 62 16 2c 25 07 7a 40 22 42 61 43 3f 0e 72 0d>, 可以用Buffer.from('hello world!')得到，里面的项为16进制
 buffer[0] => 129(十进制), 全部：[129,140,77,98,22,44,37,7,122,64,34,66,97,67,63,14,114,13]
 129 => ‭10000001(二进制)‬ 对应第一格, 即fin = 1, rsv1 = 0...

 0 1 2 3 4 5 6 7 8 9 0 1 2 3 4 5 6 7 8 9 0 1 2 3 4 5 6 7 8 9 0 1
 +-+-+-+-+-------+-+-------------+-------------------------------+
 |F|R|R|R| opcode|M| Payload len |    Extended payload length    |
 |I|S|S|S|  (4)  |A|     (7)     |             (16/64)           |
 |N|V|V|V|       |S|             |   (if payload len==126/127)   |
 | |1|2|3|       |K|             |                               |
 +-+-+-+-+-------+-+-------------+ - - - - - - - - - - - - - - - +
 |     Extended payload length continued, if payload len == 127  |
 + - - - - - - - - - - - - - - - +-------------------------------+
 |                               |Masking-key, if MASK set to 1  |
 +-------------------------------+-------------------------------+
 | Masking-key (continued)       |          Payload Data         |
 +-------------------------------- - - - - - - - - - - - - - - - +
 :                     Payload Data continued ...                :
 + - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - +
 |                     Payload Data continued ...                |
 +---------------------------------------------------------------+
 */