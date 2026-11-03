const api = ViaAuth.api;
const CAR_IMAGES_API = 'https://commons.wikimedia.org/w/api.php';
const carImages = new Map();
const CLIENT_FIELDS = ViaAuth.CLIENT_FIELDS;
// A transferência do login é consumida uma vez; recarregar volta a Visitante.
const state = { veiculos: [], clientes: [], pedidos: [], clientCount: 0, connected: false, user: ViaAuth.consumeUser() };
const money = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' });
const dateFormat = new Intl.DateTimeFormat('pt-BR', { timeZone: 'UTC' });
const $ = (selector) => document.querySelector(selector);
const byId = (collection, id) => collection.find((item) => String(item.id) === String(id));
let toastTimer;
let pendingConfirmation;
let fleetExpanded = false;
const returnParams = new URLSearchParams(location.search);
let pendingOrder = state.user && returnParams.has('reservar') ? { carId: returnParams.get('reservar'), orderId: returnParams.get('pedido') || '' } : null;
if (returnParams.has('reservar') || returnParams.has('pedido')) {
  const url = new URL(location.href);
  url.searchParams.delete('reservar');
  url.searchParams.delete('pedido');
  history.replaceState(null, '', url);
}

function renderSession() {
  $('#session-name').textContent = state.user ? state.user.nome : 'Visitante';
  $('#login-button').hidden = !!state.user;
  $('#logout-button').hidden = !state.user;
  $('#new-client').textContent = state.user ? 'Editar meus dados' : 'Login';
  $('#session-detail').textContent = state.user ? state.user.email : 'Explore nossa frota';
  $('#user-avatar').textContent = state.user ? state.user.nome.trim().split(/\s+/).map((part) => part[0]).slice(0, 2).join('').toUpperCase() : 'V';
}

function openLogin(order = null) {
  ViaAuth.redirectToLogin(order);
}

function logout() {
  ViaAuth.logout();
  document.querySelectorAll('dialog[open]').forEach((dialog) => dialog.close());
  state.user = null;
  pendingOrder = null;
  pendingConfirmation = null;
  ViaAuth.clearTransfer();
  $('#client-form').reset();
  $('#order-form').reset();
  render();
  setSidebarOpen(false);
  showToast('Você saiu da conta. Continue explorando nossa frota.');
}

function ownsOrder(order) {
  return !!state.user && !!order && String(order.clienteId) === String(state.user.id);
}

function escapeHTML(value) {
  return String(value ?? '').replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]);
}

function today() {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
}

function daysBetween(start, end) {
  if (!start || !end) return 0;
  return Math.max(0, Math.round((Date.parse(`${end}T00:00:00Z`) - Date.parse(`${start}T00:00:00Z`)) / 86400000));
}

function formatDate(value) {
  return dateFormat.format(new Date(`${value}T00:00:00Z`));
}

function showToast(message) {
  clearTimeout(toastTimer);
  $('#toast').textContent = message;
  $('#toast').hidden = false;
  toastTimer = setTimeout(() => { $('#toast').hidden = true; }, 4500);
}

function showError(selector, message = '') {
  $(selector).textContent = message;
  $(selector).hidden = !message;
}

function updateStats() {
  $('#stat-cars').textContent = state.connected ? state.veiculos.filter((car) => car.disponivel).length : '—';
  $('#stat-orders').textContent = state.connected ? state.pedidos.filter((order) => ownsOrder(order) && order.status !== 'Cancelado').length : '—';
  $('#stat-clients').textContent = state.connected ? state.clientCount : '—';
}

