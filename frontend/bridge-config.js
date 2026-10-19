// Public routing configuration only. Never put a password or cloud secret here.
const gatewayOrigin = 'https://idhssses-d7gtdzl4f86a805c9-1508185821.ap-shanghai.app.tcloudbase.com';
if (location.hostname === 'idhs-idhssses-d7gtdzl4f86a805c9.webapps.tcloudbase.com') {
  location.replace(gatewayOrigin + '/idhs' + location.pathname + location.search + location.hash);
}
window.BRIDGE_CONFIG = { apiBase: '/bridge-api' };
