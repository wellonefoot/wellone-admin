(function(){
  'use strict';

  const launchSplash = document.getElementById('pwaLaunchSplash');

  if('serviceWorker' in navigator && (location.protocol === 'https:' || location.hostname === 'localhost')){
    window.addEventListener('load', () => {
      navigator.serviceWorker.register('./sw.js?v=72', {updateViaCache:'none'})
        .then(registration => registration.update().catch(() => {}))
        .catch(() => {});
    }, {once:true});
  }

  function closeLaunchSplash(){
    if(!launchSplash){
      document.documentElement.classList.remove('pwa-launching');
      return;
    }
    window.setTimeout(() => {
      launchSplash.classList.add('is-leaving');
      window.setTimeout(() => {
        document.documentElement.classList.remove('pwa-launching');
        launchSplash.remove();
      }, 320);
    }, 720);
  }

  if(document.documentElement.classList.contains('pwa-launching')){
    requestAnimationFrame(closeLaunchSplash);
  }else if(launchSplash){
    launchSplash.remove();
  }
})();
