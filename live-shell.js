(function () {
  'use strict';

  var page = document.body;
  var frame = document.getElementById('liveFrame');
  var backendOrigin = String(page.dataset.backendOrigin || '').replace(/\/$/, '');
  var shareImage = String(page.dataset.shareImage || '').trim();
  var allowedToken = /^(?:[A-Za-z0-9_-]{12}|[a-f0-9]{48})$/i;

  function showError(message) {
    document.body.innerHTML = '<div id="errorMessage"></div>';
    document.getElementById('errorMessage').textContent = message;
  }

  function updateMeta(data) {
    var title = String(data && data.title || '直播间').trim() || '直播间';
    var description = String(data && data.description || '点击进入直播间').trim() || '点击进入直播间';
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

  function allowedTopRedirect(value, messageType) {
    try {
      var url = new URL(String(value || ''), backendOrigin);
      if (url.origin !== backendOrigin || url.username || url.password || url.hash) return '';
      var isWechatAuth = url.pathname === '/auth/wechat';
      var isPaymentResult = /^\/live\/[A-Za-z0-9_-]+(?:\/[A-Za-z0-9_-]{12})?\/payment-result$/.test(url.pathname);
      var isBusinessLive = /^\/live\/[A-Za-z0-9_-]+(?:\/[A-Za-z0-9_-]{12})?$/.test(url.pathname);
      if (messageType === 'wechat-login' && !isWechatAuth) return '';
      if (messageType === 'top-redirect' && !isPaymentResult) return '';
      if (messageType === 'business-action') {
        if (!isBusinessLive || !/^\d+$/.test(url.searchParams.get('purchase') || '')) return '';
        var purchaseStep = url.searchParams.get('purchase_step') || '';
        var purchaseQuantity = url.searchParams.get('purchase_quantity') || '';
        if (purchaseStep && purchaseStep !== 'address') return '';
        if (purchaseQuantity && !/^(?:[1-9]|[1-9][0-9])$/.test(purchaseQuantity)) return '';
        Array.from(url.searchParams.keys()).forEach(function (key) {
          if (key !== 'purchase' && key !== 't' && key !== 'purchase_step' && key !== 'purchase_quantity') url.searchParams.delete(key);
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
    var token = pathToken || queryToken;
    if (!/^[A-Za-z0-9_-]{1,64}$/.test(slug) || (token && !allowedToken.test(token))) return null;
    return { slug: slug, token: token };
  }

  var route = parseRoute();
  if (!frame || !/^https:\/\//i.test(backendOrigin) || !route) {
    showError('直播间地址无效或暂未配置');
    return;
  }
  var target = backendOrigin + '/live/' + encodeURIComponent(route.slug);
  if (/^[A-Za-z0-9_-]{12}$/.test(route.token)) target += '/' + encodeURIComponent(route.token);
  else if (/^[a-f0-9]{48}$/i.test(route.token)) target += '?t=' + encodeURIComponent(route.token);
  frame.src = target;

  window.addEventListener('message', function (event) {
    if (event.origin !== backendOrigin || !event.data || typeof event.data !== 'object') return;
    if (event.data.type === 'live-share-info') updateMeta(event.data);
    if ((event.data.type === 'wechat-login' || event.data.type === 'top-redirect' || event.data.type === 'business-action') && event.source === frame.contentWindow) {
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