// Busca as fotos e os créditos em uma única chamada, sem chave de API.
async function loadCarImages() {
  const files = [...new Set(state.veiculos.map((car) => car.imagemArquivo).filter((file) => file && !carImages.has(file)))];
  if (!files.length) return;
  const params = new URLSearchParams({
    action: 'query', format: 'json', formatversion: '2', origin: '*',
    prop: 'imageinfo', iiprop: 'url|extmetadata', iiurlwidth: '640',
    titles: files.join('|'),
  });
  try {
    const response = await fetch(`${CAR_IMAGES_API}?${params}`, { signal: AbortSignal.timeout(10000) });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const data = await response.json();
    if (data.error) throw new Error(data.error.info);
    for (const page of data.query?.pages || []) {
      const image = page.imageinfo?.[0];
      if (!image?.thumburl) continue;
      const metadata = image.extmetadata || {};
      const author = new DOMParser().parseFromString(metadata.Artist?.value || '', 'text/html').body.textContent.trim();
      carImages.set(page.title, {
        url: image.thumburl, source: image.descriptionurl,
        author: author || 'Wikimedia Commons',
        license: metadata.LicenseShortName?.value || '',
        licenseUrl: metadata.LicenseUrl?.value || image.descriptionurl,
      });
    }
    renderCars();
  } catch (error) {
    console.warn('Não foi possível carregar as fotos dos carros. As ilustrações serão mantidas.', error);
  }
}

function updateFleetPreview() {
  const grid = $('#cars-list');
  const preview = $('#fleet-preview');
  const cards = [...grid.querySelectorAll('.car-card')];
  const columns = getComputedStyle(grid).gridTemplateColumns.split(' ').length;
  const hasMore = cards.length > columns;
  const collapsed = hasMore && !fleetExpanded;
  preview.classList.toggle('is-collapsed', collapsed);
  if (collapsed) preview.style.setProperty('--fleet-preview-height', `${cards[0].getBoundingClientRect().height + 100}px`);
  $('#fleet-controls').hidden = !hasMore;
  $('#fleet-toggle').setAttribute('aria-expanded', String(!collapsed));
  $('#fleet-toggle-label').textContent = fleetExpanded ? 'Ver menos' : 'Veja mais';
  $('#fleet-count').textContent = `${cards.length} carros ${$('#car-category').value ? 'nesta categoria' : 'na frota'}`;
  cards.forEach((card, index) => {
    const hidden = collapsed && index >= columns;
    card.inert = hidden;
    if (hidden) card.setAttribute('aria-hidden', 'true');
    else card.removeAttribute('aria-hidden');
  });
}

function renderCars() {
  const category = $('#car-category').value;
  const cars = state.veiculos.filter((car) => !category || car.categoria === category);
  $('#cars-list').innerHTML = cars.map((car) => {
    const visual = ['sand', 'blue'].includes(car.corVisual) ? car.corVisual : '';
    const image = carImages.get(car.imagemArquivo);
    const photo = image ? `<img class="car-image" src="${escapeHTML(image.url)}" alt="Foto ilustrativa de ${escapeHTML(car.marca)} ${escapeHTML(car.modelo)}" loading="lazy" decoding="async" width="640" height="400">` : '';
    const credit = image ? `<p class="car-image-credit">Foto ilustrativa: <a href="${escapeHTML(image.source)}" target="_blank" rel="noopener noreferrer">${escapeHTML(image.author)}</a> · <a href="${escapeHTML(image.licenseUrl)}" target="_blank" rel="noopener noreferrer">${escapeHTML(image.license)}</a></p>` : '';
    return `<article class="car-card">
      <div class="car-visual ${visual}"><span class="category-tag">${escapeHTML(car.categoria)}</span><svg role="img" aria-label="Ilustração de ${escapeHTML(car.marca)} ${escapeHTML(car.modelo)}" ${image ? 'aria-hidden="true"' : ''}><use href="#carro"></use></svg>${photo}</div>
      <div class="car-content"><p class="car-make">${escapeHTML(car.marca)} · ${escapeHTML(car.ano)}</p><h3>${escapeHTML(car.modelo)}</h3>
      <div class="car-features"><span>${escapeHTML(car.cambio)}</span><span>· ${escapeHTML(car.lugares)} lugares</span><span>· ${escapeHTML(car.combustivel)}</span></div>
      <div class="car-bottom"><div class="car-price">${money.format(car.diaria)} <small>/ dia</small></div><button class="btn btn-primary" type="button" data-reserve="${escapeHTML(car.id)}" ${car.disponivel ? '' : 'disabled'}>${car.disponivel ? 'Reservar ↗' : 'Indisponível'}</button></div>${credit}</div></article>`;
  }).join('') || '<p class="empty-state">Nenhum veículo encontrado.</p>';
  updateFleetPreview();
}

