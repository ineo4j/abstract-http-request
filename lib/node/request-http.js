/*jslint white: false, devel: true, onevar: true, undef: true, node: true, nomen: true, regexp: true, plusplus: true, bitwise: true, es5: true, newcap: true, strict: true, maxerr: 5 */
(function (undefined) {
  "use strict";

  require('bufferjs');

  var nodeFileClient = require('./file-client-node')
    , nodeTcpClient = require('./request-tcp')
    , nodeUdpClient = require('./request-udp')
    , nodeHttpResponse = require('./response-http')
    , url = require('url')
    , http = require('http')
    , https = require('https')
    , FormData = require('FormData')
    , FormContent = require('./form-content').FormContent
    , utils = require('../utils')
    , parseJsonp = utils.parseJsonp
    , preset = utils.preset
    , globalOptions;


  globalOptions = {
    redirectCountMax: 3
  };

  function nodeHttpRequest(req, res) {
    var requestOptions
      , options = req.userOptions
      , ev
      , size = 0
      , nativeNodeRequest
      , httpClient;

    // ECONNECT, EPARSE
    function onRequestError(err) {
      clearTimeout(req.timeoutToken); // Clear connection timeout
      req.cancelled = true;
      req.emit('error', err);
    }

    // Set timeout for initial contact of server
    function onRequestTimeout() {
      req.cancelled = true;
      req.emit('error', new Error('timeout'));
      req.abort();
    }

    function makeRequest() {
      var encodedBody = options.encodedBody
        , bodyStream
        ;

      function clientRequest() {

        function abort() {
          nativeNodeRequest && nativeNodeRequest.abort();
        }

        function abortNextTick() {
          process.nextTick(abort);
        }

        requestOptions = {
            host: options.hostname
          , port: options.port
          , path: options.pathname + options.search || ''
          , method: options.method
          , headers: options.headers // auth is in the headers
        };

        requestOptions.headers.host = requestOptions.host
        if (!requestOptions.port) {
          requestOptions.port = 80;
        }

        if (80 !== parseInt(requestOptions.port) && 443 !== parseInt(requestOptions.port)) {
          requestOptions.headers.host += (':' + requestOptions.port);
        }

        // create Connection, Request
        httpClient = ('https:' === options.protocol) ? https : http;
        nativeNodeRequest = httpClient.request(requestOptions, function (response) {
          var ev = {}
            ;

          if (req.nodeData) {
            ev.lengthComputable = true;
            ev.loaded = req.nodeData.length;
            ev.total = req.nodeData.length;
          }

          req.emit('load', ev);
          clearTimeout(req.timeoutToken);
          req.nodeHttpRequest = nodeHttpRequest;
          res.nodeResponse = response;
          res.request = req;
          nodeHttpResponse(req, res);
        });

        nativeNodeRequest.on('error', onRequestError);

        req.nodeRequest = nativeNodeRequest;
        req.abort = abortNextTick;
        res.abort = abortNextTick;
        req.headers = nativeNodeRequest.headers;

        // can't call emit in the same tick the handler is assigned
        process.nextTick(function () {
          req.emit('loadstart', {});
        });
      }

      function sendBody() {
        // TODO stream
        clientRequest();
        bodyStream.on('progress', function (ev) {
          req.emit('progress', ev);
        });
        bodyStream.on('load', function (ev) {
          var data;
          if (ev && ev.target) {
            data = ev.target.result;
          } else {
            data = ev;
          }
          nativeNodeRequest.end(data);
          req.nodeData = data;
          req.emit('progress', {
              lengthComputable: true
            , loaded: data.length
            , total: data.length
            , target: {
              result: data
            }
          });
        });
      }

      if (!encodedBody) {
        clientRequest();
        nativeNodeRequest.end();
        return res;
      }

      if (encodedBody instanceof FormData) {
        // Chunked encoding is off by default because:
        //   * If the body is a stream, we can't compute the length
        //   * Many (prehaps most) webservers don't support client-side chunked encoding
        encodedBody.setNodeChunkedEncoding(options.chunked);
           // TODO .nodeSetChunkedEncoding(options.chunked);
        // TODO pass in headers instead of nodeGetContentType?
        bodyStream = encodedBody.serialize();
        // must get boundary, etc
        options.headers["Content-Type"] = encodedBody.getContentType();
                                              // TODO .nodeGetContentType();
      } else {
        bodyStream = new FormContent(encodedBody).serialize();
                                         // TODO .nodeSerialize();
      }

      // TODO document and use forceChunked
      if (options.chunked) {
        // Node sets this by default
        options.headers['Transfer-Encoding'] = 'chunked';
        delete options.headers["Content-Length"];
        sendBody();
      } else {
        bodyStream.on('size', function (size) {
          options.headers["Content-Length"] = size;
          delete options.headers['Transfer-Encoding'];
          sendBody();
        }); 
      }
    }

    req.timeoutToken = setTimeout(onRequestTimeout, options.timeout);
    
    makeRequest();

    return res;
  }

  function send(req, res) {
    var options = req.userOptions;

    switch(options.protocol) {
      case 'file:':
        return nodeFileClient(req, res);
      break;

      case 'tcp:':
      case 'tcps:':
        return nodeTcpClient(req, res);
      break;

      case 'udp:':
        return nodeUdpClient(req, res);
      break;

      /*
      case 'https:':
        httpClient = https;
      break;

      case 'http:':
      default:
        httpClient = http;
      */
    }

    if (options.jsonp) {
      options.stream = undefined;
      delete options.stream;
    }

    // can be set to undefined
    if (!('user-agent' in options.headers)) {
      options.headers['user-agent'] = 'Node.JS (AbstractHttpRequest v2)';
    }

    return nodeHttpRequest(req, res);
  }

  module.exports = send;
}());
