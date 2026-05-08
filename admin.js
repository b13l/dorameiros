const planosDuracao = {
  '24h': 1,
  '7d': 7,
  '30d': 30,
  '60d': 60,
  '180d': 180,
  'anual': 365
};

auth.onAuthStateChanged(async (user) => {
  if (!user) {
    window.location.href = 'login.html';
    return;
  }
  // Verifica se é admin
  const userDoc = await db.collection('usuarios').doc(user.uid).get();
  if (!userDoc.exists || !userDoc.data().admin) {
    alert('Acesso negado');
    auth.signOut();
  }
});

document.getElementById('adminForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const uid = document.getElementById('uidInput').value.trim();
  const plano = document.getElementById('planoSelect').value;
  const dias = planosDuracao[plano];
  const agora = new Date();
  const expiracao = new Date(agora.getTime() + dias * 24 * 60 * 60 * 1000);
  try {
    await db.collection('usuarios').doc(uid).update({
      assinatura: plano,
      expiracaoAssinatura: firebase.firestore.Timestamp.fromDate(expiracao)
    });
    document.getElementById('msgAdmin').textContent = `Assinatura ${plano} ativada até ${expiracao.toLocaleString()}`;
  } catch (err) {
    document.getElementById('msgAdmin').textContent = 'Erro: ' + err.message;
  }
});