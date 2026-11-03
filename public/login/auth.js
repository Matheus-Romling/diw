// Recursos compartilhados pelo site e pelas páginas de login.
// As credenciais e as permissões são verificadas pelo servidor local.
window.ViaAuth = (() => {
  const API_URL = 'http://localhost:3000';
  const CLIENT_FIELDS = ['nome', 'cpf', 'email', 'telefone', 'endereco', 'profissao'];
  const APP_URL = new URL('../index.html', document.currentScript.src);
  const TRANSFER_KEY = 'via-login-transfer';
  let accessToken = null;

  async function api(path, options = {}) {
    let response;
    try {
      response = await fetch(`${API_URL}/${path}`, {
        ...options,
        headers: { 'Content-Type': 'application/json', ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}), ...options.headers },
        signal: AbortSignal.timeout(8000),
      });
    } catch {
      throw new Error('Não foi possível conectar ao servidor. Execute npm start na pasta do projeto e tente novamente.');
    }
    if (!response.ok) {
      const data = await response.json().catch(() => ({}));
      throw Object.assign(new Error(data.error || `Não foi possível concluir a operação (HTTP ${response.status}).`), { status: response.status });
    }
    return response.status === 204 ? null : response.json();
  }

  function publicUser(client) {
    if (!client?.id) return null;
    return { ...Object.fromEntries(['id', ...CLIENT_FIELDS].map((key) => [key, client[key] ?? ''])), perfil: client.perfil === 'admin' ? 'admin' : 'cliente' };
  }

  function clearTransfer() {
    sessionStorage.removeItem(TRANSFER_KEY);
  }

  // Transferência de uso único entre páginas. Recarregar o site volta a Visitante.
  function consumeUser() {
    try {
      const raw = sessionStorage.getItem(TRANSFER_KEY);
      clearTransfer();
      const saved = JSON.parse(raw);
      if (!saved?.token || Date.now() - saved.createdAt >= 60000) return null;
      accessToken = saved.token;
      return publicUser(saved.user);
    } catch { return null; }
  }

  function getReturnUrl() {
    try {
      const value = new URLSearchParams(location.search).get('returnTo');
      const url = new URL(value || APP_URL.href, APP_URL);
      const appPaths = [APP_URL.pathname, new URL('.', APP_URL).pathname];
      if (url.origin === APP_URL.origin && appPaths.includes(url.pathname)) return url;
    } catch { /* Um endereço inválido volta para o início. */ }
    return new URL(APP_URL);
  }

  function guestUrl() {
    const url = getReturnUrl();
    url.searchParams.delete('reservar');
    url.searchParams.delete('pedido');
    return url;
  }

  function redirectToLogin(order = null, register = false) {
    const returnUrl = new URL(APP_URL);
    returnUrl.hash = location.hash;
    if (order) {
      returnUrl.searchParams.set('reservar', order.carId || '');
      if (order.orderId) returnUrl.searchParams.set('pedido', order.orderId);
      returnUrl.hash = 'frota';
    }
    const url = new URL(register ? 'cadastro.html' : 'index.html', new URL('login/', APP_URL));
    url.searchParams.set('returnTo', returnUrl.pathname + returnUrl.search + returnUrl.hash);
    location.assign(url);
  }

  function finishLogin(session) {
    sessionStorage.setItem(TRANSFER_KEY, JSON.stringify({ user: publicUser(session.user), token: session.token, createdAt: Date.now() }));
    location.replace(session.user.perfil === 'admin' ? new URL('admin/index.html', APP_URL) : getReturnUrl());
  }

  function logout() {
    const request = accessToken ? api('auth/logout', { method: 'POST' }).catch(() => {}) : Promise.resolve();
    accessToken = null;
    clearTransfer();
    return request;
  }

  return { API_URL, CLIENT_FIELDS, api, publicUser, consumeUser, clearTransfer, getReturnUrl, guestUrl, redirectToLogin, finishLogin, logout };
})();