function renderOrders() {
  if (!state.user) {
    $('#orders-list').innerHTML = '<tr><td colspan="6" class="empty-state">Entre na sua conta para acompanhar seus pedidos. <button type="button" class="action-button" data-login>Entrar ou criar conta</button></td></tr>';
    return;
  }
  const orders = state.pedidos.filter(ownsOrder).sort((a, b) => String(b.criadoEm).localeCompare(String(a.criadoEm)));
  $('#orders-list').innerHTML = orders.map((order) => {
    const client = byId(state.clientes, order.clienteId);
    const car = byId(state.veiculos, order.veiculoId);
    const statusClass = { Pendente: 'pendente', Aprovado: 'aprovado', Cancelado: 'cancelado' }[order.status] || 'pendente';
    return `<tr><td><strong>#${escapeHTML(order.id)} · ${escapeHTML(client?.nome || 'Cliente indisponível')}</strong><small>Reserva de automóvel</small></td><td>${escapeHTML(car ? `${car.marca} ${car.modelo}` : 'Veículo indisponível')}</td><td>${formatDate(order.dataInicio)} → ${formatDate(order.dataFim)}</td><td>${money.format(order.total)}</td><td><span class="status ${statusClass}">${escapeHTML(order.status)}</span></td><td class="text-end">${order.status !== 'Cancelado' ? `<button class="action-button" type="button" data-edit-order="${escapeHTML(order.id)}">Editar</button><button class="action-button danger" type="button" data-cancel-order="${escapeHTML(order.id)}">Cancelar</button>` : '<small>Encerrado</small>'}</td></tr>`;
  }).join('') || '<tr><td colspan="6" class="empty-state">Você ainda não tem pedidos. Escolha um carro para começar.</td></tr>';
}

function renderClients() {
  const client = state.user;
  $('#clients-list').innerHTML = client ? `<tr><td><strong>${escapeHTML(client.nome)}</strong><small>${escapeHTML(client.profissao || 'Cliente Via')}</small></td><td>${escapeHTML(client.email)}</td><td>${escapeHTML(client.telefone)}</td><td class="text-end"><button class="action-button" type="button" data-edit-client="${escapeHTML(client.id)}">Editar</button><button class="action-button danger" type="button" data-delete-client="${escapeHTML(client.id)}">Excluir conta</button></td></tr>` : '<tr><td colspan="4" class="empty-state">Entre ou crie sua conta para consultar seus dados.</td></tr>';
}

function render() {
  renderSession();
  updateStats();
  renderCars();
  renderOrders();
  renderClients();
}

async function loadData() {
  const retry = $('#retry-connection');
  retry.disabled = true;
  try {
    const [veiculos, clientes, pedidos, resumo] = await Promise.all([api('veiculos'), api('clientes'), api('pedidos'), api('resumo')]);
    if (![veiculos, clientes, pedidos].every(Array.isArray)) throw new Error('O db.json precisa conter as listas veiculos, clientes e pedidos.');
    Object.assign(state, { veiculos, clientes, pedidos, clientCount: resumo.clientes, connected: true });
    if (state.user) state.user = ViaAuth.publicUser(byId(clientes, state.user.id));
    $('#api-alert').hidden = true;
    render();
    loadCarImages();
    if (state.user && pendingOrder) {
      const order = pendingOrder;
      pendingOrder = null;
      openOrder(order.carId, order.orderId);
    }
  } catch (error) {
    state.connected = false;
    updateStats();
    $('#api-alert').hidden = false;
    $('#api-error-detail').textContent = error.message;
    $('#cars-list').innerHTML = '<p class="empty-state">Conecte o servidor para carregar a frota.</p>';
    updateFleetPreview();
    $('#orders-list').innerHTML = '<tr><td colspan="6" class="empty-state">Aguardando conexão com os dados.</td></tr>';
    $('#clients-list').innerHTML = '<tr><td colspan="4" class="empty-state">Aguardando conexão com os dados.</td></tr>';
  } finally {
    retry.disabled = false;
  }
}

function requireConnection() {
  if (state.connected) return true;
  showToast('Inicie o servidor para cadastrar clientes e fazer reservas.');
  $('#api-alert').scrollIntoView({ block: 'center' });
  return false;
}

