self.addEventListener('install', function(e){ self.skipWaiting(); });
self.addEventListener('activate', function(e){ e.waitUntil(self.clients.claim()); });
self.addEventListener('fetch', function(e){
  var req = e.request;
  if (req.method !== 'GET' || req.url.indexOf('/api/') !== -1) return;
  e.respondWith(
    fetch(req).then(function(res){
      var copy = res.clone();
      caches.open('dct-v1').then(function(c){ c.put(req, copy); }).catch(function(){});
      return res;
    }).catch(function(){ return caches.match(req); })
  );
});
