document.getElementById('isCadastro').addEventListener('change', function() {
  document.getElementById('cadastroExtra').style.display = this.checked ? 'block' : 'none';
});

document.getElementById('authForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const email = document.getElementById('email').value;
  const senha = document.getElementById('senha').value;
  const isCadastro = document.getElementById('isCadastro').checked;
  const whatsapp = document.getElementById('whatsapp').value;
  const erroDiv = document.getElementById('erro');
  erroDiv.style.display = 'none';

  try {
    if (isCadastro) {
      if (!whatsapp) throw new Error('Informe o WhatsApp');
      const userCred = await auth.createUserWithEmailAndPassword(email, senha);
      const uid = userCred.user.uid;
      const agora = firebase.firestore.Timestamp.now();
      const trialAte = new Date(agora.toDate().getTime() + 6 * 60 * 60 * 1000);
  await db.collection('usuarios').doc(uid).set({
  email,
  whatsapp,
  criadoEm: agora,
  trialAte: firebase.firestore.Timestamp.fromDate(trialAte),
  assinatura: 'trial',
  admin: false
});
console.log('Documento criado para o UID:', uid);
      window.location.href = 'index.html';
    } else {
      await auth.signInWithEmailAndPassword(email, senha);
      window.location.href = 'index.html';
    }
  } catch (err) {
    erroDiv.textContent = err.message;
    erroDiv.style.display = 'block';
  }
});
