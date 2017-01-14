
const crypto = require('crypto');

class WebSocket {
  constructor () {
    this.pingTimes = 0;
    this.state = '';
  }
  connect (req, socket, head) {
    let self = this;
    this.socket = socket;
    this.socket.on('connect', function(data){
      self.action(data);
    });
    this.handshake(req);
    this.sendText('hello world!');

    this.socket.on('data', function(data){
      self.action(data);
    });
    this.socket.on('close', function(data){
      self.state = 'CLOSE';
    });
  }
  handshake (req) {
    let shasum = crypto.createHash('sha1');
    let key = req['Sec-WebSocket-Key'] || req.headers['sec-websocket-key'];     // 小写
    key = shasum.update(key + '258EAFA5-E914-47DA-95CA-C5AB0DC85B11').digest('base64');
    let headers = [
      'HTTP/1.1 101 Switching Protocols',
      'Connection: Upgrade',
      'Upgrade: websocket',
      'Sec-WebSocket-Accept: ' + key,
      'Sec-WebSocket-Version: 13'
    ];
    this.socket.setNoDelay(true);
    this.socket.write(headers.join('\r\n')+'\r\n\r\n');      // 后面必须空两行，一行不行。
    //this.socket.write(headers.concat('','').join('\r\n'));
    this.state = 'OPEN';
    this.check();
  }

  action (data) {
    let {opcode, payloadData} = this.decode(data);
    // 0 附加, 1 文本, 2 二进制, 8 连接关闭, 9 'ping', 10 'pong'
    // 收到ping 发送pong, 收到pong 不需要操作
    switch (opcode){
      case 1:
        console.log(payloadData)
        break;
      case 9:
        this.heartbeat('pong');
        break;
      case 10:
        this.pingTimes = 0; // 接到Pong清零
        break;
      case 8:
        this.socket.destroy();
        break;
      case 0:
      case 2:
      default:
        break;
    }
  }
  sendText (msg) {
    this.socket.write(this.encode(msg));
  }
  check () {
    setTimeout(function () {
      if(this.state != 'OPEN' || this.pingTimes > 3){
        this.socket.destroy();
        return;
      }
      this.pingTimes++;
      this.heartbeat('ping');
      this.check();
    }.bind(this), 10000);
  }
  heartbeat (type) {
    let opcode = type == 'ping' ? 1001 : 1010;
    let buffer = new Buffer(2);
    buffer[0] = parseInt('1000' + opcode, 2); // fin+rsv123+opcode; (10001001).toString(10)不起作用
    buffer[1] = 0;
    this.socket.write(buffer);
  }
  decode (data) {
    let buffer = data;
    let payloadIndex = 2;
    let fin = buffer[0] >= 128;
    let opcode = fin ? buffer[0] - 128 : buffer[0];
    let masked = buffer[1] >= 128;
    let payloadLen = masked ? buffer[1] - 128 : buffer[1];

    if(payloadLen == 126){
      // 后面十六位 buffer[2] buffer[3]
      payloadIndex = 4;
    }else if(payloadLen == 127){
      // 后面六十四位即8个 buffer[2] buffer[3]...buffer[9]
      payloadIndex = 10;
    }
    if(masked){
      payloadIndex += 4;
    }
    // buffer[payloadIndex] 真正的数据开始
    let payloadData = new Buffer(buffer.length - payloadIndex);
    if(masked){
      let maskedData = buffer.slice(payloadIndex - 4, payloadIndex);  //32位，即3个, slice 不改变原数组
      for(let i = payloadIndex, j = 0; i < buffer.length; i++, j++){  //maskedData, payloadData都是新的buffer, 下标不能从payloadIndex开始(即不能用i)
        payloadData[j] = buffer[i]^maskedData[j%4];
      }
    }else{
      payloadData = buffer.slice(payloadIndex, buffer.length);
    }
    return {opcode, payloadData};
  }
  encode (msg) {
    let payloadLen = Buffer.byteLength(msg);
    let b1 = payloadLen;
    let binLen = (payloadLen).toString(2);
    let payloadIndex = 2;
    if(payloadLen > 125){
      // 后面16位为真实长度，最大为16个1表示的二进制，转化为十进制为65535.
      // else 后面64位。
      if(payloadLen <= 65535){
        payloadIndex += 2;
        b1 = 126;
      }else {
        payloadIndex += 8;
        b1 = 127;
      }
    }
    let buffer = new Buffer(payloadIndex + payloadLen);
    buffer[0] = parseInt(10000001, 2); //10000001 =>129 fin+rsv123+opcode;
    buffer[1] = b1;
    if(payloadLen > 125){
      binLen = '0000000'.substr(0, (8 - binLen.length%8)%8) + binLen;
      for(let i = payloadIndex - 1, j = binLen.length/8 - 1; i >= 2; i--, j--){
        buffer[i] = parseInt((j >= 0 ? binLen.substr(j*8, 8) : '00000000'), 2);
      }
    }
    buffer.write(msg, payloadIndex);
    return buffer;
  }

}

module.exports = WebSocket;

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