const $ = (selector) => document.querySelector(selector);
const escapeHTML = (value) => String(value ?? '').replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]);
const money = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' });
const date = (value) => new Intl.DateTimeFormat('pt-BR', { timeZone: 'UTC' }).format(new Date(`${value}T00:00:00Z`));
const state = { user: ViaAuth.consumeUser(), veiculos: [], clientes: [], pedidos: [] };
let confirmation;
let toastTimer;

function toast(message) {
  clearTimeout(toastTimer); $('#toast').textContent = message; $('#toast').hidden = false;
  toastTimer = setTimeout(() => { $('#toast').hidden = true; }, 4000);
}
function showError(selector, message = '') { $(selector).textContent = message; $(selector).hidden = !message; }
async function leave() { await ViaAuth.logout(); location.replace('../index.html'); }
async function request(path, options) {
  try { return await ViaAuth.api(path, options); }
  catch (error) {
    if (error.status === 401 || error.status === 403) { await ViaAuth.logout(); location.replace('../login/index.html'); }
    throw error;
  }
}
function render() {
  $('#admin-stat-cars').textContent = state.veiculos.filter((car) => car.disponivel).length;
  $('#admin-total-cars').textContent = `${state.veiculos.length} na frota`;
  $('#admin-stat-orders').textContent = state.pedidos.filter((order) => order.status === 'Pendente').length;
  $('#admin-stat-clients').textContent = state.clientes.length;
  $('#admin-cars').innerHTML = state.veiculos.map((car) => `<tr><td><strong>${escapeHTML(car.marca)} ${escapeHTML(car.modelo)}</strong><small>${escapeHTML(car.ano)} · ${escapeHTML(car.cambio)}</small></td><td>${escapeHTML(car.placa)}<small>${escapeHTML(car.matricula)}</small></td><td>${escapeHTML(car.categoria)}</td><td>${money.format(car.diaria)}</td><td><button class="admin-availability ${car.disponivel ? '' : 'unavailable'}" data-availability="${escapeHTML(car.id)}" type="button" aria-label="Alterar disponibilidade de ${escapeHTML(car.modelo)}">${car.disponivel ? 'Disponível' : 'Indisponível'}</button></td><td class="text-end"><button class="action-button" data-edit-car="${escapeHTML(car.id)}" type="button">Editar</button><button class="action-button danger" data-delete-car="${escapeHTML(car.id)}" type="button">Excluir</button></td></tr>`).join('') || '<tr><td colspan="6" class="empty-state">Nenhum veículo cadastrado.</td></tr>';
  const filter = $('#admin-order-filter').value;
  $('#admin-orders').innerHTML = [...state.pedidos].filter((order) => !filter || order.status === filter).sort((a, b) => String(b.criadoEm).localeCompare(String(a.criadoEm))).map((order) => {
    const client = state.clientes.find((item) => item.id === order.clienteId);
    const car = state.veiculos.find((item) => item.id === order.veiculoId);
    const statusClass = { Pendente: 'pendente', Aprovado: 'aprovado', Cancelado: 'cancelado' }[order.status] || 'pendente';
    return `<tr><td><strong>#${escapeHTML(order.id)}</strong><small>${escapeHTML(client?.nome || 'Cliente indisponível')}</small></td><td>${escapeHTML(car ? `${car.marca} ${car.modelo}` : 'Veículo indisponível')}</td><td>${date(order.dataInicio)} → ${date(order.dataFim)}</td><td>${money.format(order.total)}</td><td><span class="status ${statusClass}">${escapeHTML(order.status)}</span></td><td class="text-end">${order.status === 'Pendente' ? `<button class="action-button" data-approve="${escapeHTML(order.id)}" type="button">Aprovar</button>` : ''}${order.status !== 'Cancelado' ? `<button class="action-button danger" data-cancel="${escapeHTML(order.id)}" type="button">Cancelar</button>` : '<small>Encerrado</small>'}</td></tr>`;
  }).join('') || '<tr><td colspan="6" class="empty-state">Nenhuma reserva encontrada.</td></tr>';
  $('#admin-clients').innerHTML = state.clientes.map((client) => `<tr><td><strong>${escapeHTML(client.nome)}</strong><small>${escapeHTML(client.cpf)}</small></td><td>${escapeHTML(client.email)}</td><td>${escapeHTML(client.telefone)}</td><td>${state.pedidos.filter((order) => order.clienteId === client.id).length}</td><td class="text-end"><button class="action-button danger" data-delete-client="${escapeHTML(client.id)}" type="button">Excluir</button></td></tr>`).join('') || '<tr><td colspan="5" class="empty-state">Nenhum cliente cadastrado.</td></tr>';
}
async function loadData() {
  $('#admin-retry').disabled = true;
  try {
    const [veiculos, clientes, pedidos] = await Promise.all([request('veiculos'), request('clientes'), request('pedidos')]);
    Object.assign(state, { veiculos, clientes, pedidos });
    $('#admin-error').hidden = true; render();
  } catch (error) { $('#admin-error-message').textContent = error.message; $('#admin-error').hidden = false; }
  finally { $('#admin-retry').disabled = false; }
}
function openCar(id) {
  const form = $('#admin-car-form'); form.reset(); form.elements.id.value = '';
  form.elements.ano.value = new Date().getFullYear();
  const car = state.veiculos.find((item) => item.id === id);
  if (car) Object.entries(car).forEach(([key, value]) => {
    const field = form.elements.namedItem(key);
    if (field) { if (field.type === 'checkbox') field.checked = value; else field.value = value; }
  });
  $('#admin-car-title').textContent = car ? 'Editar carro' : 'Adicionar carro';
  showError('#admin-car-error'); $('#admin-car-dialog').showModal();
}
function confirm(message, action) {
  confirmation = action; $('#admin-confirm-message').textContent = message;
  showError('#admin-confirm-error'); $('#admin-confirm').showModal();
}
$('#admin-car-form').addEventListener('submit', async (event) => {
  event.preventDefault(); const form = event.currentTarget; const button = form.querySelector('[type="submit"]');
  const values = Object.fromEntries(new FormData(form)); const id = values.id; delete values.id;
  values.disponivel = form.elements.disponivel.checked;
  for (const key of ['ano', 'lugares', 'diaria']) values[key] = Number(values[key]);
  button.disabled = true; showError('#admin-car-error');
  try {
    await request(id ? `veiculos/${encodeURIComponent(id)}` : 'veiculos', { method: id ? 'PATCH' : 'POST', body: JSON.stringify(values) });
    $('#admin-car-dialog').close(); await loadData(); toast('Veículo salvo.');
  } catch (error) { showError('#admin-car-error', error.message); }
  finally { button.disabled = false; }
});
$('#admin-confirm-action').addEventListener('click', async () => {
  const button = $('#admin-confirm-action'); button.disabled = true;
  try { await confirmation(); $('#admin-confirm').close(); await loadData(); toast('Alteração concluída.'); }
  catch (error) { showError('#admin-confirm-error', error.message); }
  finally { button.disabled = false; }
});
document.addEventListener('click', async (event) => {
  const button = event.target.closest('button'); if (!button) return;
  if (button.classList.contains('close-dialog')) {
    const dialog = button.closest('dialog');
    if (!dialog.querySelector('button:disabled')) dialog.close();
  }
  const data = button.dataset;
  if (data.editCar) openCar(data.editCar);
  if (data.deleteCar) confirm('Excluir este veículo? Carros com reservas vinculadas devem ser mantidos no histórico.', () => request(`veiculos/${encodeURIComponent(data.deleteCar)}`, { method: 'DELETE' }));
  if (data.deleteClient) confirm('Excluir este cliente? Cadastros com reservas vinculadas serão mantidos no histórico.', () => request(`clientes/${encodeURIComponent(data.deleteClient)}`, { method: 'DELETE' }));
  if (data.approve || data.cancel) {
    const id = data.approve || data.cancel; const status = data.approve ? 'Aprovado' : 'Cancelado';
    confirm(data.approve ? 'Aprovar esta reserva?' : 'Cancelar esta reserva?', () => request(`pedidos/${encodeURIComponent(id)}`, { method: 'PATCH', body: JSON.stringify({ status }) }));
  }
  if (data.availability) {
    const car = state.veiculos.find((item) => item.id === data.availability); button.disabled = true;
    try { await request(`veiculos/${encodeURIComponent(car.id)}`, { method: 'PATCH', body: JSON.stringify({ disponivel: !car.disponivel }) }); await loadData(); }
    catch (error) { $('#admin-error-message').textContent = error.message; $('#admin-error').hidden = false; }
    finally { button.disabled = false; }
  }
});
document.querySelectorAll('dialog').forEach((dialog) => dialog.addEventListener('cancel', (event) => { if (dialog.querySelector('button:disabled')) event.preventDefault(); }));
$('#admin-new-car').addEventListener('click', () => openCar());
$('#admin-order-filter').addEventListener('change', render);
$('#admin-retry').addEventListener('click', loadData);
$('#admin-logout').addEventListener('click', leave);
function setMenu(open) {
  const mobile = matchMedia('(max-width: 900px)').matches;
  document.body.classList.toggle('sidebar-open', open);
  $('#menu-toggle').setAttribute('aria-expanded', String(open)); $('#sidebar-backdrop').hidden = !open;
  $('#sidebar').inert = mobile && !open; $('.workspace').inert = mobile && open;
}
function navigate() {
  const id = ['resumo', 'frota', 'pedidos', 'clientes'].includes(location.hash.slice(1)) ? location.hash.slice(1) : 'resumo';
  document.querySelectorAll('[data-panel]').forEach((panel) => { panel.hidden = panel.id !== id; });
  document.querySelectorAll('.nav-item').forEach((link) => {
    const active = link.hash === `#${id}`; link.classList.toggle('active', active);
    if (active) { link.setAttribute('aria-current', 'page'); $('#current-section').textContent = link.textContent.trim().replace(/^\S+\s+/, ''); }
    else link.removeAttribute('aria-current');
  });
  setMenu(false);
}
$('#menu-toggle').addEventListener('click', () => { setMenu(true); $('#sidebar-close').focus(); });
for (const id of ['#sidebar-close', '#sidebar-backdrop']) $(id).addEventListener('click', () => { setMenu(false); $('#menu-toggle').focus(); });
document.addEventListener('keydown', (event) => {
  if (!document.body.classList.contains('sidebar-open')) return;
  if (event.key === 'Escape') { setMenu(false); $('#menu-toggle').focus(); }
  if (event.key === 'Tab') {
    const items = [...$('#sidebar').querySelectorAll('a, button')].filter((item) => item.offsetParent !== null);
    if (event.shiftKey && document.activeElement === items[0]) { event.preventDefault(); items.at(-1).focus(); }
    if (!event.shiftKey && document.activeElement === items.at(-1)) { event.preventDefault(); items[0].focus(); }
  }
});
window.addEventListener('hashchange', navigate);
matchMedia('(max-width: 900px)').addEventListener('change', () => setMenu(false));
window.addEventListener('pageshow', (event) => { if (event.persisted) location.replace('../login/index.html'); });

async function init() {
  if (state.user?.perfil !== 'admin') { await ViaAuth.logout(); location.replace('../login/index.html'); return; }
  try {
    state.user = await request('auth/me');
    if (state.user.perfil !== 'admin') { await leave(); return; }
    $('#admin-name').textContent = state.user.nome; $('#admin-email').textContent = state.user.email;
    $('#admin-avatar').textContent = state.user.nome.split(/\s+/).map((part) => part[0]).slice(0, 2).join('');
    document.body.hidden = false; navigate(); await loadData();
  } catch { location.replace('../login/index.html'); }
}
init();
