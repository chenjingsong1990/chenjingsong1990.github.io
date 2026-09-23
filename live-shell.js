(function () {
  'use strict';

  var page = document.body;
  var frame = document.getElementById('liveFrame');
  var backendOrigin = String(page.dataset.backendOrigin || '').replace(/\/$/, '');
  var paymentOrigin = String(page.dataset.paymentOrigin || backendOrigin).replace(/\/$/, '');
  var shareImage = String(page.dataset.shareImage || '').trim();
  var allowedToken = /^(?:[A-Za-z0-9_-]{12}|[a-f0-9]{48})$/i;
  var authHandoffPattern = /^[a-f0-9]{64}$/i;
  var visitorTokenPattern = /^[a-f0-9]{32}$/i;
  var visitorToken = '';
  var wechatFontMenuBound = false;

  // GitHub Pages 是微信中的顶层 WebView。部分 Android 微信会在顶层直接
  // 放大 iframe 内的字形，因此必须在外壳层先声明页面自行管理字号。
  function resetWechatWebViewFontSize() {
    var userAgent = String(window.navigator && window.navigator.userAgent || '');
    if (!/MicroMessenger/i.test(userAgent)) return false;
    var bridge = window.WeixinJSBridge;
    if (!bridge || typeof bridge.invoke !== 'function') return false;
    try {
      bridge.invoke('setFontSizeCallback', { fontSize: 0 }, function () {});
    } catch (error) {
      return false;
    }
    if (!wechatFontMenuBound && typeof bridge.on === 'function') {
      wechatFontMenuBound = true;
      bridge.on('menu:setfont', function () {
        try {
          bridge.invoke('setFontSizeCallback', { fontSize: 0 }, function () {});
        } catch (error) {
          // 业务直播页仍有 text-size-adjust 和固定字号变量作为兜底。
        }
      });
    }
    return true;
  }

  function installWechatFontSizeLock() {
    var userAgent = String(window.navigator && window.navigator.userAgent || '');
    if (!/MicroMessenger/i.test(userAgent)) return;
    if (document.addEventListener) {
      document.addEventListener('WeixinJSBridgeReady', resetWechatWebViewFontSize, false);
    }
    if (typeof window.setTimeout === 'function') {
      [0, 120, 500, 1200, 2200].forEach(function (delay) {
        window.setTimeout(resetWechatWebViewFontSize, delay);
      });
    }
  }

  installWechatFontSizeLock();
  try {
    visitorToken = String(localStorage.getItem('private_live_visitor_token') || '').toLowerCase();
    if (!visitorTokenPattern.test(visitorToken)) {
      visitorToken = Array.from(crypto.getRandomValues(new Uint8Array(16))).map(function (value) {
        return value.toString(16).padStart(2, '0');
      }).join('');
      localStorage.setItem('private_live_visitor_token', visitorToken);
    }
  } catch (error) {
    visitorToken = '';
  }

  function showError(message) {
    document.body.innerHTML = '<div id="errorMessage"></div>';
    document.getElementById('errorMessage').textContent = message;
  }

  function updateMeta(data) {
    var title = String(data && data.title || 'zb').trim() || 'zb';
    var description = String(data && data.description || '点击进入zb').trim() || '点击进入zb';
    document.title = title;
    ['shareTitle', 'itemTitle'].forEach(function (id) {
      var node = document.getElementById(id);
      if (node) node.setAttribute('content', title);
    });
    ['pageDescription', 'shareDescription', 'itemDescription'].forEach(function (id) {
      var node = document.getElementById(id);
      if (node) node.setAttribute('content', description);
    });
    var image = shareImage || String(data && data.image || '').trim();
    if (image) {
      var imageNode = document.getElementById('shareImage');
      var itemImageNode = document.getElementById('itemImage');
      if (imageNode) imageNode.setAttribute('content', image);
      if (itemImageNode) itemImageNode.setAttribute('content', image);
    }
  }

  function validShellReturnUrl(value) {
    try {
      var url = new URL(String(value || ''), window.location.href);
      if (url.origin !== window.location.origin || url.username || url.password || url.hash) return false;
      if (!/^\/(?:[^/?#]+\/)?$/.test(url.pathname)) return false;
      var room = url.searchParams.get('room') || '';
      var token = url.searchParams.get('t') || '';
      var authHandoff = url.searchParams.get('auth_handoff') || '';
      if (!/^[A-Za-z0-9_-]{1,64}$/.test(room) || (token && !allowedToken.test(token)) || (authHandoff && !authHandoffPattern.test(authHandoff))) return false;
      return Array.from(url.searchParams.keys()).every(function (key) { return key === 'room' || key === 't' || key === 'auth_handoff'; });
    } catch (error) {
      return false;
    }
  }

  function allowedTopRedirect(value, messageType) {
    try {
      var url = new URL(String(value || ''), backendOrigin);
      if (url.username || url.password || url.hash) return '';
      var isWechatAuth = url.pathname === '/auth/wechat';
      var isPaymentResult = /^\/live\/[A-Za-z0-9_-]+(?:\/[A-Za-z0-9_-]{12})?\/payment-result$/.test(url.pathname);
      var isPaymentHandoff = /^\/live\/[A-Za-z0-9_-]+\/payment-handoff$/.test(url.pathname);
      var isBusinessLive = /^\/live\/[A-Za-z0-9_-]+(?:\/[A-Za-z0-9_-]{12})?$/.test(url.pathname);
      if (messageType === 'wechat-login' && (!isWechatAuth || ![backendOrigin, paymentOrigin].includes(url.origin))) return '';
      if (messageType === 'top-redirect' && !isPaymentResult) return '';
      if (messageType === 'payment-handoff') {
        if (url.origin !== paymentOrigin || !isPaymentHandoff) return '';
        if (!/^[a-f0-9]{64}$/i.test(url.searchParams.get('token') || '')) return '';
        if (Array.from(url.searchParams.keys()).some(key => key !== 'token')) return '';
        return url.href;
      }
      if (url.origin !== backendOrigin) return '';
      if (messageType === 'business-action') {
        if (!isBusinessLive || !/^\d+$/.test(url.searchParams.get('purchase') || '')) return '';
        var purchaseStep = url.searchParams.get('purchase_step') || '';
        var purchaseQuantity = url.searchParams.get('purchase_quantity') || '';
        var purchaseAddressId = url.searchParams.get('purchase_address_id') || '';
        var paymentHandoff = url.searchParams.get('payment_handoff') || '';
        var returnUrl = url.searchParams.get('return') || '';
        if (purchaseStep && purchaseStep !== 'address') return '';
        if (purchaseQuantity && !/^(?:[1-9]|[1-9][0-9])$/.test(purchaseQuantity)) return '';
        if (purchaseAddressId && !/^[1-9][0-9]{0,9}$/.test(purchaseAddressId)) return '';
        if (paymentHandoff && paymentHandoff !== '1') return '';
        if (returnUrl && !validShellReturnUrl(returnUrl)) return '';
        Array.from(url.searchParams.keys()).forEach(function (key) {
          if (key !== 'purchase' && key !== 't' && key !== 'purchase_step' && key !== 'purchase_quantity' && key !== 'purchase_address_id' && key !== 'payment_handoff' && key !== 'return') url.searchParams.delete(key);
        });
      }
      return url.href;
    } catch (error) {
      return '';
    }
  }

  function parseRoute() {
    var parts = window.location.pathname.split('/').filter(Boolean);
    var index = parts.indexOf('live');
    var params = new URLSearchParams(window.location.search);
    var slug = index >= 0 ? parts[index + 1] || '' : params.get('room') || '';
    var pathToken = index >= 0 ? parts[index + 2] || '' : '';
    var queryToken = params.get('t') || '';
    var authHandoff = params.get('auth_handoff') || '';
    var token = pathToken || queryToken;
    var paymentState = params.get('payment') || '';
    var paymentOrderNo = params.get('order_no') || '';
    if (!/^[A-Za-z0-9_-]{1,64}$/.test(slug) || (token && !allowedToken.test(token)) || (authHandoff && !authHandoffPattern.test(authHandoff))) return null;
    if (paymentState && !/^(?:success|failed)$/.test(paymentState)) return null;
    if (paymentState && !/^[A-Za-z0-9_-]{1,80}$/.test(paymentOrderNo)) return null;
    return { slug: slug, token: token, authHandoff: authHandoff, paymentState: paymentState, paymentOrderNo: paymentOrderNo };
  }

  var route = parseRoute();
  if (!frame || !/^https:\/\//i.test(backendOrigin) || !route) {
    showError('zb地址无效或暂未配置');
    return;
  }
  if (authHandoffPattern.test(route.authHandoff)) {
    var cleanLocation = new URL(window.location.href);
    cleanLocation.searchParams.delete('auth_handoff');
    window.history.replaceState(window.history.state, '', cleanLocation.pathname + cleanLocation.search + cleanLocation.hash);
  }
  var target = backendOrigin + '/live/' + encodeURIComponent(route.slug);
  if (/^[A-Za-z0-9_-]{12}$/.test(route.token)) target += '/' + encodeURIComponent(route.token);
  var targetParams = new URLSearchParams();
  if (/^[a-f0-9]{48}$/i.test(route.token)) targetParams.set('t', route.token);
  if (authHandoffPattern.test(route.authHandoff)) targetParams.set('auth_handoff', route.authHandoff);
  if (visitorToken) targetParams.set('vt', visitorToken);
  if (route.paymentState) {
    targetParams.set('payment', route.paymentState);
    targetParams.set('order_no', route.paymentOrderNo);
  }
  if (targetParams.toString()) target += '?' + targetParams.toString();
  frame.src = target;

  window.addEventListener('message', function (event) {
    if (event.origin !== backendOrigin || !event.data || typeof event.data !== 'object') return;
    if (event.data.type === 'live-share-info') updateMeta(event.data);
    if ((event.data.type === 'wechat-login' || event.data.type === 'top-redirect' || event.data.type === 'business-action' || event.data.type === 'payment-handoff') && event.source === frame.contentWindow) {
      var target = allowedTopRedirect(event.data.url, event.data.type);
      if (target) window.location.assign(target);
    }
  });
  frame.addEventListener('load', function () {
    try {
      frame.contentWindow.postMessage({ type: 'shell-init', return_url: window.location.href }, backendOrigin);
      frame.contentWindow.postMessage({ type: 'request-live-share-info' }, backendOrigin);
    } catch (error) {
      // Cross-origin access is intentionally limited to postMessage.
    }
  });
})();
