# Share Local

Aplicativo Windows para duas pessoas compartilharem tela e áudio na rede de casa. Sem cadastro. Uma pessoa abre a sala e a outra entra com o código de seis dígitos. Ambos podem transmitir. A transmissão usa WebRTC, diretamente entre os computadores. Zahir (rajado), Emma (tricolor sem rabinho) e Priya (preta) são os mascotes do tema.

## Usar

1. Baixe o instalador mais recente em [Releases](https://github.com/GalbierY/share-local/releases/latest) e instale nos dois computadores. Os builds locais ficam em `release/`.
2. Conectem os dois à mesma rede Wi-Fi ou cabo. No Firewall do Windows, permitam o Share Local em **redes privadas**. Não é necessário abrir portas no roteador.
3. Um abre a sala. O outro seleciona a sala encontrada e digita o código exibido no primeiro computador. Se a busca não encontrar, digite o IP exibido junto do código.
4. Clique em **Compartilhar tela**, escolha uma tela ou janela. O botão **Parar transmissão** encerra a captura imediatamente; fechar o aplicativo também encerra.

O áudio capturado é o de saída do computador inteiro, mesmo quando apenas uma janela é escolhida. Não há captura de microfone. Enquanto você transmite, o áudio da transmissão recebida fica pausado para evitar que ele seja recapturado e gere retorno. Para assistir com som, parem a transmissão de quem está assistindo. Algumas janelas protegidas, serviços de streaming e dispositivos de áudio podem impedir captura. Wi-Fi de convidados, isolamento entre dispositivos e VPN podem impedir conexão.

O instalador tem aproximadamente 97 MB porque inclui o Electron. Se esse tamanho ultrapassar o limite de anexos da sua conta do Discord, envie um link de download privado pelo Discord. Se houver apenas bloqueio da extensão `.exe`, um ZIP pode ser aceito, mas não reduz significativamente o tamanho. O instalador ainda não possui assinatura digital: o Windows pode exibir um aviso de editor desconhecido.

## Desenvolver

Node.js 22 ou superior, Windows x64:

```powershell
npm ci
npm start
npm test
npm run test:app
npm run dist
```

- `src/main.cjs`: janela Electron, captura, descoberta UDP e conexão da sala.
- `src/preload.cjs`: interface restrita entre a tela e o processo principal.
- `src/renderer.js`: interface e transmissão WebRTC.
- `src/protocol.cjs`: validação das mensagens e dos endereços.
- `src/style.css`: aparência, sem biblioteca de interface.

Para adicionar compartilhamento de arquivos ou outras funções, acrescente ações explícitas na ponte e valide as mensagens no processo principal. A base mantém interface e acesso ao sistema separados, sem um sistema de plugins antecipado.

## Atualizações automáticas

A partir da versão 0.2.0, o aplicativo instalado verifica as releases públicas de `GalbierY/share-local` ao abrir e a cada quatro horas. Baixa em segundo plano, verifica a integridade pelo SHA-512 do manifesto e instala automaticamente quando não há uma sala aberta ou conexão em andamento. O app reinicia depois da instalação. Se estiverem em uma sala, a atualização espera vocês saírem; fechar o app também aplica uma atualização já baixada. Sem internet, o compartilhamento local continua funcionando e o atualizador tenta de novo depois.

**Migração da versão 0.1.0:** é necessário instalar manualmente a 0.2.0 uma única vez em cada PC, pois a primeira versão não continha atualizador. Depois disso, não é preciso reenviar instaladores pelo Discord.

Para lançar a próxima atualização, faça commit das mudanças e execute na branch `main`:

```powershell
npm test
npm run test:app
npm version patch
git push --follow-tags origin main
```

`npm version patch` incrementa a versão, atualiza o lockfile e cria commit e tag (por exemplo, `v0.2.1`). Para mudanças maiores, use `npm version minor`. O workflow `.github/workflows/release.yml` roda no Windows, confere a versão da tag e o destino, executa os testes e publica o instalador, o `.blockmap` e `latest.yml`. Não apague esses arquivos da release: o atualizador depende deles. A release precisa terminar de publicar para os aplicativos encontrarem a nova versão.

O token temporário usado na publicação vem do próprio GitHub Actions; nenhuma credencial é distribuída no instalador. O código e os binários são públicos. O tráfego de atualização usa HTTPS. O app mantém seu identificador interno original para preservar a identidade da instalação após a mudança de nome. O executável ainda não tem assinatura Authenticode; a confiança das atualizações depende do controle desta conta GitHub e do HTTPS. Proteja a conta com autenticação de dois fatores.

Para mudar o repositório de publicação **antes de distribuir**, rode `npm run updates:setup -- https://github.com/USUARIO/REPOSITORIO`, confira o destino e compile novamente. Trocar de endereço depois de distribuir exige uma última release no repositório anterior apontando para o novo. `npm run dist` gera os arquivos localmente sem publicá-los.

## Rede e limites

TCP 45878 para entrada e sinalização; UDP 45879 para descoberta; WebRTC negocia portas UDP dinâmicas para mídia. Só duas pessoas por sala. Não funciona pela internet nesta versão. As salas anunciadas na rede expõem nome e IP, nunca o código.

A mídia WebRTC é criptografada. A sinalização e o código trafegam em WebSocket sem TLS: use somente na rede doméstica de confiança. Não publique a porta no roteador. Para uso fora de casa, será necessário adicionar sinalização autenticada com TLS e um servidor TURN.

## Validação manual antes de distribuir

- Instalar nos dois PCs; criar uma sala, encontrar e entrar com código.
- Tentar código incorreto e terceiro participante; ambos devem ser recusados.
- Transmitir tela com um vídeo e confirmar imagem e som no outro PC.
- Testar transmissão nos dois sentidos, inclusive simultânea; silenciar e tela cheia.
- Parar pela interface e pelo controle de captura do Windows; confirmar que a captura encerrou.
- Fechar o anfitrião; confirmar que o outro retorna à entrada. Reconectar.
- Testar o caminho por IP com a descoberta automática bloqueada.

Os testes unitários validam o protocolo e o comportamento do atualizador (falhas de rede, download automático e espera pela sala ficar livre). `test:app` abre o Electron sem janela visível, testa entrada/recusa de participantes, captura local e recepção WebRTC com vídeo e áudio sintéticos. Também salva uma prévia da interface em `release/preview.png`. A fidelidade do áudio, firewall e qualidade de transmissão exigem o teste real entre os dois computadores. A atualização com instalação e reinício deve ser confirmada com duas releases em um PC de teste; os testes automatizados não reinstalam o aplicativo na máquina do desenvolvedor.

`npm audit --omit=dev` não encontrou vulnerabilidades nas dependências distribuídas. A ferramenta de empacotamento possui um alerta moderado transitivo em `sprintf-js` (negação de serviço com precisão de formatação sem limite), ainda presente após `npm audit fix`; essa dependência não entra no aplicativo distribuído.