function openClient(id = state.user?.id) {
  if (!state.user) { openLogin(); return; }
  if (!requireConnection()) return;
  if (id && (!state.user || String(id) !== String(state.user.id))) return;
  const form = $('#client-form');
  form.reset();
  form.elements.id.value = '';
  showError('#client-error');
  const client = id ? state.user : null;
  form.elements.id.value = client?.id || '';
  $('#client-dialog-title').textContent = 'Editar meus dados';
  if (client) CLIENT_FIELDS.forEach((key) => { form.elements.namedItem(key).value = client[key] ?? ''; });
  $('#client-dialog').showModal();
}

function updateEstimate() {
  const form = $('#order-form');
  const car = byId(state.veiculos, form.elements.veiculoId.value);
  const days = daysBetween(form.elements.dataInicio.value, form.elements.dataFim.value);
  form.elements.dataFim.min = form.elements.dataInicio.value || today();
  $('#order-total').textContent = money.format(days * (car?.diaria || 0));
  $('#order-days').textContent = days ? `${days} ${days === 1 ? 'diária' : 'diárias'} · ${money.format(car?.diaria || 0)} por dia` : 'A devolução deve ser após a retirada';
}

function openOrder(carId = '', orderId = '') {
  if (!state.user) {
    openLogin({ carId, orderId });
    return;
  }
  if (!requireConnection()) return;
  const form = $('#order-form');
  const order = orderId ? byId(state.pedidos, orderId) : null;
  if (orderId && (!ownsOrder(order) || order.status === 'Cancelado')) return;
  const availableCars = state.veiculos.filter((car) => car.disponivel || String(car.id) === String(order?.veiculoId));
  if (!availableCars.length) { showToast('Não há veículos disponíveis para reserva.'); return; }
  form.reset();
  form.elements.id.value = order?.id || '';
  showError('#order-error');
  $('#order-dialog-title').textContent = order ? 'Editar reserva' : 'Nova reserva';
  $('#order-client-name').textContent = state.user.nome;
  form.elements.veiculoId.innerHTML = '<option value="">Selecione um veículo</option>' + availableCars.map((car) => `<option value="${escapeHTML(car.id)}">${escapeHTML(car.marca)} ${escapeHTML(car.modelo)} — ${money.format(car.diaria)}/dia</option>`).join('');
  form.elements.dataInicio.min = order && order.dataInicio < today() ? order.dataInicio : today();
  if (order) {
    ['veiculoId', 'dataInicio', 'dataFim'].forEach((key) => { form.elements.namedItem(key).value = order[key]; });
  } else {
    form.elements.veiculoId.value = carId;
    form.elements.dataInicio.value = today();
  }
  updateEstimate();
  $('#order-dialog').showModal();
}

async function saveClient(event) {
  event.preventDefault();
  const form = event.currentTarget;
  const data = new FormData(form);
  const id = data.get('id');
  if (!state.user || String(state.user.id) !== id) return;
  const values = Object.fromEntries(CLIENT_FIELDS.map((key) => [key, data.get(key).trim()]));
  values.email = values.email.toLowerCase();
  values.cpf = values.cpf.replace(/\D/g, '');
  showError('#client-error');
  if (!values.nome || !values.telefone || !values.endereco) { showError('#client-error', 'Preencha nome, telefone e endereço.'); return; }
  if (values.cpf.length !== 11) { showError('#client-error', 'O CPF deve conter 11 dígitos.'); return; }
  const button = form.querySelector('[type="submit"]');
  button.disabled = true;
  try {
    const clients = await api('clientes');
    if (clients.some((client) => String(client.id) !== id && String(client.cpf).replace(/\D/g, '') === values.cpf)) throw new Error('Já existe um cliente cadastrado com este CPF.');
    if (clients.some((client) => String(client.id) !== id && client.email.toLowerCase() === values.email)) throw new Error('Já existe uma conta com este e-mail. Entre na sua conta.');
    const saved = await api(`clientes/${encodeURIComponent(id)}`, { method: 'PATCH', body: JSON.stringify(values) });
    state.clientes = clients.map((client) => String(client.id) === id ? saved : client);
    $('#client-dialog').close();
    form.reset();
    state.user = ViaAuth.publicUser(saved);
    render();
    showToast('Cadastro atualizado com sucesso.');
  } catch (error) { showError('#client-error', error.message); }
  finally { button.disabled = false; }
}

