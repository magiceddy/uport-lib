(function (global, factory) {
  typeof exports === 'object' && typeof module !== 'undefined' ? factory(require('xhr'), require('qs'), require('web3-provider-engine'), require('web3-provider-engine/subproviders/rpc')) :
  typeof define === 'function' && define.amd ? define(['xhr', 'qs', 'web3-provider-engine', 'web3-provider-engine/subproviders/rpc'], factory) :
  (factory(global.xhr,global.qs,global.ProviderEngine,global.RpcSubprovider));
}(this, (function (xhr,qs,ProviderEngine,RpcSubprovider) { 'use strict';

xhr = 'default' in xhr ? xhr['default'] : xhr;
qs = 'default' in qs ? qs['default'] : qs;
ProviderEngine = 'default' in ProviderEngine ? ProviderEngine['default'] : ProviderEngine;
RpcSubprovider = 'default' in RpcSubprovider ? RpcSubprovider['default'] : RpcSubprovider;

/*
 * Emulate 'eth_accounts' / 'eth_sendTransaction' using 'eth_sendRawTransaction'
 *
 * The two callbacks a user needs to implement are:
 * TODO - update this
 * - getAccounts() -- array of addresses supported
 * - signTransaction(tx) -- sign a raw transaction object
 */

var async = require('async')
var inherits = require('util').inherits
var Subprovider = require('web3-provider-engine/subproviders/subprovider.js')

// handles the following RPC methods:
//   eth_coinbase
//   eth_accounts
//   eth_sendTransaction

inherits(UportSubprovider, Subprovider)

function UportSubprovider (opts) {
  var self = this

  // Chasqui URL (default to standard)
  self.msgServer = opts.msgServer

  // uportConnectHandler deals with displaying the
  // uport connect data as QR code or clickable link

  self.uportConnectHandler = opts.uportConnectHandler

  // ethUriHandler deals with displaying the
  // ethereum URI either as a QR code or
  // clickable link for mobile
  self.ethUriHandler = opts.ethUriHandler

  self.closeQR = opts.closeQR

  // Set address if present
  self.address = opts.address
}

UportSubprovider.prototype.handleRequest = function (payload, next, end) {
  var self = this

  switch (payload.method) {

    case 'eth_coinbase':
      self.getAddress(function (err, address) {
        end(err, address)
      })
      return

    case 'eth_accounts':
      self.getAddress(function (err, address) {
      // the result should be a list of addresses
        end(err, [address])
      })
      return

    case 'eth_sendTransaction':
      var txParams = payload.params[0]
      async.waterfall([
        self.validateTransaction.bind(self, txParams),
        self.txParamsToUri.bind(self, txParams),
        self.signAndReturnTxHash.bind(self)
      ], end)
      return

    // case 'eth_sign':
      // var address = payload.params[0]
      // var message = payload.params[1]
      // // non-standard 'extraParams' to be appended to our 'msgParams' obj
      // // good place for metadata
      // var extraParams = payload.params[2] || {}
      // var msgParams = extend(extraParams, {
        // from: address,
        // data: message,
      // })
      // async.waterfall([
        // self.validateMessage.bind(self, msgParams),
        // self.approveMessage.bind(self, msgParams),
        // function checkApproval(didApprove, cb){
          // cb( didApprove ? null : new Error('User denied message signature.') )
        // },
        // self.signMessage.bind(self, msgParams),
      // ], end)
      // return

    default:
      next()
      return

  }
}

UportSubprovider.prototype.txParamsToUri = function (txParams, cb) {
  var uri = 'ethereum:' + txParams.to
  var symbol
  if (!txParams.to) {
    return cb(new Error('Contract creation is not supported by uportProvider'))
  }
  if (txParams.value) {
    uri += '?value=' + parseInt(txParams.value, 16)
  }
  if (txParams.data) {
    symbol = txParams.value ? '&' : '?'
    uri += symbol + 'bytecode=' + txParams.data
  }
  if (txParams.gas) {
    symbol = txParams.value || txParams.data ? '&' : '?'
    uri += symbol + 'gas=' + parseInt(txParams.gas, 16)
  }
  cb(null, uri)
}

UportSubprovider.prototype.signAndReturnTxHash = function (ethUri, cb) {
  var self = this

  var topic = self.msgServer.newTopic('tx')
  ethUri += '&callback_url=' + topic.url
  self.ethUriHandler(ethUri)
  self.msgServer.waitForResult(topic, function (err, txHash) {
    self.closeQR()
    cb(err, txHash)
  })
}

UportSubprovider.prototype.getAddress = function (cb) {
  var self = this

  if (self.address) {
    cb(null, self.address)
  } else {
    var topic = self.msgServer.newTopic('address')
    var ethUri = 'ethereum:me?callback_url=' + topic.url
    self.uportConnectHandler(ethUri)
    self.msgServer.waitForResult(topic, function (err, address) {
      self.closeQR()
      if (!err) self.address = address
      cb(err, address)
    })
  }
}

UportSubprovider.prototype.validateTransaction = function (txParams, cb) {
  var self = this
  self.validateSender(txParams.from, function (err, senderIsValid) {
    if (err) return cb(err)
    if (!senderIsValid) return cb(new Error('Unknown address - unable to sign transaction for this address.'))
    cb()
  })
}

UportSubprovider.prototype.validateMessage = function (msgParams, cb) {
  var self = this
  self.validateSender(msgParams.from, function (err, senderIsValid) {
    if (err) return cb(err)
    if (!senderIsValid) return cb(new Error('Unknown address - unable to sign message for this address.'))
    cb()
  })
}

UportSubprovider.prototype.validateSender = function (senderAddress, cb) {
  var self = this

  var senderIsValid = senderAddress === self.address
  cb(null, senderIsValid)
}

/**
 * Generate a random string
 */
function randomString (length) {
  var chars = '0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ'
  var result = ''
  for (var i = length; i > 0; --i) result += chars[Math.floor(Math.random() * chars.length)]
  return result
}

// const xhr = process.browser ? require('xhr') : require('request')
// const qs = require('qs')
// const randomString = require('../util/randomString.js')

function MsgServer (chasquiUrl, isOnMobile) {
  this.chasquiUrl = chasquiUrl
  this.intervalIds = {}
  this.isOnMobile = isOnMobile
}

MsgServer.prototype.newTopic = function (topicName) {
  var topic = {
    name: topicName,
    id: randomString(16)
  }
  if (this.isOnMobile) {
    topic.url = window.location.href
  } else {
    topic.url = this.chasquiUrl
    if (topicName === 'address') {
      // address url differs from topic
      topic.url += 'addr/' + topic.id
    } else {
      topic.url += topicName + '/' + topic.id
    }
  }
  return topic
}

MsgServer.prototype.waitForResult = function (topic, cb) {
  if (this.isOnMobile) {
    this.waitForHashChange(topic, cb)
  } else {
    this.pollForResult(topic, cb)
  }
}
MsgServer.prototype.waitForHashChange = function (topic, cb) {
  window.onhashchange = function () {
    if (window.location.hash) {
      var params = qs.parse(window.location.hash.slice(1))
      if (params[topic.name]) {
        window.onhashchange = function () {}
        cb(null, params[topic.name])
      } else {
        if (params.error) {
          window.onhashchange = function () {}
          cb(params.error)
        }
      }
    }
  }
}

MsgServer.prototype.pollForResult = function (topic, cb) {
  var self = this

  self.intervalIds[topic.id] = setInterval(xhr.bind(null, {
    uri: topic.url,
    method: 'GET',
    rejectUnauthorized: false
  }, function (err, res, body) {
    if (err) return cb(err)

    // parse response into raw account
    var data
    try {
      data = JSON.parse(body)
      if (data.error) {
        clearInterval(self.intervalIds[topic.id])
        return cb(data.error)
      }
    } catch (err) {
      console.error(err.stack)
      clearInterval(self.intervalIds[topic.id])
      return cb(err)
    }
    // Check for param, stop polling and callback if present
    if (data[topic.name]) {
      clearInterval(self.intervalIds[topic.id])
      self.intervalIds[topic.id] = null
      self.clearTopic(topic.url)
      return cb(null, data[topic.name])
    }
  }), 2000)
}

MsgServer.prototype.clearTopic = function (url) {
  xhr({
    uri: url,
    method: 'DELETE',
    rejectUnauthorized: false
  }, function () {})
}

var qr = require('qr-image')

function QRDisplay () {}

QRDisplay.prototype.openQr = function (data) {
  var uportQR = this.getUportQRDisplay()
  uportQR.style.display = 'block'

  var pngBuffer = qr.imageSync(data, {type: 'png', margin: 2})
  var dataUri = 'data:image/pngbase64,' + pngBuffer.toString('base64')
  var qrImg = uportQR.children[0].children[0]
  qrImg.setAttribute('src', dataUri)
}

QRDisplay.prototype.closeQr = function () {
  var uportQR = this.getUportQRDisplay()
  uportQR.style.display = 'none'
}

QRDisplay.prototype.getUportQRDisplay = function () {
  var bg = document.getElementById('uport-qr')
  if (bg) return bg

  bg = document.createElement('div')
  bg.setAttribute('id', 'uport-qr')
  bg.setAttribute('style', 'position:fixed;top: 0;width:100%;height:100%;z-index:100;background-color:rgba(0,0,0,0.5);text-align:center;')

  var box = document.createElement('div')
  box.setAttribute('style', 'position:relative;top:50%;display:inline-block;z-index:101;background:#fff;transform:translateY(-50%);margin:0 auto;padding:20px')

  var text = document.createElement('p')
  text.innerHTML = 'Please scan with uport app'

  var qrImg = document.createElement('img')
  qrImg.setAttribute('style', 'z-index:102;')

  box.appendChild(qrImg)
  box.appendChild(text)
  bg.appendChild(box)
  document.body.appendChild(bg)
  return bg
}

function isMobile () {
  var check = false;
  (function (a) { if (/(android|bb\d+|meego).+mobile|avantgo|bada\/|blackberry|blazer|compal|elaine|fennec|hiptop|iemobile|ip(hone|od)|iris|kindle|lge |maemo|midp|mmp|mobile.+firefox|netfront|opera m(ob|in)i|palm( os)?|phone|p(ixi|re)\/|plucker|pocket|psp|series(4|6)0|symbian|treo|up\.(browser|link)|vodafone|wap|windows ce|xda|xiino/i.test(a) || /1207|6310|6590|3gso|4thp|50[1-6]i|770s|802s|a wa|abac|ac(er|oo|s\-)|ai(ko|rn)|al(av|ca|co)|amoi|an(ex|ny|yw)|aptu|ar(ch|go)|as(te|us)|attw|au(di|\-m|r |s )|avan|be(ck|ll|nq)|bi(lb|rd)|bl(ac|az)|br(e|v)w|bumb|bw\-(n|u)|c55\/|capi|ccwa|cdm\-|cell|chtm|cldc|cmd\-|co(mp|nd)|craw|da(it|ll|ng)|dbte|dc\-s|devi|dica|dmob|do(c|p)o|ds(12|\-d)|el(49|ai)|em(l2|ul)|er(ic|k0)|esl8|ez([4-7]0|os|wa|ze)|fetc|fly(\-|_)|g1 u|g560|gene|gf\-5|g\-mo|go(\.w|od)|gr(ad|un)|haie|hcit|hd\-(m|p|t)|hei\-|hi(pt|ta)|hp( i|ip)|hs\-c|ht(c(\-| |_|a|g|p|s|t)|tp)|hu(aw|tc)|i\-(20|go|ma)|i230|iac( |\-|\/)|ibro|idea|ig01|ikom|im1k|inno|ipaq|iris|ja(t|v)a|jbro|jemu|jigs|kddi|keji|kgt( |\/)|klon|kpt |kwc\-|kyo(c|k)|le(no|xi)|lg( g|\/(k|l|u)|50|54|\-[a-w])|libw|lynx|m1\-w|m3ga|m50\/|ma(te|ui|xo)|mc(01|21|ca)|m\-cr|me(rc|ri)|mi(o8|oa|ts)|mmef|mo(01|02|bi|de|do|t(\-| |o|v)|zz)|mt(50|p1|v )|mwbp|mywa|n10[0-2]|n20[2-3]|n30(0|2)|n50(0|2|5)|n7(0(0|1)|10)|ne((c|m)\-|on|tf|wf|wg|wt)|nok(6|i)|nzph|o2im|op(ti|wv)|oran|owg1|p800|pan(a|d|t)|pdxg|pg(13|\-([1-8]|c))|phil|pire|pl(ay|uc)|pn\-2|po(ck|rt|se)|prox|psio|pt\-g|qa\-a|qc(07|12|21|32|60|\-[2-7]|i\-)|qtek|r380|r600|raks|rim9|ro(ve|zo)|s55\/|sa(ge|ma|mm|ms|ny|va)|sc(01|h\-|oo|p\-)|sdk\/|se(c(\-|0|1)|47|mc|nd|ri)|sgh\-|shar|sie(\-|m)|sk\-0|sl(45|id)|sm(al|ar|b3|it|t5)|so(ft|ny)|sp(01|h\-|v\-|v )|sy(01|mb)|t2(18|50)|t6(00|10|18)|ta(gt|lk)|tcl\-|tdg\-|tel(i|m)|tim\-|t\-mo|to(pl|sh)|ts(70|m\-|m3|m5)|tx\-9|up(\.b|g1|si)|utst|v400|v750|veri|vi(rg|te)|vk(40|5[0-3]|\-v)|vm40|voda|vulc|vx(52|53|60|61|70|80|81|83|85|98)|w3c(\-| )|webc|whit|wi(g |nc|nw)|wmlb|wonu|x700|yas\-|your|zeto|zte\-/i.test(a.substr(0, 4)))check = true })(navigator.userAgent || navigator.vendor || window.opera)
  return check
}

var CHASQUI_URL = 'https://chasqui.uport.me/'
var INFURA_CONSENSYSNET = 'https://consensysnet.infura.io:8545'

module.exports = Uport

function Uport (dappName, qrDisplay, chasquiUrl) {
  this.dappName = dappName
  this.qrdisplay = qrDisplay || new QRDisplay()
  this.isOnMobile = isMobile(navigator.userAgent)
  this.subprovider = this.createUportSubprovider(chasquiUrl)
}

Uport.prototype.getUportProvider = function (rpcUrl) {
  var engine = new ProviderEngine()

  engine.addProvider(this.subprovider)

  // default url for now
  if (!rpcUrl) rpcUrl = INFURA_CONSENSYSNET
  // data source
  var rpcSubprovider = new RpcSubprovider({
    rpcUrl: rpcUrl
  })
  engine.addProvider(rpcSubprovider)

  // start polling
  engine.start()
  engine.stop()
  return engine
}

Uport.prototype.getUportSubprovider = function () {
  return this.subprovider
}

Uport.prototype.createUportSubprovider = function (chasquiUrl) {
  var self = this

  if (!chasquiUrl) chasquiUrl = CHASQUI_URL

  var opts = {
    msgServer: new MsgServer(chasquiUrl, self.isOnMobile),
    uportConnectHandler: self.handleURI.bind(self),
    ethUriHandler: self.handleURI.bind(self),
    closeQR: self.qrdisplay.closeQr.bind(self.qrdisplay)
  }
  return new UportSubprovider(opts)
}

Uport.prototype.handleURI = function (uri) {
  var self = this
  uri += '&label=' + encodeURI(self.dappName)
  if (self.isOnMobile) {
    window.location.assign(uri)
  } else {
    self.qrdisplay.openQr(uri)
  }
}

})));
//# sourceMappingURL=data:application/json;charset=utf-8;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjpudWxsLCJzb3VyY2VzIjpbIi4uL2xpYi91cG9ydHN1YnByb3ZpZGVyLmpzIiwiLi4vdXRpbC9yYW5kb21TdHJpbmcuanMiLCIuLi9saWIvbXNnU2VydmVyLmpzIiwiLi4vdXRpbC9xcmRpc3BsYXkuanMiLCIuLi91dGlsL2lzTW9iaWxlLmpzIiwiLi4vaW5kZXguanMiXSwic291cmNlc0NvbnRlbnQiOlsiLypcbiAqIEVtdWxhdGUgJ2V0aF9hY2NvdW50cycgLyAnZXRoX3NlbmRUcmFuc2FjdGlvbicgdXNpbmcgJ2V0aF9zZW5kUmF3VHJhbnNhY3Rpb24nXG4gKlxuICogVGhlIHR3byBjYWxsYmFja3MgYSB1c2VyIG5lZWRzIHRvIGltcGxlbWVudCBhcmU6XG4gKiBUT0RPIC0gdXBkYXRlIHRoaXNcbiAqIC0gZ2V0QWNjb3VudHMoKSAtLSBhcnJheSBvZiBhZGRyZXNzZXMgc3VwcG9ydGVkXG4gKiAtIHNpZ25UcmFuc2FjdGlvbih0eCkgLS0gc2lnbiBhIHJhdyB0cmFuc2FjdGlvbiBvYmplY3RcbiAqL1xuXG5jb25zdCBhc3luYyA9IHJlcXVpcmUoJ2FzeW5jJylcbmNvbnN0IGluaGVyaXRzID0gcmVxdWlyZSgndXRpbCcpLmluaGVyaXRzXG5jb25zdCBTdWJwcm92aWRlciA9IHJlcXVpcmUoJ3dlYjMtcHJvdmlkZXItZW5naW5lL3N1YnByb3ZpZGVycy9zdWJwcm92aWRlci5qcycpXG5cbi8vIGhhbmRsZXMgdGhlIGZvbGxvd2luZyBSUEMgbWV0aG9kczpcbi8vICAgZXRoX2NvaW5iYXNlXG4vLyAgIGV0aF9hY2NvdW50c1xuLy8gICBldGhfc2VuZFRyYW5zYWN0aW9uXG5cbmluaGVyaXRzKFVwb3J0U3VicHJvdmlkZXIsIFN1YnByb3ZpZGVyKVxuXG5mdW5jdGlvbiBVcG9ydFN1YnByb3ZpZGVyIChvcHRzKSB7XG4gIGNvbnN0IHNlbGYgPSB0aGlzXG5cbiAgLy8gQ2hhc3F1aSBVUkwgKGRlZmF1bHQgdG8gc3RhbmRhcmQpXG4gIHNlbGYubXNnU2VydmVyID0gb3B0cy5tc2dTZXJ2ZXJcblxuICAvLyB1cG9ydENvbm5lY3RIYW5kbGVyIGRlYWxzIHdpdGggZGlzcGxheWluZyB0aGVcbiAgLy8gdXBvcnQgY29ubmVjdCBkYXRhIGFzIFFSIGNvZGUgb3IgY2xpY2thYmxlIGxpbmtcblxuICBzZWxmLnVwb3J0Q29ubmVjdEhhbmRsZXIgPSBvcHRzLnVwb3J0Q29ubmVjdEhhbmRsZXJcblxuICAvLyBldGhVcmlIYW5kbGVyIGRlYWxzIHdpdGggZGlzcGxheWluZyB0aGVcbiAgLy8gZXRoZXJldW0gVVJJIGVpdGhlciBhcyBhIFFSIGNvZGUgb3JcbiAgLy8gY2xpY2thYmxlIGxpbmsgZm9yIG1vYmlsZVxuICBzZWxmLmV0aFVyaUhhbmRsZXIgPSBvcHRzLmV0aFVyaUhhbmRsZXJcblxuICBzZWxmLmNsb3NlUVIgPSBvcHRzLmNsb3NlUVJcblxuICAvLyBTZXQgYWRkcmVzcyBpZiBwcmVzZW50XG4gIHNlbGYuYWRkcmVzcyA9IG9wdHMuYWRkcmVzc1xufVxuXG5VcG9ydFN1YnByb3ZpZGVyLnByb3RvdHlwZS5oYW5kbGVSZXF1ZXN0ID0gZnVuY3Rpb24gKHBheWxvYWQsIG5leHQsIGVuZCkge1xuICBjb25zdCBzZWxmID0gdGhpc1xuXG4gIHN3aXRjaCAocGF5bG9hZC5tZXRob2QpIHtcblxuICAgIGNhc2UgJ2V0aF9jb2luYmFzZSc6XG4gICAgICBzZWxmLmdldEFkZHJlc3MoZnVuY3Rpb24gKGVyciwgYWRkcmVzcykge1xuICAgICAgICBlbmQoZXJyLCBhZGRyZXNzKVxuICAgICAgfSlcbiAgICAgIHJldHVyblxuXG4gICAgY2FzZSAnZXRoX2FjY291bnRzJzpcbiAgICAgIHNlbGYuZ2V0QWRkcmVzcyhmdW5jdGlvbiAoZXJyLCBhZGRyZXNzKSB7XG4gICAgICAvLyB0aGUgcmVzdWx0IHNob3VsZCBiZSBhIGxpc3Qgb2YgYWRkcmVzc2VzXG4gICAgICAgIGVuZChlcnIsIFthZGRyZXNzXSlcbiAgICAgIH0pXG4gICAgICByZXR1cm5cblxuICAgIGNhc2UgJ2V0aF9zZW5kVHJhbnNhY3Rpb24nOlxuICAgICAgdmFyIHR4UGFyYW1zID0gcGF5bG9hZC5wYXJhbXNbMF1cbiAgICAgIGFzeW5jLndhdGVyZmFsbChbXG4gICAgICAgIHNlbGYudmFsaWRhdGVUcmFuc2FjdGlvbi5iaW5kKHNlbGYsIHR4UGFyYW1zKSxcbiAgICAgICAgc2VsZi50eFBhcmFtc1RvVXJpLmJpbmQoc2VsZiwgdHhQYXJhbXMpLFxuICAgICAgICBzZWxmLnNpZ25BbmRSZXR1cm5UeEhhc2guYmluZChzZWxmKVxuICAgICAgXSwgZW5kKVxuICAgICAgcmV0dXJuXG5cbiAgICAvLyBjYXNlICdldGhfc2lnbic6XG4gICAgICAvLyB2YXIgYWRkcmVzcyA9IHBheWxvYWQucGFyYW1zWzBdXG4gICAgICAvLyB2YXIgbWVzc2FnZSA9IHBheWxvYWQucGFyYW1zWzFdXG4gICAgICAvLyAvLyBub24tc3RhbmRhcmQgJ2V4dHJhUGFyYW1zJyB0byBiZSBhcHBlbmRlZCB0byBvdXIgJ21zZ1BhcmFtcycgb2JqXG4gICAgICAvLyAvLyBnb29kIHBsYWNlIGZvciBtZXRhZGF0YVxuICAgICAgLy8gdmFyIGV4dHJhUGFyYW1zID0gcGF5bG9hZC5wYXJhbXNbMl0gfHwge31cbiAgICAgIC8vIHZhciBtc2dQYXJhbXMgPSBleHRlbmQoZXh0cmFQYXJhbXMsIHtcbiAgICAgICAgLy8gZnJvbTogYWRkcmVzcyxcbiAgICAgICAgLy8gZGF0YTogbWVzc2FnZSxcbiAgICAgIC8vIH0pXG4gICAgICAvLyBhc3luYy53YXRlcmZhbGwoW1xuICAgICAgICAvLyBzZWxmLnZhbGlkYXRlTWVzc2FnZS5iaW5kKHNlbGYsIG1zZ1BhcmFtcyksXG4gICAgICAgIC8vIHNlbGYuYXBwcm92ZU1lc3NhZ2UuYmluZChzZWxmLCBtc2dQYXJhbXMpLFxuICAgICAgICAvLyBmdW5jdGlvbiBjaGVja0FwcHJvdmFsKGRpZEFwcHJvdmUsIGNiKXtcbiAgICAgICAgICAvLyBjYiggZGlkQXBwcm92ZSA/IG51bGwgOiBuZXcgRXJyb3IoJ1VzZXIgZGVuaWVkIG1lc3NhZ2Ugc2lnbmF0dXJlLicpIClcbiAgICAgICAgLy8gfSxcbiAgICAgICAgLy8gc2VsZi5zaWduTWVzc2FnZS5iaW5kKHNlbGYsIG1zZ1BhcmFtcyksXG4gICAgICAvLyBdLCBlbmQpXG4gICAgICAvLyByZXR1cm5cblxuICAgIGRlZmF1bHQ6XG4gICAgICBuZXh0KClcbiAgICAgIHJldHVyblxuXG4gIH1cbn1cblxuVXBvcnRTdWJwcm92aWRlci5wcm90b3R5cGUudHhQYXJhbXNUb1VyaSA9IGZ1bmN0aW9uICh0eFBhcmFtcywgY2IpIHtcbiAgdmFyIHVyaSA9ICdldGhlcmV1bTonICsgdHhQYXJhbXMudG9cbiAgdmFyIHN5bWJvbFxuICBpZiAoIXR4UGFyYW1zLnRvKSB7XG4gICAgcmV0dXJuIGNiKG5ldyBFcnJvcignQ29udHJhY3QgY3JlYXRpb24gaXMgbm90IHN1cHBvcnRlZCBieSB1cG9ydFByb3ZpZGVyJykpXG4gIH1cbiAgaWYgKHR4UGFyYW1zLnZhbHVlKSB7XG4gICAgdXJpICs9ICc/dmFsdWU9JyArIHBhcnNlSW50KHR4UGFyYW1zLnZhbHVlLCAxNilcbiAgfVxuICBpZiAodHhQYXJhbXMuZGF0YSkge1xuICAgIHN5bWJvbCA9IHR4UGFyYW1zLnZhbHVlID8gJyYnIDogJz8nXG4gICAgdXJpICs9IHN5bWJvbCArICdieXRlY29kZT0nICsgdHhQYXJhbXMuZGF0YVxuICB9XG4gIGlmICh0eFBhcmFtcy5nYXMpIHtcbiAgICBzeW1ib2wgPSB0eFBhcmFtcy52YWx1ZSB8fCB0eFBhcmFtcy5kYXRhID8gJyYnIDogJz8nXG4gICAgdXJpICs9IHN5bWJvbCArICdnYXM9JyArIHBhcnNlSW50KHR4UGFyYW1zLmdhcywgMTYpXG4gIH1cbiAgY2IobnVsbCwgdXJpKVxufVxuXG5VcG9ydFN1YnByb3ZpZGVyLnByb3RvdHlwZS5zaWduQW5kUmV0dXJuVHhIYXNoID0gZnVuY3Rpb24gKGV0aFVyaSwgY2IpIHtcbiAgY29uc3Qgc2VsZiA9IHRoaXNcblxuICB2YXIgdG9waWMgPSBzZWxmLm1zZ1NlcnZlci5uZXdUb3BpYygndHgnKVxuICBldGhVcmkgKz0gJyZjYWxsYmFja191cmw9JyArIHRvcGljLnVybFxuICBzZWxmLmV0aFVyaUhhbmRsZXIoZXRoVXJpKVxuICBzZWxmLm1zZ1NlcnZlci53YWl0Rm9yUmVzdWx0KHRvcGljLCBmdW5jdGlvbiAoZXJyLCB0eEhhc2gpIHtcbiAgICBzZWxmLmNsb3NlUVIoKVxuICAgIGNiKGVyciwgdHhIYXNoKVxuICB9KVxufVxuXG5VcG9ydFN1YnByb3ZpZGVyLnByb3RvdHlwZS5nZXRBZGRyZXNzID0gZnVuY3Rpb24gKGNiKSB7XG4gIGNvbnN0IHNlbGYgPSB0aGlzXG5cbiAgaWYgKHNlbGYuYWRkcmVzcykge1xuICAgIGNiKG51bGwsIHNlbGYuYWRkcmVzcylcbiAgfSBlbHNlIHtcbiAgICB2YXIgdG9waWMgPSBzZWxmLm1zZ1NlcnZlci5uZXdUb3BpYygnYWRkcmVzcycpXG4gICAgdmFyIGV0aFVyaSA9ICdldGhlcmV1bTptZT9jYWxsYmFja191cmw9JyArIHRvcGljLnVybFxuICAgIHNlbGYudXBvcnRDb25uZWN0SGFuZGxlcihldGhVcmkpXG4gICAgc2VsZi5tc2dTZXJ2ZXIud2FpdEZvclJlc3VsdCh0b3BpYywgZnVuY3Rpb24gKGVyciwgYWRkcmVzcykge1xuICAgICAgc2VsZi5jbG9zZVFSKClcbiAgICAgIGlmICghZXJyKSBzZWxmLmFkZHJlc3MgPSBhZGRyZXNzXG4gICAgICBjYihlcnIsIGFkZHJlc3MpXG4gICAgfSlcbiAgfVxufVxuXG5VcG9ydFN1YnByb3ZpZGVyLnByb3RvdHlwZS52YWxpZGF0ZVRyYW5zYWN0aW9uID0gZnVuY3Rpb24gKHR4UGFyYW1zLCBjYikge1xuICBjb25zdCBzZWxmID0gdGhpc1xuICBzZWxmLnZhbGlkYXRlU2VuZGVyKHR4UGFyYW1zLmZyb20sIGZ1bmN0aW9uIChlcnIsIHNlbmRlcklzVmFsaWQpIHtcbiAgICBpZiAoZXJyKSByZXR1cm4gY2IoZXJyKVxuICAgIGlmICghc2VuZGVySXNWYWxpZCkgcmV0dXJuIGNiKG5ldyBFcnJvcignVW5rbm93biBhZGRyZXNzIC0gdW5hYmxlIHRvIHNpZ24gdHJhbnNhY3Rpb24gZm9yIHRoaXMgYWRkcmVzcy4nKSlcbiAgICBjYigpXG4gIH0pXG59XG5cblVwb3J0U3VicHJvdmlkZXIucHJvdG90eXBlLnZhbGlkYXRlTWVzc2FnZSA9IGZ1bmN0aW9uIChtc2dQYXJhbXMsIGNiKSB7XG4gIGNvbnN0IHNlbGYgPSB0aGlzXG4gIHNlbGYudmFsaWRhdGVTZW5kZXIobXNnUGFyYW1zLmZyb20sIGZ1bmN0aW9uIChlcnIsIHNlbmRlcklzVmFsaWQpIHtcbiAgICBpZiAoZXJyKSByZXR1cm4gY2IoZXJyKVxuICAgIGlmICghc2VuZGVySXNWYWxpZCkgcmV0dXJuIGNiKG5ldyBFcnJvcignVW5rbm93biBhZGRyZXNzIC0gdW5hYmxlIHRvIHNpZ24gbWVzc2FnZSBmb3IgdGhpcyBhZGRyZXNzLicpKVxuICAgIGNiKClcbiAgfSlcbn1cblxuVXBvcnRTdWJwcm92aWRlci5wcm90b3R5cGUudmFsaWRhdGVTZW5kZXIgPSBmdW5jdGlvbiAoc2VuZGVyQWRkcmVzcywgY2IpIHtcbiAgY29uc3Qgc2VsZiA9IHRoaXNcblxuICB2YXIgc2VuZGVySXNWYWxpZCA9IHNlbmRlckFkZHJlc3MgPT09IHNlbGYuYWRkcmVzc1xuICBjYihudWxsLCBzZW5kZXJJc1ZhbGlkKVxufVxuXG5leHBvcnQgZGVmYXVsdCBVcG9ydFN1YnByb3ZpZGVyXG4iLCIvKipcbiAqIEdlbmVyYXRlIGEgcmFuZG9tIHN0cmluZ1xuICovXG5leHBvcnQgZGVmYXVsdCBmdW5jdGlvbiByYW5kb21TdHJpbmcgKGxlbmd0aCkge1xuICBjb25zdCBjaGFycyA9ICcwMTIzNDU2Nzg5YWJjZGVmZ2hpamtsbW5vcHFyc3R1dnd4eXpBQkNERUZHSElKS0xNTk9QUVJTVFVWV1hZWidcbiAgbGV0IHJlc3VsdCA9ICcnXG4gIGZvciAodmFyIGkgPSBsZW5ndGg7IGkgPiAwOyAtLWkpIHJlc3VsdCArPSBjaGFyc1tNYXRoLmZsb29yKE1hdGgucmFuZG9tKCkgKiBjaGFycy5sZW5ndGgpXVxuICByZXR1cm4gcmVzdWx0XG59XG4iLCIvLyBjb25zdCB4aHIgPSBwcm9jZXNzLmJyb3dzZXIgPyByZXF1aXJlKCd4aHInKSA6IHJlcXVpcmUoJ3JlcXVlc3QnKVxuLy8gY29uc3QgcXMgPSByZXF1aXJlKCdxcycpXG4vLyBjb25zdCByYW5kb21TdHJpbmcgPSByZXF1aXJlKCcuLi91dGlsL3JhbmRvbVN0cmluZy5qcycpXG5cbmltcG9ydCB4aHIgZnJvbSAneGhyJ1xuaW1wb3J0IHFzIGZyb20gJ3FzJ1xuaW1wb3J0IHJhbmRvbVN0cmluZyBmcm9tICcuLi91dGlsL3JhbmRvbVN0cmluZydcblxuZnVuY3Rpb24gTXNnU2VydmVyIChjaGFzcXVpVXJsLCBpc09uTW9iaWxlKSB7XG4gIHRoaXMuY2hhc3F1aVVybCA9IGNoYXNxdWlVcmxcbiAgdGhpcy5pbnRlcnZhbElkcyA9IHt9XG4gIHRoaXMuaXNPbk1vYmlsZSA9IGlzT25Nb2JpbGVcbn1cblxuTXNnU2VydmVyLnByb3RvdHlwZS5uZXdUb3BpYyA9IGZ1bmN0aW9uICh0b3BpY05hbWUpIHtcbiAgdmFyIHRvcGljID0ge1xuICAgIG5hbWU6IHRvcGljTmFtZSxcbiAgICBpZDogcmFuZG9tU3RyaW5nKDE2KVxuICB9XG4gIGlmICh0aGlzLmlzT25Nb2JpbGUpIHtcbiAgICB0b3BpYy51cmwgPSB3aW5kb3cubG9jYXRpb24uaHJlZlxuICB9IGVsc2Uge1xuICAgIHRvcGljLnVybCA9IHRoaXMuY2hhc3F1aVVybFxuICAgIGlmICh0b3BpY05hbWUgPT09ICdhZGRyZXNzJykge1xuICAgICAgLy8gYWRkcmVzcyB1cmwgZGlmZmVycyBmcm9tIHRvcGljXG4gICAgICB0b3BpYy51cmwgKz0gJ2FkZHIvJyArIHRvcGljLmlkXG4gICAgfSBlbHNlIHtcbiAgICAgIHRvcGljLnVybCArPSB0b3BpY05hbWUgKyAnLycgKyB0b3BpYy5pZFxuICAgIH1cbiAgfVxuICByZXR1cm4gdG9waWNcbn1cblxuTXNnU2VydmVyLnByb3RvdHlwZS53YWl0Rm9yUmVzdWx0ID0gZnVuY3Rpb24gKHRvcGljLCBjYikge1xuICBpZiAodGhpcy5pc09uTW9iaWxlKSB7XG4gICAgdGhpcy53YWl0Rm9ySGFzaENoYW5nZSh0b3BpYywgY2IpXG4gIH0gZWxzZSB7XG4gICAgdGhpcy5wb2xsRm9yUmVzdWx0KHRvcGljLCBjYilcbiAgfVxufVxuTXNnU2VydmVyLnByb3RvdHlwZS53YWl0Rm9ySGFzaENoYW5nZSA9IGZ1bmN0aW9uICh0b3BpYywgY2IpIHtcbiAgd2luZG93Lm9uaGFzaGNoYW5nZSA9IGZ1bmN0aW9uICgpIHtcbiAgICBpZiAod2luZG93LmxvY2F0aW9uLmhhc2gpIHtcbiAgICAgIHZhciBwYXJhbXMgPSBxcy5wYXJzZSh3aW5kb3cubG9jYXRpb24uaGFzaC5zbGljZSgxKSlcbiAgICAgIGlmIChwYXJhbXNbdG9waWMubmFtZV0pIHtcbiAgICAgICAgd2luZG93Lm9uaGFzaGNoYW5nZSA9IGZ1bmN0aW9uICgpIHt9XG4gICAgICAgIGNiKG51bGwsIHBhcmFtc1t0b3BpYy5uYW1lXSlcbiAgICAgIH0gZWxzZSB7XG4gICAgICAgIGlmIChwYXJhbXMuZXJyb3IpIHtcbiAgICAgICAgICB3aW5kb3cub25oYXNoY2hhbmdlID0gZnVuY3Rpb24gKCkge31cbiAgICAgICAgICBjYihwYXJhbXMuZXJyb3IpXG4gICAgICAgIH1cbiAgICAgIH1cbiAgICB9XG4gIH1cbn1cblxuTXNnU2VydmVyLnByb3RvdHlwZS5wb2xsRm9yUmVzdWx0ID0gZnVuY3Rpb24gKHRvcGljLCBjYikge1xuICBjb25zdCBzZWxmID0gdGhpc1xuXG4gIHNlbGYuaW50ZXJ2YWxJZHNbdG9waWMuaWRdID0gc2V0SW50ZXJ2YWwoeGhyLmJpbmQobnVsbCwge1xuICAgIHVyaTogdG9waWMudXJsLFxuICAgIG1ldGhvZDogJ0dFVCcsXG4gICAgcmVqZWN0VW5hdXRob3JpemVkOiBmYWxzZVxuICB9LCBmdW5jdGlvbiAoZXJyLCByZXMsIGJvZHkpIHtcbiAgICBpZiAoZXJyKSByZXR1cm4gY2IoZXJyKVxuXG4gICAgLy8gcGFyc2UgcmVzcG9uc2UgaW50byByYXcgYWNjb3VudFxuICAgIHZhciBkYXRhXG4gICAgdHJ5IHtcbiAgICAgIGRhdGEgPSBKU09OLnBhcnNlKGJvZHkpXG4gICAgICBpZiAoZGF0YS5lcnJvcikge1xuICAgICAgICBjbGVhckludGVydmFsKHNlbGYuaW50ZXJ2YWxJZHNbdG9waWMuaWRdKVxuICAgICAgICByZXR1cm4gY2IoZGF0YS5lcnJvcilcbiAgICAgIH1cbiAgICB9IGNhdGNoIChlcnIpIHtcbiAgICAgIGNvbnNvbGUuZXJyb3IoZXJyLnN0YWNrKVxuICAgICAgY2xlYXJJbnRlcnZhbChzZWxmLmludGVydmFsSWRzW3RvcGljLmlkXSlcbiAgICAgIHJldHVybiBjYihlcnIpXG4gICAgfVxuICAgIC8vIENoZWNrIGZvciBwYXJhbSwgc3RvcCBwb2xsaW5nIGFuZCBjYWxsYmFjayBpZiBwcmVzZW50XG4gICAgaWYgKGRhdGFbdG9waWMubmFtZV0pIHtcbiAgICAgIGNsZWFySW50ZXJ2YWwoc2VsZi5pbnRlcnZhbElkc1t0b3BpYy5pZF0pXG4gICAgICBzZWxmLmludGVydmFsSWRzW3RvcGljLmlkXSA9IG51bGxcbiAgICAgIHNlbGYuY2xlYXJUb3BpYyh0b3BpYy51cmwpXG4gICAgICByZXR1cm4gY2IobnVsbCwgZGF0YVt0b3BpYy5uYW1lXSlcbiAgICB9XG4gIH0pLCAyMDAwKVxufVxuXG5Nc2dTZXJ2ZXIucHJvdG90eXBlLmNsZWFyVG9waWMgPSBmdW5jdGlvbiAodXJsKSB7XG4gIHhocih7XG4gICAgdXJpOiB1cmwsXG4gICAgbWV0aG9kOiAnREVMRVRFJyxcbiAgICByZWplY3RVbmF1dGhvcml6ZWQ6IGZhbHNlXG4gIH0sIGZ1bmN0aW9uICgpIHt9KVxufVxuXG5leHBvcnQgZGVmYXVsdCBNc2dTZXJ2ZXJcbiIsInZhciBxciA9IHJlcXVpcmUoJ3FyLWltYWdlJylcblxuZnVuY3Rpb24gUVJEaXNwbGF5ICgpIHt9XG5cblFSRGlzcGxheS5wcm90b3R5cGUub3BlblFyID0gZnVuY3Rpb24gKGRhdGEpIHtcbiAgdmFyIHVwb3J0UVIgPSB0aGlzLmdldFVwb3J0UVJEaXNwbGF5KClcbiAgdXBvcnRRUi5zdHlsZS5kaXNwbGF5ID0gJ2Jsb2NrJ1xuXG4gIHZhciBwbmdCdWZmZXIgPSBxci5pbWFnZVN5bmMoZGF0YSwge3R5cGU6ICdwbmcnLCBtYXJnaW46IDJ9KVxuICB2YXIgZGF0YVVyaSA9ICdkYXRhOmltYWdlL3BuZ2Jhc2U2NCwnICsgcG5nQnVmZmVyLnRvU3RyaW5nKCdiYXNlNjQnKVxuICB2YXIgcXJJbWcgPSB1cG9ydFFSLmNoaWxkcmVuWzBdLmNoaWxkcmVuWzBdXG4gIHFySW1nLnNldEF0dHJpYnV0ZSgnc3JjJywgZGF0YVVyaSlcbn1cblxuUVJEaXNwbGF5LnByb3RvdHlwZS5jbG9zZVFyID0gZnVuY3Rpb24gKCkge1xuICB2YXIgdXBvcnRRUiA9IHRoaXMuZ2V0VXBvcnRRUkRpc3BsYXkoKVxuICB1cG9ydFFSLnN0eWxlLmRpc3BsYXkgPSAnbm9uZSdcbn1cblxuUVJEaXNwbGF5LnByb3RvdHlwZS5nZXRVcG9ydFFSRGlzcGxheSA9IGZ1bmN0aW9uICgpIHtcbiAgbGV0IGJnID0gZG9jdW1lbnQuZ2V0RWxlbWVudEJ5SWQoJ3Vwb3J0LXFyJylcbiAgaWYgKGJnKSByZXR1cm4gYmdcblxuICBiZyA9IGRvY3VtZW50LmNyZWF0ZUVsZW1lbnQoJ2RpdicpXG4gIGJnLnNldEF0dHJpYnV0ZSgnaWQnLCAndXBvcnQtcXInKVxuICBiZy5zZXRBdHRyaWJ1dGUoJ3N0eWxlJywgJ3Bvc2l0aW9uOmZpeGVkO3RvcDogMDt3aWR0aDoxMDAlO2hlaWdodDoxMDAlO3otaW5kZXg6MTAwO2JhY2tncm91bmQtY29sb3I6cmdiYSgwLDAsMCwwLjUpO3RleHQtYWxpZ246Y2VudGVyOycpXG5cbiAgdmFyIGJveCA9IGRvY3VtZW50LmNyZWF0ZUVsZW1lbnQoJ2RpdicpXG4gIGJveC5zZXRBdHRyaWJ1dGUoJ3N0eWxlJywgJ3Bvc2l0aW9uOnJlbGF0aXZlO3RvcDo1MCU7ZGlzcGxheTppbmxpbmUtYmxvY2s7ei1pbmRleDoxMDE7YmFja2dyb3VuZDojZmZmO3RyYW5zZm9ybTp0cmFuc2xhdGVZKC01MCUpO21hcmdpbjowIGF1dG87cGFkZGluZzoyMHB4JylcblxuICB2YXIgdGV4dCA9IGRvY3VtZW50LmNyZWF0ZUVsZW1lbnQoJ3AnKVxuICB0ZXh0LmlubmVySFRNTCA9ICdQbGVhc2Ugc2NhbiB3aXRoIHVwb3J0IGFwcCdcblxuICB2YXIgcXJJbWcgPSBkb2N1bWVudC5jcmVhdGVFbGVtZW50KCdpbWcnKVxuICBxckltZy5zZXRBdHRyaWJ1dGUoJ3N0eWxlJywgJ3otaW5kZXg6MTAyOycpXG5cbiAgYm94LmFwcGVuZENoaWxkKHFySW1nKVxuICBib3guYXBwZW5kQ2hpbGQodGV4dClcbiAgYmcuYXBwZW5kQ2hpbGQoYm94KVxuICBkb2N1bWVudC5ib2R5LmFwcGVuZENoaWxkKGJnKVxuICByZXR1cm4gYmdcbn1cblxuZXhwb3J0IGRlZmF1bHQgUVJEaXNwbGF5XG4iLCJmdW5jdGlvbiBpc01vYmlsZSAoKSB7XG4gIHZhciBjaGVjayA9IGZhbHNlO1xuICAoZnVuY3Rpb24gKGEpIHsgaWYgKC8oYW5kcm9pZHxiYlxcZCt8bWVlZ28pLittb2JpbGV8YXZhbnRnb3xiYWRhXFwvfGJsYWNrYmVycnl8YmxhemVyfGNvbXBhbHxlbGFpbmV8ZmVubmVjfGhpcHRvcHxpZW1vYmlsZXxpcChob25lfG9kKXxpcmlzfGtpbmRsZXxsZ2UgfG1hZW1vfG1pZHB8bW1wfG1vYmlsZS4rZmlyZWZveHxuZXRmcm9udHxvcGVyYSBtKG9ifGluKWl8cGFsbSggb3MpP3xwaG9uZXxwKGl4aXxyZSlcXC98cGx1Y2tlcnxwb2NrZXR8cHNwfHNlcmllcyg0fDYpMHxzeW1iaWFufHRyZW98dXBcXC4oYnJvd3NlcnxsaW5rKXx2b2RhZm9uZXx3YXB8d2luZG93cyBjZXx4ZGF8eGlpbm8vaS50ZXN0KGEpIHx8IC8xMjA3fDYzMTB8NjU5MHwzZ3NvfDR0aHB8NTBbMS02XWl8Nzcwc3w4MDJzfGEgd2F8YWJhY3xhYyhlcnxvb3xzXFwtKXxhaShrb3xybil8YWwoYXZ8Y2F8Y28pfGFtb2l8YW4oZXh8bnl8eXcpfGFwdHV8YXIoY2h8Z28pfGFzKHRlfHVzKXxhdHR3fGF1KGRpfFxcLW18ciB8cyApfGF2YW58YmUoY2t8bGx8bnEpfGJpKGxifHJkKXxibChhY3xheil8YnIoZXx2KXd8YnVtYnxid1xcLShufHUpfGM1NVxcL3xjYXBpfGNjd2F8Y2RtXFwtfGNlbGx8Y2h0bXxjbGRjfGNtZFxcLXxjbyhtcHxuZCl8Y3Jhd3xkYShpdHxsbHxuZyl8ZGJ0ZXxkY1xcLXN8ZGV2aXxkaWNhfGRtb2J8ZG8oY3xwKW98ZHMoMTJ8XFwtZCl8ZWwoNDl8YWkpfGVtKGwyfHVsKXxlcihpY3xrMCl8ZXNsOHxleihbNC03XTB8b3N8d2F8emUpfGZldGN8Zmx5KFxcLXxfKXxnMSB1fGc1NjB8Z2VuZXxnZlxcLTV8Z1xcLW1vfGdvKFxcLnd8b2QpfGdyKGFkfHVuKXxoYWllfGhjaXR8aGRcXC0obXxwfHQpfGhlaVxcLXxoaShwdHx0YSl8aHAoIGl8aXApfGhzXFwtY3xodChjKFxcLXwgfF98YXxnfHB8c3x0KXx0cCl8aHUoYXd8dGMpfGlcXC0oMjB8Z298bWEpfGkyMzB8aWFjKCB8XFwtfFxcLyl8aWJyb3xpZGVhfGlnMDF8aWtvbXxpbTFrfGlubm98aXBhcXxpcmlzfGphKHR8dilhfGpicm98amVtdXxqaWdzfGtkZGl8a2VqaXxrZ3QoIHxcXC8pfGtsb258a3B0IHxrd2NcXC18a3lvKGN8ayl8bGUobm98eGkpfGxnKCBnfFxcLyhrfGx8dSl8NTB8NTR8XFwtW2Etd10pfGxpYnd8bHlueHxtMVxcLXd8bTNnYXxtNTBcXC98bWEodGV8dWl8eG8pfG1jKDAxfDIxfGNhKXxtXFwtY3J8bWUocmN8cmkpfG1pKG84fG9hfHRzKXxtbWVmfG1vKDAxfDAyfGJpfGRlfGRvfHQoXFwtfCB8b3x2KXx6eil8bXQoNTB8cDF8diApfG13YnB8bXl3YXxuMTBbMC0yXXxuMjBbMi0zXXxuMzAoMHwyKXxuNTAoMHwyfDUpfG43KDAoMHwxKXwxMCl8bmUoKGN8bSlcXC18b258dGZ8d2Z8d2d8d3QpfG5vayg2fGkpfG56cGh8bzJpbXxvcCh0aXx3dil8b3Jhbnxvd2cxfHA4MDB8cGFuKGF8ZHx0KXxwZHhnfHBnKDEzfFxcLShbMS04XXxjKSl8cGhpbHxwaXJlfHBsKGF5fHVjKXxwblxcLTJ8cG8oY2t8cnR8c2UpfHByb3h8cHNpb3xwdFxcLWd8cWFcXC1hfHFjKDA3fDEyfDIxfDMyfDYwfFxcLVsyLTddfGlcXC0pfHF0ZWt8cjM4MHxyNjAwfHJha3N8cmltOXxybyh2ZXx6byl8czU1XFwvfHNhKGdlfG1hfG1tfG1zfG55fHZhKXxzYygwMXxoXFwtfG9vfHBcXC0pfHNka1xcL3xzZShjKFxcLXwwfDEpfDQ3fG1jfG5kfHJpKXxzZ2hcXC18c2hhcnxzaWUoXFwtfG0pfHNrXFwtMHxzbCg0NXxpZCl8c20oYWx8YXJ8YjN8aXR8dDUpfHNvKGZ0fG55KXxzcCgwMXxoXFwtfHZcXC18diApfHN5KDAxfG1iKXx0MigxOHw1MCl8dDYoMDB8MTB8MTgpfHRhKGd0fGxrKXx0Y2xcXC18dGRnXFwtfHRlbChpfG0pfHRpbVxcLXx0XFwtbW98dG8ocGx8c2gpfHRzKDcwfG1cXC18bTN8bTUpfHR4XFwtOXx1cChcXC5ifGcxfHNpKXx1dHN0fHY0MDB8djc1MHx2ZXJpfHZpKHJnfHRlKXx2ayg0MHw1WzAtM118XFwtdil8dm00MHx2b2RhfHZ1bGN8dngoNTJ8NTN8NjB8NjF8NzB8ODB8ODF8ODN8ODV8OTgpfHczYyhcXC18ICl8d2ViY3x3aGl0fHdpKGcgfG5jfG53KXx3bWxifHdvbnV8eDcwMHx5YXNcXC18eW91cnx6ZXRvfHp0ZVxcLS9pLnRlc3QoYS5zdWJzdHIoMCwgNCkpKWNoZWNrID0gdHJ1ZSB9KShuYXZpZ2F0b3IudXNlckFnZW50IHx8IG5hdmlnYXRvci52ZW5kb3IgfHwgd2luZG93Lm9wZXJhKVxuICByZXR1cm4gY2hlY2tcbn1cblxuZXhwb3J0IGRlZmF1bHQgaXNNb2JpbGVcbiIsImltcG9ydCBVcG9ydFN1YnByb3ZpZGVyIGZyb20gJy4vbGliL3Vwb3J0c3VicHJvdmlkZXInXG5pbXBvcnQgTXNnU2VydmVyIGZyb20gJy4vbGliL21zZ1NlcnZlcidcbmltcG9ydCBQcm92aWRlckVuZ2luZSBmcm9tICd3ZWIzLXByb3ZpZGVyLWVuZ2luZSdcbmltcG9ydCBScGNTdWJwcm92aWRlciBmcm9tICd3ZWIzLXByb3ZpZGVyLWVuZ2luZS9zdWJwcm92aWRlcnMvcnBjJ1xuaW1wb3J0IFFSRGlzcGxheSBmcm9tICcuL3V0aWwvcXJkaXNwbGF5J1xuaW1wb3J0IGlzTW9iaWxlIGZyb20gJy4vdXRpbC9pc01vYmlsZSdcblxuY29uc3QgQ0hBU1FVSV9VUkwgPSAnaHR0cHM6Ly9jaGFzcXVpLnVwb3J0Lm1lLydcbmNvbnN0IElORlVSQV9DT05TRU5TWVNORVQgPSAnaHR0cHM6Ly9jb25zZW5zeXNuZXQuaW5mdXJhLmlvOjg1NDUnXG5cbm1vZHVsZS5leHBvcnRzID0gVXBvcnRcblxuZnVuY3Rpb24gVXBvcnQgKGRhcHBOYW1lLCBxckRpc3BsYXksIGNoYXNxdWlVcmwpIHtcbiAgdGhpcy5kYXBwTmFtZSA9IGRhcHBOYW1lXG4gIHRoaXMucXJkaXNwbGF5ID0gcXJEaXNwbGF5IHx8IG5ldyBRUkRpc3BsYXkoKVxuICB0aGlzLmlzT25Nb2JpbGUgPSBpc01vYmlsZShuYXZpZ2F0b3IudXNlckFnZW50KVxuICB0aGlzLnN1YnByb3ZpZGVyID0gdGhpcy5jcmVhdGVVcG9ydFN1YnByb3ZpZGVyKGNoYXNxdWlVcmwpXG59XG5cblVwb3J0LnByb3RvdHlwZS5nZXRVcG9ydFByb3ZpZGVyID0gZnVuY3Rpb24gKHJwY1VybCkge1xuICB2YXIgZW5naW5lID0gbmV3IFByb3ZpZGVyRW5naW5lKClcblxuICBlbmdpbmUuYWRkUHJvdmlkZXIodGhpcy5zdWJwcm92aWRlcilcblxuICAvLyBkZWZhdWx0IHVybCBmb3Igbm93XG4gIGlmICghcnBjVXJsKSBycGNVcmwgPSBJTkZVUkFfQ09OU0VOU1lTTkVUXG4gIC8vIGRhdGEgc291cmNlXG4gIHZhciBycGNTdWJwcm92aWRlciA9IG5ldyBScGNTdWJwcm92aWRlcih7XG4gICAgcnBjVXJsOiBycGNVcmxcbiAgfSlcbiAgZW5naW5lLmFkZFByb3ZpZGVyKHJwY1N1YnByb3ZpZGVyKVxuXG4gIC8vIHN0YXJ0IHBvbGxpbmdcbiAgZW5naW5lLnN0YXJ0KClcbiAgZW5naW5lLnN0b3AoKVxuICByZXR1cm4gZW5naW5lXG59XG5cblVwb3J0LnByb3RvdHlwZS5nZXRVcG9ydFN1YnByb3ZpZGVyID0gZnVuY3Rpb24gKCkge1xuICByZXR1cm4gdGhpcy5zdWJwcm92aWRlclxufVxuXG5VcG9ydC5wcm90b3R5cGUuY3JlYXRlVXBvcnRTdWJwcm92aWRlciA9IGZ1bmN0aW9uIChjaGFzcXVpVXJsKSB7XG4gIGNvbnN0IHNlbGYgPSB0aGlzXG5cbiAgaWYgKCFjaGFzcXVpVXJsKSBjaGFzcXVpVXJsID0gQ0hBU1FVSV9VUkxcblxuICB2YXIgb3B0cyA9IHtcbiAgICBtc2dTZXJ2ZXI6IG5ldyBNc2dTZXJ2ZXIoY2hhc3F1aVVybCwgc2VsZi5pc09uTW9iaWxlKSxcbiAgICB1cG9ydENvbm5lY3RIYW5kbGVyOiBzZWxmLmhhbmRsZVVSSS5iaW5kKHNlbGYpLFxuICAgIGV0aFVyaUhhbmRsZXI6IHNlbGYuaGFuZGxlVVJJLmJpbmQoc2VsZiksXG4gICAgY2xvc2VRUjogc2VsZi5xcmRpc3BsYXkuY2xvc2VRci5iaW5kKHNlbGYucXJkaXNwbGF5KVxuICB9XG4gIHJldHVybiBuZXcgVXBvcnRTdWJwcm92aWRlcihvcHRzKVxufVxuXG5VcG9ydC5wcm90b3R5cGUuaGFuZGxlVVJJID0gZnVuY3Rpb24gKHVyaSkge1xuICBjb25zdCBzZWxmID0gdGhpc1xuICB1cmkgKz0gJyZsYWJlbD0nICsgZW5jb2RlVVJJKHNlbGYuZGFwcE5hbWUpXG4gIGlmIChzZWxmLmlzT25Nb2JpbGUpIHtcbiAgICB3aW5kb3cubG9jYXRpb24uYXNzaWduKHVyaSlcbiAgfSBlbHNlIHtcbiAgICBzZWxmLnFyZGlzcGxheS5vcGVuUXIodXJpKVxu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
