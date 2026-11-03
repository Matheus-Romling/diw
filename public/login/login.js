const form = document.querySelector('#auth-form');
const errorBox = document.querySelector('#auth-error');
const isRegister = form.dataset.mode === 'register';
const returnUrl = ViaAuth.getReturnUrl();

document.querySelector('#guest-link').href = ViaAuth.guestUrl().href;
const switchLink = document.querySelector('#auth-switch-link');
const switchUrl = new URL(isRegister ? 'index.html' : 'cadastro.html', location.href);
switchUrl.searchParams.set('returnTo', returnUrl.pathname + returnUrl.search + returnUrl.hash);
switchLink.href = switchUrl.href;
if (returnUrl.searchParams.has('reservar') && !isRegister) {
  document.querySelector('#auth-description').textContent = 'Entre na sua conta para continuar a reserva do carro escolhido.';
}

form.addEventListener('submit', async (event) => {
  event.preventDefault();
  const button = form.querySelector('[type="submit"]');
  const data = new FormData(form);
  const email = data.get('email').trim().toLowerCase();
  const password = data.get('senha');
  errorBox.hidden = true;
  button.disabled = true;
  button.textContent = isRegister ? 'Criando conta…' : 'Entrando…';
  try {
    if (isRegister && (password.length < 8 || password !== data.get('confirmarSenha'))) {
      throw new Error('Use pelo menos 8 caracteres e confirme a mesma senha.');
    }
    let session;
    if (isRegister) {
      const values = Object.fromEntries(ViaAuth.CLIENT_FIELDS.map((key) => [key, data.get(key).trim()]));
      values.email = email;
      values.cpf = values.cpf.replace(/\D/g, '');
      if (!values.nome || !values.telefone || !values.endereco) throw new Error('Preencha nome, telefone e endereço.');
      if (values.cpf.length !== 11) throw new Error('O CPF deve conter 11 dígitos.');
      session = await ViaAuth.api('auth/register', { method: 'POST', body: JSON.stringify({ ...values, senha: password, confirmarSenha: data.get('confirmarSenha') }) });
    } else {
      session = await ViaAuth.api('auth/login', { method: 'POST', body: JSON.stringify({ email, senha: password }) });
    }
    form.reset();
    ViaAuth.finishLogin(session);
  } catch (error) {
    errorBox.textContent = error.message;
    errorBox.hidden = false;
  } finally {
    button.disabled = false;
    button.textContent = isRegister ? 'Criar conta' : 'Entrar';
  }
});