async function saveOrder(event) {
  event.preventDefault();
  if (!state.user) { $('#order-dialog').close(); openLogin(); return; }
  const form = event.currentTarget;
  const values = Object.fromEntries(new FormData(form));
  const id = values.id;
  delete values.id;
  values.clienteId = String(state.user.id);
  showError('#order-error');
  const days = daysBetween(values.dataInicio, values.dataFim);
  if (!days) { showError('#order-error', 'Escolha uma devolução posterior à retirada.'); return; }
  const button = form.querySelector('[type="submit"]');
  button.disabled = true;
  try {
    const [orders, car, client] = await Promise.all([api('pedidos'), api(`veiculos/${encodeURIComponent(values.veiculoId)}`), api(`clientes/${encodeURIComponent(values.clienteId)}`)]);
    if (!client || !car.disponivel) throw new Error('O cliente ou o veículo não está mais disponível.');
    const previous = id ? byId(orders, id) : null;
    if (id && (!ownsOrder(previous) || previous.status === 'Cancelado')) throw new Error('Esta reserva não pode mais ser editada.');
    if (values.dataInicio < today() && values.dataInicio !== previous?.dataInicio) throw new Error('A retirada não pode estar no passado.');
    const conflicting = orders.some((order) => String(order.id) !== id && String(order.veiculoId) === values.veiculoId && order.status !== 'Cancelado' && values.dataInicio < order.dataFim && values.dataFim > order.dataInicio);
    if (conflicting) throw new Error('Este veículo já tem uma reserva nesse período. Escolha outras datas ou outro carro.');
    const data = { ...values, diaria: car.diaria, total: Number((days * car.diaria).toFixed(2)), status: 'Pendente', criadoEm: previous?.criadoEm || new Date().toISOString() };
    const saved = await api(id ? `pedidos/${encodeURIComponent(id)}` : 'pedidos', { method: id ? 'PATCH' : 'POST', body: JSON.stringify(data) });
    state.pedidos = id ? orders.map((order) => String(order.id) === id ? saved : order) : [...orders, saved];
    render();
    $('#order-dialog').close();
    showToast(id ? 'Reserva atualizada e enviada para análise.' : 'Reserva criada! Acompanhe o status na lista de pedidos.');
  } catch (error) { showError('#order-error', error.message); }
  finally { button.disabled = false; }
}

function confirmAction(message, callback) {
  $('#confirm-message').textContent = message;
  showError('#confirm-error');
  pendingConfirmation = callback;
  $('#confirm-dialog').showModal();
}

function deleteClient(id) {
  if (!state.user || String(state.user.id) !== id) return;
  const client = byId(state.clientes, id);
  confirmAction(`Excluir o cadastro de ${client.nome}? Clientes com pedidos vinculados devem ser mantidos para preservar o histórico.`, async () => {
    const orders = await api('pedidos');
    if (orders.some((order) => String(order.clienteId) === id)) throw new Error('Este cliente possui pedidos vinculados e não pode ser excluído.');
    await api(`clientes/${encodeURIComponent(id)}`, { method: 'DELETE' });
    state.clientes = state.clientes.filter((item) => String(item.id) !== id);
    logout();
    showToast('Cliente excluído.');
  });
}

function cancelOrder(id) {
  if (!ownsOrder(byId(state.pedidos, id))) return;
  confirmAction('Deseja cancelar esta reserva? O pedido ficará registrado no histórico como cancelado.', async () => {
    const order = await api(`pedidos/${encodeURIComponent(id)}`);
    if (!ownsOrder(order)) throw new Error('Esta reserva não pertence à sua conta.');
    const saved = await api(`pedidos/${encodeURIComponent(id)}`, { method: 'PATCH', body: JSON.stringify({ status: 'Cancelado' }) });
    state.pedidos = state.pedidos.map((order) => String(order.id) === id ? saved : order);
    render();
    showToast('Reserva cancelada.');
  });
}

$('#login-button').addEventListener('click', () => openLogin());
$('#logout-button').addEventListener('click', logout);
$('#new-client').addEventListener('click', () => openClient(state.user?.id));
$('#new-order').addEventListener('click', () => openOrder());
$('#client-form').addEventListener('submit', saveClient);
$('#order-form').addEventListener('submit', saveOrder);
$('#order-form').addEventListener('input', updateEstimate);
$('#car-category').addEventListener('change', renderCars);
$('#fleet-toggle').addEventListener('click', () => {
  fleetExpanded = !fleetExpanded;
  updateFleetPreview();
  if (!fleetExpanded) $('#frota').scrollIntoView({ block: 'start', behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' });
});
new ResizeObserver(updateFleetPreview).observe($('#cars-list'));
$('#cars-list').addEventListener('error', (event) => {
  const image = event.target;
  if (!image.matches('.car-image')) return;
  image.hidden = true;
  image.parentElement.querySelector('svg').removeAttribute('aria-hidden');
}, true);
$('#retry-connection').addEventListener('click', loadData);
$('#confirm-action').addEventListener('click', async () => {
  const button = $('#confirm-action');
  button.disabled = true;
  try { await pendingConfirmation(); $('#confirm-dialog').close(); }
  catch (error) { showError('#confirm-error', error.message); }
  finally { button.disabled = false; }
});

document.addEventListener('click', (event) => {
  const button = event.target.closest('button');
  if (!button) return;
  if (button.hasAttribute('data-login')) openLogin();
  if (button.classList.contains('close-dialog')) {
    // Mantém o formulário aberto enquanto uma gravação estiver em andamento.
    if (!button.closest('dialog').querySelector('button[type="submit"]:disabled, #confirm-action:disabled')) button.closest('dialog').close();
  }
  if (button.dataset.reserve) openOrder(button.dataset.reserve);
  if (button.dataset.editClient) openClient(button.dataset.editClient);
  if (button.dataset.deleteClient) deleteClient(button.dataset.deleteClient);
  if (button.dataset.editOrder) openOrder('', button.dataset.editOrder);
  if (button.dataset.cancelOrder) cancelOrder(button.dataset.cancelOrder);
});

document.querySelectorAll('dialog').forEach((dialog) => dialog.addEventListener('cancel', (event) => {
  if (dialog.querySelector('button[type="submit"]:disabled, #confirm-action:disabled')) event.preventDefault();
}));

function updateNavigation() {
  const current = location.hash || '#inicio';
  document.querySelectorAll('.nav-item').forEach((link) => {
    const active = link.getAttribute('href') === current;
    link.classList.toggle('active', active);
    if (active) link.setAttribute('aria-current', 'location');
    else link.removeAttribute('aria-current');
    if (active) $('#current-section').textContent = link.textContent.trim().replace(/^\S+\s+/, '');
  });
}

function setSidebarOpen(open) {
  document.body.classList.toggle('sidebar-open', open);
  $('#menu-toggle').setAttribute('aria-expanded', String(open));
  $('#sidebar-backdrop').hidden = !open;
  const mobile = matchMedia('(max-width: 900px)').matches;
  $('#sidebar').inert = mobile && !open;
  $('.workspace').inert = mobile && open;
}

$('#menu-toggle').addEventListener('click', () => {
  setSidebarOpen(true);
  $('#sidebar-close').focus();
});
$('#sidebar-close').addEventListener('click', () => { setSidebarOpen(false); $('#menu-toggle').focus(); });
$('#sidebar-backdrop').addEventListener('click', () => { setSidebarOpen(false); $('#menu-toggle').focus(); });
$('#sidebar').addEventListener('click', (event) => {
  if (event.target.closest('a')) setSidebarOpen(false);
});
document.addEventListener('keydown', (event) => {
  if (event.key === 'Tab' && document.body.classList.contains('sidebar-open')) {
    const items = [...$('#sidebar').querySelectorAll('a, button')].filter((item) => item.offsetParent !== null);
    const first = items[0];
    const last = items[items.length - 1];
    if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
    if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
  }
  if (event.key === 'Escape' && document.body.classList.contains('sidebar-open')) {
    setSidebarOpen(false);
    $('#menu-toggle').focus();
  }
});
matchMedia('(max-width: 900px)').addEventListener('change', () => setSidebarOpen(false));
window.addEventListener('pageshow', (event) => {
  if (event.persisted) { state.user = null; render(); }
});
window.addEventListener('hashchange', updateNavigation);
setSidebarOpen(false);
updateNavigation();
render();
loadData();
